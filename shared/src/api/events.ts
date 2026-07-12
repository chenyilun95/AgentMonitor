import type {
  AgentClientView,
  AgentInteractionMode,
  AgentMessage,
  AgentStatus,
} from '../models/Agent.js';
import type { PipelineTask } from '../models/Task.js';
import type { GpuSnapshot } from '../models/GpuServer.js';

export interface AgentDelta {
  messages: AgentMessage[];
  status: string;
  costUsd?: number;
  tokenUsage?: { input: number; output: number };
  contextWindow?: { used: number; total: number };
  lastActivity: number;
  interactionMode?: AgentInteractionMode;
  pendingPlan?: AgentClientView['pendingPlan'];
  pendingQuestion?: AgentClientView['pendingQuestion'];
  currentGitBranch?: string;
}

export interface AgentInputInfo {
  prompt: string;
  choices?: string[];
}

export interface ServerToClientEvents {
  'agent:message': (data: { agentId: string; message: AgentMessage }) => void;
  'agent:status': (data: { agentId: string; status: AgentStatus | 'deleted' }) => void;
  'agent:delta': (data: { agentId: string; delta: AgentDelta }) => void;
  'agent:input_required': (data: { agentId: string; inputInfo: AgentInputInfo }) => void;
  'agent:terminal': (data: { agentId: string; chunk: string }) => void;
  'agent:update': (data: { agentId: string; agent: AgentClientView }) => void;
  'agent:snapshot': (data: { agentId: string; agent: AgentClientView }) => void;
  'terminal:output': (data: { agentId: string; data: string }) => void;
  'terminal:exit': (data: { agentId: string; exitCode: number }) => void;
  'task:update': (task: PipelineTask) => void;
  'pipeline:complete': () => void;
  'meta:status': (data: { running: boolean }) => void;
  'harness:complete': (data: unknown) => void;
  'harness:failed': (data: unknown) => void;
  'gpu:snapshot': (data: GpuSnapshot) => void;
  'gpu:terminal:output': (data: { serverName: string; data: string }) => void;
  'gpu:terminal:exit': (data: { serverName: string; exitCode: number }) => void;
  'telegram:command': (data: { chatId: string; command: string; args: string }) => void;
}

export interface ClientToServerEvents {
  'agent:join': (agentId: string) => void;
  'agent:leave': (agentId: string) => void;
  'agent:send': (data: { agentId: string; text: string }) => void;
  'agent:interrupt': (agentId: string) => void;
  'terminal:open': (data: { agentId: string; cols?: number; rows?: number; initialCommand?: string }) => void;
  'terminal:input': (data: { agentId: string; data: string }) => void;
  'terminal:resize': (data: { agentId: string; cols: number; rows: number }) => void;
  'terminal:close': (agentId: string) => void;
  'gpu:terminal:open': (data: { serverName: string; cols?: number; rows?: number }) => void;
  'gpu:terminal:input': (data: { serverName: string; data: string }) => void;
  'gpu:terminal:resize': (data: { serverName: string; cols: number; rows: number }) => void;
  'gpu:terminal:close': (data: { serverName: string }) => void;
  'telegram:reply': (data: { chatId: string; text: string; parseMode?: string }) => void;
  'telegram:register': (data: { commands: Array<{ command: string; description: string }> }) => void;
}
