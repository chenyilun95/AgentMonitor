import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import type { Agent } from '../models/Agent.js';
import type { Template } from '../models/Template.js';
import type { PipelineTask, AgentManagerConfig, MetaAgentConfig } from '../models/Task.js';
import type { ServerSettings } from '@agent-monitor/shared';
import { normalizeUserPath } from '../utils/pathUtils.js';

export type { ServerSettings };

const DEFAULT_SETTINGS: ServerSettings = {
  agentRetentionMs: 86_400_000, // 24 hours
  deleteSessionFilesPolicy: 'keep',
  opencliTemplateSeeded: false,
  promptSuggestions: [
    'kick off',
    'keep working until confirmed all required features implemented without bugs during test',
    'review the codebase and suggest improvements',
    'fix the failing tests',
    'refactor for better readability and maintainability',
  ],
  pathHistory: {},
};

const DEFAULT_OPENCLI_TEMPLATE_NAME = 'OpenCLI Skill Starter';
const DEFAULT_OPENCLI_TEMPLATE_CONTENT = `# OpenCLI Skill Starter

Use this instruction block to make the agent actively leverage \`opencli\`.

## When to use OpenCLI

- Website operations (search/extract/publish/download) that are hard to do reliably with plain HTTP.
- Browser automation steps that need UI interaction.
- Tasks where a supported external CLI is already exposed through OpenCLI.

## Recommended flow

1. Run \`opencli list\` once to discover available commands in this environment.
2. For browser-backed commands, run \`opencli doctor\` first and verify bridge/daemon status.
3. Prefer structured output for machine parsing:
   - Use \`-f json\` whenever possible.
4. If a command fails because login/session is missing, report the exact blocker and suggest the next manual step.

## Guardrails

- Do not exfiltrate credentials, cookies, or private account data.
- Keep commands deterministic and auditable (show exact command used).
- Prefer read-only operations unless the task explicitly asks for write/publish actions.
`;

const DEFAULT_KARPATHY_TEMPLATE_NAME = 'Karpathy Coding Guardrails';
const DEFAULT_KARPATHY_TEMPLATE_CONTENT = `# Karpathy Coding Guardrails

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
`;

const DEFAULT_BUILTIN_TEMPLATES = [
  {
    name: DEFAULT_OPENCLI_TEMPLATE_NAME,
    content: DEFAULT_OPENCLI_TEMPLATE_CONTENT,
    matches: (template: Template) =>
      template.name === DEFAULT_OPENCLI_TEMPLATE_NAME
      || template.content.includes('# OpenCLI Skill Starter'),
  },
  {
    name: DEFAULT_KARPATHY_TEMPLATE_NAME,
    content: DEFAULT_KARPATHY_TEMPLATE_CONTENT,
    matches: (template: Template) =>
      template.name === DEFAULT_KARPATHY_TEMPLATE_NAME
      || template.content.includes('# Karpathy Coding Guardrails')
      || template.content.includes('Behavioral guidelines to reduce common LLM coding mistakes.'),
  },
];

export class AgentStore {
  private agents: Map<string, Agent> = new Map();
  private templates: Map<string, Template> = new Map();
  private tasks: Map<string, PipelineTask> = new Map();
  private metaConfig: AgentManagerConfig | null = null;
  private settings: ServerSettings = { ...DEFAULT_SETTINGS };
  private agentsFile: string;
  private templatesFile: string;
  private tasksFile: string;
  private metaConfigFile: string;
  private settingsFile: string;

