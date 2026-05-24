import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import type { AgentProvider, ReasoningEffort } from '../models/Agent.js';
import { runtimeCapabilities } from './RuntimeCapabilities.js';

export interface StreamMessage {
  type: string;
  subtype?: string;
  // claude: assistant message
  content_block_type?: string;
  text?: string;
  // claude: tool use
  tool_name?: string;
  // claude: result
  result?: {
    cost_usd?: number;
    session_id?: string;
    is_error?: boolean;
  };
  // codex: item.completed
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number;
    status?: string;
  };
  // codex: turn.completed usage
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  // codex: thread info
  thread_id?: string;
  // generic
  [key: string]: unknown;
}

export interface ProcessStartOpts {
  provider: AgentProvider;
  directory: string;
  prompt: string;
  dangerouslySkipPermissions?: boolean;
  resume?: string;
  model?: string;
  fullAuto?: boolean;
  askForApprovalNever?: boolean;
  sandboxDangerFullAccess?: boolean;
  chrome?: boolean;
  permissionMode?: string;
  maxBudgetUsd?: number;
  allowedTools?: string;
  disallowedTools?: string;
  addDirs?: string;
  mcpConfig?: string;
  reasoningEffort?: ReasoningEffort;
}

/** Shell-escape a string for use with spawn shell: true */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.resolve(serverRoot, '..');
const localToolBins = [
  path.join(serverRoot, 'node_modules', '.bin'),
  path.join(projectRoot, 'node_modules', '.bin'),
];
const proxyEnvKeys = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
];

function injectLocalToolBins(basePath?: string): string {
  const existing = (basePath || '').split(path.delimiter).filter(Boolean);
  const merged = [...localToolBins, ...existing];
  const deduped = [...new Set(merged)];
  return deduped.join(path.delimiter);
}

function readProjectDotenvProxyEnv(): Record<string, string> {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return {};

  const values: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !proxyEnvKeys.includes(match[1])) continue;

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) values[match[1]] = value;
  }

  return values;
}

