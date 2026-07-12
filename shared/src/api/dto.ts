import type { AgentFlags, AgentProvider, AgentWorkspaceMode, ReasoningEffort } from '../models/Agent.js';

export interface CreateAgentRequest {
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
  workspaceMode?: AgentWorkspaceMode;
  skills?: string[];
}

export interface RestoreConversationResponse {
  ok: boolean;
  restoredPrompt: string;
  restoredCode: boolean;
  restoredConversation: boolean;
  warning?: string;
}

export interface BtwResponse {
  answer: string;
}

export interface StartHarnessRequest {
  goal: string;
  evaluationCriteria?: string;
  maxRevisions?: number;
}

export interface StartHarnessResponse {
  ok: boolean;
  harnessId: string;
  plannerTaskId: string;
}

export interface CreateTaskRequest {
  name: string;
  prompt: string;
  directory?: string;
  provider?: AgentProvider;
  model?: string;
  claudeMd?: string;
  flags?: Record<string, unknown>;
  order?: number;
}

export interface UpdateReasoningEffortRequest {
  reasoningEffort?: ReasoningEffort;
}

export interface InstructionFileCheckResponse {
  exists: boolean;
  content?: string;
  fileName?: string;
  matchedProvider?: AgentProvider;
}

export interface UploadFileResponse {
  path: string;
  originalName: string;
  size: number;
}
