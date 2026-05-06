import { spawnSync } from 'child_process';
import { config } from '../config.js';
import type { AgentProvider, ReasoningEffort } from '../models/Agent.js';
import { isReasoningEffort } from '../models/Agent.js';

type DetectionSource = 'help' | 'version-threshold' | 'fallback' | 'unavailable';

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}

export interface ProviderRuntimeCapabilities {
  available: boolean;
  version?: string;
  reasoningEfforts: ReasoningEffort[];
  models: string[];
  detectedFrom: DetectionSource;
}

export interface RuntimeCapabilities {
  checkedAt: number;
  providers: Record<AgentProvider, ProviderRuntimeCapabilities>;
}

type CommandRunner = (bin: string, args: string[]) => CommandResult;

const CACHE_TTL_MS = 60_000;
const DEFAULT_CLAUDE_REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];
const DEFAULT_CODEX_REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];
const DEFAULT_CLAUDE_MODELS = [
  'sonnet',
  'opus',
  'haiku',
  'sonnet[1m]',
  'opusplan',
  'claude-sonnet-4-6',
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-5-haiku-20241022',
];
const LEGACY_CODEX_MODELS = ['gpt-5'];
const GPT54_CODEX_MODELS = [...LEGACY_CODEX_MODELS, 'gpt-5.4', 'gpt-5.4-mini'];
const DEFAULT_CODEX_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-codex', 'gpt-5'];
const CODEX_XHIGH_MIN_VERSION = '0.117.0';
const CODEX_GPT54_MIN_VERSION = '0.117.0';
const CODEX_GPT55_MIN_VERSION = '0.128.0';

function runCommand(bin: string, args: string[]): CommandResult {
  const result = spawnSync(bin, args, {
    encoding: 'utf-8',
    timeout: 5000,
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    error: result.error ? new Error(String(result.error.message || result.error)) : undefined,
  };
}

function parseVersion(text: string): string | undefined {
  return text.match(/\b\d+\.\d+\.\d+\b/)?.[0];
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => parseInt(part, 10));
  const rightParts = right.split('.').map((part) => parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function uniqueEfforts(values: string[]): ReasoningEffort[] {
  const seen = new Set<ReasoningEffort>();
  const efforts: ReasoningEffort[] = [];

  for (const value of values) {
    if (!isReasoningEffort(value) || seen.has(value)) continue;
    seen.add(value);
    efforts.push(value);
  }

  return efforts;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export class RuntimeCapabilitiesService {
  private cache?: RuntimeCapabilities;
  private cacheAt = 0;

  constructor(
    private readonly commandRunner: CommandRunner = runCommand,
    private readonly cacheTtlMs = CACHE_TTL_MS,
  ) {}

  getCapabilities(forceRefresh = false): RuntimeCapabilities {
    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.cacheAt < this.cacheTtlMs) {
      return this.cache;
    }

    this.cache = {
      checkedAt: now,
      providers: {
        claude: this.detectClaude(),
        codex: this.detectCodex(),
      },
    };
    this.cacheAt = now;

    return this.cache;
  }

  getSupportedReasoningEfforts(provider: AgentProvider): ReasoningEffort[] {
    return this.getCapabilities().providers[provider].reasoningEfforts;
  }

  getSupportedModels(provider: AgentProvider): string[] {
    return this.getCapabilities().providers[provider].models;
  }

  isReasoningEffortSupported(provider: AgentProvider, effort: unknown): effort is ReasoningEffort {
    return typeof effort === 'string' && this.getSupportedReasoningEfforts(provider).includes(effort as ReasoningEffort);
  }

  normalizeReasoningEffort(provider: AgentProvider, effort: unknown): ReasoningEffort | undefined {
    return this.isReasoningEffortSupported(provider, effort) ? effort : undefined;
  }

  isModelSupported(provider: AgentProvider, model: unknown): model is string {
    return typeof model === 'string' && this.getSupportedModels(provider).includes(model);
  }

  private detectClaude(): ProviderRuntimeCapabilities {
    const versionResult = this.commandRunner(config.claudeBin, ['--version']);
    const helpResult = this.commandRunner(config.claudeBin, ['--help']);
    const version = parseVersion([versionResult.stdout, versionResult.stderr].join('\n'));
    const helpText = [helpResult.stdout, helpResult.stderr].join('\n');
    const reasoningEfforts = this.parseClaudeEfforts(helpText);
    const parsedModels = this.parseClaudeModels(helpText);
    const models = uniqueStrings([...DEFAULT_CLAUDE_MODELS, ...parsedModels]);

    if (reasoningEfforts.length > 0) {
      return {
        available: true,
        version,
        reasoningEfforts,
        models,
        detectedFrom: 'help',
      };
    }

    const available = !versionResult.error || !helpResult.error;
    if (!available) {
      return {
        available: false,
        version,
        reasoningEfforts: [],
        models: [],
        detectedFrom: 'unavailable',
      };
    }

    return {
      available: true,
      version,
      reasoningEfforts: DEFAULT_CLAUDE_REASONING_EFFORTS,
      models,
      detectedFrom: 'fallback',
    };
  }

  private detectCodex(): ProviderRuntimeCapabilities {
    const versionResult = this.commandRunner(config.codexBin, ['--version']);
    const versionText = [versionResult.stdout, versionResult.stderr].join('\n');
    const version = parseVersion(versionText);

    if (versionResult.error && !version) {
      return {
        available: false,
        version,
        reasoningEfforts: [],
        models: [],
        detectedFrom: 'unavailable',
      };
    }

    const reasoningEfforts: ReasoningEffort[] = version && compareVersions(version, CODEX_XHIGH_MIN_VERSION) >= 0
      ? [...DEFAULT_CODEX_REASONING_EFFORTS, 'xhigh']
      : [...DEFAULT_CODEX_REASONING_EFFORTS];
    const models = version && compareVersions(version, CODEX_GPT55_MIN_VERSION) >= 0
      ? [...DEFAULT_CODEX_MODELS]
      : version && compareVersions(version, CODEX_GPT54_MIN_VERSION) >= 0
        ? [...GPT54_CODEX_MODELS]
        : [...LEGACY_CODEX_MODELS];

    return {
      available: true,
      version,
      reasoningEfforts,
      models,
      detectedFrom: version ? 'version-threshold' : 'fallback',
    };
  }

  private parseClaudeEfforts(helpText: string): ReasoningEffort[] {
    const effortLine = helpText
      .split('\n')
      .find((line) => line.includes('--effort'));

    if (!effortLine) return [];

    return uniqueEfforts(effortLine.match(/\b(low|medium|high|xhigh|max)\b/g) || []);
  }

  private parseClaudeModels(helpText: string): string[] {
    const modelLine = helpText
      .split('\n')
      .find((line) => line.includes('--model <model>'));

    if (!modelLine) return [];

    const quotedMatches = [...modelLine.matchAll(/'([^']+)'/g)];
    const quotedModels = quotedMatches
      .map((match) => match[1])
      .filter((model) => /^[A-Za-z0-9][A-Za-z0-9.:_[\]@/-]*$/.test(model));
    return uniqueStrings(quotedModels);
  }
}

export const runtimeCapabilities = new RuntimeCapabilitiesService();
