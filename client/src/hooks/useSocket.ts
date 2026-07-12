import { useEffect } from 'react';
import { getSocket } from '../api/socket';
import type { ServerToClientEvents } from '@agent-monitor/shared';

type EventName = keyof ServerToClientEvents;
type EventHandler<E extends EventName> = ServerToClientEvents[E];

export function useSocket<E extends EventName>(event: E, handler: EventHandler<E>): void {
  useEffect(() => {
    const socket = getSocket();
    socket.on(event, handler as any);
    return () => {
      socket.off(event, handler as any);
    };
  }, [event, handler]);
}
