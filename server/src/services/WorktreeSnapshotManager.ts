import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

export interface WorktreeSnapshot {
  beforeTurnIndex: number;
  commit: string;
  ref?: string;
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
  }).trim();
}

/**
 * Creates restore points without modifying the worktree index or adding commits
 * to the agent branch. Dirty files are staged through a temporary Git index and
 * kept alive under a private Agent Monitor ref.
 */
export class WorktreeSnapshotManager {
  create(worktreePath: string, agentId: string, beforeTurnIndex: number): WorktreeSnapshot {
    git(worktreePath, ['rev-parse', '--git-dir']);
    const head = git(worktreePath, ['rev-parse', 'HEAD']);
    const ref = `refs/agent-monitor/snapshots/${agentId}/${beforeTurnIndex}`;
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agent-monitor-index-'));
    const indexFile = path.join(tempDir, 'index');

    try {
      const env = { GIT_INDEX_FILE: indexFile };
      git(worktreePath, ['read-tree', 'HEAD'], env);
      git(worktreePath, ['add', '-A'], env);
      const tree = git(worktreePath, ['write-tree'], env);
      const commit = git(worktreePath, [
        'commit-tree', tree, '-p', head, '-m', `[agent-monitor snapshot] before turn ${beforeTurnIndex}`,
      ], {
        ...env,
        GIT_AUTHOR_NAME: 'Agent Monitor',
        GIT_AUTHOR_EMAIL: 'agent-monitor@localhost',
        GIT_COMMITTER_NAME: 'Agent Monitor',
        GIT_COMMITTER_EMAIL: 'agent-monitor@localhost',
      });
      git(worktreePath, ['update-ref', ref, commit]);
      return { beforeTurnIndex, commit, ref };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  restore(worktreePath: string, snapshot: WorktreeSnapshot): void {
    git(worktreePath, ['cat-file', '-e', `${snapshot.commit}^{commit}`]);
    // Ignored local files are intentionally preserved. All non-ignored files
    // are rebuilt from the captured tree without moving the current branch.
    git(worktreePath, ['clean', '-fd']);
    git(worktreePath, ['read-tree', '--reset', '-u', `${snapshot.commit}^{tree}`]);
  }

  release(worktreePath: string, snapshot: WorktreeSnapshot): void {
    if (!snapshot.ref) return;
    try {
      git(worktreePath, ['update-ref', '-d', snapshot.ref]);
    } catch {
      // The worktree or private ref may already have been removed.
    }
  }
}
