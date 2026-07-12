import { Router } from 'express';
import multer from 'multer';
import type { SkillManager } from '../services/SkillManager.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function skillRoutes(skillManager: SkillManager): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(skillManager.listSkills());
  });

  router.get('/:name', (req, res) => {
    const skill = skillManager.getSkill(req.params.name);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    res.json(skill);
  });

  router.post('/', (req, res) => {
    const { name, description, body } = req.body;
    if (!name || !description) {
      res.status(400).json({ error: 'name and description are required' });
      return;
    }
    try {
      const skill = skillManager.createSkill(name, description, body || '');
      res.status(201).json(skill);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.put('/:name', (req, res) => {
    const { description, body } = req.body;
    try {
      const skill = skillManager.updateSkill(req.params.name, description, body);
      res.json(skill);
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  router.delete('/:name', (req, res) => {
    const deleted = skillManager.deleteSkill(req.params.name);
    if (!deleted) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/:name/scripts', upload.single('script'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    try {
      const name = req.params.name as string;
      skillManager.addScript(name, req.file.originalname, req.file.buffer);
      res.json({ ok: true, filename: req.file.originalname });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.delete('/:name/scripts/:filename', (req, res) => {
    const deleted = skillManager.deleteScript(req.params.name, req.params.filename);
    if (!deleted) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
