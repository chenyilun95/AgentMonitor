import type { AgentClientView, RuntimeCapabilities } from '@agent-monitor/shared';
import { isReasoningEffortSupported } from './reasoningEffort';

export function buildResumeCommand(agent: AgentClientView | null, runtimeCapabilities?: RuntimeCapabilities | null): string | undefined {
  if (!agent) return undefined;
  const provider = agent.config.provider || 'claude';
  if (!agent.sessionId) return undefined;

  const toKebab = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

  if (provider === 'codex') {
    const parts = ['codex', 'resume', '--include-non-interactive', agent.sessionId];
    const flags = agent.config.flags || {};
    let addedApprovalPolicyNever = false;

    for (const [key, value] of Object.entries(flags)) {
      if (key === 'resume') continue;
      if (key === 'dangerouslySkipPermissions' && value === true) {
        parts.push('--dangerously-bypass-approvals-and-sandbox');
        continue;
      }
      if (key === 'fullAuto' && value === true) {
        if (!addedApprovalPolicyNever) {
          parts.push('-c', 'approval_policy="never"');
          addedApprovalPolicyNever = true;
        }
        continue;
      }
      if (key === 'askForApprovalNever' && value === true) {
        if (!addedApprovalPolicyNever) {
          parts.push('-c', 'approval_policy="never"');
          addedApprovalPolicyNever = true;
        }
        continue;
      }
      if (key === 'sandboxDangerFullAccess' && value === true) {
        parts.push('--sandbox', 'danger-full-access');
        continue;
      }
      if (key === 'reasoningEffort') {
        if (isReasoningEffortSupported(provider, value, runtimeCapabilities)) {
          parts.push('-c', `model_reasoning_effort="${String(value)}"`);
        }
        continue;
      }
      if (key === 'addDirs' && typeof value === 'string') {
        for (const dir of value.split(/[,\s]+/).filter(Boolean)) {
          parts.push('--add-dir', dir);
        }
        continue;
      }
      if (key === 'model' && value) {
        parts.push('--model', String(value));
        continue;
      }

      const flag = toKebab(key);
      if (value === true) {
        parts.push(`--${flag}`);
      } else if (value !== false && value !== undefined && value !== null && value !== '') {
        parts.push(`--${flag}`, String(value));
      }
    }

    const cwd = agent.worktreePath || agent.config.directory;
    if (cwd) {
      parts.push('--cd', cwd);
    }
    return parts.join(' ');
  }

  const parts = ['claude', '--resume', agent.sessionId];
  const flags = agent.config.flags || {};
  const codexOnlyFlags = new Set(['fullAuto', 'askForApprovalNever', 'sandboxDangerFullAccess', 'outputSchema']);
  for (const [key, value] of Object.entries(flags)) {
    if (key === 'resume') continue;
    if (codexOnlyFlags.has(key)) continue;
    if (key === 'reasoningEffort') {
      if (isReasoningEffortSupported(provider, value, runtimeCapabilities)) {
        parts.push('--effort', String(value));
      }
      continue;
    }
    if (key === 'addDirs' && typeof value === 'string') {
      for (const dir of value.split(/[,\s]+/).filter(Boolean)) {
        parts.push('--add-dir', dir);
      }
      continue;
    }
    if (key === 'mcpConfig' && value) {
      parts.push('--mcp-config', String(value));
      continue;
    }
    const flag = toKebab(key);
    if (value === true) {
      parts.push(`--${flag}`);
    } else if (value !== false && value !== undefined && value !== null && value !== '') {
      parts.push(`--${flag}`, String(value));
    }
  }
  return parts.join(' ');
}
