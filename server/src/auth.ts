import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from './config.js';

const JWT_EXPIRY = '24h';
const LOGIN_WINDOW_MS = 60_000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const jwtSecret = crypto
  .createHash('sha256')
  .update(config.password || 'agent-monitor-local')
  .digest('hex');

function getJwtSecret(): string {
  return jwtSecret;
}

/** Create auth routes: login, logout, session check */
export function createAuthRoutes(): Router {
  const router = Router();

  // POST /api/auth/login
  router.post('/login', (req: Request, res: Response) => {
    const { password } = req.body ?? {};
    if (!config.password) {
      return res.json({ ok: true });
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (record && now < record.resetAt && record.count >= MAX_LOGIN_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }

    if (password !== config.password) {
      if (!record || now >= record.resetAt) {
        loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
      } else {
        record.count++;
      }
      return res.status(401).json({ error: 'Invalid password' });
    }

    loginAttempts.delete(ip);
    const token = jwt.sign({ local: true }, getJwtSecret(), { expiresIn: JWT_EXPIRY });
    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true });
  });

  // GET /api/auth/check
  router.get('/check', (req: Request, res: Response) => {
    if (!config.password) {
      return res.json({ authenticated: true });
    }
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ authenticated: false });
    }
    try {
      jwt.verify(token, getJwtSecret());
      return res.json({ authenticated: true });
    } catch {
      return res.status(401).json({ authenticated: false });
    }
  });

  // POST /api/auth/logout
  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie('auth_token', { path: '/' });
    return res.json({ ok: true });
  });

  return router;
}

/** Extract JWT token from cookie or Authorization header */
function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.auth_token;
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/** Verify a JWT token, returns true if valid */
export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, getJwtSecret());
    return true;
  } catch {
    return false;
  }
}

/** Middleware: require valid JWT for protected routes */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.password) {
    next();
    return;
  }

  // Trust requests coming through the tunnel (already authenticated by relay)
  if (config.relay.token && req.headers['x-tunnel-auth'] === config.relay.token) {
    next();
    return;
  }

  // Allow auth routes through (req.path is relative to mount point /api)
  if (req.path.startsWith('/auth/')) {
    next();
    return;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    jwt.verify(token, getJwtSecret());
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
