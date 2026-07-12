import type { AgentProvider } from '../models/Agent.js';

export const INSTRUCTION_FILE_BY_PROVIDER: Record<AgentProvider, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
};

export function getInstructionFileName(provider: AgentProvider): string {
  return INSTRUCTION_FILE_BY_PROVIDER[provider];
}
