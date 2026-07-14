import { describe, expect, it } from 'vitest';
import type { Agent } from '../src/models/Agent.js';
import { classifyCodexStderr, normalizeStoredCodexStderr } from '../src/utils/codexStderr.js';

const modelRefresh = '2026-07-14T08:14:42.609848Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit\n';
const websocket = '2026-07-14T08:15:18.748939Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: tls handshake eof, url: wss://chatgpt.com/backend-api/codex/responses\n';
const mcp = '2026-07-14T08:08:12.100877Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Client(HttpRequest(HttpRequest("http/request failed: error sending request for url (https://developers.openai.com/mcp)")))\n';

describe('Codex stderr handling', () => {
  it('ignores the piped-stdin notice', () => {
    expect(classifyCodexStderr('Reading additional input from stdin...\n')).toBe('ignore');
  });

  it.each([modelRefresh, websocket, mcp])('downgrades recoverable runtime diagnostics', diagnostic => {
    expect(classifyCodexStderr(diagnostic)).toBe('warn');
  });

  it('keeps tool failures actionable', () => {
    expect(classifyCodexStderr('ERROR tool failed: missing file')).toBe('error');
  });

  it('cleans legacy duplicates and conversation noise', () => {
    const agent: Agent = {
      id: 'codex-agent',
      name: 'Codex agent',
      status: 'stopped',
      config: { provider: 'codex', directory: '/tmp', prompt: '', flags: {} },
      messages: [
        { id: 'm1', role: 'system', content: `[stderr] ${modelRefresh}`, timestamp: 1 },
        { id: 'm2', role: 'system', content: '[stderr] ERROR tool failed', timestamp: 2 },
      ],
      logs: [
        { id: 'l1', timestamp: 10, level: 'error', source: 'stderr', stream: 'stderr', message: modelRefresh },
        { id: 'l2', timestamp: 12, level: 'error', source: 'terminal', stream: 'stderr', message: modelRefresh },
        { id: 'l3', timestamp: 20, level: 'error', source: 'terminal', stream: 'stderr', message: 'Reading additional input from stdin...\n' },
        { id: 'l4', timestamp: 30, level: 'error', source: 'stderr', stream: 'stderr', message: 'ERROR tool failed' },
        { id: 'l5', timestamp: 32, level: 'error', source: 'terminal', stream: 'stderr', message: 'ERROR tool failed' },
      ],
      lastActivity: 1,
      createdAt: 1,
    };

    expect(normalizeStoredCodexStderr(agent)).toBe(true);
    expect(agent.logs).toMatchObject([
      { id: 'l1', level: 'warn' },
      { id: 'l4', level: 'error' },
    ]);
    expect(agent.messages.map(message => message.id)).toEqual(['m2']);
    expect(normalizeStoredCodexStderr(agent)).toBe(false);
  });

  it('does not rewrite Claude stderr', () => {
    const agent: Agent = {
      id: 'claude-agent',
      name: 'Claude agent',
      status: 'stopped',
      config: { provider: 'claude', directory: '/tmp', prompt: '', flags: {} },
      messages: [],
      logs: [{ id: 'l1', timestamp: 1, level: 'error', source: 'terminal', stream: 'stderr', message: modelRefresh }],
      lastActivity: 1,
      createdAt: 1,
    };

    expect(normalizeStoredCodexStderr(agent)).toBe(false);
    expect(agent.logs?.[0].level).toBe('error');
  });
});
