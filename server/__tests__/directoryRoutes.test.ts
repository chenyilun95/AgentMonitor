import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { directoryRoutes } from '../src/routes/directories.js';
import { AgentStore } from '../src/store/AgentStore.js';

async function request(app: express.Express, method: string, url: string, body?: unknown) {
  const { createServer } = await import('http');
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Bad address'));
        return;
      }
      fetch(`http://127.0.0.1:${address.port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).then(async (response) => {
        const responseBody = await response.json();
        server.close();
        resolve({ status: response.status, body: responseBody });
      }).catch((error) => {
        server.close();
        reject(error);
      });
    });
  });
}

describe('saved directory routes', () => {
  let tmpDir: string;
  let projectDir: string;
  let store: AgentStore;
  let app: express.Express;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-routes-test-'));
    projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(projectDir);
    store = new AgentStore(path.join(tmpDir, 'data'));
    app = express();
    app.use(express.json());
    app.use('/api/directories', directoryRoutes(store));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists and removes a saved directory', async () => {
    const create = await request(app, 'POST', '/api/directories/saved', { path: projectDir });
    expect(create.status).toBe(201);
    expect(Object.values(store.getSettings().pathHistory).flat()).toContain(projectDir);

    const list = await request(app, 'GET', '/api/directories/saved');
    expect(list.status).toBe(200);
    expect((list.body as { paths: string[] }).paths).toContain(projectDir);

    const remove = await request(
      app,
      'DELETE',
      `/api/directories/saved?path=${encodeURIComponent(projectDir)}`,
    );
    expect(remove.status).toBe(200);
    expect(Object.values(store.getSettings().pathHistory).flat()).not.toContain(projectDir);
  });

  it('rejects a path that is not an existing directory', async () => {
    const response = await request(app, 'POST', '/api/directories/saved', {
      path: path.join(tmpDir, 'missing'),
    });
    expect(response.status).toBe(400);
  });
});
