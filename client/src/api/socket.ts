import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@agent-monitor/shared';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (!socket) {
    socket = io('/', {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    }) as TypedSocket;

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id);
    });
    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });
    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
  }
  return socket;
}

export function joinAgent(agentId: string): void {
  getSocket().emit('agent:join', agentId);
}

export function leaveAgent(agentId: string): void {
  getSocket().emit('agent:leave', agentId);
}

export function sendMessage(agentId: string, text: string): void {
  getSocket().emit('agent:send', { agentId, text });
}

export function interruptAgent(agentId: string): void {
  getSocket().emit('agent:interrupt', agentId);
}
