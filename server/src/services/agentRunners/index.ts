import type { AgentProvider } from '../../models/Agent.js';
import { claudeRunner } from './claudeRunner.js';
import { codexRunner } from './codexRunner.js';
import type { AgentRunner } from './types.js';

const runners: Record<AgentProvider, AgentRunner> = {
  claude: claudeRunner,
  codex: codexRunner,
};

export function getAgentRunner(provider: AgentProvider): AgentRunner {
  return runners[provider];
}

export { claudeRunner } from './claudeRunner.js';
export { codexRunner } from './codexRunner.js';
export type { AgentCommand, AgentRunner } from './types.js';
