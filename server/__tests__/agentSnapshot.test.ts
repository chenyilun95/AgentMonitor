import { describe, expect, it } from 'vitest';
import type { Agent } from '../src/models/Agent.js';
import { sanitizeAgentListSnapshot } from '../src/utils/agentSnapshot.js';

describe('agent snapshot utilities', () => {
  it('keeps only a bounded last-message preview for list snapshots', () => {
    const longContent = 'x'.repeat(800);
    const agent: Agent = {
      id: 'agent-1',
      name: 'List Snapshot Test',
      status: 'stopped',
      config: {
        provider: 'codex',
        directory: '/tmp',
        prompt: 'prompt',
        flags: {},
      },
      messages: [
        { id: 'm1', role: 'user', content: 'first', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: longContent, timestamp: 2, toolInput: 'large input', toolResult: 'large output' },
      ],
      lastActivity: 2,
      createdAt: 1,
      structuredOutput: { value: true },
      restoredConversationSeed: 'seed',
      codeSnapshots: [{ beforeTurnIndex: 0, commit: 'abc123' }],
      logs: [{ id: 'log-1', timestamp: 2, level: 'debug', source: 'stdout', message: 'large log' }],
    };

    const snapshot = sanitizeAgentListSnapshot(agent);

    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].id).toBe('m2');
    expect(snapshot.messages[0].content.length).toBeLessThan(longContent.length);
    expect(snapshot.messages[0].toolInput).toBeUndefined();
    expect(snapshot.messages[0].toolResult).toBeUndefined();
    expect(snapshot.structuredOutput).toBeUndefined();
    expect(snapshot.restoredConversationSeed).toBeUndefined();
    expect(snapshot.codeSnapshots).toBeUndefined();
    expect(snapshot.logs).toBeUndefined();
  });
});
