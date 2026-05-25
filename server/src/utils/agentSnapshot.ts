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
  const context = agent.contextWindow;
  if (!context) return agent;

  const total = Number(context.total);
  const used = Number(context.used);
  if (!Number.isFinite(total) || total <= 0) {
    const { contextWindow: _drop, ...rest } = agent;
    return rest;
  }

  const normalizedUsed = Math.min(total, Math.max(0, Number.isFinite(used) ? used : 0));
  if (normalizedUsed === used && total === context.total) {
    return agent;
  }

  return {
    ...agent,
    contextWindow: {
      used: Math.round(normalizedUsed),
      total: Math.round(total),
    },
  };
}

export function sanitizeAgentListSnapshot(agent: Agent): Agent {
  const safeAgent = sanitizeAgentSnapshot(agent);
  const lastMessage = safeAgent.messages.at(-1);

  return {
    ...safeAgent,
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
