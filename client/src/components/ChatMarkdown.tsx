import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { resolveImageSource } from '../lib/imageSources';
import { resolveWorkspaceMarkdownLink } from '../lib/markdownFileLinks';
import { ChatImage } from './ChatImage';

interface ChatMarkdownProps {
  content: string;
  workspacePath: string;
  configuredRoot?: string;
  onOpenMarkdownFile?: (path: string) => void;
}

export function ChatMarkdown({
  content,
  workspacePath,
  configuredRoot = workspacePath,
  onOpenMarkdownFile,
}: ChatMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
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
      {content}
    </ReactMarkdown>
  );
}
