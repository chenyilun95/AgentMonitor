import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, readdirSync, openSync, readSync, closeSync } from 'fs';
import { resolve, basename } from 'path';
import { homedir } from 'os';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import type { Agent, AgentProvider } from '../models/Agent.js';
import type { AgentStore } from '../store/AgentStore.js';
import { runtimeCapabilities } from './RuntimeCapabilities.js';

interface DiscoveredProcess {
  pid: number;
  provider: AgentProvider;
  args: string;
  cwd: string;
  sessionId?: string;
  prompt?: string;
  model?: string;
  flags: Record<string, boolean | string>;
}

interface ScanResult {
  imported: Agent[];
  updated: number;
  removed: number;
}

interface SessionFileInfo {
  sessionId: string;
  jsonlPath: string;
  cwd?: string;
}

interface SessionSnapshot {
  sessionId?: string;
  cwd?: string;
  model?: string;
  reasoningEffort?: string;
  tokenUsage?: Agent['tokenUsage'];
  contextWindow?: Agent['contextWindow'];
  messages: Agent['messages'];
  lastTimestamp?: number;
}

/**
 * Discovers and monitors claude/codex agents running on the local machine
 * that were NOT started by AgentMonitor.
 */
export class ExternalAgentScanner extends EventEmitter {
  private store: AgentStore;
  private interval: ReturnType<typeof setInterval> | null = null;
  private initialScanTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissedPids = new Set<number>();
  private tailOffsets = new Map<string, number>(); // agentId -> byte offset
  private scanIntervalMs: number;
  private autoImport: boolean;
  private maxMessages: number;
  private managedPids: () => Set<number>;

  constructor(
    store: AgentStore,
    getManagedPids: () => Set<number>,
    opts?: { scanIntervalMs?: number; autoImport?: boolean; maxMessages?: number },
  ) {
    super();
    this.store = store;
    this.managedPids = getManagedPids;
    this.scanIntervalMs = opts?.scanIntervalMs ?? 15_000;
    this.autoImport = opts?.autoImport ?? true;
    this.maxMessages = opts?.maxMessages ?? 200;
  }

  start(): void {
    if (this.interval) return;
    // Initial scan after short delay
    this.initialScanTimer = setTimeout(() => {
      this.initialScanTimer = null;
      this.scan();
    }, 2000);
    this.interval = setInterval(() => this.scan(), this.scanIntervalMs);
    console.log(`[ExternalScanner] Started (interval: ${this.scanIntervalMs}ms, autoImport: ${this.autoImport})`);
  }

