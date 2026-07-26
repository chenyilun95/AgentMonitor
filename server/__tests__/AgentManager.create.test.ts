import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentManager } from '../src/services/AgentManager.js';
import { AgentStore } from '../src/store/AgentStore.js';
import type { Agent } from '../src/models/Agent.js';

describe('AgentManager createAgent', () => {
  let tmpDir: string;
  let store: AgentStore;
  let manager: AgentManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-create-test-'));
    store = new AgentStore(tmpDir);
    manager = new AgentManager(store);
    vi.spyOn(
      manager as unknown as { startProcess: (agent: Agent) => void },
      'startProcess',
    ).mockImplementation(() => {});
  });

  afterEach(() => {
    const stuckCheckInterval = (
      manager as unknown as {
        stuckCheckInterval?: ReturnType<typeof setInterval> | null;
      }
    ).stuckCheckInterval;
    if (stuckCheckInterval) clearInterval(stuckCheckInterval);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores the initial prompt as the first visible user message', async () => {
    const agent = await manager.createAgent('Visible prompt', {
      provider: 'codex',
      directory: tmpDir,
      prompt: 'Please inspect the flaky test.',
      flags: {},
    });

    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0]).toMatchObject({
      role: 'user',
      content: 'Please inspect the flaky test.',
    });
    expect(store.getAgent(agent.id)?.messages).toEqual(agent.messages);
  });

  it('keeps a newly created agent with an empty prompt message-free', async () => {
    const agent = await manager.createAgent('Waiting agent', {
      provider: 'claude',
      directory: tmpDir,
      prompt: '   ',
      flags: {},
    });

    expect(agent.status).toBe('waiting_input');
    expect(agent.messages).toEqual([]);
  });
});
