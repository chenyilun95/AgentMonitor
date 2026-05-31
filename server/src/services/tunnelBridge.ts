import type { TunnelClient, TunnelMessage } from './TunnelClient.js';
import type { AgentManager } from './AgentManager.js';
import type { MetaAgentManager } from './MetaAgentManager.js';
import type { TerminalService } from './TerminalService.js';
import type { Agent } from '../models/Agent.js';
import { sanitizeAgentListSnapshot } from '../utils/agentSnapshot.js';

/**
 * Bridges local AgentManager/Pipeline events to the tunnel,
 * and handles incoming socket:c2s events from the relay.
 *
 * This mirrors the same event patterns in socket/handlers.ts and index.ts
 * but routes through the WebSocket tunnel instead of direct Socket.IO.
 */
export function setupTunnelBridge(
  tunnel: TunnelClient,
  manager: AgentManager,
  agentManagerPipeline: MetaAgentManager,
  terminalService?: TerminalService,
): void {
  // --- Local → Relay (via tunnel) ---

  // Agent messages → room-targeted emit
  manager.on('agent:message', (agentId: string, msg: unknown) => {
    tunnel.send({
      type: 'socket:s2c:room',
      event: 'agent:message',
      room: `agent:${agentId}`,
      args: [{ agentId, message: msg }],
    });
  });

  // Agent status → broadcast
  manager.on('agent:status', (agentId: string, status: string) => {
    tunnel.send({
      type: 'socket:s2c',
      event: 'agent:status',
      args: [{ agentId, status }],
    });
  });

  // Input required → room-targeted notification for permission/choice prompts
  manager.on('agent:input_required', (agentId: string, inputInfo: unknown) => {
    tunnel.send({
      type: 'socket:s2c:room',
      event: 'agent:input_required',
      room: `agent:${agentId}`,
      args: [{ agentId, inputInfo }],
    });
  });

  // Incremental message delta → room-targeted for efficient chat streaming
  manager.on('agent:delta', (agentId: string, delta: unknown) => {
    tunnel.send({
      type: 'socket:s2c:room',
      event: 'agent:delta',
      room: `agent:${agentId}`,
      args: [{ agentId, delta }],
    });
  });

  // Full agent snapshot → room-targeted for chat streaming
  manager.on('agent:update', (agentId: string, agent: unknown) => {
    tunnel.send({
      type: 'socket:s2c:room',
      event: 'agent:update',
      room: `agent:${agentId}`,
      args: [{ agentId, agent }],
    });
    // Broadcast lightweight snapshot for Dashboard cards
    tunnel.send({
      type: 'socket:s2c',
      event: 'agent:snapshot',
      args: [{ agentId, agent: sanitizeAgentListSnapshot(agent as Agent) }],
    });
  });

  // Raw terminal output for live terminal attachment
  manager.on('agent:terminal', (agentId: string, chunk: unknown) => {
    tunnel.send({
      type: 'socket:s2c:room',
      event: 'agent:terminal',
      room: `agent:${agentId}`,
      args: [{ agentId, chunk }],
    });
  });

  // PTY terminal output → room-targeted
  if (terminalService) {
    terminalService.on('data', (agentId: string, data: string) => {
      tunnel.send({
        type: 'socket:s2c:room',
        event: 'terminal:output',
        room: `agent:${agentId}`,
        args: [{ agentId, data }],
      });
    });

    terminalService.on('exit', (agentId: string, exitCode: number) => {
      tunnel.send({
        type: 'socket:s2c:room',
        event: 'terminal:exit',
        room: `agent:${agentId}`,
        args: [{ agentId, exitCode }],
      });
    });
  }

  // Agent Manager task updates → broadcast
  agentManagerPipeline.on('task:update', (task: unknown) => {
    tunnel.send({
      type: 'socket:s2c',
      event: 'task:update',
      args: [task],
    });
  });

  agentManagerPipeline.on('pipeline:complete', () => {
    tunnel.send({
      type: 'socket:s2c',
      event: 'pipeline:complete',
      args: [],
    });
  });

  agentManagerPipeline.on('status', (status: string) => {
    tunnel.send({
      type: 'socket:s2c',
      event: 'meta:status',
      args: [{ running: status === 'running' }],
    });
  });

  // --- Relay → Local (via tunnel) ---

  tunnel.onMessage((msg: TunnelMessage) => {
    if (msg.type !== 'socket:c2s') return;

    const event = msg.event as string;
    const args = msg.args as unknown[];

    switch (event) {
      case 'agent:send': {
        const data = args[0] as { agentId: string; text: string };
        manager.sendMessage(data.agentId, data.text);
        break;
      }
      case 'agent:interrupt': {
        const agentId = args[0] as string;
        manager.interruptAgent(agentId);
        break;
      }
      // PTY terminal events
      case 'terminal:open': {
        if (terminalService) {
          const d = args[0] as { agentId: string; cols?: number; rows?: number; initialCommand?: string };
          const agent = manager.getAgent(d.agentId);
          if (agent) {
            const cwd = manager.resolveExecutionDirectory(agent);
            terminalService.create(d.agentId, cwd, d.cols || 120, d.rows || 30, d.initialCommand);
          }
        }
        break;
      }
      case 'terminal:input': {
        if (terminalService) {
          const d = args[0] as { agentId: string; data: string };
          terminalService.write(d.agentId, d.data);
        }
        break;
      }
      case 'terminal:resize': {
        if (terminalService) {
          const d = args[0] as { agentId: string; cols: number; rows: number };
          terminalService.resize(d.agentId, d.cols, d.rows);
        }
        break;
      }
      case 'terminal:close': {
        if (terminalService) {
          const agentId = args[0] as string;
          terminalService.destroy(agentId);
        }
        break;
      }
      // agent:join/leave are handled on relay side (room management)
      // No local action needed for those
    }
  });
}
