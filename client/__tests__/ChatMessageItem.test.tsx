import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessageItem } from '../src/components/ChatMessageItem';
import { createMockMessage } from './helpers';

const defaultProps = {
  renderMarkdown: false,
  workspacePath: '/tmp/project',
  configuredRoot: '/tmp/project',
  isExpanded: false,
  onToggleExpand: vi.fn(),
  onOpenMarkdownFile: vi.fn(),
};

describe('ChatMessageItem', () => {
  it('renders user message with correct class', () => {
    const msg = createMockMessage({ role: 'user', content: 'Hello agent' });

    const { container } = render(
      <ChatMessageItem msg={msg} {...defaultProps} />,
    );

    const el = container.querySelector('.chat-message.user');
    expect(el).not.toBeNull();
    expect(screen.getByText('Hello agent')).toBeInTheDocument();
  });

  it('renders assistant message as plain text when renderMarkdown is false', () => {
    const msg = createMockMessage({ role: 'assistant', content: '**bold text**' });

    render(
      <ChatMessageItem msg={msg} {...defaultProps} renderMarkdown={false} />,
    );

    expect(screen.getByText('**bold text**')).toBeInTheDocument();
    expect(screen.queryByText('bold text')).toBeNull();
  });

  it('renders assistant message as markdown when renderMarkdown is true', () => {
    const msg = createMockMessage({ role: 'assistant', content: '**bold text**' });

    const { container } = render(
      <ChatMessageItem msg={msg} {...defaultProps} renderMarkdown={true} />,
    );

    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold text');
  });

  it('renders tool message with tool name', () => {
    const msg = createMockMessage({
      role: 'tool',
      content: '',
      toolName: 'Bash',
      toolInput: 'ls -la',
      toolResult: 'total 0',
    });

    render(
      <ChatMessageItem msg={msg} {...defaultProps} />,
    );

    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('hides tool details when collapsed', () => {
    const msg = createMockMessage({
      role: 'tool',
      content: '',
      toolName: 'Bash',
      toolInput: 'ls -la',
      toolResult: 'total 0',
    });

    render(
      <ChatMessageItem msg={msg} {...defaultProps} isExpanded={false} />,
    );

    expect(screen.queryByText('ls -la')).toBeNull();
    expect(screen.queryByText('total 0')).toBeNull();
  });

  it('shows tool details when expanded', () => {
    const msg = createMockMessage({
      role: 'tool',
      content: '',
      toolName: 'Bash',
      toolInput: 'ls -la',
      toolResult: 'total 0',
    });

    render(
      <ChatMessageItem msg={msg} {...defaultProps} isExpanded={true} />,
    );

    expect(screen.getByText('ls -la')).toBeInTheDocument();
    expect(screen.getByText('total 0')).toBeInTheDocument();
  });

  it('calls onToggleExpand with message id when tool header is clicked', () => {
    const onToggle = vi.fn();
    const msg = createMockMessage({
      id: 'tool-msg-1',
      role: 'tool',
      content: '',
      toolName: 'Read',
      toolInput: '/tmp/file.txt',
    });

    render(
      <ChatMessageItem msg={msg} {...defaultProps} onToggleExpand={onToggle} />,
    );

    screen.getByText('Read').closest('.tool-header')!.click();
    expect(onToggle).toHaveBeenCalledWith('tool-msg-1');
  });
});
