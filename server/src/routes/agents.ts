import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentManager } from '../services/AgentManager.js';
import type { AgentStore } from '../store/AgentStore.js';
import type { ExternalAgentScanner } from '../services/ExternalAgentScanner.js';
import type { AgentProvider } from '../models/Agent.js';
import type { CreateAgentRequest, UpdateReasoningEffortRequest } from '@agent-monitor/shared';
import { runtimeCapabilities } from '../services/RuntimeCapabilities.js';
import { sanitizeAgentListSnapshot, sanitizeAgentSnapshot } from '../utils/agentSnapshot.js';
import { normalizeUserPath } from '../utils/pathUtils.js';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

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
    if (req.query.refreshBranches === '1') {
      manager.refreshGitBranches();
    }
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
    const sanitizer = req.query.summary === '1' ? sanitizeAgentListSnapshot : sanitizeAgentSnapshot;
    res.json(agents.map(sanitizer));
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

  router.get('/:id/logs', (req, res) => {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const logs = manager.getAgentLogs(req.params.id, Number.isFinite(limit) ? limit : undefined);
    if (!logs) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ logs });
  });

  router.get('/:id/operator-context', (req, res) => {
    const logLimit = typeof req.query.logLimit === 'string' ? Number(req.query.logLimit) : undefined;
    const messageLimit = typeof req.query.messageLimit === 'string' ? Number(req.query.messageLimit) : undefined;
    const context = manager.getOperatorContext(req.params.id, {
      logLimit: Number.isFinite(logLimit) ? logLimit : undefined,
      messageLimit: Number.isFinite(messageLimit) ? messageLimit : undefined,
    });
    if (!context) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(context);
  });

  // Create agent
  router.post('/', async (req, res) => {
    try {
      const { name, directory, prompt, claudeMd, adminEmail, whatsappPhone, slackWebhookUrl, flags, provider, labels, workspaceMode, skills } = req.body as CreateAgentRequest;
      const nextProvider: AgentProvider = provider === 'codex' ? 'codex' : 'claude';
      const reasoningEffort = flags?.reasoningEffort;
      const requestedDirectory = typeof directory === 'string' ? directory.trim() : '';

      if (!name || !requestedDirectory) {
        res.status(400).json({ error: 'name and directory are required' });
        return;
      }

      if (reasoningEffort !== undefined && !runtimeCapabilities.isReasoningEffortSupported(nextProvider, reasoningEffort)) {
        res.status(400).json({ error: reasoningEffortError(nextProvider) });
        return;
      }

      const nextWorkspaceMode = workspaceMode === 'worktree' ? 'worktree' : 'direct';

      const agent = await manager.createAgent(name, {
        provider: nextProvider,
        directory: normalizeUserPath(requestedDirectory),
        prompt: typeof prompt === 'string' ? prompt : '',
        claudeMd,
        adminEmail,
        whatsappPhone,
        slackWebhookUrl,
        flags: flags || {},
        skills: Array.isArray(skills) ? skills : undefined,
      }, labels, { workspaceMode: nextWorkspaceMode });

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

  router.post('/:id/answer-question', (req, res) => {
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') {
      res.status(400).json({ error: 'answers (object) is required' });
      return;
    }
    const agent = manager.answerQuestion(req.params.id, answers);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    res.json(sanitizeAgentSnapshot(agent));
  });

  // /btw side question — ephemeral, no history, no tools
  router.post('/:id/btw', async (req, res) => {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'question (string) is required' });
      return;
    }
    const agent = store.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    const model = (agent.config.flags.model as string) || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    // Build context from recent messages (cap at last 40 to save tokens)
    const recentMsgs = agent.messages.slice(-40);
    const apiMessages = recentMsgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Ensure messages alternate and start with user
    const cleaned: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of apiMessages) {
      if (cleaned.length === 0 && msg.role !== 'user') continue;
      if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === msg.role) continue;
      cleaned.push(msg);
    }
    // Ensure last message is from assistant (so our new user question is valid)
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'user') {
      cleaned.pop();
    }

    try {
      const context = cleaned
        .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
        .join('\n\n')
        .slice(-60_000);
      const prompt = [
        'This is an ephemeral side question. Do not use tools. Answer concisely using the conversation context.',
        context ? `Conversation context:\n${context}` : '',
        `Side question:\n${question}`,
      ].filter(Boolean).join('\n\n');
      const { stdout } = await execFileAsync(config.claudeBin, [
        '-p', prompt,
        '--output-format', 'json',
        '--model', model,
        '--tools', '',
      ], {
        cwd: manager.resolveExecutionDirectory(agent),
        env: { ...process.env },
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const data = JSON.parse(stdout) as { result?: string; is_error?: boolean };
      if (data.is_error) {
        res.status(502).json({ error: data.result || 'Claude side question failed' });
        return;
      }
      res.json({ answer: data.result || '(no response)' });
    } catch (err) {
      res.status(502).json({ error: `Failed to run side question through Claude: ${String(err)}` });
    }
  });

  // Interrupt agent (double-Esc)
  router.post('/:id/interrupt', (req, res) => {
    manager.interruptAgent(req.params.id);
    res.json({ ok: true });
  });

  router.post('/:id/new-conversation', (req, res) => {
    const agent = manager.newConversation(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(sanitizeAgentSnapshot(agent));
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

    const requested = req.body.reasoningEffort as string | undefined;
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
