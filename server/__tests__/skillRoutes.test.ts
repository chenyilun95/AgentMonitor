import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { vi } from 'vitest';
import { skillRoutes } from '../src/routes/skills.js';
import type { SkillManager } from '../src/services/SkillManager.js';

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

function createMockSkillManager(): SkillManager {
  return {
    listSkills: vi.fn().mockReturnValue([]),
    getSkill: vi.fn().mockReturnValue(null),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn().mockReturnValue(false),
    addScript: vi.fn(),
    deleteScript: vi.fn().mockReturnValue(false),
    getSkillsDir: vi.fn().mockReturnValue('/tmp/skills'),
    discoverLocalSkills: vi.fn().mockReturnValue([]),
    importLocalSkill: vi.fn(),
  } as unknown as SkillManager;
}

describe('Skill Routes', () => {
  let app: express.Express;
  let mockSkillManager: SkillManager;

  beforeEach(() => {
    mockSkillManager = createMockSkillManager();
    app = express();
    app.use(express.json());
    app.use('/api/skills', skillRoutes(mockSkillManager));
  });

  describe('GET /api/skills', () => {
    it('returns an empty array when no skills exist', async () => {
      const res = await request(app, 'GET', '/api/skills');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(mockSkillManager.listSkills).toHaveBeenCalled();
    });

    it('returns all skills', async () => {
      const skills = [
        { name: 'deploy', description: 'Deploy app', body: '# Deploy', scripts: [] },
        { name: 'lint', description: 'Lint code', body: '# Lint', scripts: ['run.sh'] },
      ];
      vi.mocked(mockSkillManager.listSkills).mockReturnValue(skills);

      const res = await request(app, 'GET', '/api/skills');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(skills);
    });
  });

  describe('local skill import', () => {
    it('discovers local skills with duplicate status', async () => {
      const candidates = [{
        id: 'codex:deploy',
        name: 'deploy',
        description: 'Deploy app',
        source: 'codex' as const,
        status: 'already_imported' as const,
        duplicateOf: 'deploy',
      }];
      vi.mocked(mockSkillManager.discoverLocalSkills).mockReturnValue(candidates);

      const res = await request(app, 'GET', '/api/skills/local/discover');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(candidates);
    });

    it('imports an available local skill', async () => {
      const skill = { name: 'deploy', description: 'Deploy app', body: '# Deploy', scripts: [] };
      vi.mocked(mockSkillManager.importLocalSkill).mockReturnValue({ imported: true, skill });

      const res = await request(app, 'POST', '/api/skills/local/import', { id: 'codex:deploy' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ imported: true, skill });
      expect(mockSkillManager.importLocalSkill).toHaveBeenCalledWith('codex:deploy');
    });

    it('rejects duplicate or conflicting local skills', async () => {
      vi.mocked(mockSkillManager.importLocalSkill).mockImplementation(() => {
        throw new Error('Skill cannot be imported: name_conflict (deploy)');
      });

      const res = await request(app, 'POST', '/api/skills/local/import', { id: 'claude:deploy' });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/skills/:name', () => {
    it('returns 404 for a non-existent skill', async () => {
      const res = await request(app, 'GET', '/api/skills/no-such-skill');
      expect(res.status).toBe(404);
      expect((res.body as { error: string }).error).toBe('Skill not found');
    });

    it('returns the skill when it exists', async () => {
      const skill = { name: 'deploy', description: 'Deploy app', body: '# Deploy', scripts: [] };
      vi.mocked(mockSkillManager.getSkill).mockReturnValue(skill);

      const res = await request(app, 'GET', '/api/skills/deploy');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(skill);
      expect(mockSkillManager.getSkill).toHaveBeenCalledWith('deploy');
    });
  });

  describe('POST /api/skills', () => {
    it('creates a skill and returns 201', async () => {
      const created = { name: 'deploy', description: 'Deploy app', body: '# Deploy', scripts: [] };
      vi.mocked(mockSkillManager.createSkill).mockReturnValue(created);

      const res = await request(app, 'POST', '/api/skills', {
        name: 'deploy',
        description: 'Deploy app',
        body: '# Deploy',
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(created);
      expect(mockSkillManager.createSkill).toHaveBeenCalledWith('deploy', 'Deploy app', '# Deploy');
    });

    it('creates a skill with empty body when body is omitted', async () => {
      const created = { name: 'deploy', description: 'Deploy app', body: '', scripts: [] };
      vi.mocked(mockSkillManager.createSkill).mockReturnValue(created);

      const res = await request(app, 'POST', '/api/skills', {
        name: 'deploy',
        description: 'Deploy app',
      });
      expect(res.status).toBe(201);
      expect(mockSkillManager.createSkill).toHaveBeenCalledWith('deploy', 'Deploy app', '');
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app, 'POST', '/api/skills', {
        description: 'Deploy app',
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('name and description are required');
    });

    it('returns 400 when description is missing', async () => {
      const res = await request(app, 'POST', '/api/skills', {
        name: 'deploy',
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('name and description are required');
    });

    it('returns 400 when createSkill throws', async () => {
      vi.mocked(mockSkillManager.createSkill).mockImplementation(() => {
        throw new Error('Skill "deploy" already exists');
      });

      const res = await request(app, 'POST', '/api/skills', {
        name: 'deploy',
        description: 'Deploy app',
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain('already exists');
    });
  });

  describe('PUT /api/skills/:name', () => {
    it('updates a skill and returns the updated version', async () => {
      const updated = { name: 'deploy', description: 'Deploy v2', body: '# Deploy v2', scripts: [] };
      vi.mocked(mockSkillManager.updateSkill).mockReturnValue(updated);

      const res = await request(app, 'PUT', '/api/skills/deploy', {
        description: 'Deploy v2',
        body: '# Deploy v2',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(mockSkillManager.updateSkill).toHaveBeenCalledWith('deploy', 'Deploy v2', '# Deploy v2');
    });

    it('returns 404 when updateSkill throws (skill not found)', async () => {
      vi.mocked(mockSkillManager.updateSkill).mockImplementation(() => {
        throw new Error('Skill "no-such" not found');
      });

      const res = await request(app, 'PUT', '/api/skills/no-such', {
        description: 'Updated',
      });
      expect(res.status).toBe(404);
      expect((res.body as { error: string }).error).toContain('not found');
    });
  });

  describe('DELETE /api/skills/:name', () => {
    it('returns 404 when skill does not exist', async () => {
      const res = await request(app, 'DELETE', '/api/skills/no-such');
      expect(res.status).toBe(404);
      expect((res.body as { error: string }).error).toBe('Skill not found');
    });

    it('deletes an existing skill and returns ok', async () => {
      vi.mocked(mockSkillManager.deleteSkill).mockReturnValue(true);

      const res = await request(app, 'DELETE', '/api/skills/deploy');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockSkillManager.deleteSkill).toHaveBeenCalledWith('deploy');
    });
  });
});
