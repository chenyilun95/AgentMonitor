import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WorktreeSnapshotManager } from '../src/services/WorktreeSnapshotManager.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('WorktreeSnapshotManager', () => {
  let repo: string;
  let manager: WorktreeSnapshotManager;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-snapshot-'));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.test');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'initial\n');
    git(repo, 'add', 'tracked.txt');
    git(repo, 'commit', '-m', 'initial');
    manager = new WorktreeSnapshotManager();
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('captures dirty and untracked files without changing branch history or index', () => {
    const head = git(repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'snapshot\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'snapshot extra\n');
    const status = git(repo, 'status', '--porcelain');

    const snapshot = manager.create(repo, 'agent-test', 1);

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(repo, 'status', '--porcelain')).toBe(status);
    expect(git(repo, 'show', `${snapshot.commit}:tracked.txt`)).toBe('snapshot');
    expect(git(repo, 'show', `${snapshot.commit}:untracked.txt`)).toBe('snapshot extra');
  });

  it('restores the captured tree without moving the branch', () => {
    const head = git(repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'snapshot\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'snapshot extra\n');
    const snapshot = manager.create(repo, 'agent-test', 1);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'later\n');
    fs.rmSync(path.join(repo, 'untracked.txt'));
    fs.writeFileSync(path.join(repo, 'later.txt'), 'remove me\n');

    manager.restore(repo, snapshot);

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8')).toBe('snapshot\n');
    expect(fs.readFileSync(path.join(repo, 'untracked.txt'), 'utf8')).toBe('snapshot extra\n');
    expect(fs.existsSync(path.join(repo, 'later.txt'))).toBe(false);
  });
});
