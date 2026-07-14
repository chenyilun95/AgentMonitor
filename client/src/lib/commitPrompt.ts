import type { AgentClientView } from '@agent-monitor/shared';

export function buildCommitPrompt(agent: AgentClientView): string {
  const isWorktree = agent.workspaceMode !== 'direct' && !!agent.worktreeBranch;
  const branch = agent.worktreeBranch || '';
  const dir = agent.config.directory;

  if (isWorktree) {
    return [
      `You are on worktree branch "${branch}". The original repo is at "${dir}".`,
      '',
      'Do the following steps in order. Stop and report if any step fails:',
      '',
      '1. Run `git diff --stat` and `git status` to review all changes.',
      '2. In the worktree, stage all relevant changes (skip any .env or credential files) and commit them with a clear, descriptive message.',
      `3. Go to the original repo directory ("${dir}") and run \`git pull --rebase\` on its current branch.`,
      '   If the pull or rebase fails, report the error and stop — do NOT discard or overwrite local changes.',
      '4. Merge the worktree branch into the current branch with:',
      `   git merge --no-ff ${branch} -m "merge: ${branch}"`,
      '   If there are merge conflicts, list them and stop — do NOT auto-resolve.',
      '5. Run `git push`. If the push fails, report the error and stop.',
    ].join('\n');
  }

  return [
    'Review, commit, sync, and push the current changes:',
    '',
    'Do the following steps in order. Stop and report if any step fails:',
    '',
    '1. Run `git diff --stat` and `git status` to see what changed.',
    '2. Stage all relevant changes (skip any .env or credentials files).',
    '3. Commit with a clear, descriptive message summarizing the work.',
    '4. Run `git pull --rebase`. If the pull or rebase fails, report the error and stop — do NOT discard or overwrite local changes.',
    '5. Run `git push`. If the push fails, report the error and stop.',
  ].join('\n');
}
