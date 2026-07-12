import type {
  AgentClientView,
  AgentFlags,
  AgentInteractionMode,
  AgentManagerConfig,
  AgentProvider,
  AgentWorkspaceMode,
  BtwResponse,
  CreateAgentRequest,
  CreateTaskRequest,
  DeleteSessionFilesPolicy,
  DirListing,
  FilePreview,
  GpuInfo,
  GpuMonitorConfig,
  GpuServer,
  GpuSnapshot,
  HarnessState,
  HarnessStatus,
  InstructionFileCheckResponse,
  PipelineTask,
  ReasoningEffort,
  RestoreConversationResponse,
  RuntimeCapabilities,
  ServerSettings,
  SessionInfo,
  Skill,
  LocalSkillCandidate,
  StartHarnessRequest,
  StartHarnessResponse,
  Template,
  UploadFileResponse,
} from '@agent-monitor/shared';

export type {
  AgentClientView,
  AgentFlags,
  AgentInteractionMode,
  AgentManagerConfig,
  AgentProvider,
  AgentWorkspaceMode,
  BtwResponse,
  CreateAgentRequest,
  CreateTaskRequest,
  DeleteSessionFilesPolicy,
  DirListing,
  FilePreview,
  GpuInfo,
  GpuMonitorConfig,
  GpuServer,
  GpuSnapshot,
  HarnessState,
  HarnessStatus,
  InstructionFileCheckResponse,
  PipelineTask,
  ReasoningEffort,
  RestoreConversationResponse,
  RuntimeCapabilities,
  ServerSettings,
  SessionInfo,
  Skill,
  LocalSkillCandidate,
  StartHarnessRequest,
  StartHarnessResponse,
  Template,
  UploadFileResponse,
};

export type { AgentClientView as Agent } from '@agent-monitor/shared';

/** @deprecated Use AgentManagerConfig instead */
export type MetaAgentConfig = AgentManagerConfig;

