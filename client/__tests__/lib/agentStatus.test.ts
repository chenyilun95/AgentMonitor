import { describe, it, expect } from 'vitest';
import { getAgentStatusClass, getAgentStatusLabel } from '../../src/lib/agentStatus';

describe('getAgentStatusClass', () => {
  it('maps stopped to waiting_input class', () => {
    expect(getAgentStatusClass('stopped')).toBe('waiting_input');
  });

  it('passes through other statuses', () => {
    expect(getAgentStatusClass('running')).toBe('running');
    expect(getAgentStatusClass('error')).toBe('error');
    expect(getAgentStatusClass('waiting_input')).toBe('waiting_input');
  });
});

describe('getAgentStatusLabel', () => {
  it('maps stopped to waiting', () => {
    expect(getAgentStatusLabel('stopped')).toBe('waiting');
  });

  it('maps waiting_input to waiting', () => {
    expect(getAgentStatusLabel('waiting_input')).toBe('waiting');
  });

  it('passes through running', () => {
    expect(getAgentStatusLabel('running')).toBe('running');
  });

  it('passes through error', () => {
    expect(getAgentStatusLabel('error')).toBe('error');
  });
});
