import { describe, it, expect } from 'vitest';
import {
  buildCommitPrompt,
  buildMergeToBasePrompt,
  buildUpdateFromBasePrompt,
} from '../../src/lib/commitPrompt';

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

    expect(prompt).toContain('original working directory');
    expect(prompt).not.toContain('worktree branch');
    expect(prompt).toContain('git pull --rebase');
    expect(prompt).toContain('Push the current branch');
  });

  it('produces a worktree prompt when workspaceMode is "worktree" with a worktreeBranch', () => {
    const agent = makeAgent({
      workspaceMode: 'worktree',
      worktreeBranch: 'feature-123',
      baseBranch: 'main',
    });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('worktree branch');
    expect(prompt).toContain('feature-123');
    expect(prompt).toContain('original branch "main"');
    expect(prompt).toContain('rebase "feature-123" onto the updated original branch "main"');
    expect(prompt).toContain('fast-forward merge Worktree branch "feature-123"');
    expect(prompt).toContain('Push the original branch');
    expect(prompt).toContain('git pull --rebase');
  });

  it('falls back to direct-mode prompt when workspaceMode is unset and worktreeBranch is absent', () => {
    const agent = makeAgent();
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('original working directory');
    expect(prompt).not.toContain('worktree branch');
  });

  it('rebases, resolves conflicts, and pushes in direct mode', () => {
    const agent = makeAgent({ workspaceMode: 'direct' });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('git pull --rebase');
    expect(prompt).toContain('resolve them according to the intent of both sides');
    expect(prompt).toContain('Push the current branch to its configured upstream');
    expect(prompt).toContain('force-push');
  });

  it('rebases the agent branch, resolves conflicts, merges, and pushes the base branch', () => {
    const agent = makeAgent({
      workspaceMode: 'worktree',
      worktreeBranch: 'feature-123',
      baseBranch: 'develop',
    });
    const prompt = buildCommitPrompt(agent);

    expect(prompt).toContain('Commit on the Worktree branch');
    expect(prompt).toContain('checked-out branch is "develop"');
    expect(prompt).toContain('git pull --rebase');
    expect(prompt).toContain('rebase "feature-123" onto the updated original branch "develop"');
    expect(prompt).toContain('resolve them according to the intent of both sides');
    expect(prompt).toContain('fast-forward merge Worktree branch "feature-123"');
    expect(prompt).toContain('Push the original branch');
    expect(prompt).toContain('force-push');
  });

  it('builds a prompt that updates the Worktree from its local base branch', () => {
    const prompt = buildUpdateFromBasePrompt(makeAgent({
      workspaceMode: 'worktree',
      worktreeBranch: 'feature-123',
      baseBranch: 'develop',
    }));

    expect(prompt).toContain('Update the current Worktree branch "feature-123"');
    expect(prompt).toContain('Rebase Worktree branch "feature-123" onto the local original branch "develop"');
    expect(prompt).toContain('resolve them according to the intent of both sides');
    expect(prompt).toContain('Do not pull or push remote branches');
  });

  it('builds a prompt that integrates the Worktree into its local base without pushing', () => {
    const prompt = buildMergeToBasePrompt(makeAgent({
      workspaceMode: 'worktree',
      worktreeBranch: 'feature-123',
      baseBranch: 'develop',
    }));

    expect(prompt).toContain('Merge the current Worktree branch "feature-123" back into its original branch "develop"');
    expect(prompt).toContain('fast-forward merge Worktree branch "feature-123"');
    expect(prompt).toContain('Do not pull, push');
  });
});
