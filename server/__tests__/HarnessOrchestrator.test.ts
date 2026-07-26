import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentStore } from '../src/store/AgentStore.js';
import { AgentManager } from '../src/services/AgentManager.js';
import { HandoffManager } from '../src/services/HandoffManager.js';
import { HarnessOrchestrator } from '../src/services/HarnessOrchestrator.js';
import type { PipelineTask } from '../src/models/Task.js';

describe('HarnessOrchestrator evaluation', () => {
  let dir: string;
  let store: AgentStore;
  let manager: AgentManager;
  let orchestrator: HarnessOrchestrator;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    store = new AgentStore(dir);
    manager = new AgentManager(store);
    orchestrator = new HarnessOrchestrator(store, manager, new HandoffManager());
  });

  afterEach(() => {
    manager.pauseBackgroundChecks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails instead of passing when evaluator output has no verdict', () => {
    const generator: PipelineTask = {
      id: 'generator', name: 'Generator', prompt: 'build', directory: dir,
      status: 'evaluating', order: 0, createdAt: 1, role: 'generator', harnessId: 'harness',
    };
    const evaluator: PipelineTask = {
      id: 'evaluator', name: 'Evaluator', prompt: 'review', directory: dir,
      status: 'completed', order: 0, createdAt: 2, role: 'evaluator', harnessId: 'harness', parentTaskId: generator.id,
    };
    store.saveTask(generator);
    store.saveTask(evaluator);

    (orchestrator as unknown as { onEvaluatorComplete(task: PipelineTask): void }).onEvaluatorComplete(evaluator);

    expect(store.getTask(evaluator.id)?.status).toBe('failed');
    expect(store.getTask(generator.id)?.status).toBe('failed');
    expect(store.getTask(generator.id)?.error).toContain('valid pass/fail');
  });
});
