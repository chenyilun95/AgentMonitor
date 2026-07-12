import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { AgentStore } from '../store/AgentStore.js';
import type { MetaAgentManager } from '../services/MetaAgentManager.js';
import type { AgentManager } from '../services/AgentManager.js';
import type { HarnessOrchestrator } from '../services/HarnessOrchestrator.js';
import type { PipelineTask } from '../models/Task.js';
import type { CreateTaskRequest, StartHarnessRequest } from '@agent-monitor/shared';
import { normalizeOptionalUserPath } from '../utils/pathUtils.js';

export function taskRoutes(store: AgentStore, agentManagerPipeline: MetaAgentManager, agentManager?: AgentManager, harnessOrchestrator?: HarnessOrchestrator): Router {
  const router = Router();

  // List all tasks
  router.get('/', (_req, res) => {
    const tasks = store.getAllTasks();
    res.json(tasks);
  });

  // Create task
  router.post('/', (req, res) => {
    const { name, prompt, directory, provider, model, claudeMd, flags, order } = req.body as CreateTaskRequest;

    if (!name || !prompt) {
      res.status(400).json({ error: 'name and prompt are required' });
      return;
    }

    // If no order specified, put it after all existing tasks
    let taskOrder = order;
    if (taskOrder === undefined) {
      const tasks = store.getAllTasks();
      taskOrder = tasks.length > 0
        ? Math.max(...tasks.map(t => t.order)) + 1
        : 0;
    }

    const task: PipelineTask = {
      id: uuid(),
      name,
      prompt,
      directory: normalizeOptionalUserPath(directory),
      provider,
      model,
      claudeMd,
      flags,
      status: 'pending',
      order: taskOrder,
      createdAt: Date.now(),
    };

    store.saveTask(task);
    res.status(201).json(task);
  });

  // Clear completed/failed tasks
  router.post('/actions/clear-completed', (_req, res) => {
    store.clearCompletedTasks();
    res.json({ ok: true });
  });

  // --- Agent Manager config routes (must be before /:id) ---
  router.get('/meta/config', (_req, res) => {
    const cfg = agentManagerPipeline.getConfig();
    res.json(cfg);
  });

  router.put('/meta/config', (req, res) => {
    const cfg = agentManagerPipeline.updateConfig(req.body);
    res.json(cfg);
  });

  router.post('/meta/start', (_req, res) => {
    const tasks = store.getAllTasks();
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) {
      res.status(400).json({ error: 'No pending tasks to run' });
      return;
    }
    agentManagerPipeline.start();
    res.json({ ok: true, running: true });
  });

  router.post('/meta/stop', (_req, res) => {
    agentManagerPipeline.stop();
    res.json({ ok: true, running: false });
  });

  router.get('/meta/status', (_req, res) => {
    res.json({ running: agentManagerPipeline.isRunning() });
  });

  // --- Harness mode routes (must be before /:id) ---
  router.post('/harness/start', (req, res) => {
    if (!harnessOrchestrator) {
      res.status(500).json({ error: 'Harness orchestrator not available' });
      return;
    }
    const { goal, evaluationCriteria, maxRevisions } = req.body as StartHarnessRequest;
    if (!goal) {
      res.status(400).json({ error: 'goal is required' });
      return;
    }

    const cfg = agentManagerPipeline.getConfig();
    agentManagerPipeline.updateConfig({ harnessMode: true, evaluationCriteria, maxRevisionsPerTask: maxRevisions });

    const plannerTask = harnessOrchestrator.startHarness(goal, cfg);
    agentManagerPipeline.start();
    res.json({ ok: true, harnessId: plannerTask.harnessId, plannerTaskId: plannerTask.id });
  });

  router.post('/harness/stop', (_req, res) => {
    if (!harnessOrchestrator) {
      res.status(500).json({ error: 'Harness orchestrator not available' });
      return;
    }
    harnessOrchestrator.stopHarness();
    agentManagerPipeline.stop();
    res.json({ ok: true });
  });

  router.get('/harness/status', (_req, res) => {
    if (!harnessOrchestrator) {
      res.json({ status: 'idle', harnessId: null, goal: null, plannerTaskId: null, totalGenerators: 0, completedGenerators: 0, failedGenerators: 0 });
      return;
    }
    res.json(harnessOrchestrator.getState());
  });

  // --- Parameterized routes (must be after all static routes) ---

  // Get single task
  router.get('/:id', (req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  });

  // Update task
  router.put('/:id', (req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Only allow updates to pending tasks
    if (task.status !== 'pending') {
      res.status(400).json({ error: 'Can only update pending tasks' });
      return;
    }

    const { name, prompt, directory, provider, model, claudeMd, flags, order } = req.body as CreateTaskRequest;
    if (name !== undefined) task.name = name;
    if (prompt !== undefined) task.prompt = prompt;
    if (directory !== undefined) task.directory = normalizeOptionalUserPath(directory);
    if (provider !== undefined) task.provider = provider;
    if (model !== undefined) task.model = model;
    if (claudeMd !== undefined) task.claudeMd = claudeMd;
    if (flags !== undefined) task.flags = flags;
    if (order !== undefined) task.order = order;

    store.saveTask(task);
    res.json(task);
  });

  // Delete task (and its associated agent if any)
  router.delete('/:id', async (req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    // Delete the associated agent from Dashboard
    if (task.agentId && agentManager) {
      try {
        await agentManager.deleteAgent(task.agentId);
      } catch {
        // Agent may already be deleted — ignore
      }
    }
    store.deleteTask(req.params.id);
    res.json({ ok: true });
  });

  // Reset a failed task back to pending
  router.post('/:id/reset', (req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status !== 'failed' && task.status !== 'completed') {
      res.status(400).json({ error: 'Can only reset completed or failed tasks' });
      return;
    }
    task.status = 'pending';
    task.agentId = undefined;
    task.completedAt = undefined;
    task.error = undefined;
    store.saveTask(task);
    res.json(task);
  });

  return router;
}