export class AgentProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private _pid: number | undefined;
  private _provider: AgentProvider = 'claude';

  get pid(): number | undefined {
    return this._pid;
  }

  get provider(): AgentProvider {
    return this._provider;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  start(opts: ProcessStartOpts): void {
    this._provider = opts.provider;

    const { bin, args } = this.buildCommand(opts);

    // Clean env: remove Claude-specific vars to allow nested sessions
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    const dotenvProxyEnv = readProjectDotenvProxyEnv();
    for (const key of proxyEnvKeys) {
      if (!cleanEnv[key] && dotenvProxyEnv[key]) {
        cleanEnv[key] = dotenvProxyEnv[key];
      }
    }
    const pathKey = Object.keys(cleanEnv).find((key) => key.toLowerCase() === 'path') || 'PATH';
    cleanEnv[pathKey] = injectLocalToolBins(cleanEnv[pathKey]);

    this.process = spawn(bin, args, {
      cwd: opts.directory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
      shell: true,
      // detached: put shell in its own process group so we can signal the
      // entire group (shell + claude child) rather than just the shell.
      detached: true,
    });

    this._pid = this.process.pid;

    // With --input-format stream-json, Claude waits for user messages on stdin.
    // Send the initial prompt immediately so processing starts right away.
    // stdin stays open so permission responses and follow-ups can be delivered.
    if (opts.provider !== 'codex' && this.process.stdin?.writable) {
      const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: opts.prompt } });
      this.process.stdin.write(msg + '\n');
    } else if (opts.provider === 'codex' && this.process.stdin?.writable) {
      // Codex treats piped stdin as additional prompt input and waits for EOF.
      // We pass prompt via argv, so close stdin immediately to avoid hanging
      // on "Reading additional input from stdin...".
      this.process.stdin.end();
    }

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
      // Emit raw terminal data for live terminal attachment (base64 to preserve ANSI)
      this.emit('terminal', { stream: 'stdout', data: data.toString('base64') });
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('stderr', data.toString());
      this.emit('terminal', { stream: 'stderr', data: data.toString('base64') });
    });

    this.process.on('close', (code) => {
      this.process = null;
      this._pid = undefined;
      this.emit('exit', code);
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private buildCommand(opts: ProcessStartOpts): { bin: string; args: string[] } {
    if (opts.provider === 'codex') {
      return this.buildCodexCommand(opts);
    }
    return this.buildClaudeCommand(opts);
  }

  private buildClaudeCommand(opts: ProcessStartOpts): { bin: string; args: string[] } {
    const reasoningEffort = runtimeCapabilities.normalizeReasoningEffort('claude', opts.reasoningEffort);
    // -p is required for --resume to work in non-interactive mode.
    // --input-format stream-json keeps stdin open so the actual prompt (and any
    // permission approvals / follow-up messages) are sent via stdin after start.
    const args: string[] = [
      '-p', shellEscape(opts.prompt),
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
    ];

    if (opts.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (opts.resume) {
      args.push('--resume', shellEscape(opts.resume));
    }

    if (opts.model) {
      args.push('--model', shellEscape(opts.model));
    }

    if (reasoningEffort) {
      args.push('--effort', shellEscape(reasoningEffort));
    }

    if (opts.chrome) {
      args.push('--chrome');
    }

    if (opts.permissionMode) {
      args.push('--permission-mode', shellEscape(opts.permissionMode));
    }

    if (opts.maxBudgetUsd && opts.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', String(opts.maxBudgetUsd));
    }

    if (opts.allowedTools) {
      args.push('--allowedTools', shellEscape(opts.allowedTools));
    }

    if (opts.disallowedTools) {
      args.push('--disallowedTools', shellEscape(opts.disallowedTools));
    }

    if (opts.addDirs) {
      // Support multiple dirs separated by commas or spaces
      for (const dir of opts.addDirs.split(/[,\s]+/).filter(Boolean)) {
        args.push('--add-dir', shellEscape(dir));
      }
    }

    if (opts.mcpConfig) {
      args.push('--mcp-config', shellEscape(opts.mcpConfig));
    }

    return { bin: config.claudeBin, args };
  }

  private buildCodexCommand(opts: ProcessStartOpts): { bin: string; args: string[] } {
    const reasoningEffort = runtimeCapabilities.normalizeReasoningEffort('codex', opts.reasoningEffort);
    // Shell-escape values that may contain spaces since we use shell: true
    const isResume = !!opts.resume;
    const args: string[] = isResume
      ? ['exec', 'resume', '--json']
      : ['exec', '--json'];

    if (opts.dangerouslySkipPermissions) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (opts.fullAuto) {
      args.push('--full-auto');
    }

    if (opts.askForApprovalNever) {
      args.push('--ask-for-approval', 'never');
    }
    if (opts.sandboxDangerFullAccess) {
      args.push('--sandbox', 'danger-full-access');
    }

    if (opts.model) {
      args.push('--model', shellEscape(opts.model));
    }

    if (reasoningEffort) {
      args.push('-c', shellEscape(`model_reasoning_effort="${reasoningEffort}"`));
    }

    if (!isResume) {
      // Codex uses --cd instead of cwd for fresh exec runs, but we also set cwd.
      args.push('--cd', shellEscape(opts.directory));
    }
    args.push('--skip-git-repo-check');

    if (opts.resume) {
      // End option parsing before positional args so prompts like "--help"
      // are treated as user input rather than CLI flags.
      args.push('--', shellEscape(opts.resume));
    } else {
      args.push('--');
    }
    args.push(shellEscape(opts.prompt));

    return { bin: config.codexBin, args };
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg: StreamMessage = JSON.parse(trimmed);
        this.emit('message', msg);
      } catch {
        // Not JSON, emit as raw text
        this.emit('raw', trimmed);
      }
    }
  }

  sendMessage(text: string): void {
    if (this.process?.stdin?.writable) {
      // Claude --input-format stream-json format
      const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
      this.process.stdin.write(msg + '\n');
    }
  }

  interrupt(): void {
    if (this.process && this._pid) {
      try {
        // Kill entire process group (shell + claude child)
        process.kill(-this._pid, 'SIGINT');
      } catch {
        this.process.kill('SIGINT');
      }
    }
  }

  stop(): void {
    if (this.process && this._pid) {
      const pid = this._pid;
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        this.process.kill('SIGTERM');
      }
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch { /* already gone */ }
      }, 5000);
    }
  }
}
