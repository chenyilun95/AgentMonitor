import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getGitDirectoryInfo,
  GitOperationError,
  mergeWorktree,
  updateWorktree,
} from '../src/services/GitOperations.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('GitOperations', () => {
  let tempDir: string;
  let repoDir: string;
  let worktreeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-operations-'));
    repoDir = path.join(tempDir, 'repo');
    worktreeDir = path.join(tempDir, 'agent-worktree');
    fs.mkdirSync(repoDir);
    git(repoDir, 'init', '-b', 'main');
    git(repoDir, 'config', 'user.name', 'Agent Monitor Test');
    git(repoDir, 'config', 'user.email', 'agent-monitor@example.test');
    fs.writeFileSync(path.join(repoDir, 'base.txt'), 'base\n');
    git(repoDir, 'add', 'base.txt');
    git(repoDir, 'commit', '-m', 'initial');
    git(repoDir, 'worktree', 'add', '-b', 'agent-test', worktreeDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects a repository and merges a clean worktree into its base branch', async () => {
    const info = getGitDirectoryInfo(repoDir);
    expect(info).toMatchObject({ isGit: true, branch: 'main' });
    expect(fs.realpathSync(info.root!)).toBe(fs.realpathSync(repoDir));

    fs.writeFileSync(path.join(worktreeDir, 'agent.txt'), 'agent\n');
    git(worktreeDir, 'add', 'agent.txt');
    git(worktreeDir, 'commit', '-m', 'agent change');

    await mergeWorktree(repoDir, worktreeDir, 'agent-test', 'main');

    expect(fs.readFileSync(path.join(repoDir, 'agent.txt'), 'utf8')).toBe('agent\n');
    expect(git(repoDir, 'log', '-1', '--pretty=%P').split(' ')).toHaveLength(2);
  });

  it('updates a clean worktree from the local base branch', async () => {
    fs.writeFileSync(path.join(repoDir, 'main.txt'), 'main\n');
    git(repoDir, 'add', 'main.txt');
    git(repoDir, 'commit', '-m', 'main change');

    await updateWorktree(worktreeDir, 'main');

    expect(fs.readFileSync(path.join(worktreeDir, 'main.txt'), 'utf8')).toBe('main\n');
  });

  it('refuses to merge when either working tree is dirty', async () => {
    fs.writeFileSync(path.join(worktreeDir, 'base.txt'), 'dirty\n');
    await expect(mergeWorktree(repoDir, worktreeDir, 'agent-test', 'main'))
      .rejects.toThrow(GitOperationError);
  });

  it('prevents concurrent mutating operations for the same repository', async () => {
    const results = await Promise.allSettled([
      updateWorktree(worktreeDir, 'main'),
      updateWorktree(worktreeDir, 'main'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejection.reason)).toContain('already running');
  });
});
