import { Router } from 'express';
import { DirectoryBrowser, FileReadError } from '../services/DirectoryBrowser.js';
import type { AgentProvider } from '../models/Agent.js';
import { findInstructionFile } from '../utils/instructionFiles.js';

export function directoryRoutes(): Router {
  const router = Router();
  const browser = new DirectoryBrowser();

  router.get('/', (req, res) => {
    try {
      const dirPath = (req.query.path as string) || process.env.HOME || '/';
      const entries = browser.listDirectory(dirPath);
      const parent = browser.getParent(dirPath);
      res.json({ path: dirPath, parent, entries });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.get('/claude-md', (req, res) => {
    try {
      const dirPath = req.query.path as string;
      const provider = ((req.query.provider as string) || 'claude') as AgentProvider;
      if (!dirPath) {
        res.json({ exists: false });
        return;
      }
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
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
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
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
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
