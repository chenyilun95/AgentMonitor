const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts,
  });
  if (!res.ok) {
    // Redirect to login on 401 (relay auth required)
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.location.href = '/login';
      throw new Error('Authentication required');
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export type AgentProvider = 'claude' | 'codex';
export type AgentInteractionMode = 'default' | 'plan';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type DeleteSessionFilesPolicy = 'ask' | 'keep' | 'purge';

export interface ProviderRuntimeCapabilities {
  available: boolean;
  version?: string;
  reasoningEfforts: ReasoningEffort[];
  models: string[];
  detectedFrom: 'help' | 'version-threshold' | 'fallback' | 'unavailable';
}

export interface RuntimeCapabilities {
  checkedAt: number;
  providers: Record<AgentProvider, ProviderRuntimeCapabilities>;
}

export interface AgentFlags {
  dangerouslySkipPermissions?: boolean;
  resume?: string;
  model?: string;
  fullAuto?: boolean;
  chrome?: boolean;
  permissionMode?: string;
  maxBudgetUsd?: number;
  allowedTools?: string;
  disallowedTools?: string;
  addDirs?: string;
  mcpConfig?: string;
  reasoningEffort?: ReasoningEffort;
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error' | 'waiting_input';
  config: {
    provider: AgentProvider;
    directory: string;
    prompt: string;
    claudeMd?: string;
    adminEmail?: string;
    whatsappPhone?: string;
    slackWebhookUrl?: string;
    flags: AgentFlags;
  };
  worktreePath?: string;
  worktreeBranch?: string;
  workspaceMode?: 'worktree' | 'direct';
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
    toolName?: string;
    toolInput?: string;
    toolResult?: string;
  }>;
  lastActivity: number;
  createdAt: number;
  costUsd?: number;
  tokenUsage?: { input: number; output: number };
  projectName?: string;
  prUrl?: string;
  mcpServers?: string[];
  contextWindow?: { used: number; total: number };
  currentTask?: string;
  sessionId?: string;
  originalPrompt?: string;
  source?: 'monitor' | 'external';
  labels?: Record<string, string>;
  structuredOutput?: unknown;
  interactionMode?: AgentInteractionMode;
  pendingPlan?: {
    id: string;
    content: string;
    sourceMessageId: string;
    createdAt: number;
    approvedAt?: number;
  };
}

export interface Template {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionInfo {
  id: string;
  projectPath: string;
  lastModified: number;
}

export interface DirListing {
  path: string;
  parent: string;
  entries: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    mtime?: number;
    extension?: string;
    isTextPreviewable?: boolean;
  }>;
}

export interface FilePreview {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtime: number;
  content: string;
  truncated: boolean;
  language: string;
  isMarkdown: boolean;
}

export interface PipelineTask {
  id: string;
  name: string;
  prompt: string;
  directory?: string;
  provider?: AgentProvider;
  model?: string;
  claudeMd?: string;
  flags?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'evaluating' | 'revision';
  agentId?: string;
  order: number;
  createdAt: number;
  completedAt?: number;
  error?: string;
  // Harness fields
  role?: 'planner' | 'generator' | 'evaluator';
  harnessId?: string;
  parentTaskId?: string;
  evaluationResult?: 'pass' | 'fail';
  evaluationFeedback?: string;
  revisionCount?: number;
  maxRevisions?: number;
}

export interface AgentManagerConfig {
  running: boolean;
  agentId?: string;
  claudeMd: string;
  defaultDirectory: string;
  defaultProvider: AgentProvider;
  pollIntervalMs: number;
  adminEmail?: string;
  whatsappPhone?: string;
  slackWebhookUrl?: string;
  stuckTimeoutMs?: number;
  // Harness mode fields
  harnessMode?: boolean;
  evaluationCriteria?: string;
  maxRevisionsPerTask?: number;
}

/** @deprecated Use AgentManagerConfig instead */
export type MetaAgentConfig = AgentManagerConfig;

export type HarnessStatus = 'idle' | 'planning' | 'generating' | 'evaluating' | 'complete' | 'failed';

export interface HarnessState {
  status: HarnessStatus;
  harnessId: string | null;
  goal: string | null;
  plannerTaskId: string | null;
  totalGenerators: number;
  completedGenerators: number;
  failedGenerators: number;
}

