import { Router } from 'express';
import { existsSync, statSync } from 'fs';
import { DirectoryBrowser, FileReadError } from '../services/DirectoryBrowser.js';
import type { AgentProvider } from '../models/Agent.js';
import { findInstructionFile } from '../utils/instructionFiles.js';
import { normalizeUserPath } from '../utils/pathUtils.js';

export function directoryRoutes(): Router {
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
