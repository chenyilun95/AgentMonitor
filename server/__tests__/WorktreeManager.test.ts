import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { WorktreeManager } from '../src/services/WorktreeManager.js';

describe('WorktreeManager', () => {
  let tmpDir: string;
  let manager: WorktreeManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'));
    manager = new WorktreeManager();

    // Initialize a git repo
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    // Clean up worktrees first
    try {
      execSync('git worktree prune', { cwd: tmpDir, stdio: 'pipe' });
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a worktree', () => {
    const result = manager.createWorktree(tmpDir, 'test-branch');
    expect(result.worktreePath).toContain('test-branch');
    expect(result.branch).toBe('test-branch');
    expect(fs.existsSync(result.worktreePath)).toBe(true);
    const exclude = execSync('git rev-parse --git-path info/exclude', {
      cwd: tmpDir,
      encoding: 'utf8',
    }).trim();
    expect(fs.readFileSync(path.resolve(tmpDir, exclude), 'utf8')).toContain('/.agent-worktrees/');
    expect(execSync('git status --porcelain', { cwd: tmpDir, encoding: 'utf8' })).toBe('');
  });

  it('does not modify a tracked CLAUDE.md in the worktree', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Repository Config');
    execSync('git add CLAUDE.md && git commit -m "add instructions"', { cwd: tmpDir, stdio: 'pipe' });
    const result = manager.createWorktree(tmpDir, 'test-branch-md');
    const providerInstructions = fs.readFileSync(path.join(result.worktreePath, 'CLAUDE.md'), 'utf-8');
    expect(providerInstructions).toBe('# Repository Config');
    expect(execSync('git status --porcelain', { cwd: result.worktreePath, encoding: 'utf8' })).toBe('');
  });

  it('removes a worktree', () => {
    const result = manager.createWorktree(tmpDir, 'to-remove');
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    manager.removeWorktree(tmpDir, result.worktreePath, 'to-remove');
    // Worktree should be removed
    expect(fs.existsSync(result.worktreePath)).toBe(false);
  });

  it('does not create an untracked AGENTS.md for Codex worktrees', () => {
    const result = manager.createWorktree(tmpDir, 'codex-md');
    expect(fs.existsSync(path.join(result.worktreePath, 'AGENTS.md'))).toBe(false);
    expect(execSync('git status --porcelain', { cwd: result.worktreePath, encoding: 'utf8' })).toBe('');
  });
});
