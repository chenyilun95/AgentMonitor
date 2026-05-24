import { Router } from 'express';
import type { AgentManager } from '../services/AgentManager.js';
import type { AgentStore } from '../store/AgentStore.js';
import type { ExternalAgentScanner } from '../services/ExternalAgentScanner.js';
import type { AgentProvider } from '../models/Agent.js';
import { runtimeCapabilities } from '../services/RuntimeCapabilities.js';
import { sanitizeAgentSnapshot } from '../utils/agentSnapshot.js';

function reasoningEffortError(provider: AgentProvider): string {
  const capabilities = runtimeCapabilities.getCapabilities().providers[provider];
  const versionLabel = capabilities.version ? ` ${capabilities.version}` : '';

  if (capabilities.reasoningEfforts.length === 0) {
    return `${provider} CLI${versionLabel} does not expose any supported reasoningEffort values`;
  }

  return `reasoningEffort must be one of ${capabilities.reasoningEfforts.join(', ')} for ${provider} CLI${versionLabel}`;
}

export function settingsRoutes(store: AgentStore): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(store.getSettings());
  });

  router.get('/runtime-capabilities', (_req, res) => {
    res.json(runtimeCapabilities.getCapabilities());
  });

  router.put('/', (req, res) => {
    const current = store.getSettings();
    const updated = { ...current, ...req.body };
    if (typeof updated.agentRetentionMs !== 'number' || updated.agentRetentionMs < 0) {
      res.status(400).json({ error: 'agentRetentionMs must be a non-negative number' });
      return;
    }
    if (!['ask', 'keep', 'purge'].includes(updated.deleteSessionFilesPolicy)) {
      res.status(400).json({ error: 'deleteSessionFilesPolicy must be one of ask, keep, purge' });
      return;
    }
    store.saveSettings(updated);
    res.json(updated);
  });

  return router;
}

