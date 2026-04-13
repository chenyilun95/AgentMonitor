import type { TaskRole } from './Task.js';

export interface HandoffFile {
  taskId: string;
  taskName: string;
  role: TaskRole;
  timestamp: number;

  // Planner output
  plannerSpec?: string;
  acceptanceCriteria?: string[];
  decomposedTasks?: Array<{
    name: string;
    prompt: string;
    order: number;
    acceptanceCriteria?: string[];
  }>;

  // Generator output
  filesModified?: string[];
  summary?: string;
  worktreeBranch?: string;

  // Evaluator output
  evaluationResult?: 'pass' | 'fail';
  feedback?: string;
  scores?: Record<string, number>;
}
