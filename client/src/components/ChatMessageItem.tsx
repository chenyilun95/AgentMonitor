import { memo } from 'react';
import type { Agent } from '../api/client';
import { getToolMessageDetails } from '../lib/toolMessages';
import { resolveImageSource } from '../lib/imageSources';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatImage } from './ChatImage';

type ChatMessage = Agent['messages'][number];
type LocalMessage = { id: string; role: string; content: string; timestamp: number };
export type DisplayMessage = ChatMessage | LocalMessage;

interface ChatMessageItemProps {
  msg: DisplayMessage;
  renderMarkdown: boolean;
  workspacePath: string;
  configuredRoot: string;
  isExpanded: boolean;
  onToggleExpand: (msgId: string) => void;
  onOpenMarkdownFile: (path: string) => void;
}

export const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  renderMarkdown,
  workspacePath,
  configuredRoot,
  isExpanded,
  onToggleExpand,
  onOpenMarkdownFile,
}: ChatMessageItemProps) {
  const toolDetails = getToolMessageDetails(msg as ChatMessage);
  const isToolMsg = !!toolDetails;

  return (
    <div className={`chat-message ${msg.role}`}>
      {isToolMsg ? (
        <>
          <div
            className="tool-header"
            onClick={() => onToggleExpand(msg.id)}
          >
            <span className="tool-toggle">{isExpanded ? '▼' : '▶'}</span>
            <span className="tool-name">{toolDetails.title}</span>
          </div>
          {isExpanded && (
            <div className="tool-details">
              {toolDetails.input && (
                <div className="tool-section">
                  <div className="tool-section-label">Input</div>
                  <pre className="tool-content">{toolDetails.input}</pre>
                </div>
              )}
              {toolDetails.output && (
                <div className="tool-section">
                  <div className="tool-section-label">Output</div>
                  <pre className="tool-content">{toolDetails.output}</pre>
                </div>
              )}
              {toolDetails.details && (
                <div className="tool-section">
                  <div className="tool-section-label">Details</div>
                  <pre className="tool-content">{toolDetails.details}</pre>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        renderMarkdown && msg.role === 'assistant'
          ? <ChatMarkdown
              content={msg.content}
              workspacePath={workspacePath}
              configuredRoot={configuredRoot}
              onOpenMarkdownFile={onOpenMarkdownFile}
            />
          : msg.content
      )}
      {'attachments' in msg && msg.attachments?.map((attachment, index) => {
        const src = resolveImageSource(workspacePath, attachment.source);
        return src ? <ChatImage
          key={`${attachment.source}-${index}`}
          src={src}
          alt={attachment.name || 'Agent output image'}
          linked
        /> : null;
      })}
    </div>
  );
});
