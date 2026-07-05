import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentStore } from '../src/store/AgentStore.js';
import { AgentManager } from '../src/services/AgentManager.js';
import type { Agent } from '../src/models/Agent.js';

describe('AgentManager codex tool messages', () => {
  let tmpDir: string;
  let store: AgentStore;
  let manager: AgentManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-codex-tools-test-'));
    store = new AgentStore(tmpDir);
    manager = new AgentManager(store);
  });

  afterEach(() => {
    const stuckCheckInterval = (manager as unknown as { stuckCheckInterval?: ReturnType<typeof setInterval> | null }).stuckCheckInterval;
    if (stuckCheckInterval) clearInterval(stuckCheckInterval);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores live codex command execution messages with foldable fields', () => {
    const agent: Agent = {
      id: 'agent-codex-tools',
      name: 'Codex Tool Test',
      status: 'running',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'run a command',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
    };
    store.saveAgent(agent);

    (manager as unknown as {
      handleStreamMessage: (agentId: string, msg: Record<string, unknown>, provider: string) => void;
    }).handleStreamMessage(agent.id, {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'pwd',
        aggregated_output: `${tmpDir}\n`,
        exit_code: 0,
      },
    }, 'codex');

    const saved = store.getAgent(agent.id);
    expect(saved?.messages).toHaveLength(1);
    expect(saved?.messages[0]).toMatchObject({
      role: 'tool',
      content: 'Command: pwd',
      toolName: 'command',
      toolInput: 'pwd',
    });
    expect(saved?.messages[0].toolResult).toContain(tmpDir);
    expect(saved?.messages[0].toolResult).toContain('[exit code] 0');
  });

  it('truncates large log payloads before persisting', () => {
    const agent: Agent = {
      id: 'agent-large-log-payload',
      name: 'Large Log Payload Test',
      status: 'running',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'run a command',
        flags: {},
      },
      messages: [],
      lastActivity: 1,
      createdAt: 1,
    };
    store.saveAgent(agent);

    (manager as unknown as {
      appendAgentLog: (agentId: string, entry: Record<string, unknown>) => void;
    }).appendAgentLog(agent.id, {
      level: 'debug',
      source: 'stdout',
      message: 'large payload',
      payload: { aggregated_output: 'x'.repeat(20000) },
    });

    const saved = store.getAgent(agent.id);
    expect(saved?.logs).toHaveLength(1);
    expect(typeof saved?.logs?.[0].payload).toBe('string');
    expect(saved?.logs?.[0].payload as string).toContain('...(truncated)');
    expect(JSON.stringify(saved?.logs?.[0].payload).length).toBeLessThan(17000);
  });
});
