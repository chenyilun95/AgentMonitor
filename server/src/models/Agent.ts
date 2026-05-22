export type AgentStatus = 'running' | 'stopped' | 'error' | 'waiting_input';
export type AgentProvider = 'claude' | 'codex';
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const PROVIDER_REASONING_EFFORTS: Record<AgentProvider, readonly ReasoningEffort[]> = {
  claude: ['low', 'medium', 'high', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh'],
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
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
  flags: {
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
  };
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  config: AgentConfig;
  worktreePath?: string;
  worktreeBranch?: string;
  messages: AgentMessage[];
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
  interactionMode?: 'default' | 'plan';
  source?: 'monitor' | 'external';
  restoredConversationSeed?: string;
  codeSnapshots?: Array<{ beforeTurnIndex: number; commit: string }>;
  labels?: Record<string, string>;
  structuredOutput?: unknown;
}
