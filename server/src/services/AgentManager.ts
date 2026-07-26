import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import { execFileSync, execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync, unlinkSync, copyFileSync } from 'fs';
import path, { basename } from 'path';
import os from 'os';
import type { Agent, AgentConfig, AgentInteractionMode, AgentLogEntry, AgentMessage, AgentMessageAttachment, AgentQueuedMessage, AgentStatus, AgentWorkspaceMode, PendingQuestionItem, PendingQuestionOption, ReasoningEffort } from '../models/Agent.js';
import type { AgentDelta, AgentInputInfo } from '@agent-monitor/shared';
import { AgentStore } from '../store/AgentStore.js';
import { AgentProcess, type StreamMessage } from './AgentProcess.js';
import { extractImageAttachments, resolveAttachmentPaths } from '../utils/imageAttachments.js';
import { WorktreeManager } from './WorktreeManager.js';
import { EmailNotifier } from './EmailNotifier.js';
import { WhatsAppNotifier } from './WhatsAppNotifier.js';
import { SlackNotifier } from './SlackNotifier.js';
import { FeishuNotifier } from './FeishuNotifier.js';
import { SkillManager } from './SkillManager.js';
import { normalizeUserPath, portableUserPath } from '../utils/pathUtils.js';
import { classifyCodexStderr, normalizeStoredCodexStderr } from '../utils/codexStderr.js';
import { getGitDirectoryInfo } from './GitOperations.js';
import { WorktreeSnapshotManager } from './WorktreeSnapshotManager.js';

/** How long (ms) after a user message with no response before we notify (not auto-interrupt) */
const STUCK_TIMEOUT_MS = 600_000; // 10 minutes — long tasks (build, push, chrome MCP) can take time
const STUCK_CHECK_INTERVAL_MS = 60_000; // check every 60s
const GIT_BRANCH_CHECK_CACHE_MS = 60_000;
const MAX_AGENT_LOG_ENTRIES = 400;
const MAX_AGENT_LOG_MESSAGE_CHARS = 8000;
const MAX_AGENT_LOG_PAYLOAD_CHARS = 16000;
const PLAN_MODE_INSTRUCTIONS = `You are in AgentMonitor Plan Mode for this turn.

Rules:
- Do not edit files, write files, run formatters, apply patches, start services, commit code, or perform any mutating action.
- You may inspect and analyze existing files and run read-only commands that help produce a plan.
- Produce a decision-complete implementation plan only.
- Put the final plan in exactly one <proposed_plan>...</proposed_plan> block.
- Do not ask for approval inside the plan. AgentMonitor will show explicit approval controls.`;
const PLAN_APPROVAL_MESSAGE = 'User has approved the proposed plan. Proceed with implementation according to the approved plan.';
const WORKTREE_MODE_INSTRUCTIONS = `## Worktree Mode

You are working in an isolated Git worktree on a dedicated agent branch.
- Commit changes only on the worktree branch.
- During normal development tasks, do not merge into or push the base branch.
- You may update from or integrate into the base branch only when the current user request is an explicit AgentMonitor Git integration instruction. Follow that instruction's checks and scope exactly.
- Do not copy changed files into the original working tree.
- Shared resources such as ports, databases, containers, and external caches are not isolated.`;

export class AgentWorkspaceError extends Error {}

interface DeleteAgentOptions {
  purgeSessionFiles?: boolean;
  discardWorkspaceChanges?: boolean;
}

export interface RestoreConversationResult {
  restoredPrompt: string;
  restoredCode: boolean;
  restoredConversation: boolean;
  warning?: string;
}

interface ClaudeModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

interface ClaudeUsageCounts {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
}

const CLAUDE_PRICES_PER_MTOK: Record<string, ClaudeModelPrice> = {
  opus47: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  opus46: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  opus45: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  opus41: { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.50 },
  opus4: { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.50 },
  sonnet46: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.30 },
  sonnet45: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.30 },
  sonnet4: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.30 },
  haiku45: { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.10 },
  haiku35: { input: 0.80, output: 4, cacheWrite5m: 1, cacheWrite1h: 1.60, cacheRead: 0.08 },
  haiku3: { input: 0.25, output: 1.25, cacheWrite5m: 0.30, cacheWrite1h: 0.50, cacheRead: 0.03 },
};

export interface AgentManagerEvents {
  'agent:update': (agentId: string, agent: Agent) => void;
  'agent:message': (agentId: string, msg: StreamMessage | { type: string; text: string }) => void;
  'agent:status': (agentId: string, status: AgentStatus | 'deleted') => void;
  'agent:delta': (agentId: string, delta: AgentDelta) => void;
  'agent:terminal': (agentId: string, chunk: { stream: string; data: string }) => void;
  'agent:input_required': (agentId: string, inputInfo: AgentInputInfo) => void;
}

export declare interface AgentManager {
  on<K extends keyof AgentManagerEvents>(event: K, listener: AgentManagerEvents[K]): this;
  emit<K extends keyof AgentManagerEvents>(event: K, ...args: Parameters<AgentManagerEvents[K]>): boolean;
  off<K extends keyof AgentManagerEvents>(event: K, listener: AgentManagerEvents[K]): this;
}

export class AgentManager extends EventEmitter {
  private processes: Map<string, AgentProcess> = new Map();
  private store: AgentStore;
  private worktreeManager: WorktreeManager;
  private emailNotifier: EmailNotifier;
  private whatsappNotifier: WhatsAppNotifier;
  private slackNotifier: SlackNotifier;
  private feishuNotifier: FeishuNotifier;
  private skillManager: SkillManager | null;
  private snapshotManager = new WorktreeSnapshotManager();
  /** Track when a user message was sent per agent (agentId → timestamp) */
  private pendingUserMessage: Map<string, number> = new Map();
  private stuckCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastGitBranchCheckAt = 0;

  constructor(store: AgentStore, worktreeManager?: WorktreeManager, emailNotifier?: EmailNotifier, whatsappNotifier?: WhatsAppNotifier, slackNotifier?: SlackNotifier, feishuNotifier?: FeishuNotifier, skillManager?: SkillManager) {
    super();
    this.store = store;
    this.worktreeManager = worktreeManager || new WorktreeManager();
    this.emailNotifier = emailNotifier || new EmailNotifier();
    this.whatsappNotifier = whatsappNotifier || new WhatsAppNotifier();
    this.slackNotifier = slackNotifier || new SlackNotifier();
    this.feishuNotifier = feishuNotifier || new FeishuNotifier('', '');
    this.skillManager = skillManager || null;

    // On startup, mark any monitor-owned agents that were left in running/waiting_input as
    // stopped — their processes died when the server restarted.
    // External agents are handled by ExternalAgentScanner (it checks if PID is still alive).
    for (const agent of this.store.getAllAgents()) {
      if (normalizeStoredCodexStderr(agent)) {
        this.store.saveAgent(agent);
      }
      if (agent.source === 'external') continue;
      const portableDirectory = portableUserPath(agent.config.directory);
      if (portableDirectory !== agent.config.directory) {
        agent.config.directory = portableDirectory;
        this.store.saveAgent(agent);
      }
      if (agent.status === 'running' || agent.status === 'waiting_input') {
        agent.status = 'stopped';
        agent.runOutcome = 'interrupted';
        agent.pid = undefined;
        if (agent.queuedMessages?.length) {
          agent.queuePaused = true;
          agent.messages.push({
            id: uuid(),
            role: 'system',
            content: '[Interrupted] The server restarted before the active turn completed. Queued messages are paused until you resume them.',
            timestamp: Date.now(),
          });
        }
        this.store.saveAgent(agent);
      }
      if (agent.pendingIntegrationCleanup) {
        agent.pendingIntegrationCleanup = false;
        agent.messages.push({
          id: uuid(),
          role: 'system',
          content: '[Integration cleanup interrupted] The server restarted before Git verification and cleanup completed. The Agent and Worktree were kept; retry the action when ready.',
          timestamp: Date.now(),
        });
        this.store.saveAgent(agent);
      }
    }

    // Migrate legacy Git fields and backfill stable project/repository identity.
    for (const agent of this.store.getAllAgents()) {
      const legacy = agent as Agent & {
        gitBranch?: string;
        currentGitBranch?: string;
        worktreeMerged?: boolean;
      };
      agent.baseBranch ||= legacy.gitBranch;
      agent.currentBranch ||= legacy.currentGitBranch;
      try {
        const info = getGitDirectoryInfo(agent.config.directory);
        if (info.root) {
          agent.repositoryRoot = info.repositoryRoot || info.root;
          agent.projectKey = `git:${agent.repositoryRoot}`;
          if (!agent.baseBranch && info.branch) agent.baseBranch = info.branch;
        } else {
          agent.projectKey ||= `dir:${portableUserPath(normalizeUserPath(agent.config.directory))}`;
        }
        this.refreshAgentGitState(agent);
      } catch {
        agent.projectKey ||= `dir:${portableUserPath(normalizeUserPath(agent.config.directory))}`;
      }
      delete legacy.gitBranch;
      delete legacy.currentGitBranch;
      delete legacy.worktreeMerged;
      this.store.saveAgent(agent);
    }

    this.resumeBackgroundChecks();
  }

  resumeBackgroundChecks(): void {
    if (this.stuckCheckInterval) return;
    // Periodically check for stuck agents (sent user message but no response).
    this.stuckCheckInterval = setInterval(() => {
      this.checkStuckAgents();
    }, STUCK_CHECK_INTERVAL_MS);
  }

  pauseBackgroundChecks(): void {
    if (!this.stuckCheckInterval) return;
    clearInterval(this.stuckCheckInterval);
    this.stuckCheckInterval = null;
  }

  private checkStuckAgents(): void {
    const now = Date.now();
    for (const [agentId, sentAt] of this.pendingUserMessage.entries()) {
      if (now - sentAt < STUCK_TIMEOUT_MS) continue;

      const agent = this.store.getAgent(agentId);
      if (!agent || agent.status !== 'running') {
        this.pendingUserMessage.delete(agentId);
        continue;
      }

      const proc = this.processes.get(agentId);
      if (!proc) {
        this.pendingUserMessage.delete(agentId);
        continue;
      }

      console.warn(`[AgentManager] Agent ${agentId} possibly stuck (no response for ${STUCK_TIMEOUT_MS / 1000}s)`);
      this.pendingUserMessage.delete(agentId);

      // Notify the user but do NOT auto-interrupt — the agent may be running a long task
      agent.messages.push({
        id: uuid(),
        role: 'system',
        content: `[Stuck?] No response for ${Math.floor(STUCK_TIMEOUT_MS / 60000)} minutes after your message. The agent may be running a long task. You can manually interrupt (Esc) or wait.`,
        timestamp: now,
      });
      this.store.saveAgent(agent);

      this.emit('agent:update', agentId, agent);
    }
  }

  refreshGitBranches(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastGitBranchCheckAt < GIT_BRANCH_CHECK_CACHE_MS) return;
    this.lastGitBranchCheckAt = now;

