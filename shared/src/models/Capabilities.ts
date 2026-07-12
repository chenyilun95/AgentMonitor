import type { AgentProvider, ReasoningEffort } from './Agent.js';

export interface ProviderRuntimeCapabilities {
  available: boolean;
  version?: string;
  reasoningEfforts: ReasoningEffort[];
  models: string[];
  detectedFrom: 'help' | 'version-threshold' | 'fallback' | 'unavailable';
}

export interface RuntimeCapabilities {
  checkedAt: number;
  providers: Record<AgentProvider, ProviderRuntimeCapabilities>;
}
