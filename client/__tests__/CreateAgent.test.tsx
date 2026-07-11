import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateAgent } from '../src/pages/CreateAgent';
import { api } from '../src/api/client';
import { LanguageProvider } from '../src/i18n';

const navigate = vi.fn();

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
      getTemplates: vi.fn(),
      getSettings: vi.fn(),
      getRuntimeCapabilities: vi.fn(),
      getSessions: vi.fn(),
      createAgent: vi.fn(),
    },
  };
});

function renderCreateAgent() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <CreateAgent />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('CreateAgent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults permission automation flags on', async () => {
    vi.mocked(api.getTemplates).mockResolvedValue([]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getRuntimeCapabilities).mockResolvedValue({
      checkedAt: Date.now(),
      providers: {
        claude: {
          available: true,
          reasoningEfforts: [],
          models: [],
          detectedFrom: 'fallback',
        },
        codex: {
          available: true,
          reasoningEfforts: [],
          models: [],
          detectedFrom: 'fallback',
        },
      },
    });
    vi.mocked(api.getSessions).mockResolvedValue([]);

    renderCreateAgent();

    expect(screen.getByLabelText('--dangerously-skip-permissions')).toBeChecked();

    fireEvent.click(screen.getByText('Codex'));

    await waitFor(() => {
      expect(screen.getByLabelText('--dangerously-bypass-approvals-and-sandbox')).toBeChecked();
    });
    expect(screen.getByLabelText('approval_policy="never"')).toBeChecked();
    expect(screen.getByLabelText('--sandbox danger-full-access')).toBeChecked();
  });

  it('allows creating an agent with an empty prompt', async () => {
    vi.mocked(api.getTemplates).mockResolvedValue([]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getRuntimeCapabilities).mockResolvedValue({
      checkedAt: Date.now(),
      providers: {
        claude: {
          available: true,
          reasoningEfforts: [],
          models: [],
          detectedFrom: 'fallback',
        },
        codex: {
          available: true,
          reasoningEfforts: [],
          models: [],
          detectedFrom: 'fallback',
        },
      },
    });
    vi.mocked(api.getSessions).mockResolvedValue([]);
    vi.mocked(api.createAgent).mockResolvedValue({ id: 'agent-1' } as never);

    renderCreateAgent();

    fireEvent.change(screen.getByPlaceholderText('my-agent'), {
      target: { value: 'No prompt agent' },
    });
    fireEvent.change(screen.getByPlaceholderText('/path/to/project'), {
      target: { value: '/tmp/project' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Agent|创建代理/ }));

    await waitFor(() => {
      expect(api.createAgent).toHaveBeenCalledWith(expect.objectContaining({
        name: 'No prompt agent',
        directory: '/tmp/project',
        prompt: '',
        flags: expect.objectContaining({
          dangerouslySkipPermissions: true,
          fullAuto: true,
          sandboxDangerFullAccess: true,
        }),
      }));
    });
    expect(navigate).toHaveBeenCalledWith('/agent/agent-1');
  });
});
