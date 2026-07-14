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

    expect(prompt).toContain('Review, commit, sync, and push');
    expect(prompt).not.toContain('worktree branch');
    expect(prompt.indexOf('git pull --rebase')).toBeLessThan(prompt.indexOf('git push'));
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
    expect(prompt.indexOf('git pull --rebase')).toBeLessThan(prompt.indexOf('git merge'));
    expect(prompt.indexOf('git merge')).toBeLessThan(prompt.indexOf('git push'));
  });

  it('falls back to direct-mode prompt when workspaceMode is unset and worktreeBranch is absent', () => {
    const agent = makeAgent();
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('Review, commit, sync, and push');
    expect(prompt).not.toContain('worktree branch');
  });

  it('pulls before pushing in direct mode', () => {
    const agent = makeAgent({ workspaceMode: 'direct' });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('git pull --rebase');
    expect(prompt).toContain('git push');
    expect(prompt.indexOf('git pull --rebase')).toBeLessThan(prompt.indexOf('git push'));
  });

  it('pulls before merging and pushing in worktree mode', () => {
    const agent = makeAgent({
      workspaceMode: 'worktree',
      worktreeBranch: 'feature-123',
    });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('git pull --rebase');
    expect(prompt).toContain('git push');
    expect(prompt.indexOf('git pull --rebase')).toBeLessThan(prompt.indexOf('git merge'));
    expect(prompt.indexOf('git merge')).toBeLessThan(prompt.indexOf('git push'));
  });
});
