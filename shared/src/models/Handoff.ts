import type { TaskRole } from './Task.js';

export interface HandoffFile {
  taskId: string;
  taskName: string;
  role: TaskRole;
  timestamp: number;
  plannerSpec?: string;
  acceptanceCriteria?: string[];
  decomposedTasks?: Array<{
    name: string;
    prompt: string;
    order: number;
    acceptanceCriteria?: string[];
  }>;
  filesModified?: string[];
  summary?: string;
  worktreeBranch?: string;
  evaluationResult?: 'pass' | 'fail';
  feedback?: string;
  scores?: Record<string, number>;
}