const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts,
  });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.location.href = '/login';
      throw new Error('Authentication required');
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function uploadFile<T>(path: string, file: File, fieldName: string): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Authentication required');
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  uploadFile: (file: File) => uploadFile<UploadFileResponse>('/upload-image', file, 'file'),

  // Agents
  getAgents: (refreshBranches = false) => request<AgentClientView[]>(
    `/agents?summary=1${refreshBranches ? '&refreshBranches=1' : ''}`,
  ),
  getAgent: (id: string) => request<AgentClientView>(`/agents/${id}`),
  createAgent: (data: CreateAgentRequest) =>
    request<AgentClientView>('/agents', { method: 'POST', body: JSON.stringify(data) }),
  stopAgent: (id: string) =>
    request('/agents/' + id + '/stop', { method: 'POST' }),
  stopAllAgents: () =>
    request('/agents/actions/stop-all', { method: 'POST' }),
  deleteAgent: (id: string, opts?: { purgeSessionFiles?: boolean }) =>
    request('/agents/' + id, {
      method: 'DELETE',
      body: opts ? JSON.stringify(opts) : undefined,
    }),
  sendMessage: (id: string, text: string) =>
    request('/agents/' + id + '/message', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  updateInteractionMode: (id: string, mode: AgentInteractionMode) =>
    request<AgentClientView>('/agents/' + id + '/interaction-mode', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }),
  approvePlan: (id: string) =>
    request<AgentClientView>('/agents/' + id + '/plan/approve', { method: 'POST' }),
  revisePlan: (id: string) =>
    request<AgentClientView>('/agents/' + id + '/plan/revise', { method: 'POST' }),
  answerQuestion: (id: string, answers: Record<string, string>) =>
    request<AgentClientView>('/agents/' + id + '/answer-question', {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
  btw: (id: string, question: string) =>
    request<BtwResponse>('/agents/' + id + '/btw', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
  interruptAgent: (id: string) =>
    request('/agents/' + id + '/interrupt', { method: 'POST' }),
  newConversation: (id: string) =>
    request<AgentClientView>('/agents/' + id + '/new-conversation', { method: 'POST' }),
  renameAgent: (id: string, name: string) =>
    request('/agents/' + id + '/rename', {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  updateClaudeMd: (id: string, content: string) =>
    request('/agents/' + id + '/claude-md', {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  updateReasoningEffort: (id: string, reasoningEffort?: ReasoningEffort) =>
    request<AgentClientView>('/agents/' + id + '/reasoning-effort', {
      method: 'PUT',
      body: JSON.stringify({ reasoningEffort }),
    }),
  restoreConversation: (id: string, turnIndex: number, restoreCode: boolean, restoreConv = true) =>
    request<RestoreConversationResponse>('/agents/' + id + '/restore', {
      method: 'POST',
      body: JSON.stringify({ turnIndex, restoreCode, restoreConv }),
    }),

  // Templates
  getTemplates: () => request<Template[]>('/templates'),
  getTemplate: (id: string) => request<Template>(`/templates/${id}`),
  createTemplate: (data: { name: string; content: string }) =>
    request<Template>('/templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: { name?: string; content?: string }) =>
    request<Template>(`/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteTemplate: (id: string) =>
    request(`/templates/${id}`, { method: 'DELETE' }),

  // Skills
  getSkills: () => request<Skill[]>('/skills'),
  discoverLocalSkills: () => request<LocalSkillCandidate[]>('/skills/local/discover'),
  importLocalSkill: (id: string) => request<{ imported: boolean; skill: Skill }>(
    '/skills/local/import',
    { method: 'POST', body: JSON.stringify({ id }) },
  ),
  getSkill: (name: string) => request<Skill>(`/skills/${encodeURIComponent(name)}`),
  createSkill: (data: { name: string; description: string; body: string }) =>
    request<Skill>('/skills', { method: 'POST', body: JSON.stringify(data) }),
  updateSkill: (name: string, data: { description?: string; body?: string }) =>
    request<Skill>(`/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSkill: (name: string) =>
    request(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  uploadSkillScript: (name: string, file: File) => {
    const formData = new FormData();
    formData.append('script', file);
    return fetch(`${BASE}/skills/${encodeURIComponent(name)}/scripts`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; filename: string }>;
    });
  },
  deleteSkillScript: (name: string, filename: string) =>
    request(`/skills/${encodeURIComponent(name)}/scripts/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  // Sessions
  getSessions: (provider?: AgentProvider) =>
    request<SessionInfo[]>(`/sessions${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),

  // Directories
  listDirectory: (path?: string) =>
    request<DirListing>(`/directories${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  readFile: (path: string) =>
    request<FilePreview>(`/directories/file?path=${encodeURIComponent(path)}`),
  checkClaudeMd: (path: string) =>
    request<InstructionFileCheckResponse>(
      `/directories/claude-md?path=${encodeURIComponent(path)}`,
    ),
  checkInstructionFile: (path: string, provider: AgentProvider) =>
    request<InstructionFileCheckResponse>(
      `/directories/claude-md?path=${encodeURIComponent(path)}&provider=${encodeURIComponent(provider)}`,
    ),
  validateDirectory: (path: string) =>
    request<{ exists: boolean; path?: string }>(`/directories/validate?path=${encodeURIComponent(path)}`),

  // Pipeline Tasks
  getTasks: () => request<PipelineTask[]>('/tasks'),
  getTask: (id: string) => request<PipelineTask>(`/tasks/${id}`),
  createTask: (data: CreateTaskRequest) =>
    request<PipelineTask>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, data: Partial<PipelineTask>) =>
    request<PipelineTask>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask: (id: string) => request(`/tasks/${id}`, { method: 'DELETE' }),
  resetTask: (id: string) => request<PipelineTask>(`/tasks/${id}/reset`, { method: 'POST' }),
  clearCompletedTasks: () => request('/tasks/actions/clear-completed', { method: 'POST' }),

  // Agent Manager
  getMetaConfig: () => request<AgentManagerConfig>('/tasks/meta/config'),
  updateMetaConfig: (data: Partial<AgentManagerConfig>) =>
    request<AgentManagerConfig>('/tasks/meta/config', { method: 'PUT', body: JSON.stringify(data) }),
  startMetaAgent: () => request('/tasks/meta/start', { method: 'POST' }),
  stopMetaAgent: () => request('/tasks/meta/stop', { method: 'POST' }),
  getMetaStatus: () => request<{ running: boolean }>('/tasks/meta/status'),

  // Harness mode
  startHarness: (data: StartHarnessRequest) =>
    request<StartHarnessResponse>('/tasks/harness/start', { method: 'POST', body: JSON.stringify(data) }),
  stopHarness: () => request('/tasks/harness/stop', { method: 'POST' }),
  getHarnessStatus: () => request<HarnessState>('/tasks/harness/status'),

  // Server Settings
  getSettings: () => request<ServerSettings>('/settings'),
  getRuntimeCapabilities: () => request<RuntimeCapabilities>('/settings/runtime-capabilities'),
  updateSettings: (data: Partial<ServerSettings>) =>
    request<ServerSettings>('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // GPU Monitor
  getGpuServers: () => request<{ servers: GpuServer[]; snapshots: GpuSnapshot[]; enabled: boolean }>('/gpu/servers'),
  getGpuServer: (name: string) => request<GpuSnapshot>(`/gpu/servers/${encodeURIComponent(name)}`),
  execGpuCommand: (name: string, command: string) =>
    request<{ stdout: string; exitCode: number }>(`/gpu/servers/${encodeURIComponent(name)}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),
  getGpuConfig: () => request<GpuMonitorConfig>('/gpu/config'),
  updateGpuConfig: (data: Partial<GpuMonitorConfig>) =>
    request<GpuMonitorConfig>('/gpu/config', { method: 'PUT', body: JSON.stringify(data) }),
};
