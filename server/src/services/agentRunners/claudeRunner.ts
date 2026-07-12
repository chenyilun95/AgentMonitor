import { config } from '../../config.js';
import { runtimeCapabilities } from '../RuntimeCapabilities.js';
import type { AgentRunner } from './types.js';
import { shellEscape } from './types.js';

export const claudeRunner: AgentRunner = {
  buildCommand(opts) {
    const reasoningEffort = runtimeCapabilities.normalizeReasoningEffort('claude', opts.reasoningEffort);
    // -p is required for --resume to work in non-interactive mode.
    // --input-format stream-json keeps stdin open so follow-up messages can be sent after start.
    const args: string[] = [
      '-p', shellEscape(opts.prompt),
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
    ];

    if (opts.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (opts.resume) {
      args.push('--resume', shellEscape(opts.resume));
    }

    if (opts.model) {
      args.push('--model', shellEscape(opts.model));
    }

    if (reasoningEffort) {
      args.push('--effort', shellEscape(reasoningEffort));
    }

    if (opts.chrome) {
      args.push('--chrome');
    }

    if (opts.permissionMode) {
      args.push('--permission-mode', shellEscape(opts.permissionMode));
    }

    if (opts.maxBudgetUsd && opts.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', String(opts.maxBudgetUsd));
    }

    if (opts.allowedTools) {
      args.push('--allowedTools', shellEscape(opts.allowedTools));
    }

    if (opts.disallowedTools) {
      args.push('--disallowedTools', shellEscape(opts.disallowedTools));
    }

    if (opts.addDirs) {
      for (const dir of opts.addDirs.split(/[,\s]+/).filter(Boolean)) {
        args.push('--add-dir', shellEscape(dir));
      }
    }

    if (opts.mcpConfig) {
      args.push('--mcp-config', shellEscape(opts.mcpConfig));
    }

    return { bin: config.claudeBin, args };
  },

  handleStartInput(stdin, opts) {
    if (!stdin?.writable) return;
    const msg = this.formatUserMessage(opts.prompt);
    if (msg) stdin.write(msg);
  },

  formatUserMessage(text) {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
  },
};
