import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { relayConfig } from './config.js';
import { TunnelManager } from './tunnel.js';
import { createHttpProxy } from './httpProxy.js';
import { setupSocketBridge } from './socketBridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveExistingPath(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function main() {
  if (!relayConfig.token) {
    console.error('[Relay] RELAY_TOKEN is required. Set it in environment.');
    process.exit(1);
  }

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  // Create tunnel manager (WebSocket server at /tunnel)
  const tunnel = new TunnelManager(httpServer);

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // Relay status endpoint (local to relay, not forwarded through tunnel)
  app.get('/api/relay/status', (_req, res) => {
    res.json({
      tunnelConnected: tunnel.connected,
      uptime: Math.floor((Date.now() - tunnel.startTime) / 1000),
    });
  });

  // Forward all /api/* requests through tunnel to local machine
  // (includes /api/auth/* — auth is handled entirely by the local server)
  app.use('/api', createHttpProxy(tunnel));

  // Bridge Socket.IO between dashboard clients and tunnel
  setupSocketBridge(io, tunnel);

  // In deployed mode, static assets are copied next to the relay `dist/` folder.
  // In a repo checkout, they live under the top-level client/docs build output.
  const clientDist = resolveExistingPath(
    path.resolve(__dirname, '..', 'client-dist'),
    path.resolve(__dirname, '..', '..', 'client', 'dist'),
  );
  app.use('/assets', express.static(path.join(clientDist, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(clientDist));

  // Serve built docs if available
  const docsDist = resolveExistingPath(
    path.resolve(__dirname, '..', 'docs-dist'),
    path.resolve(__dirname, '..', '..', 'docs', '.vitepress', 'dist'),
  );
  app.use('/docs', express.static(docsDist));
  app.get('/docs/*', (_req, res) => {
    const indexPath = path.join(docsDist, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) res.status(404).send('Docs not available');
    });
  });

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Frontend not deployed');
    });
  });

  httpServer.listen(relayConfig.port, '0.0.0.0', () => {
    console.log(`[Relay] Listening on port ${relayConfig.port}`);
    console.log(`[Relay] Tunnel endpoint: ws://0.0.0.0:${relayConfig.port}/tunnel`);
    console.log('[Relay] Auth is managed by the local server (set DASHBOARD_PASSWORD there)');
    if (relayConfig.password) {
      console.warn('[Relay] RELAY_PASSWORD is set but no longer used — set DASHBOARD_PASSWORD on the local server instead');
    }
    if (relayConfig.domain) {
      console.log(`[Relay] Domain: ${relayConfig.domain}`);
    }
  });
}

main();
