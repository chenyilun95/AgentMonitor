import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentChat } from '../src/pages/AgentChat';
import { api, type Agent } from '../src/api/client';
import { LanguageProvider } from '../src/i18n';

const navigate = vi.fn();
const socket = {
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

const mockScrollToIndex = vi.fn();

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef(function MockVirtuoso(props: any, ref: any) {
      const { data, itemContent, components } = props;
      React.useImperativeHandle(ref, () => ({ scrollToIndex: mockScrollToIndex }));
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getAgent: vi.fn(),
      getAgents: vi.fn(),
      getRuntimeCapabilities: vi.fn(),
    },
  };
});

vi.mock('../src/api/socket', () => ({
  getSocket: () => socket,
  joinAgent: vi.fn(),
  leaveAgent: vi.fn(),
}));

describe('AgentChat connection handling', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stays on the conversation route when loading fails', async () => {
    vi.mocked(api.getAgent).mockRejectedValue(new Error('network unavailable'));
    vi.mocked(api.getRuntimeCapabilities).mockRejectedValue(new Error('network unavailable'));

    render(
      <MemoryRouter initialEntries={['/agent/agent-1']}>
        <LanguageProvider>
          <Routes>
            <Route path="/agent/:id" element={<AgentChat />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Unable to load this conversation|暂时无法加载此对话/,
      );
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the loaded conversation visible when a reconnect refresh fails', async () => {
    const existingAgent = {
      id: 'agent-1',
      name: 'Persistent conversation',
      status: 'running',
      config: {
        provider: 'claude',
        directory: '/tmp/project',
        prompt: 'Keep working',
        flags: {},
      },
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Existing response',
        timestamp: 1,
      }],
      lastActivity: 1,
      createdAt: 1,
    } as Agent;
    vi.mocked(api.getAgent)
      .mockResolvedValueOnce(existingAgent)
      .mockRejectedValueOnce(new Error('server restarting'));
    vi.mocked(api.getRuntimeCapabilities).mockRejectedValue(new Error('not needed'));

    render(
      <MemoryRouter initialEntries={['/agent/agent-1']}>
        <LanguageProvider>
          <Routes>
            <Route path="/agent/:id" element={<AgentChat />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Persistent conversation')).toBeInTheDocument();
    const reconnectHandler = socket.on.mock.calls.find(([event]) => event === 'connect')?.[1];
    expect(reconnectHandler).toBeTypeOf('function');
    reconnectHandler();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /Connection interrupted|连接已中断/,
      );
    });
    expect(screen.getByText('Existing response')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('warns when another active Direct Edit agent shares the project', async () => {
    const currentAgent = {
      id: 'agent-1',
      name: 'Current Direct',
      status: 'running',
      workspaceMode: 'direct',
      repositoryRoot: '/tmp/project',
      projectKey: 'git:/tmp/project',
      config: {
        provider: 'codex',
        directory: '/tmp/project',
        prompt: 'Current task',
        flags: {},
      },
      messages: [],
      lastActivity: 2,
      createdAt: 1,
    } as Agent;
    const peerAgent = {
      ...currentAgent,
      id: 'agent-2',
      name: 'Peer Direct',
      status: 'waiting_input',
      config: {
        ...currentAgent.config,
        directory: '/tmp/project/packages/app',
      },
    } as Agent;
    vi.mocked(api.getAgent).mockResolvedValue(currentAgent);
    vi.mocked(api.getAgents).mockResolvedValue([currentAgent, peerAgent]);
    vi.mocked(api.getRuntimeCapabilities).mockRejectedValue(new Error('not needed'));

    render(
      <MemoryRouter initialEntries={['/agent/agent-1']}>
        <LanguageProvider>
          <Routes>
            <Route path="/agent/:id" element={<AgentChat />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Peer Direct');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /same files and branch|共享相同的文件和分支/,
    );
  });

  it('jumps to latest message via Virtuoso scrollToIndex', async () => {
    const agent = {
      id: 'agent-1',
      name: 'Long conversation',
      status: 'stopped',
      config: {
        provider: 'codex',
        directory: '/tmp/project',
        prompt: 'Review history',
        flags: {},
      },
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Latest response',
        timestamp: 1,
      }],
      messagePage: {
        hasMore: false,
        total: 1,
      },
      lastActivity: 1,
      createdAt: 1,
    } as Agent;
    vi.mocked(api.getAgent).mockResolvedValue(agent);
    vi.mocked(api.getRuntimeCapabilities).mockRejectedValue(new Error('not needed'));

    render(
      <MemoryRouter initialEntries={['/agent/agent-1']}>
        <LanguageProvider>
          <Routes>
            <Route path="/agent/:id" element={<AgentChat />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Latest response')).toBeInTheDocument();

    const fab = document.querySelector('.chat-scroll-fab-bottom');
    if (fab) {
      fireEvent.click(fab);
      expect(mockScrollToIndex).toHaveBeenCalledWith({ index: 'LAST', behavior: 'smooth' });
    }
  });
});
