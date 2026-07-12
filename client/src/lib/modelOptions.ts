import type { AgentProvider, RuntimeCapabilities } from '@agent-monitor/shared';

export type ModelSelection = string | 'default';

const FALLBACK_MODELS: Record<AgentProvider, string[]> = {
  claude: [
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
  ],
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-codex', 'gpt-5'],
};

export function getSupportedModels(
  provider: AgentProvider,
  runtimeCapabilities?: RuntimeCapabilities | null,
): string[] {
  const detected = runtimeCapabilities?.providers?.[provider]?.models;
  return detected && detected.length > 0
    ? detected
    : FALLBACK_MODELS[provider];
}

export function isModelSupported(
  provider: AgentProvider,
  model: unknown,
  runtimeCapabilities?: RuntimeCapabilities | null,
): model is string {
  return typeof model === 'string' && getSupportedModels(provider, runtimeCapabilities).includes(model);
}

export function normalizeModelSelection(
  provider: AgentProvider,
  model: unknown,
  runtimeCapabilities?: RuntimeCapabilities | null,
  keepUnknown = false,
): ModelSelection {
  if (typeof model !== 'string' || !model.trim()) return 'default';
  const normalized = model.trim();
  if (isModelSupported(provider, normalized, runtimeCapabilities)) return normalized;
  return keepUnknown ? normalized : 'default';
}

export function getModelOptions(
  provider: AgentProvider,
  runtimeCapabilities?: RuntimeCapabilities | null,
  selectedModel?: string,
): Array<{ value: ModelSelection; label: string }> {
  const supported = getSupportedModels(provider, runtimeCapabilities);
  const options = ['default', ...supported] as ModelSelection[];

  if (selectedModel && !supported.includes(selectedModel)) {
    options.push(selectedModel);
  }

  return options.map((value) => ({
    value,
    label: value,
  }));
}
