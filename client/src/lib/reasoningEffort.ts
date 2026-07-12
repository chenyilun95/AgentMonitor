import type { AgentProvider, ReasoningEffort, RuntimeCapabilities } from '@agent-monitor/shared';

export type ReasoningEffortSelection = ReasoningEffort | 'default';

const FALLBACK_REASONING_EFFORTS: Record<AgentProvider, ReasoningEffort[]> = {
  claude: ['low', 'medium', 'high'],
  codex: ['low', 'medium', 'high', 'xhigh'],
};

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

export function getSupportedReasoningEfforts(
  provider: AgentProvider,
  runtimeCapabilities?: RuntimeCapabilities | null,
): ReasoningEffort[] {
  const detected = runtimeCapabilities?.providers?.[provider]?.reasoningEfforts;
  return detected && detected.length > 0
    ? detected
    : FALLBACK_REASONING_EFFORTS[provider];
}

export function getReasoningEffortOptions(
  provider: AgentProvider,
  runtimeCapabilities?: RuntimeCapabilities | null,
): Array<{ value: ReasoningEffortSelection; label: string }> {
  return [
    { value: 'default', label: 'Default' },
    ...getSupportedReasoningEfforts(provider, runtimeCapabilities).map((value) => ({
      value,
      label: REASONING_EFFORT_LABELS[value],
    })),
  ];
}

export function isReasoningEffortSupported(
  provider: AgentProvider,
  effort: unknown,
  runtimeCapabilities?: RuntimeCapabilities | null,
): effort is ReasoningEffort {
  return typeof effort === 'string' && getSupportedReasoningEfforts(provider, runtimeCapabilities).includes(effort as ReasoningEffort);
}

export function normalizeReasoningEffortSelection(
  provider: AgentProvider,
  effort: unknown,
  runtimeCapabilities?: RuntimeCapabilities | null,
): ReasoningEffortSelection {
  return isReasoningEffortSupported(provider, effort, runtimeCapabilities)
    ? effort
    : 'default';
}

export function getReasoningEffortLabel(effort?: ReasoningEffort): string {
  return effort ? REASONING_EFFORT_LABELS[effort] : 'default';
}
