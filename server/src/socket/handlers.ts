import type { Server, Socket } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, AgentDelta, AgentInputInfo } from '@agent-monitor/shared';
import type { AgentManager } from '../services/AgentManager.js';
import type { TerminalService } from '../services/TerminalService.js';
import type { TelegramService } from '../services/TelegramService.js';
import type { GpuMonitorService } from '../services/GpuMonitorService.js';
import { sanitizeAgentListSnapshot, sanitizeAgentSnapshot } from '../utils/agentSnapshot.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function setupSocketHandlers(io: TypedServer, manager: AgentManager, terminalService: TerminalService, telegramService?: TelegramService | null, gpuMonitor?: GpuMonitorService | null): void {
  manager.on('agent:message', (agentId, msg) => {
    io.to(`agent:${agentId}`).emit('agent:message', { agentId, message: msg as any });
  });

  manager.on('agent:status', (agentId, status) => {
    io.emit('agent:status', { agentId, status });
  });

  manager.on('agent:delta', (agentId, delta) => {
    io.to(`agent:${agentId}`).emit('agent:delta', { agentId, delta });
  });

  manager.on('agent:input_required', (agentId, inputInfo) => {
    io.to(`agent:${agentId}`).emit('agent:input_required', { agentId, inputInfo });
  });

  manager.on('agent:terminal', (agentId, chunk) => {
    io.to(`agent:${agentId}`).emit('agent:terminal', { agentId, chunk: chunk.data });
  });

  manager.on('agent:update', (agentId, agent) => {
    const safeAgent = sanitizeAgentSnapshot(agent);
    io.to(`agent:${agentId}`).emit('agent:update', { agentId, agent: safeAgent });
    io.emit('agent:snapshot', { agentId, agent: sanitizeAgentListSnapshot(agent) });
  });

  terminalService.on('data', (sessionId: string, data: string) => {
    if (sessionId.startsWith('gpu:')) {
      const serverName = sessionId.slice(4);
      io.emit('gpu:terminal:output', { serverName, data });
    } else {
      io.to(`agent:${sessionId}`).emit('terminal:output', { agentId: sessionId, data });
    }
  });

  terminalService.on('exit', (sessionId: string, exitCode: number) => {
    if (sessionId.startsWith('gpu:')) {
      const serverName = sessionId.slice(4);
      io.emit('gpu:terminal:exit', { serverName, exitCode });
    } else {
      io.to(`agent:${sessionId}`).emit('terminal:exit', { agentId: sessionId, exitCode });
    }
  });

  io.on('connection', (socket: TypedSocket) => {
    socket.on('agent:join', (agentId) => {
      socket.join(`agent:${agentId}`);
    });

    socket.on('agent:leave', (agentId) => {
      socket.leave(`agent:${agentId}`);
    });

    socket.on('agent:send', ({ agentId, text }) => {
      manager.sendMessage(agentId, text);
    });

    socket.on('agent:interrupt', (agentId) => {
      manager.interruptAgent(agentId);
    });

    socket.on('terminal:open', ({ agentId, cols, rows, initialCommand }) => {
      const agent = manager.getAgent(agentId);
      if (!agent) return;
      const cwd = manager.resolveExecutionDirectory(agent);
      terminalService.create(agentId, cwd, cols || 120, rows || 30, initialCommand);
    });

    socket.on('terminal:input', ({ agentId, data }) => {
      terminalService.write(agentId, data);
    });

    socket.on('terminal:resize', ({ agentId, cols, rows }) => {
      terminalService.resize(agentId, cols, rows);
    });

    socket.on('terminal:close', (agentId) => {
      terminalService.destroy(agentId);
    });

    socket.on('gpu:terminal:open', ({ serverName, cols, rows }) => {
      if (!gpuMonitor) return;
      const server = gpuMonitor.getServer(serverName);
      if (!server) return;
      const sessionId = `gpu:${serverName}`;
      const sshArgs = gpuMonitor.buildInteractiveSshArgs(server);
      terminalService.createSsh(sessionId, sshArgs, cols || 120, rows || 30);
    });

    socket.on('gpu:terminal:input', ({ serverName, data }) => {
      terminalService.write(`gpu:${serverName}`, data);
    });

    socket.on('gpu:terminal:resize', ({ serverName, cols, rows }) => {
      terminalService.resize(`gpu:${serverName}`, cols, rows);
    });

    socket.on('gpu:terminal:close', ({ serverName }) => {
      terminalService.destroy(`gpu:${serverName}`);
    });

    socket.on('telegram:reply', (data) => {
      if (telegramService) {
        telegramService.sendTg(data.chatId, data.text, data.parseMode);
      }
    });

    socket.on('telegram:register', (data) => {
      if (telegramService) {
        telegramService.registerExtensionCommands(data.commands);
      }
    });
  });
}