    for (const agent of this.store.getAllAgents()) {
      try {
        if (this.refreshAgentGitState(agent)) {
          this.store.saveAgent(agent);
          this.emit('agent:update', agent.id, agent);
        }
      } catch {
        // git not available or directory gone
      }
    }
  }

  private refreshAgentGitState(agent: Agent): boolean {
    const cwd = this.resolveExecutionDirectory(agent);
    const previous = JSON.stringify({
      currentBranch: agent.currentBranch,
      hasUnintegratedChanges: agent.hasUnintegratedChanges,
      repositoryRoot: agent.repositoryRoot,
      projectKey: agent.projectKey,
    });
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
    if (branch !== 'HEAD') agent.currentBranch = branch;

    const originalInfo = getGitDirectoryInfo(agent.config.directory);
    if (originalInfo.root) {
      agent.repositoryRoot = originalInfo.repositoryRoot || originalInfo.root;
      agent.projectKey = `git:${agent.repositoryRoot}`;
    }

    if (agent.workspaceMode === 'worktree' && agent.worktreeBranch && agent.baseBranch) {
      const dirty = execFileSync('git', ['status', '--porcelain'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
      }).trim().length > 0;
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', agent.worktreeBranch, agent.baseBranch], {
          cwd: normalizeUserPath(agent.config.directory),
          stdio: 'ignore',
          timeout: 5000,
        });
        agent.hasUnintegratedChanges = dirty;
      } catch (error) {
        const status = (error as { status?: number }).status;
        agent.hasUnintegratedChanges = status === 1 ? true : (dirty || undefined);
      }
    } else {
      agent.hasUnintegratedChanges = undefined;
    }
    return previous !== JSON.stringify({
      currentBranch: agent.currentBranch,
      hasUnintegratedChanges: agent.hasUnintegratedChanges,
      repositoryRoot: agent.repositoryRoot,
      projectKey: agent.projectKey,
    });
  }

  async createAgent(
    name: string,
    agentConfig: AgentConfig,
    labels?: Record<string, string>,
    opts: { workspaceMode?: AgentWorkspaceMode } = {},
  ): Promise<Agent> {
    agentConfig = {
      ...agentConfig,
      directory: normalizeUserPath(agentConfig.directory),
    };

    const id = uuid();
    const branchName = `agent-${id.slice(0, 8)}`;
    const workspaceMode: AgentWorkspaceMode = opts.workspaceMode === 'worktree' ? 'worktree' : 'direct';

    let worktreePath: string | undefined;
    let worktreeBranch: string | undefined;

    // Ensure working directory exists (create if needed)
    if (!existsSync(agentConfig.directory)) {
      mkdirSync(agentConfig.directory, { recursive: true });
      console.log(`[AgentManager] Created missing directory: ${agentConfig.directory}`);
    }

    // When resuming a previous session, detect the original working directory
    // from the session file so we run in the correct directory.
    if (agentConfig.flags.resume) {
      const sessionCwd = this.findSessionCwd(
        agentConfig.provider,
        agentConfig.flags.resume,
        agentConfig.directory,
      );
      if (sessionCwd) {
        const normalizedSessionCwd = normalizeUserPath(sessionCwd);
        if (existsSync(normalizedSessionCwd)) {
          console.log(`[AgentManager] Resume: using session cwd: ${normalizedSessionCwd}`);
          agentConfig.directory = normalizedSessionCwd;
        }
      }
    }
    const skipWorktree = !!agentConfig.flags.resume;

    // Create git worktree for isolation — only if the directory is inside a git repo.
    // Always create worktrees at the git root level so subdirectory paths work correctly.
    let gitRoot: string | undefined;
    const isGitRepo = !skipWorktree && (() => {
      try {
        gitRoot = execSync('git rev-parse --show-toplevel', {
          cwd: agentConfig.directory,
          stdio: 'pipe',
        }).toString().trim();
        return true;
      } catch { return false; }
    })();

    if (workspaceMode === 'worktree' && skipWorktree) {
      throw new AgentWorkspaceError('A resumed provider session cannot be attached to a new Git worktree. Use Direct Edit mode for this session.');
    }
    if (workspaceMode === 'worktree' && (!isGitRepo || !gitRoot)) {
      throw new AgentWorkspaceError('Worktree mode requires an existing Git repository. Choose Direct Edit for a non-Git directory.');
    }

    const repositoryRoot = gitRoot
      ? (getGitDirectoryInfo(agentConfig.directory).repositoryRoot || gitRoot)
      : undefined;
    const projectKey = repositoryRoot ? `git:${repositoryRoot}` : `dir:${portableUserPath(agentConfig.directory)}`;

    let initialBranch: string | undefined;
    if (isGitRepo && gitRoot) {
      try {
        const branchOut = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: agentConfig.directory,
          stdio: 'pipe',
        }).toString().trim();
        if (branchOut && branchOut !== 'HEAD') initialBranch = branchOut;
      } catch { /* detached or no commits */ }

      try {
        if (workspaceMode === 'direct') {
          const result = this.worktreeManager.createDirectLink(gitRoot, branchName);
          worktreePath = result.worktreePath;
          worktreeBranch = undefined;
          // Direct mode edits the user's real repo; we don't write CLAUDE.md there.
          // The user can place CLAUDE.md themselves if they want it loaded.
        } else {
          const result = this.worktreeManager.createWorktree(
            gitRoot,
            branchName,
          );
          worktreePath = result.worktreePath;
          worktreeBranch = result.branch;
        }
      } catch (err) {
        if (workspaceMode === 'worktree') {
          throw new AgentWorkspaceError(`Failed to create Git worktree: ${err instanceof Error ? err.message : String(err)}`);
        }
        console.warn('[AgentManager] Direct workspace link setup failed, using the original directory:', err);
        worktreePath = undefined;
      }
    }

    const hasPrompt = agentConfig.prompt.trim().length > 0;

    const absoluteDirectory = agentConfig.directory;
    agentConfig = { ...agentConfig, directory: portableUserPath(absoluteDirectory) };

    const agent: Agent = {
      id,
      name,
      status: hasPrompt ? 'running' : 'waiting_input',
      runOutcome: undefined,
      config: agentConfig,
      worktreePath,
      worktreeBranch,
      workspaceMode,
      baseBranch: initialBranch,
      currentBranch: workspaceMode === 'worktree' ? worktreeBranch : initialBranch,
      repositoryRoot,
      projectKey,
      messages: hasPrompt
        ? [{
            id: uuid(),
            role: 'user',
            content: agentConfig.prompt,
            timestamp: Date.now(),
          }]
        : [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      projectName: basename(repositoryRoot || absoluteDirectory),
      mcpServers: this.parseMcpServers(agentConfig.flags.mcpConfig),
      currentTask: agentConfig.prompt.length > 120 ? agentConfig.prompt.slice(0, 120) + '...' : agentConfig.prompt,
      originalPrompt: agentConfig.prompt,
      labels,
      interactionMode: 'default',
    };

    // Take initial code snapshot (before turn 0) so we can restore to clean state.
    // Skipped in direct mode — we don't commit to the user's real branch.
    if (workspaceMode !== 'direct') {
      this.takeCodeSnapshot(agent, 0);
    }

    this.store.saveAgent(agent);
    this.store.recordPath(os.hostname(), agentConfig.directory);

    if (hasPrompt) {
      this.startProcess(agent);
    }

    // Notify dashboard of newly created agent immediately
    this.emit('agent:update', agent.id, agent);

    return agent;
  }

  private startProcess(agent: Agent): void {
    const proc = new AgentProcess();
    this.processes.set(agent.id, proc);
    const processPrompt = this.composeProcessPrompt(agent);
    const processModel = agent.config.flags.model;
    const executionDirectory = this.resolveExecutionDirectory(agent);
    this.appendAgentLog(agent.id, {
      level: 'info',
      source: 'manager',
      message: `Starting ${agent.config.provider} agent in ${executionDirectory}`,
      payload: {
        provider: agent.config.provider,
        directory: executionDirectory,
        workspaceMode: agent.workspaceMode,
        model: processModel,
      },
    });

    proc.on('message', (msg: StreamMessage) => {
      this.appendAgentLog(agent.id, {
        level: 'debug',
        source: 'stdout',
        message: `stream message: ${msg.type}${msg.subtype ? `/${msg.subtype}` : ''}`,
        payload: msg,
      });
      this.handleStreamMessage(agent.id, msg, agent.config.provider);
    });

    proc.on('terminal', (chunk: { stream: string; data: string }) => {
      // stderr is persisted by the dedicated event below. The terminal event is
      // only for live streaming; storing both used to duplicate every error.
      this.emit('agent:terminal', agent.id, chunk);
    });

    proc.on('raw', (text: string) => {
      this.appendAgentLog(agent.id, {
        level: 'debug',
        source: 'stdout',
        stream: 'stdout',
        message: text,
      });
    });

    proc.on('stderr', (text: string) => {
      const disposition = agent.config.provider === 'codex'
        ? classifyCodexStderr(text)
        : 'error';
      if (disposition === 'ignore') return;

      const log = `[Agent ${agent.id}] stderr: ${text}`;
      if (disposition === 'warn') console.warn(log);
      else console.error(log);
      this.appendAgentLog(agent.id, {
        level: disposition,
        source: 'stderr',
        stream: 'stderr',
        message: text,
      });
      if (disposition !== 'error') return;

      // Store stderr in messages for debugging
      const a = this.store.getAgent(agent.id);
      if (a) {
        a.messages.push({
          id: uuid(),
          role: 'system',
          content: `[stderr] ${text}`,
          timestamp: Date.now(),
        });
        a.lastActivity = Date.now();
        this.store.saveAgent(a);
      }
    });

    proc.on('exit', (code: number | null) => {
      // A completed result marks the agent stopped before AgentManager closes
      // the transport. SSH-backed runners commonly report 255 in that case.
      const current = this.store.getAgent(agent.id);
      const expectedTransportClose = current?.status === 'stopped';
      this.appendAgentLog(agent.id, {
        level: code === 0 || code === null || expectedTransportClose ? 'info' : 'error',
        source: 'process',
        message: expectedTransportClose && code !== 0 && code !== null
          ? `Agent transport closed after completed turn (code ${code})`
          : `Agent process exited with code ${code}`,
        payload: { code, expectedTransportClose },
      });
      // Don't override 'stopped' status (set when result message is received)
      if (current && current.status !== 'stopped') {
        const status = (code === 0 || code === null) ? 'stopped' : 'error';
        current.runOutcome = status === 'stopped' ? 'succeeded' : 'failed';
        if (status === 'error') {
          current.messages.push({
            id: uuid(),
            role: 'system',
            content: `Agent process exited with code ${code}`,
            timestamp: Date.now(),
          });
          this.store.saveAgent(current);
        }
        this.updateAgentStatus(agent.id, status);
      }
      // Extract structured output if schema was provided
      if (current) {
        this.extractStructuredOutput(current);
      }
      this.processes.delete(agent.id);
      if (current?.pendingIntegrationCleanup) {
        void this.finalizeIntegrationCleanup(current.id).then((deleted) => {
          if (!deleted) this.startNextQueuedMessage(current.id);
        });
        return;
      }
      this.startNextQueuedMessage(agent.id);
    });

    proc.on('error', (err: Error) => {
      console.error(`[Agent ${agent.id}] process error:`, err);
      this.appendAgentLog(agent.id, {
        level: 'error',
        source: 'process',
        message: `Process error: ${err.message}`,
        payload: { stack: err.stack },
      });
      const a = this.store.getAgent(agent.id);
      if (a) {
        a.runOutcome = 'failed';
        a.messages.push({
          id: uuid(),
          role: 'system',
          content: `Process error: ${err.message}`,
          timestamp: Date.now(),
        });
        this.store.saveAgent(a);
      }
      this.updateAgentStatus(agent.id, 'error');
    });

    proc.start({
      provider: agent.config.provider,
      directory: executionDirectory,
      prompt: processPrompt,
      dangerouslySkipPermissions: agent.config.flags.dangerouslySkipPermissions,
      resume: agent.config.flags.resume,
      model: processModel,
      fullAuto: agent.config.flags.fullAuto,
      askForApprovalNever: agent.config.flags.askForApprovalNever,
      sandboxDangerFullAccess: agent.config.flags.sandboxDangerFullAccess,
      chrome: agent.config.flags.chrome,
      permissionMode: agent.config.flags.permissionMode,
      maxBudgetUsd: agent.config.flags.maxBudgetUsd,
      allowedTools: agent.config.flags.allowedTools,
      disallowedTools: agent.config.flags.disallowedTools,
      addDirs: agent.config.flags.addDirs,
      mcpConfig: agent.config.flags.mcpConfig,
      reasoningEffort: agent.config.flags.reasoningEffort,
    });

    agent.pid = proc.pid;
    this.store.saveAgent(agent);
  }

  getAgentLogs(agentId: string, limit = 200): AgentLogEntry[] | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;
    const safeLimit = Math.max(0, Math.min(limit, MAX_AGENT_LOG_ENTRIES));
    return (agent.logs || []).slice(-safeLimit);
  }

  getOperatorContext(agentId: string, opts: { logLimit?: number; messageLimit?: number } = {}): Record<string, unknown> | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;
    const logLimit = Math.max(0, Math.min(opts.logLimit ?? 120, MAX_AGENT_LOG_ENTRIES));
    const messageLimit = Math.max(0, Math.min(opts.messageLimit ?? 80, 300));
    const logs = this.getAgentLogs(agentId, logLimit) || [];
    const { messages: _messages, logs: _logs, ...agentSummary } = agent;
    return {
      agent: {
        ...agentSummary,
        recentMessages: agent.messages.slice(-messageLimit),
        recentMessageCount: Math.min(agent.messages.length, messageLimit),
        totalMessageCount: agent.messages.length,
        totalLogCount: (agent.logs || []).length,
      },
      logs,
      actions: {
        refresh: `GET /api/agents/${agent.id}/operator-context?logLimit=${logLimit}&messageLimit=${messageLimit}`,
        logs: `GET /api/agents/${agent.id}/logs?limit=${logLimit}`,
        sendMessage: `POST /api/agents/${agent.id}/message { "text": "..." }`,
        interrupt: `POST /api/agents/${agent.id}/interrupt`,
        stop: `POST /api/agents/${agent.id}/stop`,
        approvePlan: `POST /api/agents/${agent.id}/plan/approve`,
        revisePlan: `POST /api/agents/${agent.id}/plan/revise`,
        answerQuestion: `POST /api/agents/${agent.id}/answer-question { "answers": { ... } }`,
      },
      interventionHints: {
        canSendMessage: agent.status === 'running' || agent.status === 'waiting_input',
        canInterrupt: agent.status === 'running',
        needsPlanDecision: !!agent.pendingPlan && !agent.pendingPlan.approvedAt,
        needsQuestionAnswer: !!agent.pendingQuestion && !agent.pendingQuestion.answeredAt,
      },
    };
  }

  private appendAgentLog(
    agentId: string,
    entry: Omit<AgentLogEntry, 'id' | 'timestamp'> & { timestamp?: number },
  ): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;
    const message = entry.message.length > MAX_AGENT_LOG_MESSAGE_CHARS
      ? `${entry.message.slice(0, MAX_AGENT_LOG_MESSAGE_CHARS)}\n...(truncated)`
      : entry.message;
    const nextEntry: AgentLogEntry = {
      ...entry,
      id: uuid(),
      timestamp: entry.timestamp || Date.now(),
      message,
      payload: this.sanitizeLogPayload(entry.payload),
    };
    agent.logs = [...(agent.logs || []), nextEntry].slice(-MAX_AGENT_LOG_ENTRIES);
    this.store.saveAgentDeferred(agent);
  }

  private sanitizeLogPayload(payload: unknown): unknown {
    if (payload === undefined) return undefined;
    try {
      const serialized = JSON.stringify(payload);
      if (serialized.length <= MAX_AGENT_LOG_PAYLOAD_CHARS) {
        return payload;
      }
      return `${serialized.slice(0, MAX_AGENT_LOG_PAYLOAD_CHARS)}\n...(truncated)`;
    } catch {
      return '[unserializable payload]';
    }
  }

  private resolveAgentAttachments(agent: Agent, attachments: AgentMessageAttachment[]): AgentMessageAttachment[] {
    const execDir = this.resolveExecutionDirectory(agent);
    const repoDir = normalizeUserPath(agent.config.directory);
    return resolveAttachmentPaths(attachments, execDir, repoDir !== execDir ? repoDir : undefined);
  }

  resolveExecutionDirectory(agent: Agent): string {
    const configuredDirectory = normalizeUserPath(agent.config.directory);
    if (agent.worktreePath && existsSync(agent.worktreePath)) {
      // The worktree is created at the git root level. If config.directory was
      // a subdirectory, resolve the corresponding path within the worktree.
      try {
        const gitRoot = execSync('git rev-parse --show-toplevel', {
          cwd: configuredDirectory,
          stdio: 'pipe',
        }).toString().trim();
        const subdir = path.relative(gitRoot, configuredDirectory);
        if (subdir && subdir !== '.' && !subdir.startsWith('..')) {
          const effectiveDir = path.join(agent.worktreePath, subdir);
          if (existsSync(effectiveDir)) {
            return effectiveDir;
          }
        }
      } catch {
        // Original directory gone or not a git repo — use worktree root
      }
      return agent.worktreePath;
    }

    if (agent.worktreePath) {
      console.warn(`[AgentManager] Worktree path is missing for ${agent.id}, falling back to configured directory: ${configuredDirectory}`);
      agent.worktreePath = undefined;
      agent.worktreeBranch = undefined;
    }

    return configuredDirectory;
  }

  private composeProcessPrompt(agent: Agent): string {
    const configuredInstructions = agent.config.providerInstructions?.trim();
    let prompt = [
      configuredInstructions ? `## AgentMonitor Provider Instructions\n\n${configuredInstructions}` : '',
      agent.config.prompt,
    ].filter(Boolean).join('\n\n');

    if (agent.workspaceMode === 'worktree') {
      prompt = [
        WORKTREE_MODE_INSTRUCTIONS,
        `Worktree branch: ${agent.worktreeBranch || '(unknown)'}`,
        `Original repository: ${agent.config.directory}`,
        `User request:\n${prompt}`,
      ].filter(Boolean).join('\n\n');
    }

    if (agent.config.skills?.length && this.skillManager) {
      const skillsRoot = this.skillManager.getSkillsDir();
      const availableSkills = agent.config.skills.map(name => {
        const skill = this.skillManager?.getSkill(name);
        return `- ${name}: ${skill?.description || name} (${path.join(skillsRoot, name, 'SKILL.md')})`;
      }).join('\n');
      prompt = `${prompt}\n\n## Available Skills\n\n${availableSkills}\n\nRead the corresponding SKILL.md before using a skill.`;
    }

    // Append structured output instruction if schema is provided
    if (agent.config.flags.outputSchema) {
      prompt += `\n\nIMPORTANT: When you have completed the task, output your final result as a JSON code block (wrapped in \`\`\`json ... \`\`\`) that conforms to this JSON Schema:\n${JSON.stringify(agent.config.flags.outputSchema, null, 2)}`;
    }

    prompt = this.wrapPlanModeMessage(agent, prompt);

    return prompt;
  }

  private isPlanMode(agent: Agent): boolean {
    return agent.interactionMode === 'plan';
  }

  private wrapPlanModeMessage(agent: Agent, text: string): string {
    if (!this.isPlanMode(agent)) return text;
    return `${PLAN_MODE_INSTRUCTIONS}\n\nUser request:\n${text}`;
  }

  private extractStructuredOutput(agent: Agent): void {
    if (!agent.config.flags.outputSchema) return;
    // Search last 10 assistant messages for a ```json code block
    const assistantMsgs = agent.messages
      .filter(m => m.role === 'assistant')
      .slice(-10);
    let rawJson: string | null = null;
    for (let i = assistantMsgs.length - 1; i >= 0; i--) {
      const match = assistantMsgs[i].content.match(/```json\s*\n([\s\S]*?)\n```/);
      if (match) { rawJson = match[1]; break; }
    }
    if (!rawJson) return;
    try {
      const parsed = JSON.parse(rawJson);
      // Lazy-load Ajv to avoid import at top level
      import('ajv').then(({ default: Ajv }) => {
        const ajv = new Ajv();
        const validate = ajv.compile(agent.config.flags.outputSchema!);
        if (validate(parsed)) {
          agent.structuredOutput = parsed;
        } else {
          agent.structuredOutput = { error: ajv.errorsText(validate.errors), raw: rawJson };
        }
        this.store.saveAgent(agent);
        this.emit('agent:update', agent.id, agent);
      }).catch(() => {
        // ajv not available, store raw
        agent.structuredOutput = parsed;
        this.store.saveAgent(agent);
        this.emit('agent:update', agent.id, agent);
      });
    } catch {
      agent.structuredOutput = { error: 'Invalid JSON', raw: rawJson };
      this.store.saveAgent(agent);
      this.emit('agent:update', agent.id, agent);
    }
  }

  private handleStreamMessage(agentId: string, msg: StreamMessage, provider: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;

    // Agent is responding — clear stuck detection timer
    this.pendingUserMessage.delete(agentId);

    const prevMsgCount = agent.messages.length;

    this.store.deferAgentWrites(() => {
      if (provider === 'codex') {
        this.handleCodexMessage(agent, msg);
      } else {
        this.handleClaudeMessage(agent, msg);
      }

      const newMessages = agent.messages.slice(prevMsgCount);
      this.capturePendingPlan(agent, newMessages);
    });

    // Emit raw message (kept for backward compat)
    this.emit('agent:message', agentId, msg);

    // Emit lightweight delta with only new messages + metadata (efficient for tunnel)
    const newMessages = agent.messages.slice(prevMsgCount);
    if (newMessages.length > 0) {
      this.emit('agent:delta', agentId, {
        messages: newMessages,
        status: agent.status,
        costUsd: agent.costUsd,
        tokenUsage: agent.tokenUsage,
        contextWindow: agent.contextWindow,
        lastActivity: agent.lastActivity,
        interactionMode: agent.interactionMode,
        pendingPlan: agent.pendingPlan,
        pendingQuestion: agent.pendingQuestion,
        currentBranch: agent.currentBranch,
      });
    }

    // Full snapshot for dashboard cards (less frequent)
    const updated = this.store.getAgent(agentId);
    if (updated) {
      this.emit('agent:update', agentId, updated);
    }
  }

  private capturePendingPlan(agent: Agent, messages: AgentMessage[]): void {
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      const plan = this.extractProposedPlan(message.content);
      if (!plan) continue;

      const userInitiated = agent.interactionMode === 'plan';
      agent.pendingPlan = {
        id: uuid(),
        content: plan,
        sourceMessageId: message.id,
        createdAt: Date.now(),
      };
      agent.interactionMode = 'plan';
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);

      if (!userInitiated && !this.isPlanComplex(plan)) {
        console.log(`[AgentManager] Auto-approving simple plan for agent ${agent.id}`);
        this.approvePlan(agent.id);
      }
    }
  }

  /**
   * Detect structured interactive tool calls (AskUserQuestion, ExitPlanMode) and
   * stash their tool_use_id + parsed input on the agent so the UI can render
   * approval / question controls and we can later send a `tool_result` back to
   * unblock Claude. Without this, Claude hangs forever waiting for a reply that
   * the chat UI's text input can't provide.
   */
  private captureInteractiveTool(
    agent: Agent,
    block: { type: string; name?: string; input?: unknown; id?: string },
    sourceMessageId: string,
  ): void {
    if (!block.id || !block.name) return;

    // When --dangerously-skip-permissions is active, Claude Code handles ALL
    // interactive tools internally (including AskUserQuestion / ExitPlanMode).
    // The tool_use in the stream is a LOG of what already happened — Claude
    // auto-answered and continued. Setting waiting_input here would be wrong
    // (agent keeps running) and sending a tool_result would inject an
    // unexpected duplicate response.
    if (agent.config.flags.dangerouslySkipPermissions) return;

    const input = block.input as Record<string, unknown> | undefined;

    if (block.name === 'AskUserQuestion') {
      const rawQuestions = Array.isArray(input?.questions) ? (input!.questions as unknown[]) : [];
      const questions: PendingQuestionItem[] = [];
      for (const q of rawQuestions) {
        if (!q || typeof q !== 'object') continue;
        const qo = q as Record<string, unknown>;
        const questionText = typeof qo.question === 'string' ? qo.question : '';
        if (!questionText) continue;
        const rawOpts = Array.isArray(qo.options) ? (qo.options as unknown[]) : [];
        const options: PendingQuestionOption[] = [];
        for (const opt of rawOpts) {
          if (!opt || typeof opt !== 'object') continue;
          const oo = opt as Record<string, unknown>;
          const label = typeof oo.label === 'string' ? oo.label : '';
          if (!label) continue;
          options.push({
            label,
            description: typeof oo.description === 'string' ? oo.description : undefined,
            preview: typeof oo.preview === 'string' ? oo.preview : undefined,
          });
        }
        if (options.length === 0) continue;
        questions.push({
          question: questionText,
          header: typeof qo.header === 'string' ? qo.header : undefined,
          multiSelect: qo.multiSelect === true,
          options,
        });
      }
      if (questions.length === 0) return;
      agent.pendingQuestion = {
        id: uuid(),
        toolUseId: block.id,
        questions,
        sourceMessageId,
        createdAt: Date.now(),
      };
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);
      this.updateAgentStatus(agent.id, 'waiting_input');
      return;
    }

    if (block.name === 'ExitPlanMode') {
      const plan = typeof input?.plan === 'string' ? (input!.plan as string) : '';
      if (!plan) return;
      const userInitiated = agent.interactionMode === 'plan';
      agent.pendingPlan = {
        id: uuid(),
        content: plan,
        sourceMessageId,
        createdAt: Date.now(),
        toolUseId: block.id,
      };
      agent.interactionMode = 'plan';
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);
      this.updateAgentStatus(agent.id, 'waiting_input');

      if (!userInitiated && !this.isPlanComplex(plan)) {
        console.log(`[AgentManager] Auto-approving simple plan for agent ${agent.id}`);
        this.approvePlan(agent.id);
      }
    }
  }

  private extractProposedPlan(text: string): string | undefined {
    const match = text.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
    return match?.[1]?.trim() || undefined;
  }

  private isPlanComplex(content: string): boolean {
    if (content.length > 2000) return true;
    const steps = content.match(/^\s*\d+[\.\)]/gm) || [];
    if (steps.length > 6) return true;
    const filePaths = content.match(/[\w./\-]+\.\w{1,5}/g) || [];
    const uniqueFiles = new Set(filePaths.filter(f => f.includes('/')));
    if (uniqueFiles.size > 5) return true;
    if (/\b(delet|remov|drop|reset\s+--hard|force.push|rm\s+-rf|migrat|breaking)/i.test(content)) return true;
    return false;
  }

  private handleClaudeMessage(agent: Agent, msg: StreamMessage): void {
    // With --verbose, assistant messages have: {type: "assistant", message: {content: [{type: "text", text: "..."}]}}
    if (msg.type === 'assistant') {
      const message = msg.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string; [key: string]: unknown }> } | undefined;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            agent.messages.push({
              id: uuid(),
              role: 'assistant',
              content: block.text,
              timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use') {
            const inputStr = block.input ? (typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)) : '';
            const toolMessageId = uuid();
            agent.messages.push({
              id: toolMessageId,
              role: 'tool',
              content: `Using tool: ${block.name || 'unknown'}`,
              toolName: block.name || 'unknown',
              toolInput: inputStr.length > 50000 ? inputStr.slice(0, 50000) + '\n...(truncated)' : inputStr,
              timestamp: Date.now(),
            });
            this.captureInteractiveTool(agent, block, toolMessageId);
          } else {
            const attachments = this.resolveAgentAttachments(agent, extractImageAttachments(block));
            if (attachments.length > 0) {
              agent.messages.push({
                id: uuid(),
                role: 'assistant',
                content: '',
                attachments,
                timestamp: Date.now(),
              });
            }
          }
        }
        agent.lastActivity = Date.now();
        this.store.saveAgent(agent);
      }

      // Legacy format fallback (subtype-based)
      if (msg.subtype === 'text' && msg.text) {
        agent.messages.push({
          id: uuid(),
          role: 'assistant',
          content: msg.text,
          timestamp: Date.now(),
        });
        agent.lastActivity = Date.now();
        this.store.saveAgent(agent);
      }
      if (msg.subtype === 'tool_use') {
        agent.messages.push({
          id: uuid(),
          role: 'tool',
          content: `Using tool: ${msg.tool_name || 'unknown'}`,
          timestamp: Date.now(),
        });
        agent.lastActivity = Date.now();
        this.store.saveAgent(agent);
      }
    }

    // Capture tool results from 'user' type messages (Claude sends tool results as user messages)
    if (msg.type === 'user') {
      const userMessage = msg.message as { content?: Array<{ type: string; content?: unknown; tool_use_id?: string }> } | undefined;
      const toolResult = msg.tool_use_result as { stdout?: string; stderr?: string } | undefined;
      if (userMessage?.content) {
        for (const block of userMessage.content) {
          if (block.type === 'tool_result') {
            let resultText = '';
            if (toolResult?.stdout) resultText = toolResult.stdout;
            else if (typeof block.content === 'string') resultText = block.content;
            const attachments = this.resolveAgentAttachments(agent, extractImageAttachments([block.content, msg.tool_use_result]));
            if (resultText || attachments.length > 0) {
              // Attach result to the most recent matching tool message.
              const lastToolMsg = [...agent.messages].reverse().find(m => m.role === 'tool' && (!m.toolResult || attachments.length > 0));
              if (lastToolMsg) {
                lastToolMsg.toolResult = resultText.length > 10000 ? resultText.slice(0, 10000) + '\n...(truncated)' : resultText;
                if (attachments.length > 0) lastToolMsg.attachments = attachments;
                if (toolResult?.stderr) {
                  lastToolMsg.toolResult += '\n[stderr] ' + toolResult.stderr;
                }
                this.store.saveAgent(agent);
              }
            }
          }
        }
      }
    }

    // Track context window usage from system messages
    const anyMsg = msg as Record<string, unknown>;
    if (anyMsg.num_turns !== undefined || anyMsg.session_id !== undefined) {
      // Claude verbose stream includes context info and session_id
      if (anyMsg.session_id && typeof anyMsg.session_id === 'string') {
        agent.sessionId = anyMsg.session_id;
      }
      const contextUsed = (anyMsg.input_tokens_used as number) || 0;
      const contextTotal = (anyMsg.max_input_tokens as number) || 200000;
      if (contextUsed > 0) {
        agent.contextWindow = { used: contextUsed, total: contextTotal };
        this.store.saveAgent(agent);
      }
    }

    // Extract PR URLs from assistant messages
    if (msg.type === 'assistant') {
      const message = msg.message as { content?: Array<{ type: string; text?: string }> } | undefined;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            const prUrl = this.extractPrUrl(block.text);
            if (prUrl && !agent.prUrl) {
              agent.prUrl = prUrl;
              this.store.saveAgent(agent);
            }
          }
        }
      }
      if (msg.text) {
        const prUrl = this.extractPrUrl(msg.text);
        if (prUrl && !agent.prUrl) {
          agent.prUrl = prUrl;
          this.store.saveAgent(agent);
        }
      }
    }

    if (msg.type === 'result') {
      const cost = this.calculateClaudeCost(msg, agent.config.flags.model);
      if (cost !== undefined) {
        agent.costUsd = (agent.costUsd || 0) + cost;
      }

      // Store session ID for resume capability
      const resultAny = msg as Record<string, unknown>;
      const sessionId = msg.result?.session_id || (resultAny.session_id as string);
      if (sessionId) {
        agent.sessionId = sessionId;
      }

      // Extract context window from result
      const resultMsg = msg as Record<string, unknown>;
      const inputTokens = (resultMsg.total_input_tokens as number) || (resultMsg.input_tokens_used as number);
      const maxTokens = (resultMsg.max_input_tokens as number) || 200000;
      if (inputTokens) {
        agent.contextWindow = { used: inputTokens, total: maxTokens };
      }

      // Handle error results (e.g. "No conversation found" when resuming expired session)
      const isError = (resultAny.is_error as boolean) || msg.result?.is_error;
      if (isError) {
        agent.runOutcome = 'failed';
        const errors = (resultAny.errors as string[]) || [];
        const errText = errors.join('; ') || 'Claude returned an error result';

        // ede_diagnostic with stop_reason=end_turn is a benign CLI diagnostic
        // (e.g. ExitPlanMode ending a turn with no content), not a real error.
        const isDiagnostic = errors.every(e => /\bede_diagnostic\b/.test(e) && /\bstop_reason=end_turn\b/.test(e));
        if (isDiagnostic) {
          this.appendAgentLog(agent.id, { level: 'warn', source: 'stderr', stream: 'stderr', message: errText });
          this.store.saveAgent(agent);
          this.updateAgentStatus(agent.id, 'stopped');
        } else {
          agent.messages.push({
            id: uuid(),
            role: 'system',
            content: `[Error] ${errText}`,
            timestamp: Date.now(),
          });
          // If session not found, clear the saved sessionId so next resume starts fresh
          if (errors.some(e => e.includes('No conversation found'))) {
            agent.sessionId = undefined;
            delete agent.config.flags.resume;
          }
          this.store.saveAgent(agent);
          this.updateAgentStatus(agent.id, 'error');
        }
      } else {
        agent.runOutcome = 'succeeded';
        this.addCompactTokenNotice(agent);
        this.updateAgentStatus(agent.id, 'stopped');
      }

      // In interactive stdin mode, Claude waits for more input after result;
      // kill the process so the agent is truly stopped.
      const proc = this.processes.get(agent.id);
      if (proc) {
        proc.stop();
      }
    }

    if (this.isClaudePermissionPrompt(msg)) {
      this.handleWaitingInput(agent, msg);
    }
  }

  private calculateClaudeCost(msg: StreamMessage, configuredModel?: string): number | undefined {
    const usage = this.extractClaudeUsage(msg);
    if (usage) {
      const price = this.getClaudeModelPrice(this.extractClaudeModel(msg, configuredModel));
      return (
        usage.inputTokens * price.input +
        usage.outputTokens * price.output +
        usage.cacheWrite5mTokens * price.cacheWrite5m +
        usage.cacheWrite1hTokens * price.cacheWrite1h +
        usage.cacheReadTokens * price.cacheRead
      ) / 1_000_000;
    }

    const topLevelCost = (msg as { total_cost_usd?: unknown }).total_cost_usd;
    const nestedCost = msg.result?.cost_usd;
    const cost = typeof topLevelCost === 'number' ? topLevelCost : nestedCost;
    return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
      ? cost
      : undefined;
  }

  private extractClaudeUsage(msg: StreamMessage): ClaudeUsageCounts | undefined {
    const anyMsg = msg as Record<string, unknown>;
    const result = typeof anyMsg.result === 'object' && anyMsg.result !== null
      ? anyMsg.result as Record<string, unknown>
      : undefined;
    const message = typeof anyMsg.message === 'object' && anyMsg.message !== null
      ? anyMsg.message as Record<string, unknown>
      : undefined;
    const usage = this.asRecord(anyMsg.usage) || this.asRecord(result?.usage) || this.asRecord(message?.usage) || anyMsg;
    const cacheCreation = this.asRecord(usage.cache_creation);

    const inputTokens = this.numberField(usage, 'input_tokens', 'total_input_tokens');
    const outputTokens = this.numberField(usage, 'output_tokens');
    const cacheReadTokens = this.numberField(usage, 'cache_read_input_tokens', 'cached_input_tokens');
    const cacheWrite5mTokens = this.numberField(usage, 'cache_creation_input_tokens') +
      this.numberField(cacheCreation, 'ephemeral_5m_input_tokens');
    const cacheWrite1hTokens = this.numberField(cacheCreation, 'ephemeral_1h_input_tokens');

    if (inputTokens + outputTokens + cacheReadTokens + cacheWrite5mTokens + cacheWrite1hTokens <= 0) {
      return undefined;
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWrite5mTokens,
      cacheWrite1hTokens,
    };
  }

  private extractClaudeModel(msg: StreamMessage, configuredModel?: string): string | undefined {
    const anyMsg = msg as Record<string, unknown>;
    const message = this.asRecord(anyMsg.message);
    const result = this.asRecord(anyMsg.result);
    return this.stringField(anyMsg, 'model') ||
      this.stringField(message, 'model') ||
      this.stringField(result, 'model') ||
      configuredModel;
  }

  private getClaudeModelPrice(model?: string): ClaudeModelPrice {
    const normalized = (model || 'sonnet').toLowerCase();

    if (normalized === 'opus') return CLAUDE_PRICES_PER_MTOK.opus47;
    if (normalized === 'sonnet' || normalized === 'sonnet[1m]') return CLAUDE_PRICES_PER_MTOK.sonnet46;
    if (normalized === 'haiku') return CLAUDE_PRICES_PER_MTOK.haiku45;
    if (normalized === 'opusplan') return CLAUDE_PRICES_PER_MTOK.sonnet46;

    if (normalized.includes('opus-4-7') || normalized.includes('opus-4.7')) return CLAUDE_PRICES_PER_MTOK.opus47;
    if (normalized.includes('opus-4-6') || normalized.includes('opus-4.6')) return CLAUDE_PRICES_PER_MTOK.opus46;
    if (normalized.includes('opus-4-5') || normalized.includes('opus-4.5')) return CLAUDE_PRICES_PER_MTOK.opus45;
    if (normalized.includes('opus-4-1') || normalized.includes('opus-4.1')) return CLAUDE_PRICES_PER_MTOK.opus41;
    if (normalized.includes('opus-4')) return CLAUDE_PRICES_PER_MTOK.opus4;
    if (normalized.includes('sonnet-4-6') || normalized.includes('sonnet-4.6')) return CLAUDE_PRICES_PER_MTOK.sonnet46;
    if (normalized.includes('sonnet-4-5') || normalized.includes('sonnet-4.5')) return CLAUDE_PRICES_PER_MTOK.sonnet45;
    if (normalized.includes('sonnet-4')) return CLAUDE_PRICES_PER_MTOK.sonnet4;
    if (normalized.includes('haiku-4-5') || normalized.includes('haiku-4.5')) return CLAUDE_PRICES_PER_MTOK.haiku45;
    if (normalized.includes('haiku-3-5') || normalized.includes('haiku-3.5')) return CLAUDE_PRICES_PER_MTOK.haiku35;
    if (normalized.includes('haiku-3')) return CLAUDE_PRICES_PER_MTOK.haiku3;

    return CLAUDE_PRICES_PER_MTOK.sonnet46;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
  }

  private numberField(source: Record<string, unknown> | undefined, ...keys: string[]): number {
    if (!source) return 0;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  private stringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = source?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private handleCodexMessage(agent: Agent, msg: StreamMessage): void {
    // Extract thread_id as sessionId for Codex
    if (msg.thread_id && typeof msg.thread_id === 'string' && !agent.sessionId) {
      agent.sessionId = msg.thread_id;
      this.store.saveAgent(agent);
    }

    // Codex JSONL events: thread.started, turn.started, item.started, item.completed, turn.completed
    if (msg.type === 'item.completed' && msg.item) {
      const item = msg.item as Record<string, unknown>;
      const attachments = this.resolveAgentAttachments(agent, extractImageAttachments(item.result ?? item.output ?? item));
      if (msg.item.type === 'agent_message') {
        agent.messages.push({
          id: uuid(),
          role: 'assistant',
          content: msg.item.text || '',
          attachments: attachments.length > 0 ? attachments : undefined,
          timestamp: Date.now(),
        });
        agent.lastActivity = Date.now();
        this.store.saveAgent(agent);
      } else if (msg.item.type === 'command_execution' || msg.item.type === 'tool_call' || msg.item.type === 'function_call' || msg.item.type === 'mcp_tool_call' || msg.item.type === 'image_generation_call' || attachments.length > 0) {
        const item = msg.item as { type?: string; command?: string; aggregated_output?: string; exit_code?: number; text?: string };
        const toolSummary = item.command
          ? `Command: ${item.command}`
          : `Tool: ${item.text || JSON.stringify(msg.item)}`;
        const toolResultParts: string[] = [];
        if (item.aggregated_output) {
          toolResultParts.push(item.aggregated_output);
        }
        if (item.exit_code !== undefined) {
          toolResultParts.push(`[exit code] ${item.exit_code}`);
        }
        agent.messages.push({
          id: uuid(),
          role: 'tool',
          content: toolSummary,
          toolName: item.command ? 'command' : (item.type || 'tool'),
          toolInput: item.command || item.text || undefined,
          toolResult: toolResultParts.length > 0 ? toolResultParts.join('\n') : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
          timestamp: Date.now(),
        });
        agent.lastActivity = Date.now();
        this.store.saveAgent(agent);
      } else if (msg.item.type === 'reasoning') {
        agent.messages.push({
          id: uuid(),
          role: 'system',
          content: msg.item.text || '',
          timestamp: Date.now(),
        });
        agent.lastActivity = Date.now();
        this.store.saveAgent(agent);
      }
    }

    if (msg.type === 'turn.completed') {
      if (msg.usage) {
        agent.tokenUsage = {
          input: (agent.tokenUsage?.input || 0) + (msg.usage.input_tokens || 0),
          output: (agent.tokenUsage?.output || 0) + (msg.usage.output_tokens || 0),
        };
        this.addCompactTokenNotice(agent);
        this.store.saveAgent(agent);
      }
    }
  }

  private addCompactTokenNotice(agent: Agent): void {
    const latestCompactIndex = [...agent.messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === 'user' && this.isCompactCommand(message.content))
      ?.index;

    if (latestCompactIndex === undefined) return;
    const alreadyNotified = agent.messages
      .slice(latestCompactIndex + 1)
      .some((message) => message.role === 'system' && message.content.startsWith('[Compact]'));
    if (alreadyNotified) return;

    agent.messages.push({
      id: uuid(),
      role: 'system',
      content: this.formatCompactTokenNotice(agent),
      timestamp: Date.now(),
    });
    agent.lastActivity = Date.now();
    this.store.saveAgentDeferred(agent);
  }

  private isCompactCommand(text: string): boolean {
    return text.trim().toLowerCase().startsWith('/compact');
  }

  private formatCompactTokenNotice(agent: Agent): string {
    const context = agent.contextWindow;
    const usage = agent.tokenUsage;

    if (context?.total) {
      const used = Math.max(0, Math.min(context.total, context.used));
      const pct = Math.round((used / context.total) * 100);
      const lines = [
        `[Compact] Context after compact: ${used.toLocaleString()} / ${context.total.toLocaleString()} tokens (${pct}%).`,
      ];
      if (usage) {
        lines.push(`Cumulative usage: input ${usage.input.toLocaleString()} / output ${usage.output.toLocaleString()} / total ${(usage.input + usage.output).toLocaleString()} tokens.`);
      }
      return lines.join('\n');
    }

    if (usage) {
      return `[Compact] Token usage after compact: input ${usage.input.toLocaleString()} / output ${usage.output.toLocaleString()} / total ${(usage.input + usage.output).toLocaleString()} tokens.`;
    }

    return '[Compact] Token usage after compact is not available yet.';
  }

  private findSessionCwd(provider: Agent['config']['provider'], sessionId: string, _projectDir: string): string | undefined {
    if (provider === 'codex') {
      return this.findCodexSessionCwd(sessionId);
    }

    try {
      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
      if (!existsSync(claudeProjectsDir)) return undefined;

      // Search all project subdirs for the session file
      let projectDirs: string[];
      try { projectDirs = readdirSync(claudeProjectsDir); } catch { return undefined; }

      for (const projectSubdir of projectDirs) {
        const sessionFile = path.join(claudeProjectsDir, projectSubdir, `${sessionId}.jsonl`);
        if (!existsSync(sessionFile)) continue;

        // Read the file to find a cwd field
        const content = readFileSync(sessionFile, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            if (entry.cwd && typeof entry.cwd === 'string') {
              return entry.cwd;
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (err) {
      console.warn('[AgentManager] findSessionCwd error:', err);
    }
    return undefined;
  }

  private findCodexSessionCwd(sessionId: string): string | undefined {
    try {
      const sessionPath = this.findCodexSessionPath(sessionId);
      if (!sessionPath || !existsSync(sessionPath)) return undefined;

      const content = readFileSync(sessionPath, 'utf-8');
      const firstLine = content.split('\n').find((line) => line.trim());
      if (!firstLine) return undefined;

      const entry = JSON.parse(firstLine) as {
        type?: string;
        payload?: { cwd?: string };
      };

      if (entry.type === 'session_meta' && typeof entry.payload?.cwd === 'string') {
        return entry.payload.cwd;
      }
    } catch (err) {
      console.warn('[AgentManager] findCodexSessionCwd error:', err);
    }
    return undefined;
  }

  private parseMcpServers(mcpConfigPath?: string): string[] {
    if (!mcpConfigPath) return [];
    try {
      const content = readFileSync(mcpConfigPath, 'utf-8');
      const config = JSON.parse(content);
      // MCP config has { mcpServers: { "name": { ... } } } format
      const servers = config.mcpServers || config;
      return Object.keys(servers);
    } catch {
      return [];
    }
  }

  private extractPrUrl(text: string): string | undefined {
    // Match GitHub/GitLab PR URLs
    const prPattern = /https?:\/\/(?:github\.com|gitlab\.com)\/[^\s]+\/pull\/\d+/;
    const match = text.match(prPattern);
    return match?.[0];
  }

  private getMsgText(msg: StreamMessage): string {
    if (msg.text) return msg.text as string;
    if (msg.item?.text) return msg.item.text;
    // Extract from stream-json message.content blocks
    const message = msg.message as { content?: Array<{ type: string; text?: string }> } | undefined;
    if (message?.content) {
      return message.content
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text!)
        .join('\n');
    }
    return '';
  }

  private isClaudePermissionPrompt(msg: StreamMessage): boolean {
    if (msg.type === 'assistant' && msg.subtype === 'permission') return true;
    const text = this.getMsgText(msg).toLowerCase();
    return text.includes('permission') && text.includes('allow');
  }

  private extractInputPrompt(msg: StreamMessage): { prompt: string; choices?: string[] } {
    const text = this.getMsgText(msg) || msg.item?.text || '';
    const choices: string[] = [];

    // Claude permission prompts typically offer Yes/No/Always
    if (msg.subtype === 'permission' || (text.toLowerCase().includes('permission') && text.toLowerCase().includes('allow'))) {
      choices.push('Yes', 'No', 'Always allow');
    }

    // Detect numbered choices only at the END of the text.
    // Real choice prompts put short options at the end; numbered steps in explanations are NOT choices.
    if (choices.length === 0) {
      const lines = text.split('\n');
      // Walk backwards from the end to find a contiguous block of numbered lines
      const numberedLines: string[] = [];
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/^\s*(\d+)[.)]\s+(.+)$/);
        if (m) {
          numberedLines.unshift(m[2].trim());
        } else if (lines[i].trim() === '') {
          // skip trailing blank lines
          if (numberedLines.length > 0) break;
        } else {
          break;
        }
      }
      // Only treat as choices if: 2-8 items, each item is short (< 60 chars)
      if (numberedLines.length >= 2 && numberedLines.length <= 8 &&
          numberedLines.every(c => c.length < 60)) {
        choices.push(...numberedLines);
      }
    }

    // Detect (y/n) style prompts
    if (/\(y\/n\)/i.test(text)) {
      if (choices.length === 0) choices.push('Yes', 'No');
    }

    return { prompt: text, choices: choices.length > 0 ? choices : undefined };
  }

  private handleWaitingInput(agent: Agent, msg: StreamMessage): void {
    this.updateAgentStatus(agent.id, 'waiting_input');

    // Extract prompt and choices for the web UI
    const inputInfo = this.extractInputPrompt(msg);
    this.emit('agent:input_required', agent.id, inputInfo);

    const notificationMessage = `Agent is waiting for permission/input.\nLast message: ${msg.text || msg.item?.text || JSON.stringify(msg)}`;
    if (agent.config.adminEmail) {
      this.emailNotifier.notifyHumanNeeded(
        agent.config.adminEmail,
        agent.name,
        notificationMessage,
      );
    }
    if (agent.config.whatsappPhone) {
      this.whatsappNotifier.notifyHumanNeeded(
        agent.config.whatsappPhone,
        agent.name,
        notificationMessage,
      );
    }
    if (agent.config.slackWebhookUrl) {
      this.slackNotifier.notifyHumanNeeded(
        agent.name,
        notificationMessage,
        agent.config.slackWebhookUrl,
      );
    }
    if (agent.config.feishuChatId) {
      this.feishuNotifier.notifyHumanNeeded(
        agent.config.feishuChatId,
        agent,
        inputInfo.choices,
      );
    }
  }

  private updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.store.getAgent(agentId);
    if (agent) {
      agent.status = status;
      agent.lastActivity = Date.now();
      if (status === 'stopped' && agent.worktreeBranch) {
        try { this.refreshAgentGitState(agent); } catch { /* workspace may have disappeared */ }
      }
      this.store.saveAgent(agent);
      this.emit('agent:status', agentId, status);
      this.emit('agent:update', agentId, agent);
    }
  }

  renameAgent(agentId: string, newName: string): void {
    const agent = this.store.getAgent(agentId);
    if (agent) {
      agent.name = newName;
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);
      this.emit('agent:status', agentId, agent.status);
    }
  }

  updateReasoningEffort(agentId: string, reasoningEffort?: ReasoningEffort): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;

    if (reasoningEffort) {
      agent.config.flags.reasoningEffort = reasoningEffort;
    } else {
      delete agent.config.flags.reasoningEffort;
    }

    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);
    return agent;
  }

  updateInteractionMode(agentId: string, mode: AgentInteractionMode): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;

    agent.interactionMode = mode;
    agent.lastActivity = Date.now();
    if (mode === 'default' && agent.pendingPlan && !agent.pendingPlan.approvedAt) {
      delete agent.pendingPlan;
    }
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);
    return agent;
  }

  approvePlan(agentId: string): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent || !agent.pendingPlan) return agent;
    this.appendAgentLog(agentId, {
      level: 'info',
      source: 'operator',
      message: 'Approved pending plan',
      payload: { pendingPlanId: agent.pendingPlan.id },
    });

    agent.pendingPlan.approvedAt = Date.now();
    agent.interactionMode = 'default';
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);

    // If the pending plan came from an ExitPlanMode tool_use, Claude is blocked
    // waiting for a tool_result with that exact tool_use_id — sending plain text
    // would not unblock it. Otherwise (legacy <proposed_plan> text protocol),
    // fall back to the regular message channel.
    const toolUseId = agent.pendingPlan.toolUseId;
    const proc = this.processes.get(agentId);
    if (toolUseId && proc) {
      proc.sendToolResult(toolUseId, PLAN_APPROVAL_MESSAGE);
      this.updateAgentStatus(agentId, 'running');
      this.pendingUserMessage.set(agentId, Date.now());
      this.emit('agent:message', agentId, { type: 'user', text: PLAN_APPROVAL_MESSAGE });
    } else {
      this.sendMessage(agentId, PLAN_APPROVAL_MESSAGE);
    }
    return this.store.getAgent(agentId);
  }

  /**
   * Reply to a pending AskUserQuestion tool call.
   * `answers` maps each question text to the chosen option label
   * (or comma-joined labels for multi-select).
   */
  answerQuestion(agentId: string, answers: Record<string, string>): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent || !agent.pendingQuestion) return agent;
    this.appendAgentLog(agentId, {
      level: 'info',
      source: 'operator',
      message: 'Answered pending question',
      payload: { pendingQuestionId: agent.pendingQuestion.id, answers },
    });

    const pending = agent.pendingQuestion;
    const proc = this.processes.get(agentId);
    if (!proc) {
      // Agent crashed/restarted while waiting — nothing to reply to. Just clear.
      delete agent.pendingQuestion;
      this.store.saveAgent(agent);
      this.emit('agent:update', agentId, agent);
      return agent;
    }

    // Build the tool_result content as a structured JSON payload Claude can read.
    const payload = {
      answers: pending.questions.map((q) => ({
        question: q.question,
        answer: answers[q.question] ?? '',
      })),
    };
    proc.sendToolResult(pending.toolUseId, JSON.stringify(payload));

    // Surface the user's choices in the chat history so it's not invisible.
    const summary = pending.questions
      .map((q) => `${q.header || q.question}: ${answers[q.question] ?? ''}`)
      .join('\n');
    agent.messages.push({
      id: uuid(),
      role: 'user',
      content: summary,
      timestamp: Date.now(),
    });

    pending.answeredAt = Date.now();
    delete agent.pendingQuestion;
    agent.lastActivity = Date.now();
    this.store.saveAgent(agent);
    this.updateAgentStatus(agentId, 'running');
    this.pendingUserMessage.set(agentId, Date.now());
    this.emit('agent:update', agentId, agent);
    this.emit('agent:message', agentId, { type: 'user', text: summary });
    return agent;
  }

  revisePlan(agentId: string): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;
    this.appendAgentLog(agentId, {
      level: 'info',
      source: 'operator',
      message: 'Requested plan revision',
      payload: { pendingPlanId: agent.pendingPlan?.id },
    });

    // If the plan came from an ExitPlanMode tool_use, Claude is blocked waiting
    // for a tool_result. Reject the plan so it knows to revise instead of hang.
    const pending = agent.pendingPlan;
    const proc = this.processes.get(agentId);
    if (pending && !pending.approvedAt && pending.toolUseId && proc) {
      proc.sendToolResult(
        pending.toolUseId,
        'User rejected the plan. Continue exploring/asking and propose a revised plan.',
      );
      this.updateAgentStatus(agentId, 'running');
      this.pendingUserMessage.set(agentId, Date.now());
    }

    agent.interactionMode = 'plan';
    if (agent.pendingPlan && !agent.pendingPlan.approvedAt) {
      delete agent.pendingPlan;
    }
    agent.lastActivity = Date.now();
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);
    return agent;
  }

  sendMessage(agentId: string, text: string, queueMessageId?: string): { disposition: 'started' | 'queued'; queuedMessage?: AgentQueuedMessage } | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;
    const processText = this.wrapPlanModeMessage(agent, text);

    const proc = this.processes.get(agentId);
    if (!proc && agent.queuePaused && agent.queuedMessages?.length) {
      const queuedMessage = this.enqueueUserMessage(agent, text, queueMessageId);
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);
      this.emit('agent:update', agentId, agent);
      return { disposition: 'queued', queuedMessage };
    }
    if (proc && agent.status !== 'waiting_input') {
      // Agent is running — queue the message for later. Don't add to message
      // history yet so it doesn't appear mid-conversation (matches TUI /btw).
      const queuedMessage = this.enqueueUserMessage(agent, text, queueMessageId);
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);
      this.emit('agent:update', agentId, agent);
      return { disposition: 'queued', queuedMessage };
    }

    if (proc && agent.config.provider === 'codex') {
      // Codex exec is turn-based: stdin is closed after startup. Keep the
      // message queued until the current process exits, then resume it once.
      const queuedMessage = this.enqueueUserMessage(agent, text, queueMessageId);
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);
      this.emit('agent:update', agentId, agent);
      proc.stop();
      return { disposition: 'queued', queuedMessage };
    }

    // Message will be sent immediately — add to history now.
    this.addUserMessageToHistory(agent, text);

    if (proc) {
      // status === 'waiting_input' with a live process
      this.updateAgentStatus(agentId, 'running');
      this.pendingUserMessage.set(agentId, Date.now());
      proc.sendMessage(processText);
      this.emit('agent:message', agentId, { type: 'user', text });
    } else if (agent.status === 'waiting_input') {
      agent.originalPrompt = text;
      this.resumeAgent(agent, processText);
    } else if (agent.status === 'stopped' || agent.status === 'error') {
      this.resumeAgent(agent, processText);
    }
    return { disposition: 'started' };
  }

  integrateAndDeleteAgent(agentId: string, text: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error('Agent not found');
    if (agent.workspaceMode !== 'worktree' || !agent.worktreePath || !agent.worktreeBranch || !agent.baseBranch) {
      throw new Error('Only an isolated Worktree Agent can be integrated and deleted');
    }
    if (agent.status === 'running' || agent.status === 'waiting_input' || this.processes.has(agentId)) {
      throw new Error('Stop the Agent before integrating and deleting it');
    }
    if (agent.queuedMessages?.length) {
      throw new Error('Remove or finish queued messages before integrating and deleting the Agent');
    }
    agent.pendingIntegrationCleanup = true;
    this.store.saveAgent(agent);
    const result = this.sendMessage(agentId, text);
    if (!result || result.disposition !== 'started') {
      agent.pendingIntegrationCleanup = false;
      this.store.saveAgent(agent);
      throw new Error('Could not start the integration task');
    }
  }

  private async finalizeIntegrationCleanup(agentId: string): Promise<boolean> {
    const agent = this.store.getAgent(agentId);
    if (!agent?.pendingIntegrationCleanup) return false;

    const fail = (reason: string): void => {
      const current = this.store.getAgent(agentId);
      if (!current) return;
      current.pendingIntegrationCleanup = false;
      current.messages.push({
        id: uuid(),
        role: 'system',
        content: `[Integration cleanup not completed] ${reason}`,
        timestamp: Date.now(),
      });
      current.lastActivity = Date.now();
      this.store.saveAgent(current);
      this.emit('agent:update', agentId, current);
    };

    if (agent.runOutcome !== 'succeeded') {
      fail('The Agent did not finish the integration task successfully. The Agent and Worktree were kept.');
      return false;
    }
    if (agent.queuedMessages?.length) {
      fail('New messages were queued while integration was running. The Agent and Worktree were kept, and the queue will continue.');
      return false;
    }
    const { worktreePath, worktreeBranch, baseBranch } = agent;
    if (!worktreePath || !worktreeBranch || !baseBranch) {
      fail('The Agent no longer has complete Worktree integration metadata. The Agent record was kept.');
      return false;
    }

    try {
      const worktreeStatus = execFileSync('git', ['status', '--porcelain'], {
        cwd: worktreePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim();
      if (worktreeStatus) {
        fail('The Worktree still has uncommitted changes. The Agent and Worktree were kept.');
        return false;
      }

      const originalDirectory = normalizeUserPath(agent.config.directory);
      execFileSync('git', ['merge-base', '--is-ancestor', worktreeBranch, baseBranch], {
        cwd: originalDirectory,
        stdio: 'ignore',
        timeout: 5000,
      });
      const upstream = execFileSync('git', ['rev-parse', '--abbrev-ref', `${baseBranch}@{upstream}`], {
        cwd: originalDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim();
      const baseCommit = execFileSync('git', ['rev-parse', baseBranch], {
        cwd: originalDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim();
      const upstreamCommit = execFileSync('git', ['rev-parse', upstream], {
        cwd: originalDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim();
      if (baseCommit !== upstreamCommit) {
        fail(`Original branch "${baseBranch}" is not synchronized with "${upstream}". The Agent and Worktree were kept.`);
        return false;
      }

      agent.pendingIntegrationCleanup = false;
      this.store.saveAgent(agent);
      await this.deleteAgent(agentId);
      return true;
    } catch (err) {
      fail(`Git verification failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private addUserMessageToHistory(agent: Agent, text: string): void {
    if (agent.preRestoreSnapshot) {
      if (agent.preRestoreSnapshot.jsonlBackupPath) {
        try { unlinkSync(agent.preRestoreSnapshot.jsonlBackupPath); } catch { /* ok */ }
      }
      delete agent.preRestoreSnapshot;
    }
    agent.runOutcome = undefined;
    const turnIndex = agent.messages.filter(m => m.role === 'user').length;
    this.takeCodeSnapshot(agent, turnIndex);
    agent.messages.push({
      id: uuid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
    this.appendAgentLog(agent.id, {
      level: 'info',
      source: 'operator',
      message: text,
      payload: { action: 'sendMessage' },
    });
    agent.lastActivity = Date.now();
    this.store.saveAgent(agent);
    this.emit('agent:update', agent.id, agent);
  }

  private enqueueUserMessage(agent: Agent, text: string, messageId?: string): AgentQueuedMessage {
    const queuedMessage: AgentQueuedMessage = {
      id: messageId || uuid(),
      text,
      createdAt: Date.now(),
      interactionMode: agent.interactionMode,
    };
    agent.queuedMessages = [...(agent.queuedMessages || []), queuedMessage];
    return queuedMessage;
  }

  private startNextQueuedMessage(agentId: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent || agent.status === 'error' || agent.queuePaused || !agent.queuedMessages?.length) return;
    const next = agent.queuedMessages[0];
    agent.queuedMessages = agent.queuedMessages.slice(1);
    agent.queuePaused = false;
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);

    this.addUserMessageToHistory(agent, next.text);
    this.pendingUserMessage.set(agentId, Date.now());
    const processText = next.interactionMode === 'plan'
      ? `${PLAN_MODE_INSTRUCTIONS}\n\nUser request:\n${next.text}`
      : next.text;
    this.resumeAgent(agent, processText);
  }

  cancelQueuedMessage(agentId: string, messageId: string): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;
    const queued = agent.queuedMessages || [];
    if (!queued.some(message => message.id === messageId)) return agent;
    agent.queuedMessages = queued.filter(message => message.id !== messageId);
    if (agent.queuedMessages.length === 0) agent.queuePaused = false;
    agent.lastActivity = Date.now();
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);
    return agent;
  }

  resumeQueuedMessages(agentId: string): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;
    if (!agent.queuedMessages?.length) {
      agent.queuePaused = false;
      this.store.saveAgent(agent);
      return agent;
    }
    if (this.processes.has(agentId)) return agent;
    agent.queuePaused = false;
    if (agent.status === 'error') agent.status = 'stopped';
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);
    this.startNextQueuedMessage(agentId);
    return this.store.getAgent(agentId);
  }

  private resumeAgent(agent: Agent, newPrompt: string): void {
    console.log(`[AgentManager] Resuming agent ${agent.id} (session: ${agent.sessionId || 'none'})`);

    // If a restored conversation seed exists, prepend it so the fresh session
    // has prior context. One-time use — clear after injection.
    if (agent.restoredConversationSeed) {
      newPrompt = `Here is the previous conversation context:\n\n${agent.restoredConversationSeed}\n\n---\n\nNow continue with this new message:\n\n${newPrompt}`;
      delete agent.restoredConversationSeed;
    }

    // Update the prompt to the new one
    agent.config.prompt = newPrompt;
    agent.currentTask = newPrompt.length > 120 ? newPrompt.slice(0, 120) + '...' : newPrompt;

    // If we have a session ID, use the provider's resume flow to continue the conversation.
    if (agent.sessionId) {
      agent.config.flags.resume = agent.sessionId;
    }

    this.updateAgentStatus(agent.id, 'running');
    this.startProcess(agent);
  }

  interruptAgent(agentId: string): void {
    const proc = this.processes.get(agentId);
    if (proc) {
      this.appendAgentLog(agentId, {
        level: 'warn',
        source: 'operator',
        message: 'Interrupted agent process',
      });
      proc.interrupt();
      // After SIGINT, Claude Code stops the current task and waits for the
      // next user message.  Transition to waiting_input so the dashboard
      // reflects the interrupted state instead of staying at "running".
      const agent = this.store.getAgent(agentId);
      if (agent && agent.status === 'running') {
        agent.runOutcome = 'interrupted';
        this.updateAgentStatus(agentId, 'waiting_input');
      }
    }
  }

  newConversation(agentId: string): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;

    const proc = this.processes.get(agentId);
    if (proc) {
      proc.stop();
      this.processes.delete(agentId);
    }

    this.pendingUserMessage.delete(agentId);
    agent.queuedMessages = [];
    agent.queuePaused = false;
    agent.messages = [];
    agent.status = 'stopped';
    agent.runOutcome = 'canceled';
    agent.pid = undefined;
    agent.sessionId = undefined;
    agent.currentTask = undefined;
    agent.costUsd = undefined;
    agent.tokenUsage = undefined;
    agent.contextWindow = undefined;
    agent.structuredOutput = undefined;
    agent.restoredConversationSeed = undefined;
    this.releaseCodeSnapshots(agent);
    agent.pendingPlan = undefined;
    agent.lastActivity = Date.now();
    delete agent.config.flags.resume;

    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);
    this.emit('agent:status', agentId, agent.status);
    return agent;
  }

  waitForAgent(agentId: string, timeoutMs: number): Promise<{ status: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      const agent = this.store.getAgent(agentId);
      if (!agent || agent.status === 'stopped' || agent.status === 'error') {
        resolve({ status: agent?.status || 'not_found', timedOut: false });
        return;
      }
      const timer = setTimeout(() => {
        this.removeListener('agent:status', listener);
        resolve({ status: 'timeout', timedOut: true });
      }, timeoutMs);
      const listener = (id: string, status: string) => {
        if (id !== agentId) return;
        if (status === 'stopped' || status === 'error') {
          clearTimeout(timer);
          this.removeListener('agent:status', listener);
          resolve({ status, timedOut: false });
        }
      };
      this.on('agent:status', listener);
    });
  }

  async stopAgent(agentId: string): Promise<void> {
    const agent = this.store.getAgent(agentId);
    const proc = this.processes.get(agentId);
    if (agent) {
      agent.runOutcome = 'canceled';
      agent.queuedMessages = [];
      agent.queuePaused = false;
      this.store.saveAgent(agent);
    }

    // Send /compact before stopping if session is large
    if (proc && agent?.sessionId) {
      const sessionPath = agent.config.provider === 'claude'
        ? this.findSessionJsonlPath(agent.sessionId)
        : this.findCodexSessionPath(agent.sessionId);

      if (sessionPath) {
        try {
          const stats = statSync(sessionPath);
          const sizeMB = stats.size / (1024 * 1024);
          if (sizeMB > 1) {
            console.log(`[AgentManager] ${agent.config.provider} session ${agent.sessionId} is ${sizeMB.toFixed(2)}MB, sending /compact`);
            proc.sendMessage('/compact');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (err) {
          console.warn(`[AgentManager] Failed to check ${agent.config.provider} session size:`, err);
        }
      }
    }

    if (proc) {
      await proc.stop();
    }
    this.updateAgentStatus(agentId, 'stopped');
  }

  async deleteAgent(agentId: string, opts: DeleteAgentOptions = {}): Promise<void> {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;

    const inspectWorktreeChanges = (worktreeBranch: string, baseBranch: string): boolean => {
      try {
        const worktreeExists = !!agent.worktreePath && existsSync(agent.worktreePath);
        const dirty = worktreeExists && execFileSync('git', ['status', '--porcelain'], {
          cwd: agent.worktreePath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        }).trim().length > 0;
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', worktreeBranch, baseBranch], {
            cwd: normalizeUserPath(agent.config.directory),
            stdio: 'ignore',
            timeout: 5000,
          });
          return dirty;
        } catch (error) {
          if ((error as { status?: number }).status !== 1) throw error;
          return true;
        }
      } catch (error) {
        throw new AgentWorkspaceError(
          `Could not verify that worktree "${agent.worktreePath || agent.worktreeBranch}" is safe to delete: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    if (agent.workspaceMode === 'worktree' && agent.worktreeBranch && agent.baseBranch) {
      const hasUnsafeChanges = inspectWorktreeChanges(agent.worktreeBranch, agent.baseBranch);
      agent.hasUnintegratedChanges = hasUnsafeChanges || undefined;
      this.store.saveAgent(agent);
      if (hasUnsafeChanges && !opts.discardWorkspaceChanges) {
        throw new AgentWorkspaceError(
          'This worktree has uncommitted files or commits that are not merged into the base branch. Integrate the changes first, or explicitly choose to discard them.',
        );
      }
    }

    await this.stopAgent(agentId);
    if (
      agent.workspaceMode === 'worktree'
      && agent.worktreeBranch
      && agent.baseBranch
      && !opts.discardWorkspaceChanges
      && inspectWorktreeChanges(agent.worktreeBranch, agent.baseBranch)
    ) {
      agent.hasUnintegratedChanges = true;
      this.store.saveAgent(agent);
      throw new AgentWorkspaceError(
        'The worktree changed while the Agent was stopping. It was kept; review or integrate the changes before deleting it.',
      );
    }

    this.releaseCodeSnapshots(agent);

    if (agent.worktreePath) {
      if (agent.workspaceMode === 'direct') {
        this.worktreeManager.removeDirectLink(agent.worktreePath);
      } else if (agent.worktreeBranch) {
        this.worktreeManager.removeWorktree(
          normalizeUserPath(agent.config.directory),
          agent.worktreePath,
          agent.worktreeBranch,
        );
      }
    }

    if (opts.purgeSessionFiles) {
      this.purgeSessionFiles(agent);
    }

    this.store.deleteAgent(agentId);
    this.emit('agent:status', agentId, 'deleted');
  }

  async stopAllAgents(): Promise<void> {
    const agents = this.store.getAllAgents();
    for (const agent of agents) {
      if (agent.status === 'running' || agent.status === 'waiting_input') {
        await this.stopAgent(agent.id);
      }
    }
  }

  updateProviderInstructions(agentId: string, content: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;
    // Keep monitor-specific instructions out of the checked-out files. They
    // are injected into the process prompt on the next provider turn.
    agent.config.providerInstructions = content;
    this.store.saveAgent(agent);
  }

  getAgent(agentId: string, refreshGit = true): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (agent && refreshGit) {
      try {
        if (this.refreshAgentGitState(agent)) this.store.saveAgent(agent);
      } catch { /* non-Git or missing workspace */ }
    }
    return agent;
  }

  getAllAgents(): Agent[] {
    return this.store.getAllAgents();
  }

  /** Return PIDs of all processes managed by this AgentManager (not external). */
  getManagedPids(): Set<number> {
    const pids = new Set<number>();
    for (const [, proc] of this.processes) {
      if (proc.pid) pids.add(proc.pid);
    }
    // Also include stored PIDs for agents we own
    for (const agent of this.store.getAllAgents()) {
      if (agent.source !== 'external' && agent.pid) {
        pids.add(agent.pid);
      }
    }
    return pids;
  }

  async cleanupExpiredAgents(retentionMs: number): Promise<number> {
    if (retentionMs <= 0) return 0;
    const now = Date.now();
    const agents = this.store.getAllAgents();
    let count = 0;
    for (const agent of agents) {
      if (agent.source === 'external') continue;
      if (
        (agent.status === 'stopped' || agent.status === 'error') &&
        agent.workspaceMode !== 'worktree' &&
        agent.lastActivity + retentionMs < now
      ) {
        await this.deleteAgent(agent.id);
        count++;
      }
    }
    return count;
  }

  /**
   * Find the JSONL session file for a given sessionId.
   * Searches ~/.claude/projects/star/[sessionId].jsonl
   */
  private findSessionJsonlPath(sessionId: string): string | undefined {
    try {
      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
      if (!existsSync(claudeProjectsDir)) return undefined;
      let projectDirs: string[];
      try { projectDirs = readdirSync(claudeProjectsDir); } catch { return undefined; }
      for (const projectSubdir of projectDirs) {
        const sessionFile = path.join(claudeProjectsDir, projectSubdir, `${sessionId}.jsonl`);
        if (existsSync(sessionFile)) return sessionFile;
      }
    } catch (err) {
      console.warn('[AgentManager] findSessionJsonlPath error:', err);
    }
    return undefined;
  }

  private findCodexSessionPath(sessionId: string): string | undefined {
    try {
      const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
      const exactMatches = this.findCodexSessionPathsById(codexSessionsDir, sessionId);
      if (exactMatches.length > 0) return exactMatches[0];

      const findSession = (dir: string): string | undefined => {
        if (!existsSync(dir)) return undefined;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findSession(fullPath);
            if (found) return found;
          } else if (entry.name.includes(sessionId)) {
            return fullPath;
          }
        }
        return undefined;
      };
      return findSession(codexSessionsDir);
    } catch (err) {
      console.warn('[AgentManager] findCodexSessionPath error:', err);
    }
    return undefined;
  }

  private findCodexSessionPathsById(rootDir: string, sessionId: string): string[] {
    if (!existsSync(rootDir)) return [];
    const matches: string[] = [];
    const visit = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }
        if (entry.name.endsWith(`${sessionId}.jsonl`)) {
          matches.push(fullPath);
        }
      }
    };
    try {
      visit(rootDir);
    } catch (err) {
      console.warn('[AgentManager] findCodexSessionPathsById error:', err);
    }
    return matches;
  }

  private purgeSessionFiles(agent: Agent): void {
    if (!agent.sessionId) return;
    const removedFiles: string[] = [];
    try {
      if (agent.config.provider === 'claude') {
        const sessionPath = this.findSessionJsonlPath(agent.sessionId);
        if (sessionPath && existsSync(sessionPath)) {
          unlinkSync(sessionPath);
          removedFiles.push(sessionPath);
        }
      } else if (agent.config.provider === 'codex') {
        const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
        for (const sessionPath of this.findCodexSessionPathsById(codexSessionsDir, agent.sessionId)) {
          if (existsSync(sessionPath)) {
            unlinkSync(sessionPath);
            removedFiles.push(sessionPath);
          }
        }
      }
    } catch (err) {
      console.warn('[AgentManager] Session file purge failed:', err);
    }

    if (removedFiles.length > 0) {
      console.log(`[AgentManager] Purged ${removedFiles.length} session file(s) for ${agent.id}:`, removedFiles.join(', '));
    }
  }

  /**
   * Restore the agent's conversation to the state just BEFORE turn `turnIndex`.
   * Like local Claude CLI: truncates to before the selected user message,
   * returns that message's text so the client can pre-fill the input box.
   * Does NOT auto-restart — the user edits the prompt and sends manually.
   */
  async restoreConversation(agentId: string, turnIndex: number, restoreCode: boolean, restoreConv = true): Promise<RestoreConversationResult> {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    let warning: string | undefined;
    if (agent) {
      agent.queuedMessages = [];
      agent.queuePaused = false;
    }

    // Stop the running process first
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.stop();
      this.processes.delete(agentId);
    }

    // Save pre-restore snapshot on first restore so user can re-select later turns
    const sourceMessages = agent.preRestoreSnapshot?.messages ?? agent.messages;
    const sourceSessionId = agent.preRestoreSnapshot?.sessionId ?? agent.sessionId;

    if (!agent.preRestoreSnapshot) {
      let jsonlBackupPath: string | undefined;
      if (agent.sessionId && agent.config.provider === 'claude') {
        const jsonlPath = this.findSessionJsonlPath(agent.sessionId);
        if (jsonlPath) {
          try {
            const backupPath = jsonlPath + '.pre-restore';
            copyFileSync(jsonlPath, backupPath);
            jsonlBackupPath = backupPath;
          } catch { /* best effort */ }
        }
      }
      agent.preRestoreSnapshot = {
        messages: [...agent.messages],
        sessionId: agent.sessionId,
        jsonlBackupPath,
      };
    }

    // Find the user message text from the full (pre-restore) source
    let restoredPrompt = '';
    let userMsgCount = 0;
    for (const msg of sourceMessages) {
      if (msg.role === 'user') {
        if (userMsgCount === turnIndex) {
          restoredPrompt = msg.content;
          break;
        }
        userMsgCount++;
      }
    }

    // Truncate Claude's JSONL session file from the backup (not the already-truncated file)
    if (restoreConv && sourceSessionId && agent.config.provider === 'claude') {
      const jsonlPath = this.findSessionJsonlPath(sourceSessionId);
      if (jsonlPath) {
        try {
          // Restore from backup first if available
          const backupPath = agent.preRestoreSnapshot?.jsonlBackupPath;
          if (backupPath) {
            try { copyFileSync(backupPath, jsonlPath); } catch { /* backup may not exist */ }
          }
          const content = readFileSync(jsonlPath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim() !== '');
          let userCount = 0;
          let cutLine = lines.length;
          for (let i = 0; i < lines.length; i++) {
            try {
              const parsed = JSON.parse(lines[i]);
              if (parsed.type === 'user') {
                if (userCount === turnIndex) {
                  cutLine = i;
                  break;
                }
                userCount++;
              }
            } catch { /* skip malformed */ }
          }
          const truncated = lines.slice(0, cutLine).join('\n') + '\n';
          writeFileSync(jsonlPath, truncated, 'utf-8');
          console.log(`[AgentManager] Truncated JSONL to line ${cutLine} (before turn ${turnIndex})`);
        } catch (err) {
          console.warn('[AgentManager] JSONL truncation error:', err);
          warning = 'Conversation history was restored in AgentMonitor, but the provider session file could not be truncated.';
        }
      }
    }

    // Truncate messages from the full source list
    if (restoreConv) {
      userMsgCount = 0;
      let keepUntil = sourceMessages.length;
      for (let i = 0; i < sourceMessages.length; i++) {
        if (sourceMessages[i].role === 'user') {
          if (userMsgCount === turnIndex) {
            keepUntil = i;
            break;
          }
          userMsgCount++;
        }
      }
      agent.messages = sourceMessages.slice(0, keepUntil);
    }

    // Optionally restore git worktree to the snapshot before this turn
    let restoredCode = false;
    if (restoreCode) {
      if (agent.worktreePath) {
        const codeResult = this.restoreAgentCode(agent, turnIndex);
        restoredCode = codeResult?.restored ?? false;
        warning = codeResult?.warning || warning;
      } else {
        warning = 'No worktree is attached to this agent, so only the conversation was restored.';
      }
    }

    if (restoreConv) {
      if (agent.messages.length > 0) {
        agent.restoredConversationSeed = agent.messages
          .map(m => `[${m.role}]: ${m.content}`)
          .join('\n\n');
      }
      agent.sessionId = undefined;
      delete agent.config.flags.resume;
    } else if (agent.sessionId && agent.config.provider === 'claude') {
      agent.config.flags.resume = agent.sessionId;
    }
    agent.interactionMode = 'default';
    delete agent.pendingPlan;
    delete agent.pendingQuestion;
    agent.status = 'stopped';
    agent.lastActivity = Date.now();
    this.store.saveAgent(agent);
    this.emit('agent:status', agentId, 'stopped');
    this.emit('agent:update', agentId, agent);

    return {
      restoredPrompt,
      restoredCode,
      restoredConversation: restoreConv,
      warning,
    };
  }

  private takeCodeSnapshot(agent: Agent, beforeTurnIndex: number): void {
    if (!agent.worktreePath) return;
    if (agent.workspaceMode === 'direct') return;
    try {
      const snapshot = this.snapshotManager.create(agent.worktreePath, agent.id, beforeTurnIndex);
      if (!agent.codeSnapshots) agent.codeSnapshots = [];
      const existing = agent.codeSnapshots.findIndex(s => s.beforeTurnIndex === beforeTurnIndex);
      if (existing >= 0) {
        this.snapshotManager.release(agent.worktreePath, agent.codeSnapshots[existing]);
        agent.codeSnapshots[existing] = snapshot;
      } else {
        agent.codeSnapshots.push(snapshot);
      }
      console.log(`[AgentManager] Code snapshot before turn ${beforeTurnIndex}: ${snapshot.commit.slice(0, 8)}`);
    } catch {
      // Not a git repo or commit failed — skip silently
    }
  }

  private releaseCodeSnapshots(agent: Agent): void {
    if (agent.worktreePath && agent.codeSnapshots) {
      for (const snapshot of agent.codeSnapshots) {
        this.snapshotManager.release(agent.worktreePath, snapshot);
      }
    }
    agent.codeSnapshots = undefined;
  }

  private restoreAgentCode(agent: Agent, beforeTurnIndex: number): { restored: boolean; warning?: string } {
    if (!agent.worktreePath) {
      return { restored: false, warning: 'No worktree is attached to this agent, so code was not restored.' };
    }
    if (agent.workspaceMode === 'direct') {
      return { restored: false, warning: 'Agent is in direct mode (no isolated worktree); code was not restored.' };
    }
    try {
      execSync('git rev-parse --git-dir', { cwd: agent.worktreePath, stdio: 'pipe' });
      const snapshot = agent.codeSnapshots?.find(s => s.beforeTurnIndex === beforeTurnIndex);
      if (snapshot) {
        this.snapshotManager.restore(agent.worktreePath, snapshot);
        const discarded = agent.codeSnapshots!.filter(s => s.beforeTurnIndex >= beforeTurnIndex);
        for (const item of discarded) this.snapshotManager.release(agent.worktreePath, item);
        agent.codeSnapshots = agent.codeSnapshots!.filter(s => s.beforeTurnIndex < beforeTurnIndex);
        console.log(`[AgentManager] Restored code to snapshot ${snapshot.commit.slice(0, 8)} (before turn ${beforeTurnIndex})`);
        return { restored: true };
      } else {
        console.log(`[AgentManager] No snapshot found for turn ${beforeTurnIndex}; leaving worktree unchanged`);
        return { restored: false, warning: 'No code snapshot was found for this turn, so only the conversation was restored.' };
      }
    } catch (err) {
      console.warn('[AgentManager] Code restore failed:', err);
      return { restored: false, warning: `Code restore failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
