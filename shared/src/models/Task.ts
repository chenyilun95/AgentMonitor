import type { AgentProvider } from './Agent.js';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'evaluating' | 'revision';

export type TaskRole = 'planner' | 'generator' | 'evaluator';

export interface PipelineTask {
  id: string;
  name: string;
  prompt: string;
  directory?: string;
  provider?: AgentProvider;
  model?: string;
  claudeMd?: string;
  flags?: {
    dangerouslySkipPermissions?: boolean;
    fullAuto?: boolean;
    askForApprovalNever?: boolean;
    sandboxDangerFullAccess?: boolean;
  };
  status: TaskStatus;
  agentId?: string;
  order: number;
  createdAt: number;
  completedAt?: number;
  error?: string;
  notifiedAt?: number;
  role?: TaskRole;
  harnessId?: string;
  parentTaskId?: string;
  evaluationResult?: 'pass' | 'fail';
  evaluationFeedback?: string;
  revisionCount?: number;
  maxRevisions?: number;
  handoffFile?: string;
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
  feishuChatId?: string;
  stuckTimeoutMs?: number;
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
