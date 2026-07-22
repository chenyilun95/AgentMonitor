import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatMarkdown } from '../src/components/ChatMarkdown';

describe('ChatMarkdown', () => {
  it('renders inline and display math with KaTeX', () => {
    const { container } = render(
      <ChatMarkdown
        content={'Inline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$'}
        workspacePath="/tmp/project"
      />,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
  });

  it('continues to render GitHub-flavored Markdown', () => {
    const { getByRole } = render(
      <ChatMarkdown content={'| A | B |\n| - | - |\n| 1 | 2 |'} workspacePath="/tmp/project" />,
    );

    expect(getByRole('table')).toBeInTheDocument();
  });

  it('opens Markdown links in the workspace file browser', () => {
    const onOpenMarkdownFile = vi.fn();
    const { getByRole } = render(
      <ChatMarkdown
        content="[README](/repo/README.md)"
        workspacePath="/tmp/worktree"
        configuredRoot="/repo"
        onOpenMarkdownFile={onOpenMarkdownFile}
      />,
    );

    fireEvent.click(getByRole('link', { name: 'README' }));
    expect(onOpenMarkdownFile).toHaveBeenCalledWith('/tmp/worktree/README.md');
  });

  it('opens inline Markdown file references from the keyboard', () => {
    const onOpenMarkdownFile = vi.fn();
    const { getByRole } = render(
      <ChatMarkdown
        content="`docs/guide.md`"
        workspacePath="/tmp/worktree"
        onOpenMarkdownFile={onOpenMarkdownFile}
      />,
    );

    fireEvent.keyDown(getByRole('link'), { key: 'Enter' });
    expect(onOpenMarkdownFile).toHaveBeenCalledWith('/tmp/worktree/docs/guide.md');
  });
});
