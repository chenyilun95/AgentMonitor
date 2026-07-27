import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { AgentChat } from '../src/pages/AgentChat';
import { createMockAgent, createMockMessage, createMockSocket } from './helpers';

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef(function MockVirtuoso(props: any, ref: any) {
      const { data, itemContent, components } = props;
      React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
      return React.createElement('div', { 'data-testid': 'virtuoso', className: props.className, style: props.style },
        components?.Header ? React.createElement(components.Header) : null,
        data?.map((item: any, index: number) =>
          React.createElement('div', { key: item.id ?? index }, itemContent(index, item)),
        ),
        components?.Footer ? React.createElement(components.Footer) : null,
      );
    }),
  };
});

const mockSocket = createMockSocket();

vi.mock('../src/api/socket', () => ({
  getSocket: () => mockSocket,
  joinAgent: vi.fn(),
  leaveAgent: vi.fn(),
  sendMessage: vi.fn(),
  interruptAgent: vi.fn(),
}));

vi.mock('../src/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client')>();
  return {
    ...original,
    api: {
      getAgent: vi.fn(),
      getAgents: vi.fn().mockResolvedValue([]),
      getRuntimeCapabilities: vi.fn().mockResolvedValue({}),
      interruptAgent: vi.fn(),
      sendMessage: vi.fn(),
      restoreConversation: vi.fn(),
      setReasoningEffort: vi.fn(),
    },
  };
});

function renderAgentChat(agentId = 'test-1') {
  return render(
    <MemoryRouter initialEntries={[`/agent/${agentId}`]}>
      <LanguageProvider>
        <Routes>
          <Route path="/agent/:id" element={<AgentChat />} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

let apiMock: typeof import('../src/api/client')['api'];

beforeEach(async () => {
  const mod = await import('../src/api/client');
  apiMock = mod.api;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AgentChat', () => {
  describe('hooks ordering (React error #310 regression)', () => {
    it('renders loading state without crashing when agent is null', async () => {
      vi.mocked(apiMock.getAgent).mockReturnValue(new Promise(() => {}));

      expect(() => renderAgentChat()).not.toThrow();
    });

    it('transitions from loading to rendered without hooks error', async () => {
      const agent = createMockAgent({ id: 'test-1', name: 'My Agent' });

      vi.mocked(apiMock.getAgent).mockResolvedValue(agent);

      renderAgentChat();

      await waitFor(() => {
        expect(screen.getByText('My Agent')).toBeInTheDocument();
      });
    });
  });

  describe('normal rendering', () => {
    it('displays agent name and messages', async () => {
      const agent = createMockAgent({
        id: 'test-1',
        name: 'Chat Bot',
        messages: [
          createMockMessage({ role: 'user', content: 'What is 2+2?' }),
          createMockMessage({ role: 'assistant', content: 'The answer is 4.' }),
        ],
      });

      vi.mocked(apiMock.getAgent).mockResolvedValue(agent);

      renderAgentChat();

      await waitFor(() => {
        expect(screen.getByText('Chat Bot')).toBeInTheDocument();
      });

      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
      expect(screen.getByText('The answer is 4.')).toBeInTheDocument();
    });

    it('renders tool messages with tool name', async () => {
      const agent = createMockAgent({
        id: 'test-1',
        messages: [
          createMockMessage({ role: 'user', content: 'Read the file' }),
          createMockMessage({
            role: 'tool',
            content: '',
            toolName: 'Read',
            toolInput: JSON.stringify({ path: '/tmp/foo.txt' }),
            toolResult: 'file contents here',
          }),
        ],
      });

      vi.mocked(apiMock.getAgent).mockResolvedValue(agent);

      renderAgentChat();

      await waitFor(() => {
        expect(screen.getByText('Read')).toBeInTheDocument();
      });
    });

    it('shows thinking indicator when agent is running', async () => {
      const agent = createMockAgent({
        id: 'test-1',
        status: 'running',
        messages: [createMockMessage({ role: 'user', content: 'Do something' })],
      });

      vi.mocked(apiMock.getAgent).mockResolvedValue(agent);

      renderAgentChat();

      await waitFor(() => {
        const thinking = document.querySelector('.thinking-dots');
        expect(thinking).not.toBeNull();
      });
    });
  });

  describe('error handling', () => {
    it('shows retry button when loading fails', async () => {
      vi.mocked(apiMock.getAgent).mockRejectedValue(new Error('Network error'));

      renderAgentChat();

      await waitFor(() => {
        const retryButton = screen.getByRole('button');
        expect(retryButton).toBeInTheDocument();
      });
    });
  });
});