export function agentRoutes(manager: AgentManager, store: AgentStore): Router {
  const router = Router();

  // List all agents (supports ?label=key:value filtering)
  router.get('/', (req, res) => {
    let agents = manager.getAllAgents();
    const labelFilter = req.query.label;
    if (labelFilter) {
      const filters = Array.isArray(labelFilter) ? labelFilter as string[] : [labelFilter as string];
      agents = agents.filter(a =>
        filters.every(f => {
          const sep = f.indexOf(':');
          if (sep < 0) return false;
          return a.labels?.[f.slice(0, sep)] === f.slice(sep + 1);
        })
      );
    }
    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) {
      agents = agents.filter(a => a.status === statusFilter);
    }
    res.json(agents.map(sanitizeAgentSnapshot));
  });

  // Get single agent
  router.get('/:id', (req, res) => {
    const agent = manager.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(sanitizeAgentSnapshot(agent));
  });

  // Create agent
  router.post('/', async (req, res) => {
    try {
      const { name, directory, prompt, claudeMd, adminEmail, whatsappPhone, slackWebhookUrl, flags, provider, labels } = req.body;
      const nextProvider: AgentProvider = provider === 'codex' ? 'codex' : 'claude';
      const reasoningEffort = flags?.reasoningEffort;

      if (!name || !directory) {
        res.status(400).json({ error: 'name and directory are required' });
        return;
      }

      if (reasoningEffort !== undefined && !runtimeCapabilities.isReasoningEffortSupported(nextProvider, reasoningEffort)) {
        res.status(400).json({ error: reasoningEffortError(nextProvider) });
        return;
      }

      const agent = await manager.createAgent(name, {
        provider: nextProvider,
        directory,
        prompt: typeof prompt === 'string' ? prompt : '',
        claudeMd,
        adminEmail,
        whatsappPhone,
        slackWebhookUrl,
        flags: flags || {},
      }, labels);

      res.status(201).json(agent);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Stop agent
  router.post('/:id/stop', async (req, res) => {
    try {
      await manager.stopAgent(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Stop all agents
  router.post('/actions/stop-all', async (_req, res) => {
    try {
      await manager.stopAllAgents();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Delete agent
  router.delete('/:id', async (req, res) => {
    try {
      const requestedPurge = req.body && typeof req.body.purgeSessionFiles === 'boolean'
        ? req.body.purgeSessionFiles
        : undefined;
      const deletePolicy = store.getSettings().deleteSessionFilesPolicy;
      const purgeSessionFiles = requestedPurge ?? (deletePolicy === 'purge');
      await manager.deleteAgent(req.params.id, { purgeSessionFiles });
      res.json({ ok: true, purgeSessionFiles });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Send message to agent
  router.post('/:id/message', (req, res) => {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    manager.sendMessage(req.params.id, text);
    res.json({ ok: true });
  });

  router.put('/:id/interaction-mode', (req, res) => {
    const { mode } = req.body;
    if (mode !== 'default' && mode !== 'plan') {
      res.status(400).json({ error: 'mode must be default or plan' });
      return;
    }

    const agent = manager.updateInteractionMode(req.params.id, mode);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    res.json(sanitizeAgentSnapshot(agent));
  });

  router.post('/:id/plan/approve', (req, res) => {
    const agent = manager.approvePlan(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    res.json(sanitizeAgentSnapshot(agent));
  });

  router.post('/:id/plan/revise', (req, res) => {
    const agent = manager.revisePlan(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    res.json(sanitizeAgentSnapshot(agent));
  });

  // Interrupt agent (double-Esc)
  router.post('/:id/interrupt', (req, res) => {
    manager.interruptAgent(req.params.id);
    res.json({ ok: true });
  });

  // Rename agent
  router.put('/:id/rename', (req, res) => {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    manager.renameAgent(req.params.id, name);
    res.json({ ok: true });
  });

  // Update CLAUDE.md
  router.put('/:id/claude-md', (req, res) => {
    const { content } = req.body;
    if (content === undefined) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    manager.updateClaudeMd(req.params.id, content);
    res.json({ ok: true });
  });

  router.put('/:id/reasoning-effort', (req, res) => {
    const agent = manager.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const requested = req.body.reasoningEffort;
    const reasoningEffort = requested === '' || requested === null ? undefined : requested;

    if (reasoningEffort !== undefined && !runtimeCapabilities.isReasoningEffortSupported(agent.config.provider, reasoningEffort)) {
      res.status(400).json({ error: reasoningEffortError(agent.config.provider) });
      return;
    }

    const updated = manager.updateReasoningEffort(req.params.id, reasoningEffort);
    res.json(updated);
  });

  // Restore conversation to a previous turn
  router.post('/:id/restore', async (req, res) => {
    try {
      const { turnIndex, restoreCode, restoreConv } = req.body;
      if (typeof turnIndex !== 'number') {
        res.status(400).json({ error: 'turnIndex (number) is required' });
        return;
      }
      const result = await manager.restoreConversation(
        req.params.id, Number(turnIndex), !!restoreCode, restoreConv !== false,
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Update agent labels
  router.patch('/:id/labels', (req, res) => {
    const agent = manager.getAgent(req.params.id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    agent.labels = { ...(agent.labels || {}), ...req.body };
    store.saveAgent(agent);
    manager.emit('agent:update', agent.id, agent);
    res.json({ ok: true, labels: agent.labels });
  });

  // Wait for agent to finish (long-poll)
  router.get('/:id/wait', async (req, res) => {
    const agent = manager.getAgent(req.params.id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (agent.status === 'stopped' || agent.status === 'error') {
      res.json({ status: agent.status, timedOut: false, agent: sanitizeAgentSnapshot(agent) });
      return;
    }
    const timeout = Math.min(Number(req.query.timeout) || 60000, 300000);
    const result = await manager.waitForAgent(agent.id, timeout);
    const final = manager.getAgent(req.params.id);
    res.json({ ...result, agent: final ? sanitizeAgentSnapshot(final) : null });
  });

  return router;
}

export function externalRoutes(scanner: ExternalAgentScanner): Router {
  const router = Router();

  // Trigger a scan and return results
  router.post('/scan', (_req, res) => {
    const result = scanner.scan();
    res.json(result);
  });

  // List candidate processes not yet imported
  router.get('/candidates', (_req, res) => {
    res.json(scanner.getCandidates());
  });

  // Import a specific process by PID
  router.post('/import', (req, res) => {
    const { pid } = req.body;
    if (typeof pid !== 'number') {
      res.status(400).json({ error: 'pid (number) is required' });
      return;
    }
    const agent = scanner.importByPid(pid);
    if (!agent) {
      res.status(404).json({ error: 'Process not found or already tracked' });
      return;
    }
    res.json(agent);
  });

  // Dismiss a PID so it won't appear in candidates
  router.post('/dismiss', (req, res) => {
    const { pid } = req.body;
    if (typeof pid !== 'number') {
      res.status(400).json({ error: 'pid (number) is required' });
      return;
    }
    scanner.dismiss(pid);
    res.json({ ok: true });
  });

  return router;
}
