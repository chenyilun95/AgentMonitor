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

    // Write the provider-specific instruction file with worktree context.
    const worktreeNotice = [
      '',
      '## Worktree Mode',
      '',
      `You are working in an isolated git worktree on branch \`${branchName}\`.`,
      `Original repository: \`${repoDir}\``,
      '',
      '### Workflow',
      '1. Make your code changes in this worktree.',
      '2. Commit freely on this branch with clean, descriptive commit messages.',
      '3. When finished, your branch will be merged back to the original repository via `git merge` or `git cherry-pick`.',
      '',
      '### Build & Test',
      '- If this project has no shared resource conflicts (ports, databases, lock files, etc.), you MAY install dependencies and run build/test in this worktree.',
      '- If this project uses shared resources that would conflict with other running instances, do NOT build or start servers here. Build and test will happen in the original repository after merging.',
      '- When in doubt, focus on code changes only and let the user handle build/test.',
      '',
      '### Rules',
      '- Do NOT merge into or push to the main branch — that is handled separately.',
      '- Do NOT copy files manually to the original repo — all changes flow back through git merge.',
      '',
    ].join('\n');

    const fullContent = (claudeMd || '') + worktreeNotice;
    fs.writeFileSync(path.join(worktreePath, getInstructionFileName(provider)), fullContent);

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

  deploySkills(
    worktreePath: string,
    skillNames: string[],
    provider: AgentProvider,
    skillsDir: string,
  ): void {
    if (skillNames.length === 0) return;

    if (provider === 'claude') {
      const targetDir = path.join(worktreePath, '.claude', 'skills');
      fs.mkdirSync(targetDir, { recursive: true });
      for (const name of skillNames) {
        const src = path.join(skillsDir, name);
        const dest = path.join(targetDir, name);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.symlinkSync(src, dest, 'dir');
        }
      }
    } else {
      const targetDir = path.join(worktreePath, '.skills');
      fs.mkdirSync(targetDir, { recursive: true });
      for (const name of skillNames) {
        const src = path.join(skillsDir, name);
        const dest = path.join(targetDir, name);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.symlinkSync(src, dest, 'dir');
        }
      }
      this.appendSkillsToAgentsMd(worktreePath, skillNames, skillsDir);
    }
  }

  private appendSkillsToAgentsMd(worktreePath: string, skillNames: string[], skillsDir: string): void {
    const agentsMdPath = path.join(worktreePath, getInstructionFileName('codex'));
    let content = '';
    if (fs.existsSync(agentsMdPath)) {
      content = fs.readFileSync(agentsMdPath, 'utf-8');
    }

    const lines: string[] = ['\n\n## Available Skills\n'];
    for (const name of skillNames) {
      const skillMdPath = path.join(skillsDir, name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;
      const raw = fs.readFileSync(skillMdPath, 'utf-8');
      const match = raw.match(/^---\r?\n[\s\S]*?description:\s*(.+)\r?\n[\s\S]*?\r?\n---/);
      const desc = match ? match[1].replace(/^["']|["']$/g, '').trim() : name;
      lines.push(`- **${name}** (\`.skills/${name}/SKILL.md\`): ${desc}`);
    }
    lines.push('\nWhen you need to use a skill, read the corresponding SKILL.md for detailed instructions. Scripts are in `.skills/<name>/scripts/`.\n');

    fs.writeFileSync(agentsMdPath, content + lines.join('\n'));
  }
}
