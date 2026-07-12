import { describe, it, expect } from 'vitest';
import {
  isReasoningEffort,
  REASONING_EFFORTS,
  PROVIDER_REASONING_EFFORTS,
} from '../src/models/Agent.js';

describe('isReasoningEffort', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'returns true for valid effort "%s"',
    (effort) => {
      expect(isReasoningEffort(effort)).toBe(true);
    },
  );

  it.each([
    ['empty string', ''],
    ['invalid string', 'invalid'],
    ['null', null],
    ['undefined', undefined],
    ['number', 123],
    ['boolean', true],
  ])('returns false for invalid value: %s', (_label, value) => {
    expect(isReasoningEffort(value)).toBe(false);
  });
});

describe('REASONING_EFFORTS', () => {
  it('contains exactly 5 items', () => {
    expect(REASONING_EFFORTS).toHaveLength(5);
  });

  it('contains the expected values', () => {
    expect([...REASONING_EFFORTS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('PROVIDER_REASONING_EFFORTS', () => {
  it('has a non-empty array for claude', () => {
    expect(PROVIDER_REASONING_EFFORTS.claude.length).toBeGreaterThan(0);
  });

  it('has a non-empty array for codex', () => {
    expect(PROVIDER_REASONING_EFFORTS.codex.length).toBeGreaterThan(0);
  });

  it('all claude values are valid ReasoningEffort values', () => {
    for (const effort of PROVIDER_REASONING_EFFORTS.claude) {
      expect(isReasoningEffort(effort)).toBe(true);
    }
  });

  it('all codex values are valid ReasoningEffort values', () => {
    for (const effort of PROVIDER_REASONING_EFFORTS.codex) {
      expect(isReasoningEffort(effort)).toBe(true);
    }
  });
});
