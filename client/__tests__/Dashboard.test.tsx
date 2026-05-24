import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Dashboard } from '../src/pages/Dashboard';
import { api, type Agent } from '../src/api/client';
import { LanguageProvider } from '../src/i18n';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getAgents: vi.fn(),
      getSettings: vi.fn(),
      renameAgent: vi.fn(),
    },
  };
});

vi.mock('../src/api/socket', () => ({
  getSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

function makeAgent(id: string, name: string, lastActivity: number, status: Agent['status'] = 'running'): Agent {
  return {
    id,
    name,
    status,
    config: {
      provider: 'claude',
      directory: '/tmp/project',
      prompt: 'Do work',
      flags: {},
    },
    messages: [],
    lastActivity,
    createdAt: lastActivity - 1000,
  };
}

describe('Dashboard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('sorts agents by most recent activity by default', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([
      makeAgent('older', 'Older agent', 1000),
      makeAgent('recent', 'Recent agent', 3000),
      makeAgent('middle', 'Middle agent', 2000),
    ]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Recent agent/)).toBeInTheDocument();
    });

    const cards = Array.from(document.querySelectorAll('.card'));
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Recent agent'),
      expect.stringContaining('Middle agent'),
      expect.stringContaining('Older agent'),
    ]);
  });

  it('highlights agents waiting for input', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([
      makeAgent('running', 'Running agent', 1000),
      makeAgent('waiting', 'Blocked agent', 2000, 'waiting_input'),
    ]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Needs input (1)')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Blocked agent' })).toBeInTheDocument();
    expect(screen.getByText('Needs input', { selector: '.status' })).toBeInTheDocument();
  });

  it('renames an agent from the dashboard title', async () => {
    vi.stubGlobal('prompt', vi.fn(() => 'Renamed agent'));
    vi.mocked(api.getAgents).mockResolvedValue([
      makeAgent('agent-1', 'Original agent', 1000),
    ]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.renameAgent).mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Original agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Rename the current conversation: Original agent/ }));

    await waitFor(() => {
      expect(api.renameAgent).toHaveBeenCalledWith('agent-1', 'Renamed agent');
    });
    expect(screen.getByText('Renamed agent')).toBeInTheDocument();
  });
});
