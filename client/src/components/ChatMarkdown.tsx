import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { resolveImageSource } from '../lib/imageSources';

interface ChatMarkdownProps {
  content: string;
  workspacePath: string;
}

export function ChatMarkdown({ content, workspacePath }: ChatMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        img: ({ src, alt, title }) => (
          <img
            className="chat-image"
            src={resolveImageSource(workspacePath, src)}
            alt={alt || ''}
            title={title}
            loading="lazy"
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
