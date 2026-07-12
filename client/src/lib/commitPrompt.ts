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
      `2. Go to the original repo directory ("${dir}") and run:`,
      `   git merge --no-ff ${branch} -m "merge: ${branch}"`,
      '   If there are merge conflicts, list them and stop — do NOT auto-resolve.',
      '3. After a clean merge, commit any remaining uncommitted changes with a descriptive message summarizing what was done.',
    ].join('\n');
  }

  return [
    'Review and commit the current changes:',
    '',
    '1. Run `git diff --stat` and `git status` to see what changed.',
    '2. Stage all relevant changes (skip any .env or credentials files).',
    '3. Commit with a clear, descriptive message summarizing the work.',
  ].join('\n');
}
