import { Router } from 'express';
import type { GpuMonitorService } from '../services/GpuMonitorService.js';

export function gpuMonitorRoutes(gpuMonitor: GpuMonitorService | null): Router {
  const router = Router();

  router.get('/servers', (_req, res) => {
    if (!gpuMonitor) {
      return res.json({ servers: [], snapshots: [], enabled: false });
    }
    gpuMonitor.refresh();
    res.json({
      servers: gpuMonitor.getServers(),
      snapshots: gpuMonitor.getSnapshots(),
      enabled: true,
    });
  });

  router.get('/servers/:name', (req, res) => {
    if (!gpuMonitor) return res.status(404).json({ error: 'GPU monitor not configured' });
    const snapshot = gpuMonitor.getSnapshot(req.params.name);
    if (!snapshot) return res.status(404).json({ error: 'Server not found' });
    res.json(snapshot);
  });

  router.post('/servers/:name/exec', async (req, res) => {
    if (!gpuMonitor) return res.status(404).json({ error: 'GPU monitor not configured' });
    const { command } = req.body;
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command is required' });
    }
    try {
      const result = await gpuMonitor.execCommand(req.params.name, command);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/config', (_req, res) => {
    if (!gpuMonitor) return res.json({ pollInterval: 10, enabled: false, serverCount: 0 });
    res.json(gpuMonitor.getConfig());
  });

  router.put('/config', (req, res) => {
    if (!gpuMonitor) return res.status(404).json({ error: 'GPU monitor not configured' });
    const { pollInterval } = req.body;
    if (typeof pollInterval === 'number') {
      gpuMonitor.updatePollInterval(pollInterval);
    }
    res.json(gpuMonitor.getConfig());
  });

  return router;
}
