import { vi } from 'vitest';
import type { AgentClientView, AgentMessage } from '@agent-monitor/shared';

export type Agent = AgentClientView;

export function createMockMessage(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: 'assistant',
    content: 'Hello from the agent',
    timestamp: Date.now(),
    ...overrides,
  };
}

export function createMockAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: 'test-agent-1',
    name: 'Test Agent',
    status: 'stopped',
    config: {
      provider: 'claude',
      directory: '/tmp/test-project',
      prompt: 'test prompt',
      flags: {},
    },
    messages: [
      createMockMessage({ role: 'user', content: 'Hello' }),
      createMockMessage({ role: 'assistant', content: 'Hi there!' }),
    ],
    lastActivity: Date.now(),
    createdAt: Date.now() - 60000,
    ...overrides,
  };
}

export function createMockSocket() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  const socket = {
    connected: true,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return socket;
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners.get(event)?.delete(handler);
      return socket;
    }),
    emit: vi.fn(),
    simulateEvent(event: string, ...args: any[]) {
      listeners.get(event)?.forEach(handler => handler(...args));
    },
  };

  return socket;
}