  stop(): void {
    if (this.initialScanTimer) {
      clearTimeout(this.initialScanTimer);
      this.initialScanTimer = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  dismiss(pid: number): void {
    this.dismissedPids.add(pid);
  }

  /**
   * Run a single scan cycle: discover processes, import/update/cleanup.
   */
  scan(): ScanResult {
    const result: ScanResult = { imported: [], updated: 0, removed: 0 };
    try {
      const processes = this.discoverProcesses();
      const tracked = this.managedPids();

      // Import new external processes
      for (const proc of processes) {
        if (tracked.has(proc.pid) || this.dismissedPids.has(proc.pid)) continue;
        if (this.isAlreadyTracked(proc)) continue;

        if (this.autoImport) {
          const agent = this.importProcess(proc);
          if (agent) {
            result.imported.push(agent);
          }
        }
      }

      // Update existing external agents
      const runningPids = new Set(processes.map(p => p.pid));
      for (const agent of this.store.getAllAgents()) {
        if (agent.source !== 'external') continue;

        const isAlive = !!agent.pid && (runningPids.has(agent.pid) || this.isProcessAlive(agent.pid));
        if (!isAlive) {
          this.store.deleteAgent(agent.id);
          this.tailOffsets.delete(agent.id);
          this.emit('agent:status', agent.id, 'deleted');
          result.removed++;
          continue;
        }

        if (agent.status === 'running' || agent.status === 'waiting_input') {
          // Still running — tail JSONL for new messages
          const newMsgs = this.tailMessages(agent);
          if (newMsgs > 0) {
            result.updated++;
          }
        }
      }
    } catch (err) {
      console.warn('[ExternalScanner] Scan error:', err);
    }
    return result;
  }

  /**
   * Get list of candidate processes not yet imported.
   */
  getCandidates(): DiscoveredProcess[] {
    const processes = this.discoverProcesses();
    const tracked = this.managedPids();
    return processes.filter(p =>
      !tracked.has(p.pid) &&
      !this.dismissedPids.has(p.pid) &&
      !this.isAlreadyTracked(p),
    );
  }

  /**
   * Import a specific process by PID.
   */
  importByPid(pid: number): Agent | null {
    const processes = this.discoverProcesses();
    const proc = processes.find(p => p.pid === pid);
    if (!proc) return null;
    return this.importProcess(proc);
  }

  // --- Private methods ---

  private discoverProcesses(): DiscoveredProcess[] {
    const results: DiscoveredProcess[] = [];
    try {
      // Use a BSD/GNU-compatible format:
      // `pid=` / `args=` suppress headers on both macOS and Linux.
      // `-x` limits results to the current user's processes in practice and
      // includes background jobs without a controlling terminal.
      const psOutput = execSync('ps -x -o pid= -o args=', {
        encoding: 'utf-8',
        timeout: 5000,
      });

      for (const line of psOutput.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx < 0) continue;

        const pid = parseInt(trimmed.slice(0, spaceIdx), 10);
        const args = trimmed.slice(spaceIdx + 1).trim();

        // Skip non-claude/codex processes
        if (!this.isClaudeOrCodex(args)) continue;
        // Skip grep/ps itself
        if (args.includes('grep') || args.includes(' ps ')) continue;
        // Skip AgentMonitor's own server
        if (args.includes('server/src/index')) continue;
        // Skip agents started by AgentMonitor (they use stream-json for programmatic IO)
        if (args.includes('stream-json')) continue;

        const parsed = this.parseArgs(args, pid);
        if (parsed) results.push(parsed);
      }
    } catch {
      // ps failed — likely no running processes
    }
    return results;
  }

  private detectProcessCwd(pid: number, args: string, provider: AgentProvider): string {
    if (provider === 'codex') {
      const cdMatch = args.match(/(?:--cd|-C)\s+(?:'([^']+)'|"([^"]+)"|(\S+))/);
      const argCwd = cdMatch?.[1] || cdMatch?.[2] || cdMatch?.[3];
      if (argCwd) return argCwd;
    }

    try {
      return readFileSync(`/proc/${pid}/cwd`, 'utf-8').trim();
    } catch {
      // Linux /proc may not exist on macOS.
    }

    try {
      return execSync(`readlink /proc/${pid}/cwd`, { encoding: 'utf-8', timeout: 2000 }).trim();
    } catch {
      // Ignore and try macOS-friendly fallback below.
    }

    try {
      const lsofOutput = execSync(`lsof -a -d cwd -p ${pid} -Fn`, {
        encoding: 'utf-8',
        timeout: 2000,
      });
      const cwdLine = lsofOutput.split('\n').find((line) => line.startsWith('n'));
      if (cwdLine) return cwdLine.slice(1).trim();
    } catch {
      // No cwd information available.
    }

    return '';
  }

  private isClaudeOrCodex(args: string): boolean {
    // Match claude CLI invocations (interactive or with flags)
    // Exclude: chrome-native-host, shell-snapshot scripts, claude-code-guide
    if (/chrome-native-host|shell-snapshot|claude-code-guide|claude\.md/.test(args)) return false;
    if (/\bclaude\b/.test(args) && (
      args.includes('--dangerously-skip-permissions') ||
      args.includes('--permission-mode') ||
      args.includes('--resume') ||
      args.includes(' -p ')
    )) return true;
    if (/\bcodex\b/.test(args) && !/(\s|^)(--help|-h|--version)(\s|$)/.test(args)) return true;
    return false;
  }

  private parseArgs(args: string, pid: number): DiscoveredProcess | null {
    const isClaude = /\bclaude\b/.test(args) && !/\bcodex\b/.test(args);
    const isCodex = /\bcodex\b/.test(args) && !isClaude;
    const provider: AgentProvider = isCodex ? 'codex' : 'claude';
    const cwd = this.detectProcessCwd(pid, args, provider);

    // Extract flags
    const flags: Record<string, boolean | string> = {};
    const sessionMatch = isClaude
      ? args.match(/--resume\s+(\S+)/)
      : args.match(/exec\s+resume(?:\s+--\S+(?:\s+\S+)?)?\s+([0-9a-fA-F-]{8,})/);
    const modelMatch = args.match(/(?:--model|-m)\s+(\S+)/);
    const reasoningEffortMatch = args.match(/model_reasoning_effort=(?:"|')?(low|medium|high|xhigh)(?:"|')?/) ||
      args.match(/--effort\s+(?:"|')?(low|medium|high|max)(?:"|')?/);
    const promptMatch = args.match(/-p\s+'([^']*)'/) || args.match(/-p\s+"([^"]*)"/);

    if (args.includes('--dangerously-skip-permissions')) flags.dangerouslySkipPermissions = true;
    if (args.includes('--chrome')) flags.chrome = true;
    if (args.includes('--full-auto')) flags.fullAuto = true;
    if (reasoningEffortMatch?.[1]) flags.reasoningEffort = reasoningEffortMatch[1];

    const sessionId = sessionMatch?.[1];
    const model = modelMatch?.[1];
    let prompt = promptMatch?.[1] || '';

    // For codex, extract prompt after 'exec'
    if (isCodex && !prompt) {
      const execMatch = args.match(/exec(?:\s+resume)?(?:\s+--\S+(?:\s+\S+)?)*\s+'([^']+)'/);
      prompt = execMatch?.[1] || '';
    }

    return { pid, provider, args, cwd, sessionId, prompt, model, flags };
  }

  private isAlreadyTracked(proc: DiscoveredProcess): boolean {
    const agents = this.store.getAllAgents();
    // Resolve session file to get the actual sessionId for dedup
    const resolvedSessionId = proc.sessionId || this.findSessionFile(proc)?.sessionId;
    for (const agent of agents) {
      if (agent.pid === proc.pid) return true;
      if (resolvedSessionId && agent.sessionId === resolvedSessionId) return true;
    }
    return false;
  }

  private importProcess(proc: DiscoveredProcess): Agent | null {
    // Try to find session file and load messages
    const sessionInfo = this.findSessionFile(proc);
    const sessionSnapshot = sessionInfo
      ? this.parseSessionSnapshot(proc.provider, sessionInfo.jsonlPath)
      : null;

    // Dedup by resolved sessionId — multiple processes can share the same session
    if (sessionInfo?.sessionId) {
      const existing = this.store.getAllAgents().find(a => a.sessionId === sessionInfo.sessionId);
      if (existing) {
        // If the existing agent has a different PID, add this PID as an alias (don't re-import)
        console.log(`[ExternalScanner] Skipping PID ${proc.pid}: session ${sessionInfo.sessionId.slice(0, 8)} already tracked by ${existing.id.slice(0, 8)}`);
        return null;
      }
    }

    const messages = sessionSnapshot?.messages || [];
    const firstUserMsg = messages.find(m => m.role === 'user');
    const promptText = proc.prompt || firstUserMsg?.content || '(external agent)';
    const directory = proc.cwd || sessionSnapshot?.cwd || sessionInfo?.cwd || '/';
    const dirName = directory ? basename(directory) : 'unknown';

    const agent: Agent = {
      id: uuid(),
      name: `${dirName} (${proc.provider})`,
      status: 'running',
      config: {
        provider: proc.provider,
        directory,
        prompt: promptText,
        flags: {
          dangerouslySkipPermissions: !!proc.flags.dangerouslySkipPermissions,
          model: proc.model || sessionSnapshot?.model,
          resume: proc.sessionId,
          fullAuto: !!proc.flags.fullAuto,
          chrome: !!proc.flags.chrome,
          reasoningEffort: runtimeCapabilities.normalizeReasoningEffort(
            proc.provider,
            proc.flags.reasoningEffort || sessionSnapshot?.reasoningEffort,
          ),
        },
      },
      messages: messages.slice(-this.maxMessages),
      lastActivity: sessionSnapshot?.lastTimestamp || Date.now(),
      createdAt: sessionSnapshot?.lastTimestamp || Date.now(),
      pid: proc.pid,
      sessionId: sessionSnapshot?.sessionId || sessionInfo?.sessionId || proc.sessionId,
      projectName: dirName,
      currentTask: promptText.length > 120 ? promptText.slice(0, 120) + '...' : promptText,
      originalPrompt: promptText,
      source: 'external',
      tokenUsage: sessionSnapshot?.tokenUsage,
      contextWindow: sessionSnapshot?.contextWindow,
    };

    // Set tail offset to end of file so we only pick up NEW messages going forward
    if (sessionInfo?.jsonlPath) {
      try {
        this.tailOffsets.set(agent.id, statSync(sessionInfo.jsonlPath).size);
      } catch { /* ignore */ }
    }

    this.store.saveAgent(agent);
    this.emit('agent:update', agent.id, agent);
    console.log(`[ExternalScanner] Imported: ${agent.name} (PID: ${proc.pid}, session: ${agent.sessionId || 'none'}, msgs: ${agent.messages.length})`);
    return agent;
  }

  /** Encode a path the same way Claude CLI does for project directory names. */
  private encodeProjectPath(cwdPath: string): string {
    // Claude CLI replaces all non-alphanumeric chars (except hyphen) with hyphens
    return cwdPath.replace(/[^a-zA-Z0-9-]/g, '-');
  }

  private findSessionFile(proc: DiscoveredProcess): SessionFileInfo | null {
    if (proc.provider === 'codex') {
      return this.findCodexSessionFile(proc);
    }
    return this.findClaudeSessionFile(proc);
  }

  private findClaudeSessionFile(proc: DiscoveredProcess): SessionFileInfo | null {
    if (!proc.cwd) return null;
    const claudeDir = resolve(homedir(), '.claude', 'projects');
    if (!existsSync(claudeDir)) return null;

    // Try encoded path first, then scan all project dirs for a match
    const encoded = this.encodeProjectPath(proc.cwd);
    let projectDir = resolve(claudeDir, encoded);

    if (!existsSync(projectDir)) {
      // Fallback: scan project dirs that start with the expected prefix
      const cwdBase = basename(proc.cwd).replace(/[^a-zA-Z0-9-]/g, '-');
      try {
        const dirs = readdirSync(claudeDir);
        const match = dirs.find(d => d.endsWith(cwdBase) || d.includes(cwdBase));
        if (match) {
          projectDir = resolve(claudeDir, match);
        } else {
          return null;
        }
      } catch { return null; }
    }

    // If we have a session ID, look for that specific file
    if (proc.sessionId) {
      const jsonlPath = resolve(projectDir, `${proc.sessionId}.jsonl`);
      if (existsSync(jsonlPath)) {
        return { sessionId: proc.sessionId, jsonlPath };
      }
    }

    // Otherwise find the most recently modified JSONL
    try {
      const files = readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          path: resolve(projectDir, f),
          mtime: statSync(resolve(projectDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        const sessionId = files[0].name.replace('.jsonl', '');
        return { sessionId, jsonlPath: files[0].path };
      }
    } catch {
      // Can't read directory
    }
    return null;
  }

  private findCodexSessionFile(proc: DiscoveredProcess): SessionFileInfo | null {
    const codexDir = resolve(homedir(), '.codex', 'sessions');
    if (!existsSync(codexDir)) return null;

    const files = this.listCodexSessionFiles(codexDir)
      .map((jsonlPath) => {
        const meta = this.readCodexSessionMeta(jsonlPath);
        return {
          jsonlPath,
          sessionId: meta?.sessionId || basename(jsonlPath).match(/[0-9a-fA-F-]{8,}(?=\.jsonl$)/)?.[0] || '',
          cwd: meta?.cwd,
          mtime: statSync(jsonlPath).mtimeMs,
        };
      })
      .sort((left, right) => right.mtime - left.mtime);

    if (proc.sessionId) {
      const exact = files.find((file) => file.sessionId === proc.sessionId);
      if (exact) {
        return {
          sessionId: exact.sessionId,
          jsonlPath: exact.jsonlPath,
          cwd: exact.cwd,
        };
      }
    }

    const matchedByCwd = files.find((file) => !proc.cwd || file.cwd === proc.cwd);
    if (!matchedByCwd) return null;

    return {
      sessionId: matchedByCwd.sessionId,
      jsonlPath: matchedByCwd.jsonlPath,
      cwd: matchedByCwd.cwd,
    };
  }

  private listCodexSessionFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.listCodexSessionFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable directories.
    }
    return files;
  }

  private readCodexSessionMeta(jsonlPath: string): { sessionId?: string; cwd?: string } | null {
    try {
      const content = readFileSync(jsonlPath, 'utf-8');
      const firstLine = content.split('\n').find((line) => line.trim());
      if (!firstLine) return null;

      const entry = JSON.parse(firstLine) as { type?: string; payload?: { id?: string; cwd?: string } };
      if (entry.type !== 'session_meta') return null;
      return {
        sessionId: entry.payload?.id,
        cwd: entry.payload?.cwd,
      };
    } catch {
      return null;
    }
  }

  private parseSessionSnapshot(provider: AgentProvider, jsonlPath: string): SessionSnapshot {
    return provider === 'codex'
      ? this.parseCodexSessionSnapshot(jsonlPath)
      : {
          messages: this.parseJsonlMessages(jsonlPath),
        };
  }

  private parseJsonlMessages(jsonlPath: string): Agent['messages'] {
    const messages: Agent['messages'] = [];
    try {
      const content = readFileSync(jsonlPath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const msg = this.jsonlEntryToMessage(entry);
          if (msg) messages.push(msg);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Can't read file
    }
    return messages;
  }

  private parseCodexSessionSnapshot(jsonlPath: string): SessionSnapshot {
    const snapshot: SessionSnapshot = { messages: [] };
    try {
      const content = readFileSync(jsonlPath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          this.applyCodexEntry(snapshot, entry);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Can't read file
    }
    return snapshot;
  }

  private jsonlEntryToMessage(entry: Record<string, unknown>): Agent['messages'][0] | null {
    const type = entry.type as string;
    const ts = entry.timestamp ? new Date(entry.timestamp as string).getTime() : Date.now();

    if (type === 'user') {
      const msg = entry.message as { content?: string } | undefined;
      const content = typeof msg?.content === 'string' ? msg.content : '';
      if (!content) return null;
      return { id: (entry.uuid as string) || uuid(), role: 'user', content, timestamp: ts };
    }

    if (type === 'assistant') {
      const msg = entry.message as { content?: unknown[] } | undefined;
      if (!msg?.content || !Array.isArray(msg.content)) return null;
      // Extract text blocks
      const textParts: string[] = [];
      for (const block of msg.content) {
        if (typeof block === 'string') textParts.push(block);
        else if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') textParts.push(b.text);
          if (b.type === 'tool_use') {
            return {
              id: (b.id as string) || uuid(),
              role: 'tool',
              content: b.name as string || 'tool',
              toolName: b.name as string,
              toolInput: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
              timestamp: ts,
            };
          }
        }
      }
      const content = textParts.join('\n');
      if (!content) return null;
      return { id: (entry.uuid as string) || uuid(), role: 'assistant', content, timestamp: ts };
    }

    if (type === 'tool_result' || type === 'tool') {
      const content = typeof entry.content === 'string'
        ? entry.content
        : JSON.stringify(entry.content || '');
      return {
        id: (entry.uuid as string) || uuid(),
        role: 'tool',
        content: content.slice(0, 500),
        toolName: (entry.tool_name as string) || 'tool',
        toolResult: content.slice(0, 2000),
        timestamp: ts,
      };
    }

    return null;
  }

  private applyCodexEntry(snapshot: SessionSnapshot, entry: Record<string, unknown>): void {
    const type = entry.type as string | undefined;
    const ts = entry.timestamp ? new Date(entry.timestamp as string).getTime() : Date.now();
    snapshot.lastTimestamp = Math.max(snapshot.lastTimestamp || 0, ts);

    if (type === 'session_meta') {
      const payload = entry.payload as Record<string, unknown> | undefined;
      if (payload?.id && typeof payload.id === 'string') snapshot.sessionId = payload.id;
      if (payload?.cwd && typeof payload.cwd === 'string') snapshot.cwd = payload.cwd;
      return;
    }

    if (type === 'turn_context') {
      const payload = entry.payload as Record<string, unknown> | undefined;
      if (payload?.model && typeof payload.model === 'string') snapshot.model = payload.model;
      if (payload?.effort && typeof payload.effort === 'string') {
        snapshot.reasoningEffort = payload.effort;
      }
      if (typeof payload?.model_context_window === 'number') {
        snapshot.contextWindow = {
          used: snapshot.contextWindow?.used || 0,
          total: payload.model_context_window,
        };
      }
      return;
    }

    if (type === 'event_msg') {
      const payload = entry.payload as Record<string, unknown> | undefined;
      const eventType = payload?.type as string | undefined;

      if (eventType === 'user_message' && typeof payload?.message === 'string') {
        snapshot.messages.push({
          id: `codex-user-${ts}-${snapshot.messages.length}`,
          role: 'user',
          content: payload.message,
          timestamp: ts,
        });
        return;
      }

      if (eventType === 'agent_message' && typeof payload?.message === 'string') {
        snapshot.messages.push({
          id: `codex-assistant-${ts}-${snapshot.messages.length}`,
          role: 'assistant',
          content: payload.message,
          timestamp: ts,
        });
        return;
      }

      if (eventType === 'agent_reasoning' && typeof payload?.text === 'string') {
        snapshot.messages.push({
          id: `codex-reasoning-${ts}-${snapshot.messages.length}`,
          role: 'system',
          content: payload.text,
          timestamp: ts,
        });
        return;
      }

      if (eventType === 'token_count') {
        const info = payload?.info as Record<string, unknown> | undefined;
        const totalUsage = info?.total_token_usage as Record<string, unknown> | undefined;
        const lastUsage = info?.last_token_usage as Record<string, unknown> | undefined;
        if (totalUsage) {
          snapshot.tokenUsage = {
            input: Number(totalUsage.input_tokens || 0),
            output: Number(totalUsage.output_tokens || 0),
          };
        }

        const contextLimit = this.toPositiveNumber(info?.model_context_window);
        if (contextLimit !== undefined) {
          const lastUsageTokens = this.extractCodexUsageTotal(lastUsage);
          const totalUsageTokens = this.extractCodexUsageTotal(totalUsage);
          const fallbackUsed = snapshot.contextWindow?.used ?? 0;
          const contextUsed = lastUsageTokens
            ?? (totalUsageTokens !== undefined && totalUsageTokens <= contextLimit ? totalUsageTokens : undefined)
            ?? fallbackUsed;
          snapshot.contextWindow = {
            used: Math.min(contextLimit, Math.max(0, Math.round(contextUsed))),
            total: contextLimit,
          };
        }
      }
      return;
    }

    if (type !== 'response_item') return;

    const payload = entry.payload as Record<string, unknown> | undefined;
    const payloadType = payload?.type as string | undefined;
    if (payloadType === 'function_call') {
      const toolName = typeof payload?.name === 'string' ? payload.name : 'tool';
      const callId = typeof payload?.call_id === 'string' ? payload.call_id : `codex-tool-${ts}-${snapshot.messages.length}`;
      const toolInput = typeof payload?.arguments === 'string'
        ? payload.arguments
        : JSON.stringify(payload?.arguments || {});
      const command = this.extractCodexCommand(toolInput);
      snapshot.messages.push({
        id: callId,
        role: 'tool',
        content: command ? `Command: ${command}` : `Using tool: ${toolName}`,
        toolName,
        toolInput,
        timestamp: ts,
      });
      return;
    }

    if (payloadType === 'function_call_output') {
      const callId = typeof payload?.call_id === 'string' ? payload.call_id : '';
      const toolResult = this.formatCodexFunctionOutput(payload?.output);
      const existing = [...snapshot.messages].reverse().find((message) => message.id === callId);
      if (existing) {
        existing.toolResult = toolResult;
      } else if (toolResult) {
        snapshot.messages.push({
          id: callId || `codex-tool-output-${ts}-${snapshot.messages.length}`,
          role: 'tool',
          content: 'Tool result',
          toolResult,
          timestamp: ts,
        });
      }
    }
  }

  private extractCodexCommand(toolInput: string): string | undefined {
    try {
      const parsed = JSON.parse(toolInput) as { command?: string[] };
      if (Array.isArray(parsed.command)) {
        return parsed.command.join(' ');
      }
    } catch {
      // Ignore malformed arguments.
    }
    return undefined;
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const parsed = typeof value === 'number'
      ? value
      : (typeof value === 'string' ? Number(value) : NaN);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private extractCodexUsageTotal(usage: Record<string, unknown> | undefined): number | undefined {
    if (!usage) return undefined;
    const totalTokens = this.toPositiveNumber(usage.total_tokens);
    if (totalTokens !== undefined) return totalTokens;

    const tokenKeys = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'] as const;
    let sum = 0;
    let hasTokens = false;
    for (const key of tokenKeys) {
      const value = this.toPositiveNumber(usage[key]);
      if (value !== undefined) {
        sum += value;
        hasTokens = true;
      }
    }
    return hasTokens ? sum : undefined;
  }

  private formatCodexFunctionOutput(output: unknown): string {
    if (typeof output !== 'string') {
      return JSON.stringify(output || '');
    }

    try {
      const parsed = JSON.parse(output) as {
        output?: string;
        metadata?: { exit_code?: number; duration_seconds?: number };
      };
      const lines: string[] = [];
      if (typeof parsed.output === 'string' && parsed.output) {
        lines.push(parsed.output);
      }
      if (parsed.metadata?.exit_code !== undefined) {
        lines.push(`[exit ${parsed.metadata.exit_code}]`);
      }
      if (parsed.metadata?.duration_seconds !== undefined) {
        lines.push(`[duration ${parsed.metadata.duration_seconds}s]`);
      }
      return lines.join('\n').slice(0, 10_000);
    } catch {
      return output.slice(0, 10_000);
    }
  }

  /**
   * Tail-read new messages from an external agent's JSONL.
   */
  private tailMessages(agent: Agent): number {
    if (!agent.sessionId) return 0;
    const sessionFile = this.findSessionFileById(agent.config.provider, agent.sessionId, agent.config.directory);
    if (!sessionFile) return 0;

    const offset = this.tailOffsets.get(agent.id) ?? 0;
    let fileSize: number;
    try {
      fileSize = statSync(sessionFile).size;
    } catch { return 0; }

    if (fileSize <= offset) return 0;

    try {
      const fd = openSync(sessionFile, 'r');
      const buf = Buffer.alloc(fileSize - offset);
      readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);

      const newContent = buf.toString('utf-8');
      const newMessages: Agent['messages'] = [];
      let changed = false;

      for (const line of newContent.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (agent.config.provider === 'codex') {
            const snapshot: SessionSnapshot = {
              messages: agent.messages,
              sessionId: agent.sessionId,
              cwd: agent.config.directory,
              model: agent.config.flags.model,
              reasoningEffort: agent.config.flags.reasoningEffort,
              tokenUsage: agent.tokenUsage,
              contextWindow: agent.contextWindow,
              lastTimestamp: agent.lastActivity,
            };
            const beforeCount = agent.messages.length;
            this.applyCodexEntry(snapshot, entry);
            const appended = agent.messages.slice(beforeCount);
            if (appended.length > 0) {
              newMessages.push(...appended);
              changed = true;
            }
            if (snapshot.sessionId && agent.sessionId !== snapshot.sessionId) {
              agent.sessionId = snapshot.sessionId;
              changed = true;
            }
            if (snapshot.cwd && agent.config.directory !== snapshot.cwd) {
              agent.config.directory = snapshot.cwd;
              changed = true;
            }
            if (snapshot.model && agent.config.flags.model !== snapshot.model) {
              agent.config.flags.model = snapshot.model;
              changed = true;
            }
            const normalizedEffort = runtimeCapabilities.normalizeReasoningEffort(agent.config.provider, snapshot.reasoningEffort);
            if (normalizedEffort && agent.config.flags.reasoningEffort !== normalizedEffort) {
              agent.config.flags.reasoningEffort = normalizedEffort;
              changed = true;
            }
            if (snapshot.tokenUsage && (
              !agent.tokenUsage ||
              agent.tokenUsage.input !== snapshot.tokenUsage.input ||
              agent.tokenUsage.output !== snapshot.tokenUsage.output
            )) {
              agent.tokenUsage = snapshot.tokenUsage;
              changed = true;
            }
            if (snapshot.contextWindow && (
              !agent.contextWindow ||
              agent.contextWindow.used !== snapshot.contextWindow.used ||
              agent.contextWindow.total !== snapshot.contextWindow.total
            )) {
              agent.contextWindow = snapshot.contextWindow;
              changed = true;
            }
            if (snapshot.lastTimestamp && snapshot.lastTimestamp > agent.lastActivity) {
              agent.lastActivity = snapshot.lastTimestamp;
              changed = true;
            }
            const payloadType = typeof (entry as { payload?: { type?: unknown } }).payload?.type === 'string'
              ? (entry as { payload: { type: string } }).payload.type
              : '';
            if ((entry as { type?: string }).type === 'response_item' && payloadType === 'function_call_output') {
              // applyCodexEntry may update an existing tool message in place (no append).
              changed = true;
            }
          } else {
            const msg = this.jsonlEntryToMessage(entry);
            if (msg) newMessages.push(msg);
          }
        } catch { /* skip */ }
      }

      if (agent.config.provider !== 'codex' && newMessages.length > 0) {
        agent.messages.push(...newMessages);
        agent.lastActivity = Date.now();
        changed = true;
      }

      if (changed) {
        // Cap message history
        if (agent.messages.length > this.maxMessages * 2) {
          agent.messages = agent.messages.slice(-this.maxMessages);
        }
        this.store.saveAgent(agent);
        this.emit('agent:delta', agent.id, { newMessages, agent });
        this.emit('agent:update', agent.id, agent);
      }

      this.tailOffsets.set(agent.id, fileSize);
      return changed ? Math.max(newMessages.length, 1) : 0;
    } catch {
      return 0;
    }
  }

  private findSessionFileById(provider: AgentProvider, sessionId: string, cwd: string): string | null {
    if (provider === 'codex') {
      const codexDir = resolve(homedir(), '.codex', 'sessions');
      if (!existsSync(codexDir)) return null;
      const files = this.listCodexSessionFiles(codexDir);
      const matched = files.find((file) => file.includes(sessionId));
      return matched || null;
    }

    const claudeDir = resolve(homedir(), '.claude', 'projects');
    if (!existsSync(claudeDir)) return null;

    const encoded = this.encodeProjectPath(cwd);
    const jsonlPath = resolve(claudeDir, encoded, `${sessionId}.jsonl`);
    if (existsSync(jsonlPath)) return jsonlPath;

    // Scan all project dirs for this session ID
    try {
      for (const dir of readdirSync(claudeDir)) {
        const p = resolve(claudeDir, dir, `${sessionId}.jsonl`);
        if (existsSync(p)) return p;
      }
    } catch { /* */ }
    return null;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
