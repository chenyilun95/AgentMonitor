import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentStore } from '../src/store/AgentStore.js';
import { AgentManager } from '../src/services/AgentManager.js';
import { MetaAgentManager } from '../src/services/MetaAgentManager.js';
import type { PipelineTask } from '../src/models/Task.js';

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
    expect(cfg.claudeMd).toContain('Agent Manager');
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
});
