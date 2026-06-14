import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import type { AgentStore } from '../store/AgentStore.js';
import type { AgentManager } from './AgentManager.js';
import type { HandoffManager } from './HandoffManager.js';
import type { PipelineTask, AgentManagerConfig } from '../models/Task.js';
import type { HandoffFile } from '../models/Handoff.js';
import type { AgentProvider } from '../models/Agent.js';

const DEFAULT_MAX_REVISIONS = 3;

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

export class HarnessOrchestrator extends EventEmitter {
  private store: AgentStore;
  private agentManager: AgentManager;
  private handoffManager: HandoffManager;
  private harnessId: string | null = null;
  private goal: string | null = null;
  private plannerTaskId: string | null = null;

  constructor(store: AgentStore, agentManager: AgentManager, handoffManager: HandoffManager) {
    super();
    this.store = store;
    this.agentManager = agentManager;
    this.handoffManager = handoffManager;
  }

  getState(): HarnessState {
    if (!this.harnessId) {
      return { status: 'idle', harnessId: null, goal: null, plannerTaskId: null, totalGenerators: 0, completedGenerators: 0, failedGenerators: 0 };
    }

    const tasks = this.store.getAllTasks().filter(t => t.harnessId === this.harnessId);
    const plannerTask = tasks.find(t => t.role === 'planner');
    const generators = tasks.filter(t => t.role === 'generator');
    const evaluators = tasks.filter(t => t.role === 'evaluator');

    let status: HarnessStatus = 'idle';
    if (plannerTask?.status === 'running') {
      status = 'planning';
    } else if (generators.some(t => t.status === 'running' || t.status === 'revision')) {
      status = 'generating';
    } else if (evaluators.some(t => t.status === 'running')) {
      status = 'evaluating';
    } else if (generators.length > 0 && generators.every(t => t.status === 'completed' || t.status === 'failed')) {
      status = generators.some(t => t.status === 'failed') ? 'failed' : 'complete';
    }

    return {
      status,
      harnessId: this.harnessId,
      goal: this.goal,
      plannerTaskId: this.plannerTaskId,
      totalGenerators: generators.length,
      completedGenerators: generators.filter(t => t.status === 'completed').length,
      failedGenerators: generators.filter(t => t.status === 'failed').length,
    };
  }

  /**
   * Start a harness run: create a planner task that decomposes the goal.
   */
  startHarness(goal: string, config: AgentManagerConfig): PipelineTask {
    this.harnessId = uuid();
    this.goal = goal;

    const plannerPrompt = this.buildPlannerPrompt(goal, config.evaluationCriteria);

    const task: PipelineTask = {
      id: uuid(),
      name: '[Planner] Decompose goal',
      prompt: plannerPrompt,
      directory: config.defaultDirectory,
      provider: config.defaultProvider,
      model: undefined,
      claudeMd: config.claudeMd,
      flags: { dangerouslySkipPermissions: true },
      status: 'pending',
      order: 0,
      createdAt: Date.now(),
      role: 'planner',
      harnessId: this.harnessId,
    };

    this.plannerTaskId = task.id;
    this.store.saveTask(task);
    this.emit('task:update', task);
    return task;
  }

  /**
   * Called by the pipeline tick when a harness task completes.
   * Returns true if the orchestrator handled it.
   */
  onTaskComplete(task: PipelineTask): boolean {
    if (!task.harnessId || task.harnessId !== this.harnessId) return false;

    if (task.role === 'planner') {
      this.onPlannerComplete(task);
      return true;
    }
    if (task.role === 'generator') {
      this.onGeneratorComplete(task);
      return true;
    }
    if (task.role === 'evaluator') {
      this.onEvaluatorComplete(task);
      return true;
    }
    return false;
  }

  stopHarness(): void {
    this.harnessId = null;
    this.goal = null;
    this.plannerTaskId = null;
  }

  // --- Private ---

