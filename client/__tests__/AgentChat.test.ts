import { describe, it, expect } from 'vitest';
import { getToolMessageDetails } from '../src/lib/toolMessages';

describe('getToolMessageDetails', () => {
  it('treats legacy codex content-only tool messages as foldable', () => {
    const details = getToolMessageDetails({
      id: 'tool-1',
      role: 'tool',
      content: 'Command: pwd\nOutput: /tmp/project\n(exit: 0)',
      timestamp: 1,
    });

    expect(details).not.toBeNull();
    expect(details?.title).toBe('Command: pwd');
    expect(details?.details).toContain('Output: /tmp/project');
  });

  it('prefers structured tool fields when present', () => {
    const details = getToolMessageDetails({
      id: 'tool-2',
      role: 'tool',
      content: 'Command: pwd',
      toolName: 'command',
      toolInput: 'pwd',
      toolResult: '/tmp/project\n[exit code] 0',
      timestamp: 1,
    });

    expect(details).not.toBeNull();
    expect(details?.title).toBe('Command: pwd');
    expect(details?.input).toBe('pwd');
    expect(details?.output).toContain('[exit code] 0');
  });
});