export interface ServerSettings {
  agentRetentionMs: number;
  promptSuggestions: string[];
  pathHistory: Record<string, string[]>;
  deleteSessionFilesPolicy: DeleteSessionFilesPolicy;
}

export interface GpuServer {
  group: string;
  role: string;
  name: string;
  ip: string;
  user: string;
  port: string;
  target: string;
}

export interface GpuInfo {
  index: string;
  utilization: number;
  memoryPercent: number;
  temperature: number;
  memoryUsed: number;
  memoryTotal: number;
}

export interface GpuSnapshot {
  serverName: string;
  status: 'ok' | 'offline' | 'nosmi' | 'pending';
  gpus: GpuInfo[];
  timestamp: number;
}

export interface GpuMonitorConfig {
  pollInterval: number;
  enabled: boolean;
  serverCount: number;
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
  // Upload (images + any file type)
  uploadFile: (file: File) => uploadFile<{ path: string; originalName: string; size: number }>('/upload-image', file, 'file'),

  // Agents
  getAgents: () => request<Agent[]>('/agents?summary=1'),
  getAgent: (id: string) => request<Agent>(`/agents/${id}`),
  createAgent: (data: {
    name: string;
    provider?: AgentProvider;
    directory: string;
    prompt: string;
    claudeMd?: string;
    adminEmail?: string;
    whatsappPhone?: string;
    slackWebhookUrl?: string;
    flags?: AgentFlags;
    labels?: Record<string, string>;
    workspaceMode?: 'worktree' | 'direct';
  }) => request<Agent>('/agents', { method: 'POST', body: JSON.stringify(data) }),
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
    request<Agent>('/agents/' + id + '/interaction-mode', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }),
  approvePlan: (id: string) =>
    request<Agent>('/agents/' + id + '/plan/approve', { method: 'POST' }),
  revisePlan: (id: string) =>
    request<Agent>('/agents/' + id + '/plan/revise', { method: 'POST' }),
  interruptAgent: (id: string) =>
    request('/agents/' + id + '/interrupt', { method: 'POST' }),
  newConversation: (id: string) =>
    request<Agent>('/agents/' + id + '/new-conversation', { method: 'POST' }),
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
    request<Agent>('/agents/' + id + '/reasoning-effort', {
      method: 'PUT',
      body: JSON.stringify({ reasoningEffort }),
    }),
  restoreConversation: (id: string, turnIndex: number, restoreCode: boolean, restoreConv = true) =>
    request<{ ok: boolean; restoredPrompt: string; restoredCode: boolean; restoredConversation: boolean; warning?: string }>('/agents/' + id + '/restore', {
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

  // Sessions
  getSessions: (provider?: AgentProvider) =>
    request<SessionInfo[]>(`/sessions${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),

  // Directories
  listDirectory: (path?: string) =>
    request<DirListing>(`/directories${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  readFile: (path: string) =>
    request<FilePreview>(`/directories/file?path=${encodeURIComponent(path)}`),
  checkClaudeMd: (path: string) =>
    request<{ exists: boolean; content?: string; fileName?: string; matchedProvider?: AgentProvider }>(
      `/directories/claude-md?path=${encodeURIComponent(path)}`,
    ),
  checkInstructionFile: (path: string, provider: AgentProvider) =>
    request<{ exists: boolean; content?: string; fileName?: string; matchedProvider?: AgentProvider }>(
      `/directories/claude-md?path=${encodeURIComponent(path)}&provider=${encodeURIComponent(provider)}`,
    ),

  // Pipeline Tasks
  getTasks: () => request<PipelineTask[]>('/tasks'),
  getTask: (id: string) => request<PipelineTask>(`/tasks/${id}`),
  createTask: (data: {
    name: string;
    prompt: string;
    directory?: string;
    provider?: AgentProvider;
    model?: string;
    claudeMd?: string;
    flags?: Record<string, unknown>;
    order?: number;
  }) => request<PipelineTask>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
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
  startHarness: (data: { goal: string; evaluationCriteria?: string; maxRevisions?: number }) =>
    request<{ ok: boolean; harnessId: string; plannerTaskId: string }>('/tasks/harness/start', { method: 'POST', body: JSON.stringify(data) }),
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
