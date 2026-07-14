import type { Agent, AgentLogEntry } from '../models/Agent.js';

export type CodexStderrDisposition = 'ignore' | 'warn' | 'error';

const CODEX_STDIN_NOTICE = /^Reading additional input from stdin\.\.\.$/;
const CODEX_TRANSIENT_DIAGNOSTICS = [
  /^(?:\S+\s+)?ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit$/,
  /^(?:\S+\s+)?ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Client\(HttpRequest\(HttpRequest\("http\/request failed: error sending request for url \(https:\/\/developers\.openai\.com\/mcp\)"\)\)\)$/,
  /^(?:\S+\s+)?ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: tls handshake eof, url: wss:\/\/chatgpt\.com\/backend-api\/codex\/responses$/,
];

/**
 * Codex writes both actionable failures and recoverable runtime diagnostics to
 * stderr. Keep the latter visible for troubleshooting without presenting them
 * as agent/task failures or injecting them into the conversation history.
 */
export function classifyCodexStderr(text: string): CodexStderrDisposition {
  const message = text.trim();
  if (CODEX_STDIN_NOTICE.test(message)) return 'ignore';
  if (CODEX_TRANSIENT_DIAGNOSTICS.some(pattern => pattern.test(message))) return 'warn';
  return 'error';
}

function isDuplicateTerminalStderr(log: AgentLogEntry, logs: AgentLogEntry[]): boolean {
  if (log.source !== 'terminal' || log.stream !== 'stderr') return false;
  return logs.some(candidate =>
    candidate.source === 'stderr'
    && candidate.stream === 'stderr'
    && candidate.message === log.message
    && Math.abs(candidate.timestamp - log.timestamp) <= 1000
  );
}

/** Normalize diagnostics persisted by older Agent Monitor versions. */
export function normalizeStoredCodexStderr(agent: Agent): boolean {
  if (agent.config.provider !== 'codex') return false;

  const previousLogs = agent.logs || [];
  const normalizedLogs = previousLogs
    .filter(log => {
      if (log.stream !== 'stderr') return true;
      if (classifyCodexStderr(log.message) === 'ignore') return false;
      return !isDuplicateTerminalStderr(log, previousLogs);
    })
    .map(log => {
      if (log.stream !== 'stderr' || classifyCodexStderr(log.message) !== 'warn' || log.level === 'warn') {
        return log;
      }
      return { ...log, level: 'warn' as const };
    });

  const normalizedMessages = agent.messages.filter(message => {
    if (message.role !== 'system' || !message.content.startsWith('[stderr] ')) return true;
    return classifyCodexStderr(message.content.slice('[stderr] '.length)) === 'error';
  });

  const changed = normalizedLogs.length !== previousLogs.length
    || normalizedLogs.some((log, index) => log !== previousLogs[index])
    || normalizedMessages.length !== agent.messages.length;

  if (changed) {
    agent.logs = normalizedLogs;
    agent.messages = normalizedMessages;
  }
  return changed;
}
