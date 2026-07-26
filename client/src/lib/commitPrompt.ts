import type { AgentClientView } from '@agent-monitor/shared';

function requireWorktreeDetails(agent: AgentClientView): { worktreeBranch: string; baseBranch: string } {
  if (!agent.worktreeBranch || !agent.baseBranch) {
    throw new Error('This agent does not have complete Worktree branch information.');
  }
  return { worktreeBranch: agent.worktreeBranch, baseBranch: agent.baseBranch };
}

export function buildUpdateFromBasePrompt(agent: AgentClientView): string {
  const { worktreeBranch, baseBranch } = requireWorktreeDetails(agent);
  return [
    `Update the current Worktree branch "${worktreeBranch}" from its original base branch "${baseBranch}".`,
    '',
    'Do the following steps in order:',
    '',
    '1. In the Worktree, inspect `git status` and verify there are no uncommitted changes. If it is not clean, stop and report what must be committed first.',
    `2. Rebase Worktree branch "${worktreeBranch}" onto the local original branch "${baseBranch}". Do not pull or push remote branches.`,
    '3. If there are conflicts, inspect the base, local, and incoming changes and resolve them according to the intent of both sides. Do not blindly choose ours or theirs. Stage each resolution and continue the rebase.',
    '4. Review the result and run the relevant tests or checks. If a conflict cannot be resolved confidently or checks fail, stop and report without discarding work.',
    '5. Summarize which commits or files were updated so the conversation records the new Worktree state.',
    'Do not merge into the original branch, stash, reset away changes, switch branches, push, or force-push.',
  ].join('\n');
}

export function buildMergeToBasePrompt(agent: AgentClientView): string {
  const { worktreeBranch, baseBranch } = requireWorktreeDetails(agent);
  return [
    `Merge the current Worktree branch "${worktreeBranch}" back into its original branch "${baseBranch}" without pushing to the remote.`,
    `The original working directory is "${agent.config.directory}".`,
    '',
    'Do the following steps in order:',
    '',
    '1. Verify the Worktree has no uncommitted changes. If it is not clean, stop and report what must be committed first.',
    `2. Verify the original working directory is clean and currently has branch "${baseBranch}" checked out. Stop if either check fails; do not switch branches automatically.`,
    `3. Rebase Worktree branch "${worktreeBranch}" onto the local original branch "${baseBranch}" so the integration can be linear. Do not pull remote changes.`,
    '4. If there are conflicts, inspect the base, local, and incoming changes and resolve them according to the intent of both sides. Do not blindly choose ours or theirs. Stage each resolution and continue the rebase.',
    '5. Review the result and run the relevant tests or checks. If a conflict cannot be resolved confidently or checks fail, stop and report without discarding work.',
    `6. In the original working directory, fast-forward merge Worktree branch "${worktreeBranch}" into "${baseBranch}".`,
    '7. Summarize the integration result so the conversation records the updated original branch state.',
    'Do not pull, push, stash, reset away changes, switch branches, or force-push.',
  ].join('\n');
}

export function buildCommitPrompt(agent: AgentClientView): string {
  const isWorktree = agent.workspaceMode !== 'direct' && !!agent.worktreeBranch;
  const baseBranch = agent.baseBranch;

  if (isWorktree) {
    return [
      `Review and commit the current changes on worktree branch "${agent.worktreeBranch}", rebase them onto the latest original branch${baseBranch ? ` "${baseBranch}"` : ''}, merge them back, and push that original branch.`,
      `The original working directory is "${agent.config.directory}".`,
      '',
      'Do the following steps in order:',
      '',
      '1. In the Worktree, run `git diff --stat` and `git status` to see what changed.',
      '2. Stage all relevant changes (skip any .env or credentials files).',
      '3. Commit on the Worktree branch with a clear, descriptive message.',
      `4. In the original working directory, verify that the working tree is clean and that the checked-out branch is${baseBranch ? ` "${baseBranch}"` : ' the Worktree\'s original base branch'}. Stop if either check fails.`,
      '5. In the original working directory, run `git pull --rebase` to update the original branch from its configured upstream.',
      `6. In the Worktree, rebase "${agent.worktreeBranch}" onto the updated original branch${baseBranch ? ` "${baseBranch}"` : ''}.`,
      '7. If either rebase has conflicts, inspect the base, local, and incoming changes and resolve them according to the intent of both sides. Do not blindly choose ours or theirs. Stage each resolution and continue the rebase until it completes.',
      '8. Review the resulting diff and run the relevant tests or checks. If a conflict cannot be resolved confidently or checks fail, stop and report the remaining problem without discarding work.',
      `9. In the original working directory, fast-forward merge Worktree branch "${agent.worktreeBranch}" into the checked-out original branch.`,
      '10. Push the original branch to its configured upstream. If no upstream is configured, stop and report instead of guessing a remote branch.',
      'Do not stash, switch branches, reset away changes, or force-push.',
    ].join('\n');
  }

  return [
    'Review, commit, and push the current changes in the original working directory.',
    '',
    'Do the following steps in order:',
    '',
    '1. Run `git diff --stat` and `git status` to see what changed.',
    '2. Stage all relevant changes (skip any .env or credentials files).',
    '3. Commit with a clear, descriptive message summarizing the work.',
    '4. Run `git pull --rebase` to update the current branch from its configured upstream.',
    '5. If the rebase has conflicts, inspect the base, local, and incoming changes and resolve them according to the intent of both sides. Do not blindly choose ours or theirs. Stage each resolution and continue the rebase until it completes.',
    '6. Review the rebased diff and run the relevant tests or checks. If a conflict cannot be resolved confidently or checks fail, stop and report the remaining problem without discarding work.',
    '7. Push the current branch to its configured upstream. If no upstream is configured, stop and report instead of guessing a remote branch.',
    'Do not merge, stash, switch branches, reset away changes, or force-push.',
  ].join('\n');
}