  private onPlannerComplete(task: PipelineTask): void {
    const cfg = this.store.getMetaConfig() as AgentManagerConfig | null;
    const workingDir = task.directory || cfg?.defaultDirectory || process.cwd();

    // Try to read handoff file, fallback to extracting from messages
    let handoff = this.handoffManager.readHandoff(workingDir, task.id);
    if (!handoff?.decomposedTasks) {
      const agent = task.agentId ? this.store.getAgent(task.agentId) : undefined;
      if (agent) {
        const extracted = this.handoffManager.extractHandoffFromMessages(agent.messages);
        if (extracted) {
          handoff = { taskId: task.id, taskName: task.name, role: 'planner', timestamp: Date.now(), ...extracted };
        }
      }
    }

    if (!handoff?.decomposedTasks?.length) {
      console.error('[Harness] Planner produced no tasks. Marking harness as failed.');
      this.emit('harness:failed', { reason: 'Planner produced no decomposed tasks' });
      return;
    }

    // Create generator tasks from planner output
    const maxRevisions = cfg?.maxRevisionsPerTask ?? DEFAULT_MAX_REVISIONS;
    for (const dt of handoff.decomposedTasks) {
      const genTask: PipelineTask = {
        id: uuid(),
        name: `[Generator] ${dt.name}`,
        prompt: dt.prompt,
        directory: workingDir,
        provider: cfg?.defaultProvider,
        claudeMd: cfg?.claudeMd,
        flags: { dangerouslySkipPermissions: true },
        status: 'pending',
        order: dt.order,
        createdAt: Date.now(),
        role: 'generator',
        harnessId: this.harnessId!,
        maxRevisions,
        revisionCount: 0,
      };
      this.store.saveTask(genTask);
      this.emit('task:update', genTask);
    }

    // Write planner handoff for reference
    this.handoffManager.writeHandoff(workingDir, handoff);
    console.log(`[Harness] Planner decomposed goal into ${handoff.decomposedTasks.length} generator tasks`);
  }

  private onGeneratorComplete(task: PipelineTask): void {
    const cfg = this.store.getMetaConfig() as AgentManagerConfig | null;
    const workingDir = task.directory || cfg?.defaultDirectory || process.cwd();
    const criteria = cfg?.evaluationCriteria || '';

    // Get the generator's agent to find its worktree
    const agent = task.agentId ? this.store.getAgent(task.agentId) : undefined;
    const evalDir = agent ? this.agentManager.resolveExecutionDirectory(agent) : workingDir;

    const evalPrompt = this.buildEvaluatorPrompt(task, criteria);

    const evalTask: PipelineTask = {
      id: uuid(),
      name: `[Evaluator] Review: ${task.name.replace('[Generator] ', '')}`,
      prompt: evalPrompt,
      directory: evalDir,
      provider: cfg?.defaultProvider,
      claudeMd: cfg?.claudeMd,
      flags: { dangerouslySkipPermissions: true },
      status: 'pending',
      order: task.order, // same order so it runs next in the pipeline tick
      createdAt: Date.now(),
      role: 'evaluator',
      harnessId: this.harnessId!,
      parentTaskId: task.id,
    };

    // Mark generator as evaluating
    task.status = 'evaluating';
    this.store.saveTask(task);
    this.store.saveTask(evalTask);
    this.emit('task:update', task);
    this.emit('task:update', evalTask);

    console.log(`[Harness] Created evaluator for "${task.name}"`);
  }

  private onEvaluatorComplete(evalTask: PipelineTask): void {
    const cfg = this.store.getMetaConfig() as AgentManagerConfig | null;
    const workingDir = evalTask.directory || cfg?.defaultDirectory || process.cwd();

    // Try to read evaluator's verdict
    let handoff = this.handoffManager.readHandoff(workingDir, evalTask.id);
    if (!handoff?.evaluationResult) {
      const agent = evalTask.agentId ? this.store.getAgent(evalTask.agentId) : undefined;
      if (agent) {
        const extracted = this.handoffManager.extractHandoffFromMessages(agent.messages);
        if (extracted) {
          handoff = { taskId: evalTask.id, taskName: evalTask.name, role: 'evaluator', timestamp: Date.now(), ...extracted };
        }
      }
    }

    const result = handoff?.evaluationResult || 'pass'; // default to pass if can't parse
    const feedback = handoff?.feedback || '';

    evalTask.evaluationResult = result;
    evalTask.evaluationFeedback = feedback;
    this.store.saveTask(evalTask);
    this.emit('task:update', evalTask);

    // Find the parent generator task
    const genTask = evalTask.parentTaskId ? this.store.getTask(evalTask.parentTaskId) : undefined;
    if (!genTask) {
      console.error(`[Harness] Evaluator ${evalTask.id} has no parent generator task`);
      return;
    }

    if (result === 'pass') {
      genTask.status = 'completed';
      genTask.evaluationResult = 'pass';
      genTask.completedAt = Date.now();
      this.store.saveTask(genTask);
      this.emit('task:update', genTask);
      console.log(`[Harness] Generator "${genTask.name}" passed evaluation`);
      this.checkHarnessComplete();
    } else {
      // Fail — check revision budget
      const revisionCount = (genTask.revisionCount || 0) + 1;
      const maxRevisions = genTask.maxRevisions ?? cfg?.maxRevisionsPerTask ?? DEFAULT_MAX_REVISIONS;

      if (revisionCount >= maxRevisions) {
        genTask.status = 'failed';
        genTask.evaluationResult = 'fail';
        genTask.evaluationFeedback = feedback;
        genTask.completedAt = Date.now();
        genTask.error = `Failed evaluation after ${revisionCount} revision(s): ${feedback}`;
        this.store.saveTask(genTask);
        this.emit('task:update', genTask);
        console.log(`[Harness] Generator "${genTask.name}" exhausted revisions (${revisionCount}/${maxRevisions})`);
        this.checkHarnessComplete();
      } else {
        // Create revision: re-run generator with feedback
        genTask.status = 'revision';
        genTask.revisionCount = revisionCount;
        genTask.evaluationFeedback = feedback;
        this.store.saveTask(genTask);

        const revisionPrompt = this.buildRevisionPrompt(genTask, feedback);
        const revTask: PipelineTask = {
          ...genTask,
          id: uuid(),
          name: `[Generator] Revision ${revisionCount}: ${genTask.name.replace(/^\[Generator\]\s*(Revision \d+:\s*)?/, '')}`,
          prompt: revisionPrompt,
          status: 'pending',
          agentId: undefined,
          createdAt: Date.now(),
          completedAt: undefined,
          error: undefined,
          revisionCount,
        };
        this.store.saveTask(revTask);
        this.emit('task:update', genTask);
        this.emit('task:update', revTask);
        console.log(`[Harness] Created revision ${revisionCount}/${maxRevisions} for "${genTask.name}"`);
      }
    }
  }

