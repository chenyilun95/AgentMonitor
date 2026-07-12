import { describe, it, expect } from 'vitest';
import { getToolMessageDetails } from '../../src/lib/toolMessages';

describe('getToolMessageDetails', () => {
  it('returns null for non-tool messages', () => {
    expect(getToolMessageDetails({
      id: 'msg-1', role: 'user', content: 'hello', timestamp: 1,
    })).toBeNull();

    expect(getToolMessageDetails({
      id: 'msg-2', role: 'assistant', content: 'hi', timestamp: 1,
    })).toBeNull();
  });

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

  it('uses toolName as title when toolInput/toolResult are present', () => {
    const details = getToolMessageDetails({
      id: 'tool-3',
      role: 'tool',
      content: 'file contents here',
      toolName: 'Read',
      toolInput: '/tmp/file.txt',
      toolResult: 'file contents here',
      timestamp: 1,
    });

    expect(details).not.toBeNull();
    expect(details?.title).toBe('Read');
    expect(details?.input).toBe('/tmp/file.txt');
  });

  it('falls back to content first line when toolName is present but no structured fields', () => {
    const details = getToolMessageDetails({
      id: 'tool-4',
      role: 'tool',
      content: 'some output',
      toolName: 'Read',
      timestamp: 1,
    });

    expect(details).not.toBeNull();
    expect(details?.title).toBe('some output');
  });

  it('handles tool messages with empty content', () => {
    const details = getToolMessageDetails({
      id: 'tool-5',
      role: 'tool',
      content: '',
      timestamp: 1,
    });

    // Empty content tool messages still return a details object
    expect(details).not.toBeNull();
    expect(details?.title).toBe('Tool');
  });
});
