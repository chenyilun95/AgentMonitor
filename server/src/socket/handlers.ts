import type { Server, Socket } from 'socket.io';
import type { AgentManager } from '../services/AgentManager.js';
import type { TerminalService } from '../services/TerminalService.js';
import type { TelegramService } from '../services/TelegramService.js';
import type { Agent } from '../models/Agent.js';
import { sanitizeAgentListSnapshot, sanitizeAgentSnapshot } from '../utils/agentSnapshot.js';

export function setupSocketHandlers(io: Server, manager: AgentManager, terminalService: TerminalService, telegramService?: TelegramService | null): void {
  // Forward agent events to connected clients
  manager.on('agent:message', (agentId: string, msg: unknown) => {
    io.to(`agent:${agentId}`).emit('agent:message', { agentId, message: msg });
  });

  manager.on('agent:status', (agentId: string, status: string) => {
    io.emit('agent:status', { agentId, status });
  });

  // Incremental message delta for efficient real-time chat streaming
  manager.on('agent:delta', (agentId: string, delta: unknown) => {
    io.to(`agent:${agentId}`).emit('agent:delta', { agentId, delta });
  });

  // Input required notification (permission prompts, choices)
  manager.on('agent:input_required', (agentId: string, inputInfo: unknown) => {
    io.to(`agent:${agentId}`).emit('agent:input_required', { agentId, inputInfo });
  });

  // Raw terminal output for live terminal attachment (from agent process stdout)
  manager.on('agent:terminal', (agentId: string, chunk: unknown) => {
    io.to(`agent:${agentId}`).emit('agent:terminal', { agentId, chunk });
  });

  // Full agent snapshot for real-time streaming (no HTTP re-fetch needed)
  manager.on('agent:update', (agentId: string, agent: unknown) => {
    const safeAgent = sanitizeAgentSnapshot(agent as Agent);
    io.to(`agent:${agentId}`).emit('agent:update', { agentId, agent: safeAgent });
    // Also broadcast a lightweight version for Dashboard cards
    io.emit('agent:snapshot', { agentId, agent: sanitizeAgentListSnapshot(agent as Agent) });
  });

  // PTY terminal output → client
  terminalService.on('data', (agentId: string, data: string) => {
    io.to(`agent:${agentId}`).emit('terminal:output', { agentId, data });
  });

  terminalService.on('exit', (agentId: string, exitCode: number) => {
    io.to(`agent:${agentId}`).emit('terminal:exit', { agentId, exitCode });
  });

  io.on('connection', (socket: Socket) => {
    // Join agent room to receive messages
    socket.on('agent:join', (agentId: string) => {
      socket.join(`agent:${agentId}`);
    });

    socket.on('agent:leave', (agentId: string) => {
      socket.leave(`agent:${agentId}`);
    });

    // Send message to agent
    socket.on('agent:send', ({ agentId, text }: { agentId: string; text: string }) => {
      manager.sendMessage(agentId, text);
    });

    // Interrupt agent (double-Esc)
    socket.on('agent:interrupt', (agentId: string) => {
      manager.interruptAgent(agentId);
    });

    // --- PTY terminal events ---
    socket.on('terminal:open', ({ agentId, cols, rows, initialCommand }: { agentId: string; cols?: number; rows?: number; initialCommand?: string }) => {
      const agent = manager.getAgent(agentId);
      if (!agent) return;
      const cwd = agent.worktreePath || agent.config.directory;
      terminalService.create(agentId, cwd, cols || 120, rows || 30, initialCommand);
    });

    socket.on('terminal:input', ({ agentId, data }: { agentId: string; data: string }) => {
      terminalService.write(agentId, data);
    });

    socket.on('terminal:resize', ({ agentId, cols, rows }: { agentId: string; cols: number; rows: number }) => {
      terminalService.resize(agentId, cols, rows);
    });

    socket.on('terminal:close', (agentId: string) => {
      terminalService.destroy(agentId);
    });

    // Extension: reply to Telegram command
    socket.on('telegram:reply', (data: { chatId: string; text: string; parseMode?: string }) => {
      if (telegramService) {
        telegramService.sendTg(data.chatId, data.text, data.parseMode);
      }
    });

    // Extension: register additional Telegram commands
    socket.on('telegram:register', (data: { commands: Array<{ command: string; description: string }> }) => {
      if (telegramService) {
        telegramService.registerExtensionCommands(data.commands);
      }
    });
  });
}
