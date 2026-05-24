import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'fs';
import path, { basename } from 'path';
import os from 'os';
import type { Agent, AgentConfig, AgentInteractionMode, AgentMessage, AgentStatus, ReasoningEffort } from '../models/Agent.js';
import { AgentStore } from '../store/AgentStore.js';
import { AgentProcess, type StreamMessage } from './AgentProcess.js';
import { WorktreeManager } from './WorktreeManager.js';
import { EmailNotifier } from './EmailNotifier.js';
import { WhatsAppNotifier } from './WhatsAppNotifier.js';
import { SlackNotifier } from './SlackNotifier.js';
import { FeishuNotifier } from './FeishuNotifier.js';
import { getInstructionFileName } from '../utils/instructionFiles.js';

/** How long (ms) after a user message with no response before we notify (not auto-interrupt) */
const STUCK_TIMEOUT_MS = 600_000; // 10 minutes — long tasks (build, push, chrome MCP) can take time
const STUCK_CHECK_INTERVAL_MS = 60_000; // check every 60s
const PLAN_MODE_INSTRUCTIONS = `You are in AgentMonitor Plan Mode for this turn.

Rules:
- Do not edit files, write files, run formatters, apply patches, start services, commit code, or perform any mutating action.
- You may inspect and analyze existing files and run read-only commands that help produce a plan.
- Produce a decision-complete implementation plan only.
- Put the final plan in exactly one <proposed_plan>...</proposed_plan> block.
- Do not ask for approval inside the plan. AgentMonitor will show explicit approval controls.`;
const PLAN_APPROVAL_MESSAGE = 'User has approved the proposed plan. Proceed with implementation according to the approved plan.';

