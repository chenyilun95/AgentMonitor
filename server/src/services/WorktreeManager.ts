import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { AgentProvider } from '../models/Agent.js';
import { getInstructionFileName } from '../utils/instructionFiles.js';

export class WorktreeManager {
  createWorktree(
    repoDir: string,
    branchName: string,
    claudeMd?: string,
    provider: AgentProvider = 'claude',
  ): { worktreePath: string; branch: string } {
    const worktreeBase = path.join(repoDir, '.agent-worktrees');
    fs.mkdirSync(worktreeBase, { recursive: true });

    const worktreePath = path.join(worktreeBase, branchName);

    // Verify the directory is a git repo (caller should check before calling)
    execSync('git rev-parse --git-dir', { cwd: repoDir, stdio: 'pipe' });

    // Create the worktree
    execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
      cwd: repoDir,
      stdio: 'pipe',
    });

    // Write the provider-specific instruction file if provided.
    if (claudeMd) {
      fs.writeFileSync(path.join(worktreePath, getInstructionFileName(provider)), claudeMd);
    }

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

  updateClaudeMd(worktreePath: string, content: string, provider: AgentProvider = 'claude'): void {
    fs.writeFileSync(path.join(worktreePath, getInstructionFileName(provider)), content);
  }

  getClaudeMd(worktreePath: string, provider: AgentProvider = 'claude'): string | null {
    const filePath = path.join(worktreePath, getInstructionFileName(provider));
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return null;
  }
}