  private checkHarnessComplete(): void {
    if (!this.harnessId) return;
    const tasks = this.store.getAllTasks().filter(t => t.harnessId === this.harnessId && t.role === 'generator');
    if (tasks.length === 0) return;
    if (tasks.every(t => t.status === 'completed' || t.status === 'failed')) {
      const allPassed = tasks.every(t => t.status === 'completed');
      this.emit('harness:complete', { harnessId: this.harnessId, allPassed });
      console.log(`[Harness] Complete. All passed: ${allPassed}`);
    }
  }

  private buildPlannerPrompt(goal: string, evaluationCriteria?: string): string {
    return `You are a Planner agent. Your job is to decompose a high-level goal into concrete, actionable tasks.

## Goal
${goal}

## Instructions
Analyze the goal and break it down into discrete implementation tasks. Each task should be:
- Self-contained and independently executable
- Ordered by dependency (tasks that depend on others get higher order numbers)
- Tasks with the same order number will run in parallel

${evaluationCriteria ? `## Evaluation Criteria\nThe following criteria will be used to evaluate each task:\n${evaluationCriteria}\n` : ''}

## Required Output Format
You MUST output a JSON block with this exact structure:

\`\`\`json
{
  "tasks": [
    {
      "name": "Short descriptive name",
      "prompt": "Detailed implementation instructions for the agent",
      "order": 1,
      "acceptanceCriteria": ["criterion 1", "criterion 2"]
    }
  ]
}
\`\`\`

Output ONLY the JSON block. Do not include any other text.`;
  }

  private buildEvaluatorPrompt(generatorTask: PipelineTask, criteria: string): string {
    return `You are an Evaluator agent. Your job is to review the work done by a Generator agent and determine if it meets quality standards.

## Task That Was Completed
Name: ${generatorTask.name}
Original Prompt: ${generatorTask.prompt}

## Evaluation Instructions
1. Review the code changes in the current working directory
2. Check if the implementation matches the task requirements
3. Run any relevant tests if available
4. Assess code quality and correctness

${criteria ? `## Evaluation Criteria\n${criteria}\n` : `## Default Criteria
- Functionality: Does the code work as specified?
- Correctness: Are there bugs or logic errors?
- Completeness: Are all requirements addressed?
- Code quality: Is the code clean and maintainable?
`}

## Required Output Format
You MUST output a JSON block with this exact structure:

\`\`\`json
{
  "evaluationResult": "pass" or "fail",
  "feedback": "Detailed explanation of what passed/failed and why",
  "scores": {
    "functionality": 1-10,
    "correctness": 1-10,
    "completeness": 1-10,
    "quality": 1-10
  }
}
\`\`\`

Be rigorous but fair. Only fail if there are genuine issues that need fixing.`;
  }

  private buildRevisionPrompt(originalTask: PipelineTask, feedback: string): string {
    return `You are continuing work on a task that did not pass evaluation. Fix the issues identified by the evaluator.

## Original Task
${originalTask.prompt}

## Evaluator Feedback
${feedback}

## Instructions
1. Review the evaluator's feedback carefully
2. Fix all identified issues
3. Ensure the original requirements are still met
4. Run tests if available to verify your fixes

Focus only on addressing the feedback. Do not make unrelated changes.`;
  }
}
