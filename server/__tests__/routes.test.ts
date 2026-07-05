import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import { AgentStore } from '../src/store/AgentStore.js';
import type { Agent } from '../src/models/Agent.js';
import { AgentManager } from '../src/services/AgentManager.js';
import { agentRoutes } from '../src/routes/agents.js';
import { templateRoutes } from '../src/routes/templates.js';
import { directoryRoutes } from '../src/routes/directories.js';

// Simple test helper
async function request(app: express.Express, method: string, url: string, body?: unknown) {
  // Use a simple approach - create a test server
  const { createServer } = await import('http');

  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Bad address'));
        return;
      }

      const options: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (body) options.body = JSON.stringify(body);

      fetch(`http://127.0.0.1:${addr.port}${url}`, options)
        .then(async (res) => {
          const json = await res.json().catch(() => null);
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe('Template routes', () => {
  let tmpDir: string;
  let app: express.Express;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-test-'));
    const store = new AgentStore(tmpDir);
    app = express();
    app.use(express.json());
    app.use('/api/templates', templateRoutes(store));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and lists templates', async () => {
    // AgentStore seeds a default template on init, so capture the baseline count
    const baselineRes = await request(app, 'GET', '/api/templates');
    const baselineCount = (baselineRes.body as unknown[]).length;

    const createRes = await request(app, 'POST', '/api/templates', {
      name: 'Test',
      content: '# Test',
    });
    expect(createRes.status).toBe(201);

    const listRes = await request(app, 'GET', '/api/templates');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect((listRes.body as unknown[]).length).toBe(baselineCount + 1);
  });

  it('rejects template without name', async () => {
    const res = await request(app, 'POST', '/api/templates', { content: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('Directory routes', () => {
  let tmpDir: string;
  let app: express.Express;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dirroutes-test-'));
    fs.mkdirSync(path.join(tmpDir, 'testdir'));
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude');
    app = express();
    app.use(express.json());
    app.use('/api/directories', directoryRoutes());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists directory contents', async () => {
    const res = await request(
      app,
      'GET',
      `/api/directories?path=${encodeURIComponent(tmpDir)}`,
    );
    expect(res.status).toBe(200);
    const body = res.body as { entries: unknown[] };
    expect(body.entries).toBeDefined();
  });

  it('returns provider-specific instruction files when present', async () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Codex');

    const res = await request(
      app,
      'GET',
      `/api/directories/claude-md?path=${encodeURIComponent(tmpDir)}&provider=codex`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      exists: true,
      content: '# Codex',
      fileName: 'AGENTS.md',
      matchedProvider: 'codex',
    });
  });

  it('falls back to compatible instruction files across providers', async () => {
    const res = await request(
      app,
      'GET',
      `/api/directories/claude-md?path=${encodeURIComponent(tmpDir)}&provider=codex`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      exists: true,
      content: '# Claude',
      fileName: 'CLAUDE.md',
      matchedProvider: 'claude',
    });
  });
});

describe('Agent operator routes', () => {
  let tmpDir: string;
  let app: express.Express;
  let store: AgentStore;
  let manager: AgentManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroutes-test-'));
    store = new AgentStore(tmpDir);
    manager = new AgentManager(store);
    app = express();
    app.use(express.json());
    app.use('/api/agents', agentRoutes(manager, store));
  });

  afterEach(() => {
    const stuckCheckInterval = (manager as unknown as { stuckCheckInterval?: ReturnType<typeof setInterval> | null }).stuckCheckInterval;
    if (stuckCheckInterval) clearInterval(stuckCheckInterval);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns logs and operator context for an agent', async () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Test agent',
      status: 'waiting_input',
      config: {
        provider: 'codex',
        directory: tmpDir,
        prompt: 'test',
        flags: {},
      },
      workspaceMode: 'direct',
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'hello',
        timestamp: 1,
      }],
      logs: [
        {
          id: 'log-1',
          timestamp: 1,
          level: 'error',
          source: 'stderr',
          stream: 'stderr',
          message: 'boom',
        },
      ],
      lastActivity: 1,
      createdAt: 1,
      pendingQuestion: {
        id: 'question-1',
        toolUseId: 'tool-1',
        sourceMessageId: 'msg-1',
        createdAt: 1,
        questions: [{
          question: 'Continue?',
          options: [{ label: 'Yes' }],
        }],
      },
    };
    store.saveAgent(agent);

    const logsRes = await request(app, 'GET', '/api/agents/agent-1/logs?limit=1');
    expect(logsRes.status).toBe(200);
    expect((logsRes.body as { logs: unknown[] }).logs).toHaveLength(1);

    const contextRes = await request(app, 'GET', '/api/agents/agent-1/operator-context?messageLimit=1');
    expect(contextRes.status).toBe(200);
    const context = contextRes.body as {
      agent: { recentMessages: unknown[]; totalMessageCount: number };
      logs: unknown[];
      actions: Record<string, string>;
      interventionHints: Record<string, boolean>;
    };
    expect(context.agent.recentMessages).toHaveLength(1);
    expect(context.agent.totalMessageCount).toBe(1);
    expect(context.logs).toHaveLength(1);
    expect(context.actions.sendMessage).toContain('/api/agents/agent-1/message');
    expect(context.interventionHints.needsQuestionAnswer).toBe(true);
  });
});
