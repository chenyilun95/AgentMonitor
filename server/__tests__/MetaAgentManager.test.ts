import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentStore } from '../src/store/AgentStore.js';
import { AgentManager } from '../src/services/AgentManager.js';
import { MetaAgentManager } from '../src/services/MetaAgentManager.js';
import type { PipelineTask } from '../src/models/Task.js';
import type { Agent } from '../src/models/Agent.js';
import { execFileSync } from 'child_process';

describe('AgentManager Pipeline (MetaAgentManager)', () => {
  let tmpDir: string;
  let store: AgentStore;
  let agentManager: AgentManager;
  let pipeline: MetaAgentManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-test-'));
    store = new AgentStore(tmpDir);
    agentManager = new AgentManager(store);
    pipeline = new MetaAgentManager(store, agentManager);
  });

  afterEach(() => {
    pipeline.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts and stops correctly', () => {
    expect(pipeline.isRunning()).toBe(false);
    pipeline.start();
    expect(pipeline.isRunning()).toBe(true);
    pipeline.stop();
    expect(pipeline.isRunning()).toBe(false);
  });

  it('returns default config when none saved', () => {
    const cfg = pipeline.getConfig();
    expect(cfg.providerInstructions).toContain('Agent Manager');
    expect(cfg.running).toBe(false);
    expect(cfg.pollIntervalMs).toBe(5000);
  });

  it('updates config', () => {
    pipeline.updateConfig({
      defaultDirectory: '/new/dir',
      pollIntervalMs: 10000,
    });
    const cfg = pipeline.getConfig();
    expect(cfg.defaultDirectory).toBe('/new/dir');
    expect(cfg.pollIntervalMs).toBe(10000);
  });

  it('emits status events on start/stop', () => {
    const events: string[] = [];
    pipeline.on('status', (s: string) => events.push(s));

    pipeline.start();
    pipeline.stop();

    expect(events).toEqual(['running', 'stopped']);
  });

  it('does not double-start', () => {
    pipeline.start();
    const startCount = pipeline.listenerCount('status');
    pipeline.start(); // should be a no-op
    expect(pipeline.listenerCount('status')).toBe(startCount);
    pipeline.stop();
  });

  it('uses Worktree for Git pipeline tasks and Direct Edit for non-Git tasks', async () => {
    const gitDir = path.join(tmpDir, 'repo');
    const plainDir = path.join(tmpDir, 'plain');
    fs.mkdirSync(gitDir);
    fs.mkdirSync(plainDir);
    execFileSync('git', ['init', '-b', 'main'], { cwd: gitDir });

    const createAgent = vi.spyOn(agentManager, 'createAgent').mockImplementation(async (name, config, labels, opts) => ({
      id: `agent-${createAgent.mock.calls.length}`,
      name,
      status: 'running',
      config,
      workspaceMode: opts?.workspaceMode,
      messages: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      labels,
    } as Agent));

    const gitTask: PipelineTask = { id: 'git', name: 'Git', prompt: 'work', directory: gitDir, status: 'pending', order: 0, createdAt: 1 };
    const plainTask: PipelineTask = { id: 'plain', name: 'Plain', prompt: 'work', directory: plainDir, status: 'pending', order: 1, createdAt: 2 };
    await (pipeline as unknown as { startTask(task: PipelineTask): Promise<void> }).startTask(gitTask);
    await (pipeline as unknown as { startTask(task: PipelineTask): Promise<void> }).startTask(plainTask);

    expect(createAgent.mock.calls[0][3]).toEqual({ workspaceMode: 'worktree' });
    expect(createAgent.mock.calls[1][3]).toEqual({ workspaceMode: 'direct' });
  });

  it('does not treat a canceled agent as a completed pipeline task', async () => {
    const task: PipelineTask = { id: 'task', name: 'Task', prompt: 'work', status: 'running', agentId: 'agent', order: 0, createdAt: 1 };
    const agent: Agent = {
      id: 'agent', name: 'Agent', status: 'stopped', runOutcome: 'canceled',
      config: { provider: 'codex', directory: tmpDir, prompt: 'work', flags: {} },
      messages: [], lastActivity: 1, createdAt: 1,
    };
    store.saveTask(task);
    store.saveAgent(agent);

    await (pipeline as unknown as { checkRunningTasks(tasks: PipelineTask[]): Promise<void> }).checkRunningTasks([task]);

    expect(store.getTask(task.id)?.status).toBe('canceled');
  });
});
