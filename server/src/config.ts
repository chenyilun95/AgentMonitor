import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3456', 10),
  dataDir: path.resolve(__dirname, '..', 'data'),
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  codexBin: process.env.CODEX_BIN || 'codex',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'agent-monitor@localhost',
  },
  whatsapp: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_WHATSAPP_FROM || '',
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },
  relay: {
    /** WebSocket URL of the relay server (e.g., ws://192.3.168.14:3457/tunnel) */
    url: process.env.RELAY_URL || '',
    /** Shared secret token for tunnel authentication */
    token: process.env.RELAY_TOKEN || '',
    /** Enable AES-256-GCM encryption for tunnel messages (set RELAY_ENCRYPT=1 on both sides) */
    encrypt: process.env.RELAY_ENCRYPT === '1',
  },
  /** Password for dashboard login (if empty, auth is disabled) */
  password: process.env.DASHBOARD_PASSWORD || '',
  telegram: {
    token: process.env.TELEGRAM_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    /** Comma-separated list of allowed open_ids; empty = allow all */
    allowedUsers: process.env.FEISHU_ALLOWED_USERS
      ? process.env.FEISHU_ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean)
      : [],
    /** Admin chat ID for pipeline/global notifications (optional) */
    adminChatId: process.env.FEISHU_ADMIN_CHAT_ID || '',
  },
  gpuMonitor: {
    serversConf: process.env.GPU_SERVERS_CONF || '',
    jumpHost: process.env.GPU_SSH_JUMP || '',
    identityFile: process.env.GPU_SSH_IDENTITY || '',
    pollInterval: parseInt(process.env.GPU_POLL_INTERVAL || '10', 10),
    sshAliveInterval: process.env.GPU_SSH_ALIVE_INTERVAL || '30',
    controlPath: process.env.GPU_SSH_CONTROL_PATH || '~/.ssh/gpu-tmux-%C',
    remoteBashrc: process.env.GPU_REMOTE_BASHRC || '',
    useSshTarget: process.env.GPU_SSH_USE_TARGET === '1',
  },
};
