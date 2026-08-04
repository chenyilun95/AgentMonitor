import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { resolveImageSource } from '../lib/imageSources';
import {
  hasMath as detectMath,
  prepareMarkdownForMath,
  REMARK_PLAIN, REMARK_MATH,
  REHYPE_PLAIN, REHYPE_MATH,
} from '../lib/markdown';
import { resolveWorkspaceMarkdownLink } from '../lib/markdownFileLinks';
import { ChatImage } from './ChatImage';

interface ChatMarkdownProps {
  content: string;
  workspacePath: string;
  configuredRoot?: string;
  onOpenMarkdownFile?: (path: string) => void;
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  workspacePath,
  configuredRoot = workspacePath,
  onOpenMarkdownFile,
}: ChatMarkdownProps) {
  const mathDetected = detectMath(content);
  const processed = mathDetected ? prepareMarkdownForMath(content) : content;
  return (
    <ReactMarkdown
      remarkPlugins={mathDetected ? REMARK_MATH : REMARK_PLAIN}
      rehypePlugins={mathDetected ? REHYPE_MATH : REHYPE_PLAIN}
      components={{
        a: ({ href, children, title }) => {
          const markdownPath = resolveWorkspaceMarkdownLink(href, workspacePath, configuredRoot);
          if (!markdownPath || !onOpenMarkdownFile) {
            return <a href={href} title={title}>{children}</a>;
          }
          return (
            <a
              className="chat-file-link"
              href={href}
              title={title}
              onClick={(event) => {
                event.preventDefault();
                onOpenMarkdownFile(markdownPath);
              }}
            >
              {children}
            </a>
          );
        },
        code: ({ className, children }) => {
          const value = String(children).trim();
          const markdownPath = !className && !value.includes('\n')
            ? resolveWorkspaceMarkdownLink(value, workspacePath, configuredRoot)
            : null;
          if (!markdownPath || !onOpenMarkdownFile) {
            return <code className={className}>{children}</code>;
          }
          return (
            <code
              className="chat-file-link"
              role="link"
              tabIndex={0}
              title="Open in Files"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenMarkdownFile(markdownPath);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onOpenMarkdownFile(markdownPath);
              }}
            >
              {children}
            </code>
          );
        },
        img: ({ src, alt, title }) => {
          const resolved = resolveImageSource(workspacePath, src);
          return resolved ? <ChatImage src={resolved} alt={alt || ''} title={title} /> : null;
        },
      }}
    >
      {processed}
    </ReactMarkdown>
  );
});