interface DeleteAgentOptions {
  purgeSessionFiles?: boolean;
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

export class AgentManager extends EventEmitter {
  private processes: Map<string, AgentProcess> = new Map();
  private store: AgentStore;
  private worktreeManager: WorktreeManager;
  private emailNotifier: EmailNotifier;
  private whatsappNotifier: WhatsAppNotifier;
  private slackNotifier: SlackNotifier;
  private feishuNotifier: FeishuNotifier;
  /** Track when a user message was sent per agent (agentId → timestamp) */
  private pendingUserMessage: Map<string, number> = new Map();
  private stuckCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(store: AgentStore, worktreeManager?: WorktreeManager, emailNotifier?: EmailNotifier, whatsappNotifier?: WhatsAppNotifier, slackNotifier?: SlackNotifier, feishuNotifier?: FeishuNotifier) {
    super();
    this.store = store;
    this.worktreeManager = worktreeManager || new WorktreeManager();
    this.emailNotifier = emailNotifier || new EmailNotifier();
    this.whatsappNotifier = whatsappNotifier || new WhatsAppNotifier();
    this.slackNotifier = slackNotifier || new SlackNotifier();
    this.feishuNotifier = feishuNotifier || new FeishuNotifier('', '');

    // On startup, mark any monitor-owned agents that were left in running/waiting_input as
    // stopped — their processes died when the server restarted.
    // External agents are handled by ExternalAgentScanner (it checks if PID is still alive).
    for (const agent of this.store.getAllAgents()) {
      if (agent.source === 'external') continue;
      if (agent.status === 'running' || agent.status === 'waiting_input') {
        agent.status = 'stopped';
        agent.pid = undefined;
        this.store.saveAgent(agent);
      }
    }

    // Periodically check for stuck agents (sent user message but no response)
    this.stuckCheckInterval = setInterval(() => this.checkStuckAgents(), STUCK_CHECK_INTERVAL_MS);
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

  async createAgent(name: string, agentConfig: AgentConfig, labels?: Record<string, string>): Promise<Agent> {
    const id = uuid();
    const branchName = `agent-${id.slice(0, 8)}`;

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
      if (sessionCwd && existsSync(sessionCwd)) {
        console.log(`[AgentManager] Resume: using session cwd: ${sessionCwd}`);
        agentConfig.directory = sessionCwd;
      }
    }
    const skipWorktree = !!agentConfig.flags.resume;

    // Create git worktree for isolation — only if the directory is already a git repo
    const isGitRepo = !skipWorktree && (() => {
      try {
        execSync('git rev-parse --git-dir', { cwd: agentConfig.directory, stdio: 'pipe' });
        return true;
      } catch { return false; }
    })();

    if (isGitRepo) {
      try {
        const result = this.worktreeManager.createWorktree(
          agentConfig.directory,
          branchName,
          agentConfig.claudeMd,
          agentConfig.provider,
        );
        worktreePath = result.worktreePath;
        worktreeBranch = result.branch;
      } catch (err) {
        console.warn('[AgentManager] Worktree creation failed, using directory directly:', err);
        worktreePath = agentConfig.directory;
        if (agentConfig.claudeMd) {
          writeFileSync(
            path.join(worktreePath, getInstructionFileName(agentConfig.provider)),
            agentConfig.claudeMd,
          );
        }
      }
    } else {
      // Not a git repo — work directly in the directory, no worktree needed
      worktreePath = agentConfig.directory;
      // Write the provider-specific instruction file directly into the working directory.
      if (agentConfig.claudeMd) {
        writeFileSync(
          path.join(worktreePath, getInstructionFileName(agentConfig.provider)),
          agentConfig.claudeMd,
        );
      }
    }

    const agent: Agent = {
      id,
      name,
      status: 'running',
      config: agentConfig,
      worktreePath,
      worktreeBranch,
      messages: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      projectName: basename(agentConfig.directory),
      mcpServers: this.parseMcpServers(agentConfig.flags.mcpConfig),
      currentTask: agentConfig.prompt.length > 120 ? agentConfig.prompt.slice(0, 120) + '...' : agentConfig.prompt,
      originalPrompt: agentConfig.prompt,
      labels,
      interactionMode: 'default',
    };

    // Take initial code snapshot (before turn 0) so we can restore to clean state
    this.takeCodeSnapshot(agent, 0);

    this.store.saveAgent(agent);
    this.store.recordPath(os.hostname(), agentConfig.directory);
    this.startProcess(agent);

    // Notify dashboard of newly created agent immediately
    this.emit('agent:update', agent.id, agent);

    return agent;
  }

