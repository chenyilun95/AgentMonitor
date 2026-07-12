import { describe, it, expect } from 'vitest';
import { buildCommitPrompt } from '../../src/lib/commitPrompt';

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

describe('buildCommitPrompt', () => {
  it('produces a direct-mode prompt when workspaceMode is "direct"', () => {
    const agent = makeAgent({ workspaceMode: 'direct' });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('Review and commit');
    expect(prompt).not.toContain('worktree branch');
  });

  it('produces a worktree prompt when workspaceMode is "worktree" with a worktreeBranch', () => {
    const agent = makeAgent({
      workspaceMode: 'worktree',
      worktreeBranch: 'feature-123',
    });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('worktree branch');
    expect(prompt).toContain('feature-123');
    expect(prompt).toContain('git merge');
  });

  it('falls back to direct-mode prompt when workspaceMode is unset and worktreeBranch is absent', () => {
    const agent = makeAgent();
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('Review and commit');
    expect(prompt).not.toContain('worktree branch');
  });

  it('does not include push step in direct mode', () => {
    const agent = makeAgent({ workspaceMode: 'direct' });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).not.toContain('Push');
    expect(prompt).not.toContain('push');
  });

  it('does not include push step in worktree mode', () => {
    const agent = makeAgent({
      workspaceMode: 'worktree',
      worktreeBranch: 'feature-123',
    });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).not.toContain('Push');
    expect(prompt).not.toContain('push');
  });
});
