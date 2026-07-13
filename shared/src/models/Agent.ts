export type AgentStatus = 'running' | 'stopped' | 'error' | 'waiting_input';
export type AgentProvider = 'claude' | 'codex';
export type AgentInteractionMode = 'default' | 'plan';
export type AgentWorkspaceMode = 'worktree' | 'direct';
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const PROVIDER_REASONING_EFFORTS: Record<AgentProvider, readonly ReasoningEffort[]> = {
  claude: ['low', 'medium', 'high', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh'],
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export interface AgentMessageAttachment {
  type: 'image';
  source: string;
  name?: string;
  mimeType?: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  attachments?: AgentMessageAttachment[];
}

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: 'process' | 'stdout' | 'stderr' | 'terminal' | 'manager' | 'operator';
  message: string;
  stream?: 'stdout' | 'stderr';
  payload?: unknown;
}

export interface AgentFlags {
  dangerouslySkipPermissions?: boolean;
  resume?: string;
  model?: string;
  fullAuto?: boolean;
  askForApprovalNever?: boolean;
  sandboxDangerFullAccess?: boolean;
  chrome?: boolean;
  permissionMode?: string;
  maxBudgetUsd?: number;
  allowedTools?: string;
  disallowedTools?: string;
  addDirs?: string;
  mcpConfig?: string;
  reasoningEffort?: ReasoningEffort;
  outputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AgentConfig {
  provider: AgentProvider;
  directory: string;
  prompt: string;
  claudeMd?: string;
  adminEmail?: string;
  whatsappPhone?: string;
  slackWebhookUrl?: string;
  feishuChatId?: string;
  flags: AgentFlags;
  skills?: string[];
}

export interface PendingQuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface PendingQuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: PendingQuestionOption[];
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  config: AgentConfig;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeMerged?: boolean;
  workspaceMode?: AgentWorkspaceMode;
  gitBranch?: string;
  currentGitBranch?: string;
  messages: AgentMessage[];
  logs?: AgentLogEntry[];
  lastActivity: number;
  createdAt: number;
  costUsd?: number;
  pid?: number;
  tokenUsage?: { input: number; output: number };
  projectName?: string;
  prUrl?: string;
  mcpServers?: string[];
  contextWindow?: { used: number; total: number };
  currentTask?: string;
  sessionId?: string;
  originalPrompt?: string;
  source?: 'monitor' | 'external';
  restoredConversationSeed?: string;
  codeSnapshots?: Array<{ beforeTurnIndex: number; commit: string }>;
  labels?: Record<string, string>;
  structuredOutput?: unknown;
  interactionMode?: AgentInteractionMode;
  pendingPlan?: {
    id: string;
    content: string;
    sourceMessageId: string;
    createdAt: number;
    approvedAt?: number;
    toolUseId?: string;
  };
  pendingQuestion?: {
    id: string;
    toolUseId: string;
    questions: PendingQuestionItem[];
    sourceMessageId: string;
    createdAt: number;
    answeredAt?: number;
  };
  preRestoreSnapshot?: {
    messages: AgentMessage[];
    sessionId?: string;
    jsonlBackupPath?: string;
  };
}

export interface AgentClientView extends Omit<Agent, 'preRestoreSnapshot' | 'logs'> {
  preRestoreUserTurns?: Array<{ id: string; content: string; timestamp: number }>;
}
