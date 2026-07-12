import { describe, it, expect } from 'vitest';

describe('PendingQuestionBanner types', () => {
  it('PendingQuestionItem interface should be importable from shared', async () => {
    const mod = await import('@agent-monitor/shared');
    expect(mod).toBeDefined();
  });

  it('PendingQuestionBanner component should be importable', async () => {
    const mod = await import('../../src/components/PendingQuestionBanner');
    expect(mod.PendingQuestionBanner).toBeDefined();
    expect(typeof mod.PendingQuestionBanner).toBe('function');
  });
});
