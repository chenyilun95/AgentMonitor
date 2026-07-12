import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('../../src/api/socket', () => ({
  getSocket: () => mockSocket,
}));

// Capture the useEffect callback and its cleanup so we can invoke them manually.
let effectCallback: (() => (() => void) | void) | null = null;

vi.mock('react', () => ({
  useEffect: vi.fn((cb: () => (() => void) | void) => {
    effectCallback = cb;
  }),
}));

import { useSocket } from '../../src/hooks/useSocket';

describe('useSocket', () => {
  beforeEach(() => {
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    effectCallback = null;
  });

  it('subscribes to the specified event on mount', () => {
    const handler = vi.fn();
    useSocket('agents:update' as any, handler);

    // The useEffect callback should have been captured
    expect(effectCallback).toBeDefined();
    // Execute the effect (simulating mount)
    effectCallback!();

    expect(mockSocket.on).toHaveBeenCalledWith('agents:update', handler);
  });

  it('unsubscribes on unmount via cleanup function', () => {
    const handler = vi.fn();
    useSocket('agents:update' as any, handler);

    // Execute the effect and get the cleanup
    const cleanup = effectCallback!();

    expect(typeof cleanup).toBe('function');
    // Execute cleanup (simulating unmount)
    (cleanup as () => void)();

    expect(mockSocket.off).toHaveBeenCalledWith('agents:update', handler);
  });

  it('calls the handler when the registered listener fires', () => {
    const handler = vi.fn();
    useSocket('agents:update' as any, handler);
    effectCallback!();

    // The handler passed to socket.on is the same handler we provided
    const registeredHandler = mockSocket.on.mock.calls[0][1];
    registeredHandler('test-data');

    expect(handler).toHaveBeenCalledWith('test-data');
  });
});