  constructor(dataDir?: string) {
    const dir = dataDir || config.dataDir;
    fs.mkdirSync(dir, { recursive: true });
    this.agentsFile = path.join(dir, 'agents.json');
    this.templatesFile = path.join(dir, 'templates.json');
    this.tasksFile = path.join(dir, 'tasks.json');
    this.metaConfigFile = path.join(dir, 'meta-agent.json');
    this.settingsFile = path.join(dir, 'settings.json');
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.agentsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.agentsFile, 'utf-8'));
        for (const a of data) {
          this.agents.set(a.id, a);
        }
      } catch {
        // ignore corrupt file
      }
    }
    if (fs.existsSync(this.templatesFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.templatesFile, 'utf-8'));
        for (const t of data) {
          this.templates.set(t.id, t);
        }
      } catch {
        // ignore corrupt file
      }
    }
    if (fs.existsSync(this.tasksFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.tasksFile, 'utf-8'));
        for (const t of data) {
          this.tasks.set(t.id, t);
        }
      } catch {
        // ignore corrupt file
      }
    }
    if (fs.existsSync(this.metaConfigFile)) {
      try {
        this.metaConfig = JSON.parse(fs.readFileSync(this.metaConfigFile, 'utf-8'));
      } catch {
        // ignore corrupt file
      }
    }
    if (fs.existsSync(this.settingsFile)) {
      try {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(this.settingsFile, 'utf-8')) };
        if (!['ask', 'keep', 'purge'].includes(this.settings.deleteSessionFilesPolicy)) {
          this.settings.deleteSessionFilesPolicy = DEFAULT_SETTINGS.deleteSessionFilesPolicy;
        }
      } catch {
        // ignore corrupt file
      }
    }

    this.ensureBuiltinTemplates();
  }

  private ensureBuiltinTemplates(): void {
    let changed = false;
    for (const builtin of DEFAULT_BUILTIN_TEMPLATES) {
      const existing = [...this.templates.values()].find((template) => builtin.matches(template));
      if (existing) continue;

      const now = Date.now();
      const template: Template = {
        id: randomUUID(),
        name: builtin.name,
        content: builtin.content,
        createdAt: now,
        updatedAt: now,
      };
      this.templates.set(template.id, template);
      changed = true;
    }

    if (changed) this.saveTemplates();

    // Preserve/upgrade the legacy marker so older settings files stay forward-compatible.
    this.settings.opencliTemplateSeeded = true;
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
  }

  private saveAgents(): void {
    fs.writeFileSync(
      this.agentsFile,
      JSON.stringify([...this.agents.values()], null, 2),
    );
  }

  private saveTemplates(): void {
    fs.writeFileSync(
      this.templatesFile,
      JSON.stringify([...this.templates.values()], null, 2),
    );
  }

  private saveTasks(): void {
    fs.writeFileSync(
      this.tasksFile,
      JSON.stringify([...this.tasks.values()], null, 2),
    );
  }

  private saveMetaConfig(): void {
    if (this.metaConfig) {
      fs.writeFileSync(
        this.metaConfigFile,
        JSON.stringify(this.metaConfig, null, 2),
      );
    }
  }

  // Agent methods
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): Agent[] {
    return [...this.agents.values()];
  }

  saveAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.saveAgents();
  }

  deleteAgent(id: string): boolean {
    const deleted = this.agents.delete(id);
    if (deleted) this.saveAgents();
    return deleted;
  }

  // Template methods
  getTemplate(id: string): Template | undefined {
    return this.templates.get(id);
  }

  getAllTemplates(): Template[] {
    return [...this.templates.values()];
  }

  saveTemplate(template: Template): void {
    this.templates.set(template.id, template);
    this.saveTemplates();
  }

  deleteTemplate(id: string): boolean {
    const deleted = this.templates.delete(id);
    if (deleted) this.saveTemplates();
    return deleted;
  }

  // Task methods
  getTask(id: string): PipelineTask | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): PipelineTask[] {
    return [...this.tasks.values()].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  saveTask(task: PipelineTask): void {
    this.tasks.set(task.id, task);
    this.saveTasks();
  }

  deleteTask(id: string): boolean {
    const deleted = this.tasks.delete(id);
    if (deleted) this.saveTasks();
    return deleted;
  }

  clearCompletedTasks(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        this.tasks.delete(id);
      }
    }
    this.saveTasks();
  }

  // Agent Manager config methods
  getMetaConfig(): AgentManagerConfig | null {
    return this.metaConfig;
  }

  saveMetaAgentConfig(cfg: AgentManagerConfig): void {
    this.metaConfig = cfg;
    this.saveMetaConfig();
  }

  // Server settings methods
  getSettings(): ServerSettings {
    return { ...this.settings };
  }

  saveSettings(settings: ServerSettings): void {
    this.settings = { ...settings };
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
  }

  recordPath(machine: string, dirPath: string): void {
    if (!this.settings.pathHistory) this.settings.pathHistory = {};
    const normalizedPath = normalizeUserPath(dirPath);
    const paths = this.settings.pathHistory[machine] || [];
    // Move to front if exists, otherwise prepend (max 20 per machine)
    const filtered = paths.filter(p => normalizeUserPath(p) !== normalizedPath);
    this.settings.pathHistory[machine] = [normalizedPath, ...filtered].slice(0, 20);
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
  }
}
