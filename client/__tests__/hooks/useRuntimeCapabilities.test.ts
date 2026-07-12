import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/api/client', () => ({
  api: {
    getRuntimeCapabilities: vi.fn(),
  },
}));

// Mock React hooks to run synchronously for testing.
let stateValue: any = null;
let stateSetter: ((v: any) => void) | null = null;
let effectCallback: (() => void) | null = null;

vi.mock('react', () => ({
  useState: vi.fn((initial: any) => {
    stateValue = initial;
    stateSetter = (v: any) => {
      stateValue = v;
    };
    return [stateValue, stateSetter];
  }),
  useEffect: vi.fn((cb: () => void) => {
    effectCallback = cb;
  }),
}));

import { api } from '../../src/api/client';
import { useRuntimeCapabilities } from '../../src/hooks/useRuntimeCapabilities';

const mockedGetRuntimeCapabilities = api.getRuntimeCapabilities as ReturnType<typeof vi.fn>;

describe('useRuntimeCapabilities', () => {
  beforeEach(() => {
    stateValue = null;
    stateSetter = null;
    effectCallback = null;
    vi.clearAllMocks();
  });

  it('returns null initially', () => {
    mockedGetRuntimeCapabilities.mockReturnValue(new Promise(() => {})); // never resolves
    const result = useRuntimeCapabilities();

    expect(result).toBeNull();
  });

  it('returns capabilities after fetch resolves', async () => {
    const capabilities = { providers: ['claude'], reasoningEffort: true };
    mockedGetRuntimeCapabilities.mockResolvedValue(capabilities);

    useRuntimeCapabilities();

    // Run the effect
    expect(effectCallback).toBeDefined();
    effectCallback!();

    // Wait for the promise to resolve and the setter to be called
    await vi.waitFor(() => {
      expect(stateValue).toEqual(capabilities);
    });
  });

  it('handles fetch failure gracefully and returns null', async () => {
    mockedGetRuntimeCapabilities.mockRejectedValue(new Error('network error'));

    const result = useRuntimeCapabilities();

    // Run the effect
    effectCallback!();

    // Wait for the rejection to be caught
    await vi.waitFor(() => {
      expect(mockedGetRuntimeCapabilities).toHaveBeenCalled();
    });

    // State should remain null (the .catch(() => {}) swallows the error)
    expect(stateValue).toBeNull();
    expect(result).toBeNull();
  });
});
