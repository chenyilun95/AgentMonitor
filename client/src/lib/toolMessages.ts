import type { AgentClientView } from '@agent-monitor/shared';

type ChatMessage = AgentClientView['messages'][number];

export type ToolMessageDetails = {
  title: string;
  input?: string;
  output?: string;
  details?: string;
};

function normalizeToolField(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getToolMessageDetails(msg: ChatMessage): ToolMessageDetails | null {
  if (msg.role !== 'tool') return null;

  const toolInput = normalizeToolField(msg.toolInput);
  const toolResult = normalizeToolField(msg.toolResult);
  const content = normalizeToolField(msg.content);
  const lines = content?.split('\n') || [];
  const firstLine = lines[0];
  const remaining = lines.slice(1).join('\n').trim();
  const genericToolNames = new Set(['tool', 'command', 'command_execution', 'tool_call', 'function_call']);
  const normalizedToolName = normalizeToolField(msg.toolName);

  let title = (normalizedToolName && !genericToolNames.has(normalizedToolName))
    ? normalizedToolName
    : (firstLine || normalizedToolName || 'Tool');
  let details: string | undefined;

  if (toolInput || toolResult) {
    if (content) {
      const normalizedTitle = title.trim();
      const normalizedContent = content.trim();
      if (normalizedContent !== normalizedTitle && normalizedContent !== `Using tool: ${normalizedTitle}`) {
        details = normalizedContent;
      }
    }
  } else if (content) {
    if (firstLine?.startsWith('Command:')) {
      title = firstLine;
      details = remaining || content;
    } else if (firstLine?.startsWith('Tool:') || firstLine?.startsWith('Using tool:')) {
      title = firstLine;
      details = remaining || content;
    } else {
      title = firstLine || title;
      details = remaining || content;
    }
  }

  return {
    title,
    input: toolInput,
    output: toolResult,
    details,
  };
}
