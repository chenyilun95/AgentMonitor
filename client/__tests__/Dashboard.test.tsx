import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      getSavedDirectories: vi.fn(),
      renameAgent: vi.fn(),
      saveDirectory: vi.fn(),
      deleteSavedDirectory: vi.fn(),
      getDirectoryGitInfo: vi.fn(),
      pullDirectory: vi.fn(),
      pushDirectory: vi.fn(),
      sendMessage: vi.fn(),
      deleteAgent: vi.fn(),
      updateSettings: vi.fn(),
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
      expect(screen.getByText(/Needs input \(1\)|等待输入 \(1\)/)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Blocked agent' })).toBeInTheDocument();
    expect(screen.getByText(/Needs input|等待输入/, { selector: '.status' })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /Rename the current conversation: Original agent|重命名当前对话: Original agent/ }));

    await waitFor(() => {
      expect(api.renameAgent).toHaveBeenCalledWith('agent-1', 'Renamed agent');
    });
    expect(screen.getByText('Renamed agent')).toBeInTheDocument();
  });

  it('keeps saved directory groups visible without agents', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: { workstation: ['/tmp/saved-project'] },
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: ['/tmp/saved-project'] });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('/tmp/saved-project')).toBeInTheDocument();
    expect(screen.getByText(/0 agents|0 个代理/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove path: \/tmp\/saved-project|删除路径: \/tmp\/saved-project/ }))
      .toBeInTheDocument();
  });

  it('hides the saved-directory remove action while the group has agents', async () => {
    localStorage.setItem('agentmonitor-group-by', 'project');
    const agent = {
      ...makeAgent('agent-1', 'Project agent', 1000, 'stopped'),
      config: {
        ...makeAgent('agent-1', 'Project agent', 1000, 'stopped').config,
        directory: '/tmp/saved-project',
      },
    };
    vi.mocked(api.getAgents).mockResolvedValue([agent]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: ['/tmp/saved-project'] });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Project agent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove path: \/tmp\/saved-project|删除路径: \/tmp\/saved-project/ }))
      .not.toBeInTheDocument();
  });

  it('only offers Direct mode for a non-Git directory', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: ['/tmp/plain-directory'] });
    vi.mocked(api.getDirectoryGitInfo).mockResolvedValue({ isGit: false });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.getDirectoryGitInfo).toHaveBeenCalledWith('/tmp/plain-directory');
    });
    const directoryGroup = screen.getByText('/tmp/plain-directory').closest('.directory-group');
    expect(directoryGroup).not.toBeNull();
    expect(within(directoryGroup as HTMLElement).getByRole('button', { name: /New Agent|新建代理/ }))
      .toBeInTheDocument();
    expect(within(directoryGroup as HTMLElement).queryByRole('button', { name: /New Worktree Agent|新建Worktree代理/ }))
      .not.toBeInTheDocument();
  });

  it('offers Worktree mode after confirming a Git directory', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: ['/tmp/repository'] });
    vi.mocked(api.getDirectoryGitInfo).mockResolvedValue({
      isGit: true,
      root: '/tmp/repository',
      repositoryRoot: '/tmp/repository',
      branch: 'main',
    });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: /New Worktree Agent|新建Worktree代理/ }))
      .toBeInTheDocument();
  });

  it('adds and removes a saved directory from the dashboard', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: [] });
    vi.mocked(api.saveDirectory).mockResolvedValue({ path: '/tmp/new-project' });
    vi.mocked(api.deleteSavedDirectory).mockResolvedValue({ ok: true });
    vi.mocked(api.getDirectoryGitInfo).mockResolvedValue({ isGit: false });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.getSavedDirectories).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /New Path|Add Project Directory|新建路径|新建项目目录/ }));
    fireEvent.change(screen.getByPlaceholderText('/path/to/project'), { target: { value: '/tmp/new-project' } });
    fireEvent.click(screen.getByRole('button', { name: /Select|选择/ }));
    expect(await screen.findByText('/tmp/new-project')).toBeInTheDocument();
    expect(api.saveDirectory).toHaveBeenCalledWith('/tmp/new-project');

    fireEvent.click(screen.getByRole('button', { name: /Remove path: \/tmp\/new-project|删除路径: \/tmp\/new-project/ }));
    await waitFor(() => expect(screen.queryByText('/tmp/new-project')).not.toBeInTheDocument());
    expect(api.deleteSavedDirectory).toHaveBeenCalledWith('/tmp/new-project');
  });

  it('shows directory Git errors inline instead of opening an alert', async () => {
    vi.mocked(api.getAgents).mockResolvedValue([]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: ['/tmp/repo'] });
    vi.mocked(api.getDirectoryGitInfo).mockResolvedValue({ isGit: true, branch: 'main', upstream: 'origin/main' });
    vi.mocked(api.pushDirectory).mockRejectedValue(new Error('push rejected: fetch first'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Push$|^推送$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('push rejected: fetch first');
    expect(alert).not.toHaveBeenCalled();
  });

  it('groups different subdirectories of the same repository as one project', async () => {
    localStorage.setItem('agentmonitor-group-by', 'directory');
    const frontend = { ...makeAgent('front', 'Frontend', 2), config: { ...makeAgent('front', 'Frontend', 2).config, directory: '/repo/frontend' }, repositoryRoot: '/repo', projectKey: 'git:/repo' };
    const backend = { ...makeAgent('back', 'Backend', 1), config: { ...makeAgent('back', 'Backend', 1).config, directory: '/repo/backend' }, repositoryRoot: '/repo', projectKey: 'git:/repo' };
    vi.mocked(api.getAgents).mockResolvedValue([frontend, backend]);
    vi.mocked(api.getSettings).mockResolvedValue({ agentRetentionMs: 86_400_000, promptSuggestions: [], pathHistory: {}, deleteSessionFilesPolicy: 'keep' });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: [] });
    vi.mocked(api.getDirectoryGitInfo).mockResolvedValue({ isGit: true, root: '/repo' });

    render(<MemoryRouter><LanguageProvider><Dashboard /></LanguageProvider></MemoryRouter>);

    await screen.findByText('Frontend');
    expect(document.querySelectorAll('.directory-group')).toHaveLength(1);
    expect(screen.getByTitle('/repo')).toBeInTheDocument();
  });

  it('sends Worktree update and merge actions to the agent as prompts', async () => {
    const agent = {
      ...makeAgent('agent-1', 'Worktree agent', 1000, 'stopped'),
      workspaceMode: 'worktree' as const,
      worktreePath: '/tmp/project/.agent-worktrees/agent-1',
      worktreeBranch: 'agent-1',
      baseBranch: 'main',
    };
    vi.mocked(api.getAgents).mockResolvedValue([agent]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'keep',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: [] });
    vi.mocked(api.sendMessage).mockResolvedValue({ ok: true, disposition: 'started', agent });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Update from main|从 main 更新/ }));
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith(
      'agent-1',
      expect.stringContaining('Update the current Worktree branch "agent-1"'),
    ));

    fireEvent.click(screen.getByRole('button', { name: /Merge to main|合并到 main/ }));
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith(
      'agent-1',
      expect.stringContaining('Merge the current Worktree branch "agent-1" back into its original branch "main"'),
    ));
  });

  it('requires explicit confirmation before discarding Worktree changes', async () => {
    const agent = {
      ...makeAgent('agent-delete', 'Unsafe worktree', 1000, 'stopped'),
      workspaceMode: 'worktree' as const,
      worktreePath: '/tmp/project/.agent-worktrees/agent-delete',
      worktreeBranch: 'agent-delete',
      baseBranch: 'main',
      hasUnintegratedChanges: true,
    };
    vi.mocked(api.getAgents).mockResolvedValue([agent]);
    vi.mocked(api.getSettings).mockResolvedValue({
      agentRetentionMs: 86_400_000,
      promptSuggestions: [],
      pathHistory: {},
      deleteSessionFilesPolicy: 'purge',
    });
    vi.mocked(api.getSavedDirectories).mockResolvedValue({ paths: [] });
    vi.mocked(api.deleteAgent).mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <Dashboard />
        </LanguageProvider>
      </MemoryRouter>,
    );

    await screen.findByText('Unsafe worktree');
    fireEvent.click(screen.getByRole('button', { name: /^Delete$|^删除$/ }));

    expect(screen.getByText(agent.worktreePath)).toBeInTheDocument();
    expect(screen.getByText(agent.worktreeBranch)).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete$|^删除$/ });
    const confirm = deleteButtons[deleteButtons.length - 1];
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByLabelText(
      /Discard all uncommitted files|放弃所有未提交文件/,
    ));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(api.deleteAgent).toHaveBeenCalledWith(agent.id, {
      purgeSessionFiles: false,
      discardWorkspaceChanges: true,
    }));
  });
});
