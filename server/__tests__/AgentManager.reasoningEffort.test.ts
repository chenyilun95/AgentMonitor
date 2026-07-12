import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentStore } from '../src/store/AgentStore.js';
import { AgentManager } from '../src/services/AgentManager.js';
import { AgentProcess } from '../src/services/AgentProcess.js';
import type { Agent } from '../src/models/Agent.js';
import { runtimeCapabilities } from '../src/services/RuntimeCapabilities.js';

describe('reasoning effort support', () => {
  let tmpDir: string;
  let store: AgentStore;
  let manager: AgentManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-effort-test-'));
    store = new AgentStore(tmpDir);
    manager = new AgentManager(store);
  });

  afterEach(() => {
    const stuckCheckInterval = (manager as unknown as { stuckCheckInterval?: ReturnType<typeof setInterval> | null }).stuckCheckInterval;
    if (stuckCheckInterval) clearInterval(stuckCheckInterval);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates reasoning effort on an existing codex agent', () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Effort Test',
      status: 'stopped',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'original prompt',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
    };
    store.saveAgent(agent);

    manager.updateReasoningEffort(agent.id, 'xhigh');
    expect(store.getAgent(agent.id)?.config.flags.reasoningEffort).toBe('xhigh');

    manager.updateReasoningEffort(agent.id, undefined);
    expect(store.getAgent(agent.id)?.config.flags.reasoningEffort).toBeUndefined();
  });

  it('passes reasoning effort to Codex via config override', () => {
    vi.spyOn(runtimeCapabilities, 'normalizeReasoningEffort').mockImplementation((provider, effort) => (
      provider === 'codex' ? effort as 'high' : undefined
    ));

    const proc = new AgentProcess();
    const buildCodexCommand = (proc as unknown as {
      buildCodexCommand: (opts: {
        provider: 'codex';
        directory: string;
        prompt: string;
        model?: string;
        reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
      }) => { bin: string; args: string[] };
    }).buildCodexCommand.bind(proc);

    const { args } = buildCodexCommand({
      provider: 'codex',
      directory: tmpDir,
      prompt: 'ping',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });

    expect(args).toContain('-c');
    expect(args).toContain('\'model_reasoning_effort="high"\'');
  });

  it('uses codex exec resume when a Codex session id is provided', () => {
    const proc = new AgentProcess();
    const buildCodexCommand = (proc as unknown as {
      buildCodexCommand: (opts: {
        provider: 'codex';
        directory: string;
        prompt: string;
        resume?: string;
      }) => { bin: string; args: string[] };
    }).buildCodexCommand.bind(proc);

    const sessionId = '019d5000-aaaa-7bbb-8ccc-1234567890ab';
    const { args } = buildCodexCommand({
      provider: 'codex',
      directory: tmpDir,
      prompt: 'continue the task',
      resume: sessionId,
    });

    expect(args.slice(0, 3)).toEqual(['exec', 'resume', '--json']);
    expect(args).toContain('--');
    expect(args).toContain(`'${sessionId}'`);
    expect(args).not.toContain('--cd');
  });

  it('does not pass fresh-only Codex flags to resume', () => {
    const proc = new AgentProcess();
    const buildCodexCommand = (proc as unknown as {
      buildCodexCommand: (opts: {
        provider: 'codex';
        directory: string;
        prompt: string;
        resume?: string;
        askForApprovalNever?: boolean;
        sandboxDangerFullAccess?: boolean;
        fullAuto?: boolean;
      }) => { bin: string; args: string[] };
    }).buildCodexCommand.bind(proc);

    const { args } = buildCodexCommand({
      provider: 'codex',
      directory: tmpDir,
      prompt: 'continue the task',
      resume: '019d5000-aaaa-7bbb-8ccc-1234567890ab',
      askForApprovalNever: true,
      sandboxDangerFullAccess: true,
      fullAuto: true,
    });

    expect(args.slice(0, 3)).toEqual(['exec', 'resume', '--json']);
    expect(args).not.toContain('--full-auto');
    expect(args).not.toContain('--ask-for-approval');
    expect(args).not.toContain('--sandbox');
  });

  it('treats dash-prefixed fresh Codex prompts as positional input', () => {
    const proc = new AgentProcess();
    const buildCodexCommand = (proc as unknown as {
      buildCodexCommand: (opts: {
        provider: 'codex';
        directory: string;
        prompt: string;
      }) => { bin: string; args: string[] };
    }).buildCodexCommand.bind(proc);

    const { args } = buildCodexCommand({
      provider: 'codex',
      directory: tmpDir,
      prompt: '--help',
    });

    expect(args[args.length - 2]).toBe('--');
    expect(args[args.length - 1]).toBe('\'--help\'');
  });

  it('treats dash-prefixed resumed Codex prompts as positional input', () => {
    const proc = new AgentProcess();
    const buildCodexCommand = (proc as unknown as {
      buildCodexCommand: (opts: {
        provider: 'codex';
        directory: string;
        prompt: string;
        resume?: string;
      }) => { bin: string; args: string[] };
    }).buildCodexCommand.bind(proc);

    const sessionId = '019d5000-aaaa-7bbb-8ccc-1234567890ab';
    const { args } = buildCodexCommand({
      provider: 'codex',
      directory: tmpDir,
      prompt: '--status',
      resume: sessionId,
    });

    const separatorIndex = args.indexOf('--');
    expect(separatorIndex).toBeGreaterThan(2);
    expect(args[separatorIndex + 1]).toBe(`'${sessionId}'`);
    expect(args[separatorIndex + 2]).toBe('\'--status\'');
  });

  it('passes supported reasoning effort to Claude via --effort', () => {
    vi.spyOn(runtimeCapabilities, 'normalizeReasoningEffort').mockImplementation((provider, effort) => (
      provider === 'claude' ? effort as 'high' : undefined
    ));

    const proc = new AgentProcess();
    const buildClaudeCommand = (proc as unknown as {
      buildClaudeCommand: (opts: {
        provider: 'claude';
        directory: string;
        prompt: string;
        reasoningEffort?: 'low' | 'medium' | 'high';
      }) => { bin: string; args: string[] };
    }).buildClaudeCommand.bind(proc);

    const { args } = buildClaudeCommand({
      provider: 'claude',
      directory: tmpDir,
      prompt: 'ping',
      reasoningEffort: 'high',
    });

    expect(args).toContain('--effort');
    expect(args).toContain('\'high\'');
  });

  it('skips unsupported Claude reasoning effort values', () => {
    vi.spyOn(runtimeCapabilities, 'normalizeReasoningEffort').mockReturnValue(undefined);

    const proc = new AgentProcess();
    const buildClaudeCommand = (proc as unknown as {
      buildClaudeCommand: (opts: {
        provider: 'claude';
        directory: string;
        prompt: string;
        reasoningEffort?: 'max';
      }) => { bin: string; args: string[] };
    }).buildClaudeCommand.bind(proc);

    const { args } = buildClaudeCommand({
      provider: 'claude',
      directory: tmpDir,
      prompt: 'ping',
      reasoningEffort: 'max',
    });

    expect(args).not.toContain('--effort');
  });

  it('does not prefix Codex prompts with /model slash commands', () => {
    const composed = (manager as unknown as {
      composeProcessPrompt: (agent: Agent) => string;
    }).composeProcessPrompt({
      id: 'agent-codex-model',
      name: 'Codex Model',
      status: 'running',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'Implement feature X',
        flags: { model: 'gpt-5.4-mini' },
      },
      messages: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });

    expect(composed).toBe('Implement feature X');
  });

  it('passes Codex model selection through process start options', async () => {
    const startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(() => undefined);

    await manager.createAgent('Codex Model', {
      provider: 'codex',
      directory: tmpDir,
      prompt: 'Implement feature X',
      flags: { model: 'gpt-5.4-mini' },
    });

    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5.4-mini',
      prompt: 'Implement feature X',
    }));
  });

  it('does not inject /model prefix for Claude prompts', () => {
    const composed = (manager as unknown as {
      composeProcessPrompt: (agent: Agent) => string;
    }).composeProcessPrompt({
      id: 'agent-claude-model',
      name: 'Claude Model',
      status: 'running',
      config: {
        provider: 'claude',
        directory: tmpDir,
        prompt: 'Implement feature Y',
        flags: { model: 'sonnet' },
      },
      messages: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    });

    expect(composed).toBe('Implement feature Y');
  });
});
