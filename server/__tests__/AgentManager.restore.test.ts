import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentStore } from '../src/store/AgentStore.js';
import { AgentManager } from '../src/services/AgentManager.js';
import { AgentProcess } from '../src/services/AgentProcess.js';
import type { Agent } from '../src/models/Agent.js';
import { execFileSync } from 'child_process';

describe('AgentManager restoreConversation', () => {
  let tmpDir: string;
  let store: AgentStore;
  let manager: AgentManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-restore-test-'));
    store = new AgentStore(tmpDir);
    manager = new AgentManager(store);
  });

  afterEach(() => {
    const stuckCheckInterval = (manager as unknown as { stuckCheckInterval?: ReturnType<typeof setInterval> | null }).stuckCheckInterval;
    if (stuckCheckInterval) clearInterval(stuckCheckInterval);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const initGitRepository = (): void => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir });
  };

  it('clears session, truncates JSONL, and builds conversation seed after restore', async () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Restore Test',
      status: 'running',
      config: {
        provider: 'claude',
        directory: tmpDir,
        prompt: 'original prompt',
        flags: {},
      },
      messages: [
        { id: 'u1', role: 'user', content: 'first prompt', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'first reply', timestamp: 2 },
        { id: 'u2', role: 'user', content: 'second prompt', timestamp: 3 },
        { id: 'a2', role: 'assistant', content: 'second reply', timestamp: 4 },
      ],
      lastActivity: 4,
      createdAt: 1,
      sessionId: 'session-123',
    };
    store.saveAgent(agent);

    const jsonlPath = path.join(tmpDir, 'session-123.jsonl');
    fs.writeFileSync(jsonlPath, [
      JSON.stringify({ type: 'user', message: { content: 'first prompt' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'first reply' } }),
      JSON.stringify({ type: 'user', message: { content: 'second prompt' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'second reply' } }),
      '',
    ].join('\n'));

    vi.spyOn(manager as unknown as { findSessionJsonlPath: (sessionId: string) => string | undefined }, 'findSessionJsonlPath')
      .mockReturnValue(jsonlPath);

    const result = await manager.restoreConversation(agent.id, 1, false, true);

    expect(result).toMatchObject({
      restoredPrompt: 'second prompt',
      restoredCode: false,
      restoredConversation: true,
    });

    const saved = store.getAgent(agent.id);
    expect(saved).toBeDefined();
    expect(saved?.messages.map(msg => msg.content)).toEqual(['first prompt', 'first reply']);
    expect(saved?.status).toBe('stopped');
    // Session cleared — truncated JSONL is not valid for --resume
    expect(saved?.sessionId).toBeUndefined();
    expect(saved?.config.flags.resume).toBeUndefined();
    // Conversation seed built from retained messages
    expect(saved?.restoredConversationSeed).toContain('first prompt');
    expect(saved?.restoredConversationSeed).toContain('first reply');

    const truncatedJsonl = fs.readFileSync(jsonlPath, 'utf-8');
    expect(truncatedJsonl).toContain('first prompt');
    expect(truncatedJsonl).toContain('first reply');
    expect(truncatedJsonl).not.toContain('second prompt');
    expect(truncatedJsonl).not.toContain('second reply');
  });

  it('seeds the next resumed prompt with restored conversation context', () => {
    const agent: Agent = {
      id: 'agent-2',
      name: 'Resume Seed Test',
      status: 'stopped',
      config: {
        provider: 'claude',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
      restoredConversationSeed: 'Conversation seed text',
    };
    store.saveAgent(agent);

    const startProcessSpy = vi.spyOn(manager as unknown as { startProcess: (agent: Agent) => void }, 'startProcess')
      .mockImplementation(() => {});

    manager.sendMessage(agent.id, 'follow-up question');

    const saved = store.getAgent(agent.id);
    expect(saved?.config.prompt).toContain('Conversation seed text');
    expect(saved?.config.prompt).toContain('follow-up question');
    expect(saved?.restoredConversationSeed).toBeUndefined();
    expect(saved?.config.flags.resume).toBeUndefined();
    expect(saved?.sessionId).toBeUndefined();
    expect(startProcessSpy).toHaveBeenCalledOnce();
  });

  it('does not guess Worktree integration state merely because a new turn starts', () => {
    const agent: Agent = {
      id: 'agent-new-work-after-merge',
      name: 'Merged Worktree',
      status: 'stopped',
      config: { provider: 'codex', directory: tmpDir, prompt: 'old prompt', flags: {} },
      worktreePath: tmpDir,
      worktreeBranch: 'agent-test',
      workspaceMode: 'worktree',
      hasUnintegratedChanges: false,
      messages: [],
      lastActivity: 1,
      createdAt: 1,
    };
    store.saveAgent(agent);
    vi.spyOn(manager as unknown as { startProcess: (agent: Agent) => void }, 'startProcess').mockImplementation(() => {});

    manager.sendMessage(agent.id, 'new work');

    expect(store.getAgent(agent.id)?.hasUnintegratedChanges).toBe(false);
  });

  it('rejects worktree mode for a non-Git directory instead of editing it directly', async () => {
    await expect(manager.createAgent('Non Git Worktree', {
      provider: 'codex',
      directory: tmpDir,
      prompt: 'do work',
      providerInstructions: '# Internal instructions',
      flags: {},
    }, undefined, { workspaceMode: 'worktree' })).rejects.toThrow('requires an existing Git repository');

    expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(false);
    expect(store.getAllAgents()).toHaveLength(0);
  });

  it('derives unintegrated Worktree state from Git history instead of a stored flag', async () => {
    initGitRepository();
    const agent = await manager.createAgent('Git State', {
      provider: 'codex',
      directory: tmpDir,
      prompt: '',
      flags: {},
    }, undefined, { workspaceMode: 'worktree' });

    expect(manager.getAgent(agent.id)?.hasUnintegratedChanges).toBe(false);
    fs.writeFileSync(path.join(agent.worktreePath!, 'change.txt'), 'change\n');
    execFileSync('git', ['add', 'change.txt'], { cwd: agent.worktreePath! });
    execFileSync('git', ['commit', '-m', 'agent change'], { cwd: agent.worktreePath! });
    expect(manager.getAgent(agent.id)?.hasUnintegratedChanges).toBe(true);

    execFileSync('git', ['merge', '--ff-only', agent.worktreeBranch!], { cwd: tmpDir });
    expect(manager.getAgent(agent.id)?.hasUnintegratedChanges).toBe(false);
  });

  it('deletes a Worktree Agent only after its branch is merged and pushed', async () => {
    initGitRepository();
    const remote = path.join(tmpDir, '.git', 'test-remote.git');
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: tmpDir });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: tmpDir });
    const agent = await manager.createAgent('Integrate Cleanup', {
      provider: 'codex',
      directory: tmpDir,
      prompt: '',
      flags: {},
    }, undefined, { workspaceMode: 'worktree' });

    fs.writeFileSync(path.join(agent.worktreePath!, 'integrated.txt'), 'done\n');
    execFileSync('git', ['add', 'integrated.txt'], { cwd: agent.worktreePath! });
    execFileSync('git', ['commit', '-m', 'integrated change'], { cwd: agent.worktreePath! });
    execFileSync('git', ['merge', '--ff-only', agent.worktreeBranch!], { cwd: tmpDir });
    execFileSync('git', ['push'], { cwd: tmpDir });

    const saved = store.getAgent(agent.id)!;
    saved.status = 'stopped';
    saved.runOutcome = 'succeeded';
    saved.pendingIntegrationCleanup = true;
    store.saveAgent(saved);
    await (manager as unknown as { finalizeIntegrationCleanup: (id: string) => Promise<boolean> })
      .finalizeIntegrationCleanup(agent.id);

    expect(store.getAgent(agent.id)).toBeUndefined();
    expect(fs.existsSync(agent.worktreePath!)).toBe(false);
  });

  it('does not expire Worktree Agents before the user explicitly cleans them up', async () => {
    const old = Date.now() - 10_000;
    store.saveAgent({
      id: 'retained-worktree',
      name: 'Retained Worktree',
      status: 'stopped',
      config: { provider: 'codex', directory: tmpDir, prompt: '', flags: {} },
      workspaceMode: 'worktree',
      worktreeBranch: 'agent-retained',
      messages: [],
      lastActivity: old,
      createdAt: old,
    });
    store.saveAgent({
      id: 'expired-direct',
      name: 'Expired Direct',
      status: 'stopped',
      config: { provider: 'codex', directory: tmpDir, prompt: '', flags: {} },
      workspaceMode: 'direct',
      messages: [],
      lastActivity: old,
      createdAt: old,
    });

    expect(await manager.cleanupExpiredAgents(1000)).toBe(1);
    expect(store.getAgent('retained-worktree')).toBeDefined();
    expect(store.getAgent('expired-direct')).toBeUndefined();
  });

  it('allows only one active Direct Edit agent across subdirectories of the same repository', async () => {
    initGitRepository();
    const subdirectory = path.join(tmpDir, 'packages', 'app');
    fs.mkdirSync(subdirectory, { recursive: true });

    await manager.createAgent('First Direct', {
      provider: 'codex',
      directory: tmpDir,
      prompt: '',
      flags: {},
    }, undefined, { workspaceMode: 'direct' });

    await expect(manager.createAgent('Second Direct', {
      provider: 'codex',
      directory: subdirectory,
      prompt: '',
      flags: {},
    }, undefined, { workspaceMode: 'direct' })).rejects.toThrow('Direct Edit is already active for this project');
  });

  it('reuses the saved session id when resuming a stopped codex agent', () => {
    const agent: Agent = {
      id: 'agent-codex-resume',
      name: 'Codex Resume Test',
      status: 'stopped',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
      sessionId: '019d5000-aaaa-7bbb-8ccc-1234567890ab',
    };
    store.saveAgent(agent);

    const startProcessSpy = vi.spyOn(manager as unknown as { startProcess: (agent: Agent) => void }, 'startProcess')
      .mockImplementation(() => {});

    manager.sendMessage(agent.id, 'follow-up question');

    const saved = store.getAgent(agent.id);
    expect(saved?.config.prompt).toBe('follow-up question');
    expect(saved?.config.flags.resume).toBe(agent.sessionId);
    expect(startProcessSpy).toHaveBeenCalledOnce();
  });

  it('keeps dash-prefixed chat input intact when resuming a stopped codex agent', () => {
    const agent: Agent = {
      id: 'agent-codex-dash-prompt',
      name: 'Codex Dash Prompt Test',
      status: 'stopped',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
      sessionId: '019d5000-aaaa-7bbb-8ccc-1234567890ab',
    };
    store.saveAgent(agent);

    const startProcessSpy = vi.spyOn(manager as unknown as { startProcess: (agent: Agent) => void }, 'startProcess')
      .mockImplementation(() => {});

    manager.sendMessage(agent.id, '--status');

    const saved = store.getAgent(agent.id);
    expect(saved?.config.prompt).toBe('--status');
    expect(saved?.config.flags.resume).toBe(agent.sessionId);
    expect(saved?.messages.at(-1)?.content).toBe('--status');
    expect(startProcessSpy).toHaveBeenCalledOnce();
  });

  it('queues follow-up messages while an agent is already running', () => {
    const agent: Agent = {
      id: 'agent-queued-followup',
      name: 'Queued Followup Test',
      status: 'running',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: {},
      },
      messages: [
        { id: 'u1', role: 'user', content: 'current prompt', timestamp: 1 },
      ],
      lastActivity: 1,
      createdAt: 1,
      sessionId: '019d5000-aaaa-7bbb-8ccc-1234567890ab',
    };
    store.saveAgent(agent);

    const sendMessage = vi.fn();
    (manager as unknown as { processes: Map<string, { sendMessage: (text: string) => void }> }).processes.set(agent.id, { sendMessage });
    const startProcessSpy = vi.spyOn(manager as unknown as { startProcess: (agent: Agent) => void }, 'startProcess')
      .mockImplementation(() => {});

    const result = manager.sendMessage(agent.id, 'follow-up while busy', 'client-stable-id');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result?.disposition).toBe('queued');
    expect(result?.queuedMessage?.id).toBe('client-stable-id');
    expect(store.getAgent(agent.id)?.messages.at(-1)?.content).toBe('current prompt');
    expect(store.getAgent(agent.id)?.queuedMessages).toEqual([
      expect.objectContaining({ id: result?.queuedMessage?.id, text: 'follow-up while busy' }),
    ]);

    (manager as unknown as { startNextQueuedMessage: (agentId: string) => void }).startNextQueuedMessage(agent.id);

    const saved = store.getAgent(agent.id);
    expect(saved?.config.prompt).toBe('follow-up while busy');
    expect(saved?.queuedMessages).toEqual([]);
    expect(saved?.config.flags.resume).toBe(agent.sessionId);
    expect(startProcessSpy).toHaveBeenCalledOnce();
  });

  it('pauses persisted queue messages after a server restart until explicitly resumed', () => {
    const agent: Agent = {
      id: 'agent-restart-queue',
      name: 'Restart Queue Test',
      status: 'running',
      config: { provider: 'codex', directory: tmpDir, prompt: 'active turn', flags: {} },
      messages: [{ id: 'u1', role: 'user', content: 'active turn', timestamp: 1 }],
      queuedMessages: [{ id: 'q1', text: 'next turn', createdAt: 2 }],
      lastActivity: 2,
      createdAt: 1,
    };
    store.saveAgent(agent);

    const restartedManager = new AgentManager(store);
    const restartedInterval = (restartedManager as unknown as { stuckCheckInterval?: ReturnType<typeof setInterval> }).stuckCheckInterval;
    const savedAfterRestart = store.getAgent(agent.id);
    expect(savedAfterRestart?.status).toBe('stopped');
    expect(savedAfterRestart?.queuePaused).toBe(true);
    expect(savedAfterRestart?.queuedMessages?.map(message => message.text)).toEqual(['next turn']);
    expect(savedAfterRestart?.messages.at(-1)?.content).toContain('server restarted');

    const startProcessSpy = vi.spyOn(restartedManager as unknown as { startProcess: (agent: Agent) => void }, 'startProcess')
      .mockImplementation(() => {});
    restartedManager.resumeQueuedMessages(agent.id);

    expect(store.getAgent(agent.id)?.queuePaused).toBe(false);
    expect(store.getAgent(agent.id)?.queuedMessages).toEqual([]);
    expect(store.getAgent(agent.id)?.messages.at(-1)?.content).toBe('next turn');
    expect(startProcessSpy).toHaveBeenCalledOnce();
    if (restartedInterval) clearInterval(restartedInterval);
  });

  it('restarts a waiting Codex process instead of writing to its closed stdin', () => {
    const agent: Agent = {
      id: 'agent-codex-waiting',
      name: 'Waiting Codex',
      status: 'waiting_input',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
      sessionId: '019d5000-aaaa-7bbb-8ccc-1234567890ab',
    };
    store.saveAgent(agent);

    const sendMessage = vi.fn();
    const stop = vi.fn();
    (manager as unknown as { processes: Map<string, { sendMessage: (text: string) => void; stop: () => void }> })
      .processes.set(agent.id, { sendMessage, stop });
    const startProcessSpy = vi.spyOn(manager as unknown as { startProcess: (agent: Agent) => void }, 'startProcess')
      .mockImplementation(() => {});

    manager.sendMessage(agent.id, 'continue after interrupt');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    (manager as unknown as { startNextQueuedMessage: (agentId: string) => void }).startNextQueuedMessage(agent.id);
    expect(startProcessSpy).toHaveBeenCalledOnce();
    expect(store.getAgent(agent.id)?.config.prompt).toBe('continue after interrupt');
  });

  it('starts a new empty conversation and clears resume state', () => {
    const agent: Agent = {
      id: 'agent-new-conversation',
      name: 'New Conversation Test',
      status: 'running',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: { resume: 'old-session' },
      },
      messages: [
        { id: 'u1', role: 'user', content: 'old prompt', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'old reply', timestamp: 2 },
      ],
      lastActivity: 2,
      createdAt: 1,
      sessionId: 'old-session',
      tokenUsage: { input: 10, output: 20 },
      contextWindow: { used: 30, total: 100 },
      costUsd: 0.1,
      currentTask: 'old task',
      restoredConversationSeed: 'old seed',
      codeSnapshots: [{ beforeTurnIndex: 0, commit: 'abc123' }],
    };
    store.saveAgent(agent);

    const stop = vi.fn();
    (manager as unknown as { processes: Map<string, { stop: () => void }> }).processes.set(agent.id, { stop });

    const updated = manager.newConversation(agent.id);

    expect(stop).toHaveBeenCalledOnce();
    expect(updated?.messages).toEqual([]);
    expect(updated?.status).toBe('stopped');
    expect(updated?.sessionId).toBeUndefined();
    expect(updated?.config.flags.resume).toBeUndefined();
    expect(updated?.tokenUsage).toBeUndefined();
    expect(updated?.contextWindow).toBeUndefined();
    expect(updated?.costUsd).toBeUndefined();
    expect(updated?.currentTask).toBeUndefined();
    expect(updated?.restoredConversationSeed).toBeUndefined();
    expect(updated?.codeSnapshots).toBeUndefined();
  });

  it('falls back to the configured directory when a stopped agent resumes after worktree cleanup', () => {
    const missingWorktreePath = path.join(tmpDir, '.agent-worktrees', 'agent-missing');
    const agent: Agent = {
      id: 'agent-cleaned-worktree',
      name: 'Cleaned Worktree Test',
      status: 'stopped',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: {},
      },
      worktreePath: missingWorktreePath,
      worktreeBranch: 'agent-missing',
      messages: [],
      lastActivity: 1,
      createdAt: 1,
      sessionId: '019d5000-aaaa-7bbb-8ccc-1234567890ab',
    };
    store.saveAgent(agent);

    const startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(() => {});

    manager.sendMessage(agent.id, 'follow-up after cleanup');

    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ directory: tmpDir }));
    const saved = store.getAgent(agent.id);
    expect(saved?.worktreePath).toBeUndefined();
    expect(saved?.worktreeBranch).toBeUndefined();
  });

  it('routes code restore to the selected turn snapshot', async () => {
    const agent: Agent = {
      id: 'agent-3',
      name: 'Code Restore Test',
      status: 'running',
      config: {
        provider: 'claude',
        directory: tmpDir,
        prompt: 'old prompt',
        flags: {},
      },
      worktreePath: tmpDir,
      messages: [],
      lastActivity: 1,
      createdAt: 1,
      codeSnapshots: [
        { beforeTurnIndex: 0, commit: 'base-commit' },
        { beforeTurnIndex: 1, commit: 'turn-1-commit' },
      ],
    };
    store.saveAgent(agent);

    const restoreAgentCodeSpy = vi.spyOn(
      manager as unknown as { restoreAgentCode: (agent: Agent, beforeTurnIndex: number) => { restored: boolean; warning?: string } },
      'restoreAgentCode',
    ).mockReturnValue({ restored: true });

    await manager.restoreConversation(agent.id, 1, true, false);

    expect(restoreAgentCodeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: agent.id }), 1);
  });
});
