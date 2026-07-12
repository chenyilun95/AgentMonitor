import type { Agent } from '../models/Agent.js';

const DASHBOARD_MESSAGE_PREVIEW_LIMIT = 500;

function truncateText(text: string): string {
  return text.length > DASHBOARD_MESSAGE_PREVIEW_LIMIT
    ? `${text.slice(0, DASHBOARD_MESSAGE_PREVIEW_LIMIT)}...`
    : text;
}

/**
 * Normalize persisted context window values for UI/transport safety.
 * Older data may contain cumulative tokens in `used`, which can exceed `total`.
 */
export function sanitizeAgentSnapshot(agent: Agent): Agent {
  // Logs have a dedicated paginated endpoint and are not used by the client
  // agent view. Excluding them avoids sending hundreds of KB on page entry and
  // every socket snapshot.
  const { preRestoreSnapshot, logs: _logs, ...rest } = agent;
  let result = rest as Agent;

  if (preRestoreSnapshot) {
    (result as any).preRestoreUserTurns = preRestoreSnapshot.messages
      .filter(m => m.role === 'user')
      .map(m => ({ id: m.id, content: m.content, timestamp: m.timestamp }));
  }

  const context = result.contextWindow;
  if (!context) return result;

  const total = Number(context.total);
  const used = Number(context.used);
  if (!Number.isFinite(total) || total <= 0) {
    const { contextWindow: _drop, ...r } = result;
    return r;
  }

  const normalizedUsed = Math.min(total, Math.max(0, Number.isFinite(used) ? used : 0));
  if (normalizedUsed === used && total === context.total) {
    return result;
  }

  return {
    ...result,
    contextWindow: {
      used: Math.round(normalizedUsed),
      total: Math.round(total),
    },
  };
}

export function sanitizeAgentListSnapshot(agent: Agent): Agent {
  const safeAgent = sanitizeAgentSnapshot(agent);
  const lastMessage = safeAgent.messages.at(-1);
  const { logs: _logs, ...summary } = safeAgent;

  return {
    ...summary,
    messages: lastMessage
      ? [{
        id: lastMessage.id,
        role: lastMessage.role,
        content: truncateText(lastMessage.content || ''),
        timestamp: lastMessage.timestamp,
        toolName: lastMessage.toolName,
      }]
      : [],
    structuredOutput: undefined,
    restoredConversationSeed: undefined,
    codeSnapshots: undefined,
  };
}
