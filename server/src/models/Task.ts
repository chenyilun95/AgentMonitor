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
  order: number; // Tasks with same order run in parallel; sequential orders wait for previous
  createdAt: number;
  completedAt?: number;
  error?: string;
  notifiedAt?: number; // Timestamp of last stuck-agent notification (avoids spam)

  // Harness mode fields (all optional for backward compat)
  role?: TaskRole;
  harnessId?: string;           // Groups tasks belonging to the same harness run
  parentTaskId?: string;        // For evaluator: which generator task it evaluates
  evaluationResult?: 'pass' | 'fail';
  evaluationFeedback?: string;
  revisionCount?: number;       // How many times this task has been revised
  maxRevisions?: number;        // Cap on revision attempts (default 3)
  handoffFile?: string;         // Path to the handoff JSON file
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
  stuckTimeoutMs?: number; // How long an agent can be in waiting_input before notification (default 5 min)

  // Harness mode config
  harnessMode?: boolean;           // false = simple pipeline (default), true = harness mode
  evaluationCriteria?: string;     // Default rubric for evaluators
  maxRevisionsPerTask?: number;    // Global default for max revisions (default 3)
}

/** @deprecated Use AgentManagerConfig instead */
export type MetaAgentConfig = AgentManagerConfig;
