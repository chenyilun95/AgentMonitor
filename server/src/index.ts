import express from 'express';
import cors from 'cors';
import { parse as parseCookie } from 'cookie';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createAuthRoutes, requireAuth, verifyToken } from './auth.js';
import { AgentStore } from './store/AgentStore.js';
import { AgentManager } from './services/AgentManager.js';
import { MetaAgentManager } from './services/MetaAgentManager.js';
import { HarnessOrchestrator } from './services/HarnessOrchestrator.js';
import { HandoffManager } from './services/HandoffManager.js';
import { EmailNotifier } from './services/EmailNotifier.js';
import { WhatsAppNotifier } from './services/WhatsAppNotifier.js';
import { SlackNotifier } from './services/SlackNotifier.js';
import { agentRoutes, settingsRoutes, externalRoutes } from './routes/agents.js';
import { ExternalAgentScanner } from './services/ExternalAgentScanner.js';
import { templateRoutes } from './routes/templates.js';
import { skillRoutes } from './routes/skills.js';
import { SkillManager } from './services/SkillManager.js';
import { sessionRoutes } from './routes/sessions.js';
import { directoryRoutes } from './routes/directories.js';
import { taskRoutes } from './routes/tasks.js';
import { uploadRoutes } from './routes/upload.js';
import { setupSocketHandlers } from './socket/handlers.js';
import { TunnelClient } from './services/TunnelClient.js';
import { setupTunnelBridge } from './services/tunnelBridge.js';
import { TerminalService } from './services/TerminalService.js';
import { FeishuService } from './services/FeishuService.js';
import { FeishuNotifier } from './services/FeishuNotifier.js';
import { TelegramService } from './services/TelegramService.js';
import { GpuMonitorService } from './services/GpuMonitorService.js';
import { gpuMonitorRoutes } from './routes/gpu-monitor.js';
import type { Agent } from './models/Agent.js';
import { sanitizeAgentListSnapshot, sanitizeAgentSnapshot } from './utils/agentSnapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  // In relay mode the dashboard is served from a different origin, so we must
  // reflect the incoming Origin header (required for credentials: 'include').
  // In local-only mode we restrict to localhost origins to limit CSRF exposure.
  const corsOrigin = config.relay.url
    ? true
    : (origin: string | undefined, cb: (e: Error | null, allow?: boolean) => void) => {
        if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      };
  app.use(cors({ credentials: true, origin: corsOrigin }));
  app.use(cookieParser());
  app.use(express.json());

  // Auth routes (before requireAuth middleware)
  app.use('/api/auth', createAuthRoutes());

  // Protect all /api routes when DASHBOARD_PASSWORD is set
  app.use('/api', requireAuth);

  const store = new AgentStore();
  const skillManager = new SkillManager();
  const emailNotifier = new EmailNotifier();
  const whatsappNotifier = new WhatsAppNotifier();
  const slackNotifier = new SlackNotifier();
  const feishuNotifier = config.feishu.appId && config.feishu.appSecret
    ? new FeishuNotifier(config.feishu.appId, config.feishu.appSecret)
    : undefined;
  const manager = new AgentManager(store, undefined, emailNotifier, whatsappNotifier, slackNotifier, feishuNotifier, skillManager);
  const agentManagerPipeline = new MetaAgentManager(store, manager, emailNotifier, whatsappNotifier, slackNotifier, feishuNotifier);
  const handoffManager = new HandoffManager();
  const harnessOrchestrator = new HarnessOrchestrator(store, manager, handoffManager);
  agentManagerPipeline.setHarnessOrchestrator(harnessOrchestrator);

  // External agent scanner — discovers claude/codex processes not started by the monitor
  const externalScanner = new ExternalAgentScanner(
    store,
    () => manager.getManagedPids(),
    { scanIntervalMs: 5 * 60_000, autoImport: false, maxMessages: 200 },
  );

  const idleTimeoutMinutes = Math.max(0, Number.parseFloat(process.env.AGENTMONITOR_IDLE_TIMEOUT_MINUTES || '60') || 0);
  const idleTimeoutMs = idleTimeoutMinutes * 60_000;
  let sleeping = false;
  let lastActivityAt = Date.now();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const hasActiveWork = () => {
    const hasActiveAgent = manager.getAllAgents().some(agent =>
      agent.source !== 'external' && (agent.status === 'running' || agent.status === 'waiting_input'),
    );
    const harnessStatus = harnessOrchestrator.getState().status;
    return hasActiveAgent
      || agentManagerPipeline.isRunning()
      || !['idle', 'complete', 'failed'].includes(harnessStatus);
  };

  const scheduleIdleCheck = () => {
    if (idleTimeoutMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    const delay = Math.max(1_000, idleTimeoutMs - (Date.now() - lastActivityAt));
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (hasActiveWork()) {
        // Active work is itself a reason to stay awake. Check infrequently;
        // status events will reset the full idle deadline when work finishes.
        idleTimer = setTimeout(scheduleIdleCheck, 5 * 60_000);
        idleTimer.unref?.();
        return;
      }
      sleeping = true;
      externalScanner.stop();
      manager.pauseBackgroundChecks();
      console.log(`[Idle] Sleeping after ${idleTimeoutMinutes} minute(s) without activity`);
    }, delay);
    idleTimer.unref?.();
  };

  const touchActivity = (source: string) => {
    lastActivityAt = Date.now();
    if (sleeping) {
      sleeping = false;
      manager.resumeBackgroundChecks();
      externalScanner.start();
      console.log(`[Idle] Woke up (${source})`);
    }
    scheduleIdleCheck();
  };

  // Auth/health probes do not wake background work. Normal dashboard/API use does.
  app.use('/api', (req, _res, next) => {
    if (req.path !== '/health' && !req.path.startsWith('/auth/')) {
      touchActivity(`${req.method} ${req.path}`);
    }
    next();
  });

  // REST routes
  app.use('/api/agents', agentRoutes(manager, store));
  app.use('/api/external', externalRoutes(externalScanner));
  app.use('/api/templates', templateRoutes(store));
  app.use('/api/sessions', sessionRoutes());
  app.use('/api/directories', directoryRoutes());
  app.use('/api/tasks', taskRoutes(store, agentManagerPipeline, manager, harnessOrchestrator));
  app.use('/api/settings', settingsRoutes(store));
  app.use('/api/upload-image', uploadRoutes());
  app.use('/api/skills', skillRoutes(skillManager));

  // GPU Monitor (optional - only when GPU_SERVERS_CONF is set)
  let gpuMonitor: GpuMonitorService | null = null;
  if (config.gpuMonitor.serversConf) {
    gpuMonitor = new GpuMonitorService(config.gpuMonitor);
    console.log(`[Server] GPU Monitor configured with ${gpuMonitor.getServers().length} server(s); polling on page demand`);
  }
  app.use('/api/gpu', gpuMonitorRoutes(gpuMonitor));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Serve built docs (VitePress)
  const docsDist = path.resolve(__dirname, '..', '..', 'docs', '.vitepress', 'dist');
  if (fs.existsSync(docsDist)) {
    app.use('/docs', express.static(docsDist));
    app.get('/docs/*', (_req, res) => {
      res.sendFile(path.join(docsDist, 'index.html'));
    });
  } else {
    app.get('/docs/*', (_req, res) => {
      res.status(404).send('Docs not built. Run `npm run docs:build` first.');
    });
  }

  // Serve built client
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    app.get('*', (_req, res) => {
      res.status(404).json({
        error: 'Client not built',
        hint: 'In development, open http://localhost:5173. For production, run `cd client && npm run build` first.',
      });
    });
  }

  // Socket.IO auth middleware
  io.use((socket, next) => {
    if (!config.password) return next();
    const cookieHeader = socket.handshake.headers.cookie || '';
    const parsed = parseCookie(cookieHeader);
    const token = parsed.auth_token || socket.handshake.auth?.token;
    if (token && verifyToken(token)) return next();
    return next(new Error('Authentication required'));
  });

  // Slack streaming
  slackNotifier.startStreaming(manager);

  // Telegram bot (optional - only when TELEGRAM_TOKEN is set)
  let telegramService: TelegramService | null = null;
  if (config.telegram.token) {
    telegramService = new TelegramService({
      token: config.telegram.token,
      chatId: config.telegram.chatId,
    }, manager);
    console.log('[Server] Telegram bot starting...');
  }

  // Socket.IO
  const terminalService = new TerminalService();
  setupSocketHandlers(io, manager, terminalService, telegramService, gpuMonitor);

  // Forward GPU monitor snapshots to socket
  if (gpuMonitor) {
    gpuMonitor.on('gpu:snapshot', (snapshot) => {
      io.emit('gpu:snapshot', snapshot);
    });
  }

  // Forward agent manager pipeline events to socket
  agentManagerPipeline.on('task:update', (task) => {
    io.emit('task:update', task);
  });
  agentManagerPipeline.on('pipeline:complete', () => {
    io.emit('pipeline:complete');
  });
  agentManagerPipeline.on('status', (status: string) => {
    touchActivity(`pipeline ${status}`);
    io.emit('meta:status', { running: status === 'running' });
  });

  // Forward harness orchestrator events to socket
  harnessOrchestrator.on('task:update', (task) => {
    io.emit('task:update', task);
  });
  harnessOrchestrator.on('harness:complete', (data) => {
    touchActivity('harness complete');
    io.emit('harness:complete', data);
  });
  harnessOrchestrator.on('harness:failed', (data) => {
    touchActivity('harness failed');
    io.emit('harness:failed', data);
  });

  manager.on('agent:status', (_agentId: string, status: string) => {
    touchActivity(`agent ${status}`);
  });

  io.on('connection', () => {
    touchActivity('dashboard connection');
  });

  // External agent scanner — forward events to socket.io for live dashboard updates
  externalScanner.on('agent:update', (agentId: string, agent: unknown) => {
    const safeAgent = sanitizeAgentSnapshot(agent as Agent);
    io.to(`agent:${agentId}`).emit('agent:update', { agentId, agent: safeAgent });
    io.emit('agent:snapshot', { agentId, agent: sanitizeAgentListSnapshot(agent as Agent) });
  });
  externalScanner.on('agent:status', (agentId: string, status: string) => {
    io.to(`agent:${agentId}`).emit('agent:status', { agentId, status });
  });
  externalScanner.on('agent:delta', (agentId: string, delta: unknown) => {
    io.to(`agent:${agentId}`).emit('agent:delta', { agentId, ...(delta as Record<string, unknown>) });
  });
  externalScanner.start();
  scheduleIdleCheck();

  // Cleanup is not latency-sensitive: run once at startup, then twice a day.
  const cleanupExpiredAgents = async () => {
    const { agentRetentionMs } = store.getSettings();
    if (agentRetentionMs <= 0) return;
    try {
      const count = await manager.cleanupExpiredAgents(agentRetentionMs);
      if (count > 0) {
        console.log(`[Cleanup] Auto-deleted ${count} expired agent(s)`);
        io.emit('agent:status', null, 'deleted');
      }
    } catch (err) {
      console.error('[Cleanup] Error during agent cleanup:', err);
    }
  };
  void cleanupExpiredAgents();
  const cleanupInterval = setInterval(() => {
    void cleanupExpiredAgents();
  }, 12 * 60 * 60_000);

  // Start Telegram after IO is set up
  if (telegramService) {
    telegramService.setIO(io);
    telegramService.start().catch(err =>
      console.error('[Telegram] Failed to start:', err),
    );
  }

  // Feishu bot (optional - only when FEISHU_APP_ID is set)
  let feishuService: FeishuService | null = null;
  if (config.feishu.appId && config.feishu.appSecret) {
    feishuService = new FeishuService({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      allowedUsers: config.feishu.allowedUsers,
    }, manager);
    feishuService.start().catch(err =>
      console.error('[Feishu] Failed to start:', err),
    );
    console.log('[Server] Feishu bot starting...');
  }

  // Tunnel to relay server (optional - only when RELAY_URL is set)
  let tunnelClient: TunnelClient | null = null;
  if (config.relay.url && config.relay.token) {
    tunnelClient = new TunnelClient(config.relay.url, config.relay.token, config.port);
    setupTunnelBridge(tunnelClient, manager, agentManagerPipeline, terminalService);
    tunnelClient.start();
    console.log(`[Server] Tunnel client connecting to ${config.relay.url}`);
  }

  const idleController = {
    isSleeping: () => sleeping,
    touch: () => touchActivity('manual'),
    stop: () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    },
  };

  return { app, httpServer, io, store, manager, agentManagerPipeline, harnessOrchestrator, cleanupInterval, idleController, tunnelClient, feishuService, telegramService };
}

// Only start server if this is the main module
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  const { httpServer } = createApp();
  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`Agent Monitor server running on port ${config.port}`);
  });
}
