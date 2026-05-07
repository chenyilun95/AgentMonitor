import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentStore } from '../src/store/AgentStore.js';
import { AgentManager } from '../src/services/AgentManager.js';
import type { Agent } from '../src/models/Agent.js';
import type { StreamMessage } from '../src/services/AgentProcess.js';

describe('AgentManager Claude cost tracking', () => {
  let tmpDir: string;
  let store: AgentStore;
  let manager: AgentManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cost-test-'));
    store = new AgentStore(tmpDir);
    manager = new AgentManager(store);
  });

  afterEach(() => {
    const stuckCheckInterval = (manager as unknown as { stuckCheckInterval?: ReturnType<typeof setInterval> | null }).stuckCheckInterval;
    if (stuckCheckInterval) clearInterval(stuckCheckInterval);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function saveClaudeAgent(overrides: Partial<Agent> = {}): Agent {
    const agent: Agent = {
      id: 'agent-claude-cost',
      name: 'Claude Cost',
      status: 'running',
      config: {
        provider: 'claude',
        directory: tmpDir,
        prompt: 'track cost',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
      ...overrides,
    };
    store.saveAgent(agent);
    return agent;
  }

  function handle(msg: StreamMessage): void {
    (manager as unknown as {
      handleStreamMessage: (agentId: string, msg: StreamMessage, provider: string) => void;
    }).handleStreamMessage('agent-claude-cost', msg, 'claude');
  }

  it('stores the first Claude result cost', () => {
    saveClaudeAgent();

    handle({ type: 'result', total_cost_usd: 0.0123 });

    expect(store.getAgent('agent-claude-cost')?.costUsd).toBeCloseTo(0.0123);
  });

  it('adds resumed Claude result cost to existing agent cost', () => {
    saveClaudeAgent({ costUsd: 0.0123 });

    handle({ type: 'result', total_cost_usd: 0.0045 });

    expect(store.getAgent('agent-claude-cost')?.costUsd).toBeCloseTo(0.0168);
  });

  it('accepts nested Claude result cost when top-level cost is absent', () => {
    saveClaudeAgent({ costUsd: 0.01 });

    handle({ type: 'result', result: { cost_usd: 0.0025 } });

    expect(store.getAgent('agent-claude-cost')?.costUsd).toBeCloseTo(0.0125);
  });

  it('uses official Claude Sonnet API pricing when usage is present', () => {
    saveClaudeAgent({ config: {
      provider: 'claude',
      directory: tmpDir,
      prompt: 'track cost',
      flags: { model: 'sonnet' },
    } });

    handle({
      type: 'result',
      total_cost_usd: 0.0001,
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
    });

    expect(store.getAgent('agent-claude-cost')?.costUsd).toBeCloseTo(18);
  });

  it('prices Claude cache write and read tokens separately', () => {
    saveClaudeAgent({ config: {
      provider: 'claude',
      directory: tmpDir,
      prompt: 'track cost',
      flags: { model: 'claude-haiku-4-5-20251001' },
    } });

    handle({
      type: 'result',
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      },
    });

    expect(store.getAgent('agent-claude-cost')?.costUsd).toBeCloseTo(7.35);
  });

  it('uses the stream model field before the configured Claude alias', () => {
    saveClaudeAgent({ config: {
      provider: 'claude',
      directory: tmpDir,
      prompt: 'track cost',
      flags: { model: 'sonnet' },
    } });

    handle({
      type: 'result',
      model: 'claude-opus-4-1-20250805',
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
    });

    expect(store.getAgent('agent-claude-cost')?.costUsd).toBeCloseTo(90);
  });
});
