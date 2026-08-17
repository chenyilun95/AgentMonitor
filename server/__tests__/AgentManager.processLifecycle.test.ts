import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentManager } from '../src/services/AgentManager.js';
import { AgentProcess } from '../src/services/AgentProcess.js';
import { AgentStore } from '../src/store/AgentStore.js';
import type { Agent } from '../src/models/Agent.js';

describe('AgentManager process lifecycle', () => {
  let tmpDir: string;
  let store: AgentStore;
  let manager: AgentManager;
  let agent: Agent;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-process-lifecycle-'));
    store = new AgentStore(tmpDir);
    manager = new AgentManager(store);
    agent = {
      id: 'agent-lifecycle',
      name: 'Lifecycle agent',
      status: 'running',
      config: {
        provider: 'claude',
        directory: tmpDir,
        prompt: 'initial prompt',
        flags: {},
      },
      messages: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
    store.saveAgent(agent);
  });

  afterEach(() => {
    const interval = (manager as unknown as {
      stuckCheckInterval?: ReturnType<typeof setInterval> | null;
    }).stuckCheckInterval;
    if (interval) clearInterval(interval);
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('restarts a turn when the tracked process is no longer running', () => {
    const staleProcess = new AgentProcess();
    const staleInternals = staleProcess as unknown as {
      _pid: number;
      process: {
        killed: boolean;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
      };
    };
    staleInternals._pid = 999_999;
    staleInternals.process = { killed: false, exitCode: 1, signalCode: null };
    const processes = (manager as unknown as {
      processes: Map<string, AgentProcess>;
    }).processes;
    processes.set(agent.id, staleProcess);
    const startSpy = vi.spyOn(
      manager as unknown as { startProcess: (value: Agent) => void },
      'startProcess',
    ).mockImplementation(() => {});

    const result = manager.sendMessage(agent.id, 'continue');

    expect(result?.disposition).toBe('started');
    expect(startSpy).toHaveBeenCalledOnce();
    expect(store.getAgent(agent.id)?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'continue',
    });
  });

  it('does not let an old exit callback delete a replacement process', () => {
    vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(() => {});
    const startProcess = (manager as unknown as {
      startProcess: (value: Agent) => void;
    }).startProcess.bind(manager);
    const processes = (manager as unknown as {
      processes: Map<string, AgentProcess>;
    }).processes;

    startProcess(agent);
    const oldProcess = processes.get(agent.id)!;
    startProcess(agent);
    const replacement = processes.get(agent.id)!;

    oldProcess.emit('exit', 0);

    expect(processes.get(agent.id)).toBe(replacement);
    expect(store.getAgent(agent.id)?.status).toBe('running');
  });
});
