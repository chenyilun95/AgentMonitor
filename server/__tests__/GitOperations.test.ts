import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getGitDirectoryInfo,
  GitOperationError,
  pullDirectory,
  pushDirectory,
} from '../src/services/GitOperations.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('GitOperations', () => {
  let tempDir: string;
  let repoDir: string;
  let remoteDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-operations-'));
    repoDir = path.join(tempDir, 'repo');
    remoteDir = path.join(tempDir, 'remote.git');
    fs.mkdirSync(repoDir);
    fs.mkdirSync(remoteDir);
    git(remoteDir, 'init', '--bare');
    git(repoDir, 'init', '-b', 'main');
    git(repoDir, 'config', 'user.name', 'Agent Monitor Test');
    git(repoDir, 'config', 'user.email', 'agent-monitor@example.test');
    fs.writeFileSync(path.join(repoDir, 'base.txt'), 'base\n');
    git(repoDir, 'add', 'base.txt');
    git(repoDir, 'commit', '-m', 'initial');
    git(repoDir, 'remote', 'add', 'origin', remoteDir);
    git(repoDir, 'push', '-u', 'origin', 'main');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects a repository and its upstream', () => {
    expect(getGitDirectoryInfo(repoDir)).toMatchObject({
      isGit: true,
      branch: 'main',
      upstream: 'origin/main',
    });
  });

  it('pulls a fast-forward update from the configured upstream', async () => {
    const other = path.join(tempDir, 'other');
    git(tempDir, 'clone', remoteDir, other);
    git(other, 'switch', 'main');
    git(other, 'config', 'user.name', 'Other');
    git(other, 'config', 'user.email', 'other@example.test');
    fs.writeFileSync(path.join(other, 'remote.txt'), 'remote\n');
    git(other, 'add', 'remote.txt');
    git(other, 'commit', '-m', 'remote update');
    git(other, 'push');

    await pullDirectory(repoDir);
    expect(fs.readFileSync(path.join(repoDir, 'remote.txt'), 'utf8')).toBe('remote\n');
  });

  it('pushes the current original branch', async () => {
    fs.writeFileSync(path.join(repoDir, 'local.txt'), 'local\n');
    git(repoDir, 'add', 'local.txt');
    git(repoDir, 'commit', '-m', 'local update');
    await pushDirectory(repoDir);
    expect(git(remoteDir, 'show', 'main:local.txt')).toBe('local');
  });

  it('refuses remote operations when the original checkout is dirty', async () => {
    fs.writeFileSync(path.join(repoDir, 'base.txt'), 'dirty\n');
    await expect(pullDirectory(repoDir)).rejects.toThrow(GitOperationError);
  });

  it('prevents concurrent mutating operations for the same repository', async () => {
    const results = await Promise.allSettled([pullDirectory(repoDir), pullDirectory(repoDir)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejection.reason)).toContain('already running');
  });
});