  private startProcess(agent: Agent): void {
    const proc = new AgentProcess();
    this.processes.set(agent.id, proc);
    const processPrompt = this.composeProcessPrompt(agent);
    const processModel = agent.config.provider === 'codex'
      ? undefined
      : agent.config.flags.model;
    const executionDirectory = this.resolveExecutionDirectory(agent);

    proc.on('message', (msg: StreamMessage) => {
      this.handleStreamMessage(agent.id, msg, agent.config.provider);
    });

    proc.on('terminal', (chunk: { stream: string; data: string }) => {
      this.emit('agent:terminal', agent.id, chunk);
    });

    proc.on('stderr', (text: string) => {
      console.error(`[Agent ${agent.id}] stderr: ${text}`);
      // Codex prints this informational line when stdin is piped; harmless noise.
      if (agent.config.provider === 'codex' && text.trim() === 'Reading additional input from stdin...') {
        return;
      }
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
      // Don't override 'stopped' status (set when result message is received)
      const current = this.store.getAgent(agent.id);
      if (current && current.status !== 'stopped') {
        const status = (code === 0 || code === null) ? 'stopped' : 'error';
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
    });

    proc.on('error', (err: Error) => {
      console.error(`[Agent ${agent.id}] process error:`, err);
      const a = this.store.getAgent(agent.id);
      if (a) {
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

  private resolveExecutionDirectory(agent: Agent): string {
    if (agent.worktreePath && existsSync(agent.worktreePath)) {
      return agent.worktreePath;
    }

    if (agent.worktreePath) {
      console.warn(`[AgentManager] Worktree path is missing for ${agent.id}, falling back to configured directory: ${agent.config.directory}`);
      agent.worktreePath = undefined;
      agent.worktreeBranch = undefined;
    }

    return agent.config.directory;
  }

  private composeProcessPrompt(agent: Agent): string {
    let prompt = agent.config.prompt;

    // Append structured output instruction if schema is provided
    if (agent.config.flags.outputSchema) {
      prompt += `\n\nIMPORTANT: When you have completed the task, output your final result as a JSON code block (wrapped in \`\`\`json ... \`\`\`) that conforms to this JSON Schema:\n${JSON.stringify(agent.config.flags.outputSchema, null, 2)}`;
    }

    prompt = this.wrapPlanModeMessage(agent, prompt);

    if (agent.config.provider !== 'codex') {
      return prompt;
    }

    const selectedModel = agent.config.flags.model?.trim();
    if (!selectedModel) {
      return prompt;
    }

    const trimmedPrompt = prompt.trimStart();
    if (trimmedPrompt.startsWith('/model ')) {
      return prompt;
    }

    return `/model ${selectedModel}\n${prompt}`;
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

    if (provider === 'codex') {
      this.handleCodexMessage(agent, msg);
    } else {
      this.handleClaudeMessage(agent, msg);
    }

    // Emit raw message (kept for backward compat)
    this.emit('agent:message', agentId, msg);

    // Emit lightweight delta with only new messages + metadata (efficient for tunnel)
    const newMessages = agent.messages.slice(prevMsgCount);
    this.capturePendingPlan(agent, newMessages);
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

      agent.pendingPlan = {
        id: uuid(),
        content: plan,
        sourceMessageId: message.id,
        createdAt: Date.now(),
      };
      agent.interactionMode = 'plan';
      agent.lastActivity = Date.now();
      this.store.saveAgent(agent);
    }
  }

  private extractProposedPlan(text: string): string | undefined {
    const match = text.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
    return match?.[1]?.trim() || undefined;
  }

  private handleClaudeMessage(agent: Agent, msg: StreamMessage): void {
    // With --verbose, assistant messages have: {type: "assistant", message: {content: [{type: "text", text: "..."}]}}
    if (msg.type === 'assistant') {
      const message = msg.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } | undefined;
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
            agent.messages.push({
              id: uuid(),
              role: 'tool',
              content: `Using tool: ${block.name || 'unknown'}`,
              toolName: block.name || 'unknown',
              toolInput: inputStr.length > 5000 ? inputStr.slice(0, 5000) + '\n...(truncated)' : inputStr,
              timestamp: Date.now(),
            });
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
      const userMessage = msg.message as { content?: Array<{ type: string; content?: string; tool_use_id?: string }> } | undefined;
      const toolResult = msg.tool_use_result as { stdout?: string; stderr?: string } | undefined;
      if (userMessage?.content) {
        for (const block of userMessage.content) {
          if (block.type === 'tool_result') {
            let resultText = '';
            if (toolResult?.stdout) resultText = toolResult.stdout;
            else if (typeof block.content === 'string') resultText = block.content;
            if (resultText) {
              // Attach result to the most recent tool message without a result
              const lastToolMsg = [...agent.messages].reverse().find(m => m.role === 'tool' && !m.toolResult);
              if (lastToolMsg) {
                lastToolMsg.toolResult = resultText.length > 10000 ? resultText.slice(0, 10000) + '\n...(truncated)' : resultText;
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
        const errors = (resultAny.errors as string[]) || [];
        const errText = errors.join('; ') || 'Claude returned an error result';
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
      } else {
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
      if (msg.item.type === 'agent_message') {
        agent.messages.push({
          id: uuid(),
          role: 'assistant',
          content: msg.item.text || '',
          timestamp: Date.now(),
        });
        agent.lastActivity = Date.now();
        this.store.saveAgent(agent);
      } else if (msg.item.type === 'command_execution' || msg.item.type === 'tool_call' || msg.item.type === 'function_call') {
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
    this.store.saveAgent(agent);
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

    agent.pendingPlan.approvedAt = Date.now();
    agent.interactionMode = 'default';
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);

    this.sendMessage(agentId, PLAN_APPROVAL_MESSAGE);
    return this.store.getAgent(agentId);
  }

  revisePlan(agentId: string): Agent | undefined {
    const agent = this.store.getAgent(agentId);
    if (!agent) return undefined;

    agent.interactionMode = 'plan';
    if (agent.pendingPlan && !agent.pendingPlan.approvedAt) {
      delete agent.pendingPlan;
    }
    agent.lastActivity = Date.now();
    this.store.saveAgent(agent);
    this.emit('agent:update', agentId, agent);
    return agent;
  }

  sendMessage(agentId: string, text: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;
    const processText = this.wrapPlanModeMessage(agent, text);

    // Take a code snapshot before this turn so we can restore to it later.
    const turnIndex = agent.messages.filter(m => m.role === 'user').length;
    this.takeCodeSnapshot(agent, turnIndex);

    // Add user message to history
    agent.messages.push({
      id: uuid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
    agent.lastActivity = Date.now();
    this.store.saveAgent(agent);
    // Emit full snapshot so chat UI updates immediately with user message
    this.emit('agent:update', agentId, agent);

    const proc = this.processes.get(agentId);
    if (proc) {
      // Agent is running (or waiting_input) — send message to existing process.
      // With --input-format stream-json, Claude CLI accepts stdin at any time and
      // queues messages. The agent will process it when the current task finishes.
      if (agent.status === 'waiting_input') {
        this.updateAgentStatus(agentId, 'running');
        // Only set stuck timer when agent transitions from waiting → running,
        // meaning we expect a response. Don't set it if agent is already busy.
        this.pendingUserMessage.set(agentId, Date.now());
      }
      proc.sendMessage(processText);
      this.emit('agent:message', agentId, {
        type: 'user',
        text,
      });
    } else if (agent.status === 'stopped' || agent.status === 'error') {
      // Agent is stopped — resume with new prompt
      this.resumeAgent(agent, processText);
    }
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
      proc.interrupt();
      // After SIGINT, Claude Code stops the current task and waits for the
      // next user message.  Transition to waiting_input so the dashboard
      // reflects the interrupted state instead of staying at "running".
      const agent = this.store.getAgent(agentId);
      if (agent && agent.status === 'running') {
        this.updateAgentStatus(agentId, 'waiting_input');
      }
    }
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
      proc.stop();
    }
    this.updateAgentStatus(agentId, 'stopped');
  }

  async deleteAgent(agentId: string, opts: DeleteAgentOptions = {}): Promise<void> {
    await this.stopAgent(agentId);
    const agent = this.store.getAgent(agentId);
    if (!agent) return;

    if (opts.purgeSessionFiles) {
      this.purgeSessionFiles(agent);
    }

    if (agent?.worktreePath && agent.worktreeBranch) {
      try {
        this.worktreeManager.removeWorktree(
          agent.config.directory,
          agent.worktreePath,
          agent.worktreeBranch,
        );
      } catch (err) {
        console.warn('[AgentManager] Worktree cleanup failed:', err);
      }
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

  updateClaudeMd(agentId: string, content: string): void {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;
    // Write to the provider-specific instruction file so the running agent sees the change.
    if (agent.worktreePath) {
      this.worktreeManager.updateClaudeMd(agent.worktreePath, content, agent.config.provider);
    }
    // Persist to agent config so it survives restart / shows correctly in UI
    agent.config.claudeMd = content;
    this.store.saveAgent(agent);
  }

  getAgent(agentId: string): Agent | undefined {
    return this.store.getAgent(agentId);
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
      if (
        (agent.status === 'stopped' || agent.status === 'error') &&
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

    // Stop the running process first
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.stop();
      this.processes.delete(agentId);
    }

    // Find the user message text to return for pre-fill
    let restoredPrompt = '';
    let userMsgCount = 0;
    for (const msg of agent.messages) {
      if (msg.role === 'user') {
        if (userMsgCount === turnIndex) {
          restoredPrompt = msg.content;
          break;
        }
        userMsgCount++;
      }
    }

    // Truncate Claude's JSONL session file — keep everything BEFORE the selected user turn.
    // Codex session files are not currently mutated; we seed a fresh session below instead.
    if (restoreConv && agent.sessionId && agent.config.provider === 'claude') {
      const jsonlPath = this.findSessionJsonlPath(agent.sessionId);
      if (jsonlPath) {
        try {
          const content = readFileSync(jsonlPath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim() !== '');
          let userCount = 0;
          let cutLine = lines.length;
          for (let i = 0; i < lines.length; i++) {
            try {
              const parsed = JSON.parse(lines[i]);
              if (parsed.type === 'user') {
                if (userCount === turnIndex) {
                  // Cut BEFORE this user turn
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

    // Truncate agent.messages to BEFORE the Nth user-role message
    if (restoreConv) {
      userMsgCount = 0;
      let keepUntil = agent.messages.length;
      for (let i = 0; i < agent.messages.length; i++) {
        if (agent.messages[i].role === 'user') {
          if (userMsgCount === turnIndex) {
            keepUntil = i;
            break;
          }
          userMsgCount++;
        }
      }
      agent.messages = agent.messages.slice(0, keepUntil);
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

    // After truncating the JSONL, the old session is no longer valid for --resume.
    // Clear sessionId so the next send starts a fresh session instead of hitting
    // "No conversation found with session ID".
    // Build a conversation seed so the fresh session still has prior context.
    if (restoreConv) {
      if (agent.messages.length > 0) {
        agent.restoredConversationSeed = agent.messages
          .map(m => `[${m.role}]: ${m.content}`)
          .join('\n\n');
      }
      agent.sessionId = undefined;
      delete agent.config.flags.resume;
    } else if (agent.sessionId && agent.config.provider === 'claude') {
      // Code-only restore: session is intact, keep resume flag
      agent.config.flags.resume = agent.sessionId;
    }
    agent.interactionMode = 'default';
    delete agent.pendingPlan;
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
    try {
      execSync('git rev-parse --git-dir', { cwd: agent.worktreePath, stdio: 'pipe' });
      // Commit all current changes (including untracked) as a snapshot.
      // Safe because agents work on isolated worktree branches (agent-XXXX).
      execSync('git add -A && git commit --allow-empty -m "[snapshot] before turn ' + beforeTurnIndex + '"', {
        cwd: agent.worktreePath, stdio: 'pipe', shell: '/bin/bash',
      });
      const commit = execSync('git rev-parse HEAD', { cwd: agent.worktreePath, encoding: 'utf-8' }).trim();
      if (!agent.codeSnapshots) agent.codeSnapshots = [];
      const existing = agent.codeSnapshots.findIndex(s => s.beforeTurnIndex === beforeTurnIndex);
      if (existing >= 0) {
        agent.codeSnapshots[existing].commit = commit;
      } else {
        agent.codeSnapshots.push({ beforeTurnIndex, commit });
      }
      console.log(`[AgentManager] Code snapshot before turn ${beforeTurnIndex}: ${commit.slice(0, 8)}`);
    } catch {
      // Not a git repo or commit failed — skip silently
    }
  }

  private restoreAgentCode(agent: Agent, beforeTurnIndex: number): { restored: boolean; warning?: string } {
    if (!agent.worktreePath) {
      return { restored: false, warning: 'No worktree is attached to this agent, so code was not restored.' };
    }
    try {
      execSync('git rev-parse --git-dir', { cwd: agent.worktreePath, stdio: 'pipe' });
      const snapshot = agent.codeSnapshots?.find(s => s.beforeTurnIndex === beforeTurnIndex);
      if (snapshot) {
        execSync(`git reset --hard ${snapshot.commit}`, { cwd: agent.worktreePath, stdio: 'pipe' });
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
