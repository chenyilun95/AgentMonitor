import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import { AgentStore } from '../src/store/AgentStore.js';
import { settingsRoutes } from '../src/routes/agents.js';

// Simple test helper (same pattern as routes.test.ts)
async function request(app: express.Express, method: string, url: string, body?: unknown) {
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

describe('Settings Routes', () => {
  let tmpDir: string;
  let app: express.Express;
  let store: AgentStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settingsroutes-test-'));
    store = new AgentStore(tmpDir);
    app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRoutes(store));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/settings', () => {
    it('returns default settings', async () => {
      const res = await request(app, 'GET', '/api/settings');
      expect(res.status).toBe(200);

      const body = res.body as {
        agentRetentionMs: number;
        deleteSessionFilesPolicy: string;
        promptSuggestions: string[];
        pathHistory: Record<string, string[]>;
      };
      expect(body.agentRetentionMs).toBe(86_400_000);
      expect(body.deleteSessionFilesPolicy).toBe('keep');
      expect(Array.isArray(body.promptSuggestions)).toBe(true);
      expect(body.pathHistory).toBeDefined();
    });
  });

  describe('PUT /api/settings', () => {
    it('updates settings and returns the merged result', async () => {
      const res = await request(app, 'PUT', '/api/settings', {
        agentRetentionMs: 3600000,
        deleteSessionFilesPolicy: 'purge',
      });
      expect(res.status).toBe(200);

      const body = res.body as {
        agentRetentionMs: number;
        deleteSessionFilesPolicy: string;
      };
      expect(body.agentRetentionMs).toBe(3600000);
      expect(body.deleteSessionFilesPolicy).toBe('purge');

      // Verify the settings persisted by reading them back
      const getRes = await request(app, 'GET', '/api/settings');
      expect((getRes.body as { agentRetentionMs: number }).agentRetentionMs).toBe(3600000);
    });

    it('rejects invalid agentRetentionMs (negative)', async () => {
      const res = await request(app, 'PUT', '/api/settings', {
        agentRetentionMs: -1,
        deleteSessionFilesPolicy: 'keep',
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain('agentRetentionMs');
    });

    it('rejects invalid agentRetentionMs (non-number)', async () => {
      const res = await request(app, 'PUT', '/api/settings', {
        agentRetentionMs: 'forever',
        deleteSessionFilesPolicy: 'keep',
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain('agentRetentionMs');
    });

    it('rejects invalid deleteSessionFilesPolicy', async () => {
      const res = await request(app, 'PUT', '/api/settings', {
        agentRetentionMs: 1000,
        deleteSessionFilesPolicy: 'invalid-policy',
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain('deleteSessionFilesPolicy');
    });

    it('accepts all valid deleteSessionFilesPolicy values', async () => {
      for (const policy of ['ask', 'keep', 'purge']) {
        const res = await request(app, 'PUT', '/api/settings', {
          agentRetentionMs: 1000,
          deleteSessionFilesPolicy: policy,
        });
        expect(res.status).toBe(200);
        expect((res.body as { deleteSessionFilesPolicy: string }).deleteSessionFilesPolicy).toBe(policy);
      }
    });

    it('merges partial updates with existing settings', async () => {
      // First update just the retention
      const res1 = await request(app, 'PUT', '/api/settings', {
        agentRetentionMs: 5000,
      });
      expect(res1.status).toBe(200);

      // The existing deleteSessionFilesPolicy should still be present
      const body = res1.body as {
        agentRetentionMs: number;
        deleteSessionFilesPolicy: string;
        promptSuggestions: string[];
      };
      expect(body.agentRetentionMs).toBe(5000);
      expect(body.deleteSessionFilesPolicy).toBe('keep');
      expect(Array.isArray(body.promptSuggestions)).toBe(true);
    });
  });
});
