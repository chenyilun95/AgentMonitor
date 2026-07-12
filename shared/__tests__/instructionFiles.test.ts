import { describe, it, expect } from 'vitest';
import {
  INSTRUCTION_FILE_BY_PROVIDER,
  getInstructionFileName,
} from '../src/constants/instructionFiles.js';

describe('INSTRUCTION_FILE_BY_PROVIDER', () => {
  it('maps claude to CLAUDE.md', () => {
    expect(INSTRUCTION_FILE_BY_PROVIDER.claude).toBe('CLAUDE.md');
  });

  it('maps codex to AGENTS.md', () => {
    expect(INSTRUCTION_FILE_BY_PROVIDER.codex).toBe('AGENTS.md');
  });
});

describe('getInstructionFileName', () => {
  it('returns CLAUDE.md for claude', () => {
    expect(getInstructionFileName('claude')).toBe('CLAUDE.md');
  });

  it('returns AGENTS.md for codex', () => {
    expect(getInstructionFileName('codex')).toBe('AGENTS.md');
  });
});
