import { Router } from 'express';
import { existsSync, statSync } from 'fs';
import os from 'os';
import { DirectoryBrowser, FileReadError } from '../services/DirectoryBrowser.js';
import type { AgentStore } from '../store/AgentStore.js';
import type { AgentProvider } from '../models/Agent.js';
import { findInstructionFile } from '../utils/instructionFiles.js';
import { normalizeUserPath, portableUserPath } from '../utils/pathUtils.js';
import { getGitDirectoryInfo, GitOperationError, pullDirectory, pushDirectory } from '../services/GitOperations.js';

export function directoryRoutes(store?: AgentStore): Router {
  const router = Router();
  const browser = new DirectoryBrowser();

  router.get('/validate', (req, res) => {
    const rawPath = req.query.path as string;
    if (!rawPath?.trim()) {
      res.json({ exists: false });
      return;
    }
    const dirPath = normalizeUserPath(rawPath);
    let exists = false;
    try {
      exists = existsSync(dirPath) && statSync(dirPath).isDirectory();
    } catch { /* inaccessible or disappeared */ }
    res.json({ exists, path: dirPath });
  });

  router.get('/saved', (_req, res) => {
    if (!store) {
      res.status(501).json({ error: 'Saved directories are unavailable' });
      return;
    }
    const currentMachine = os.hostname();
    const paths = Object.entries(store.getSettings().pathHistory || {}).flatMap(([machine, entries]) => (
      entries.map(entry => machine === currentMachine ? portableUserPath(entry) : entry)
    ));
    res.json({ paths: Array.from(new Set(paths)) });
  });

  router.post('/saved', (req, res) => {
    if (!store) {
      res.status(501).json({ error: 'Saved directories are unavailable' });
      return;
    }
    const rawPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    if (!rawPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const dirPath = normalizeUserPath(rawPath);
    try {
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
        res.status(400).json({ error: 'Directory does not exist' });
        return;
      }
      store.recordPath(os.hostname(), dirPath);
      res.status(201).json({ path: portableUserPath(dirPath) });
    } catch {
      res.status(400).json({ error: 'Directory is not accessible' });
    }
  });

  router.delete('/saved', (req, res) => {
    if (!store) {
      res.status(501).json({ error: 'Saved directories are unavailable' });
      return;
    }
    const rawPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!rawPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    store.removePath(rawPath);
    res.json({ ok: true });
  });

  router.get('/git-info', (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!rawPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    res.json(getGitDirectoryInfo(rawPath));
  });

  router.post('/git-pull', async (req, res) => {
    try {
      if (typeof req.body?.path !== 'string' || !req.body.path.trim()) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      const target = getGitDirectoryInfo(req.body.path);
      const activeDirect = store?.getAllAgents().find(agent => {
        if (agent.workspaceMode !== 'direct' || !['running', 'waiting_input'].includes(agent.status)) return false;
        const info = getGitDirectoryInfo(agent.config.directory);
        return target.root && info.root === target.root;
      });
      if (activeDirect) {
        res.status(409).json({ error: `Stop Direct Edit agent "${activeDirect.name}" before pulling this repository.` });
        return;
      }
      res.json({ ok: true, info: await pullDirectory(req.body.path) });
    } catch (error) {
      const status = error instanceof GitOperationError ? error.statusCode : 500;
      res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/git-push', async (req, res) => {
    try {
      if (typeof req.body?.path !== 'string' || !req.body.path.trim()) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      const target = getGitDirectoryInfo(req.body.path);
      const activeDirect = store?.getAllAgents().find(agent => {
        if (agent.workspaceMode !== 'direct' || !['running', 'waiting_input'].includes(agent.status)) return false;
        const info = getGitDirectoryInfo(agent.config.directory);
        return target.root && info.root === target.root;
      });
      if (activeDirect) {
        res.status(409).json({ error: `Stop Direct Edit agent "${activeDirect.name}" before pushing this repository.` });
        return;
      }
      res.json({ ok: true, info: await pushDirectory(req.body.path) });
    } catch (error) {
      const status = error instanceof GitOperationError ? error.statusCode : 500;
      res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/', (req, res) => {
    try {
      const dirPath = normalizeUserPath((req.query.path as string) || process.env.HOME || '/');
      const entries = browser.listDirectory(dirPath);
      const parent = browser.getParent(dirPath);
      res.json({ path: dirPath, parent, entries });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.get('/claude-md', (req, res) => {
    try {
      const rawPath = req.query.path as string;
      const provider = ((req.query.provider as string) || 'claude') as AgentProvider;
      if (!rawPath?.trim()) {
        res.json({ exists: false });
        return;
      }
      const dirPath = normalizeUserPath(rawPath);
      const match = findInstructionFile(dirPath, provider);
      if (!match) {
        res.json({ exists: false });
        return;
      }
      res.json({
        exists: true,
        content: match.content,
        fileName: match.fileName,
        matchedProvider: match.matchedProvider,
      });
    } catch (err) {
      res.json({ exists: false });
    }
  });

  router.get('/file', (req, res) => {
    try {
      const rawPath = req.query.path as string;
      if (!rawPath?.trim()) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      const filePath = normalizeUserPath(rawPath);
      res.json(browser.readTextFile(filePath));
    } catch (err) {
      if (err instanceof FileReadError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: String(err) });
    }
  });

  router.get('/asset', (req, res) => {
    try {
      const rawPath = req.query.path as string;
      if (!rawPath?.trim()) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      const filePath = normalizeUserPath(rawPath);
      const asset = browser.getPreviewAsset(filePath);
      res.sendFile(asset.path);
    } catch (err) {
      if (err instanceof FileReadError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: String(err) });
    }
  });

  return router;
}
