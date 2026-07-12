import { config } from '../../config.js';
import { runtimeCapabilities } from '../RuntimeCapabilities.js';
import type { AgentRunner } from './types.js';
import { shellEscape } from './types.js';

export const codexRunner: AgentRunner = {
  buildCommand(opts) {
    const reasoningEffort = runtimeCapabilities.normalizeReasoningEffort('codex', opts.reasoningEffort);
    const isResume = !!opts.resume;
    const args: string[] = isResume
      ? ['exec', 'resume', '--json']
      : ['exec', '--json'];

    if (opts.dangerouslySkipPermissions) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (opts.fullAuto || opts.askForApprovalNever) {
      args.push('-c', shellEscape('approval_policy="never"'));
    }

    if (opts.sandboxDangerFullAccess && isResume) {
      args.push('-c', shellEscape('sandbox_mode="danger-full-access"'));
    } else if (opts.sandboxDangerFullAccess) {
      args.push('--sandbox', 'danger-full-access');
    }

    if (opts.model) {
      args.push('--model', shellEscape(opts.model));
    }

    if (reasoningEffort) {
      args.push('-c', shellEscape(`model_reasoning_effort="${reasoningEffort}"`));
    }

    if (!isResume) {
      args.push('--cd', shellEscape(opts.directory));
    }
    args.push('--skip-git-repo-check');

    if (opts.resume) {
      args.push('--', shellEscape(opts.resume));
    } else {
      args.push('--');
    }
    args.push(shellEscape(opts.prompt));

    return { bin: config.codexBin, args };
  },

  handleStartInput(stdin) {
    // Codex treats piped stdin as additional prompt input and waits for EOF.
    // The prompt is passed via argv, so close stdin immediately.
    if (stdin?.writable) stdin.end();
  },

  formatUserMessage() {
    return undefined;
  },
};
