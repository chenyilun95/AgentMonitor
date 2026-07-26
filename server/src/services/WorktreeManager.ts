import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export class WorktreeManager {
  private ensureInternalWorktreeExcluded(repoDir: string): void {
    const excludeOutput = execSync('git rev-parse --git-path info/exclude', {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    const excludePath = path.isAbsolute(excludeOutput)
      ? excludeOutput
      : path.resolve(repoDir, excludeOutput);
    const pattern = '/.agent-worktrees/';
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
    if (existing.split(/\r?\n/).includes(pattern)) return;
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.appendFileSync(excludePath, `${existing && !existing.endsWith('\n') ? '\n' : ''}${pattern}\n`);
  }

  createWorktree(
    repoDir: string,
    branchName: string,
  ): { worktreePath: string; branch: string } {
    const worktreeBase = path.join(repoDir, '.agent-worktrees');
    fs.mkdirSync(worktreeBase, { recursive: true });

    const worktreePath = path.join(worktreeBase, branchName);

    // Verify the directory is a git repo (caller should check before calling)
    execSync('git rev-parse --git-dir', { cwd: repoDir, stdio: 'pipe' });
    this.ensureInternalWorktreeExcluded(repoDir);

    // Create the worktree
    execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
      cwd: repoDir,
      stdio: 'pipe',
    });

    return { worktreePath, branch: branchName };
  }

  removeWorktree(repoDir: string, worktreePath: string, branchName: string): void {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoDir,
        stdio: 'pipe',
      });
    } catch {
      // worktree may already be gone
    }
    try {
      execSync(`git branch -D "${branchName}"`, {
        cwd: repoDir,
        stdio: 'pipe',
      });
    } catch {
      // branch may already be gone
    }
  }

  createDirectLink(
    repoDir: string,
    branchName: string,
  ): { worktreePath: string } {
    const worktreeBase = path.join(repoDir, '.agent-worktrees');
    fs.mkdirSync(worktreeBase, { recursive: true });

    execSync('git rev-parse --git-dir', { cwd: repoDir, stdio: 'pipe' });
    this.ensureInternalWorktreeExcluded(repoDir);

    const worktreePath = path.join(worktreeBase, branchName);
    if (fs.existsSync(worktreePath) || fs.lstatSync(worktreePath, { throwIfNoEntry: false })) {
      throw new Error(`workspace path already exists: ${worktreePath}`);
    }
    fs.symlinkSync(repoDir, worktreePath, 'dir');
    return { worktreePath };
  }

  removeDirectLink(worktreePath: string): void {
    try {
      const stat = fs.lstatSync(worktreePath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(worktreePath);
      }
      // If it isn't a symlink, refuse to touch it — caller likely passed wrong path.
    } catch {
      // already gone
    }
  }

}
