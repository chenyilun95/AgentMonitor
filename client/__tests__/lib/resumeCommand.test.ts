import { describe, it, expect } from 'vitest';
import { buildResumeCommand } from '../../src/lib/resumeCommand';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    status: 'running',
    config: {
      provider: 'claude',
      directory: '/home/user/project',
      prompt: 'do stuff',
      flags: {},
    },
    messages: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  } as any;
}

describe('buildResumeCommand', () => {
  it('returns undefined when agent is null', () => {
    expect(buildResumeCommand(null)).toBeUndefined();
  });

  it('returns undefined when agent has no sessionId', () => {
    const agent = makeAgent({ sessionId: undefined });
    expect(buildResumeCommand(agent)).toBeUndefined();
  });

  it('returns a claude resume command for claude provider', () => {
    const agent = makeAgent({
      sessionId: 'sess-abc',
      config: {
        provider: 'claude',
        directory: '/home/user/project',
        prompt: 'do stuff',
        flags: {},
      },
    });
    const cmd = buildResumeCommand(agent);

    expect(cmd).toBeDefined();
    expect(cmd).toMatch(/^claude --resume sess-abc/);
  });

  it('returns a codex resume command for codex provider', () => {
    const agent = makeAgent({
      sessionId: 'sess-xyz',
      config: {
        provider: 'codex',
        directory: '/home/user/project',
        prompt: 'do stuff',
        flags: {},
      },
    });
    const cmd = buildResumeCommand(agent);

    expect(cmd).toBeDefined();
    expect(cmd).toMatch(/^codex resume --include-non-interactive sess-xyz/);
  });

  it('includes --model flag for claude provider when model is set', () => {
    const agent = makeAgent({
      sessionId: 'sess-abc',
      config: {
        provider: 'claude',
        directory: '/home/user/project',
        prompt: 'do stuff',
        flags: { model: 'opus' },
      },
    });
    const cmd = buildResumeCommand(agent)!;

    expect(cmd).toContain('--model opus');
  });

  it('includes --dangerously-bypass-approvals-and-sandbox for codex with dangerouslySkipPermissions', () => {
    const agent = makeAgent({
      sessionId: 'sess-xyz',
      config: {
        provider: 'codex',
        directory: '/home/user/project',
        prompt: 'do stuff',
        flags: { dangerouslySkipPermissions: true },
      },
    });
    const cmd = buildResumeCommand(agent)!;

    expect(cmd).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('includes --add-dir for each directory in addDirs flag for claude provider', () => {
    const agent = makeAgent({
      sessionId: 'sess-abc',
      config: {
        provider: 'claude',
        directory: '/home/user/project',
        prompt: 'do stuff',
        flags: { addDirs: '/extra/dir1,/extra/dir2' },
      },
    });
    const cmd = buildResumeCommand(agent)!;

    expect(cmd).toContain('--add-dir /extra/dir1');
    expect(cmd).toContain('--add-dir /extra/dir2');
  });
});
