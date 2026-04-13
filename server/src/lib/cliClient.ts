import WebSocket from 'ws';

export class CliClient {
  constructor(private baseUrl: string) {}

  private get httpBase(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  private get wsBase(): string {
    return this.httpBase.replace(/^http/, 'ws');
  }

  async request<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${this.httpBase}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async listAgents(filters?: { label?: string[]; status?: string }): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (filters?.label) {
      for (const l of filters.label) params.append('label', l);
    }
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString();
    return this.request(`/agents${qs ? '?' + qs : ''}`);
  }

  async createAgent(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async stopAgent(id: string): Promise<void> {
    await this.request(`/agents/${id}/stop`, { method: 'POST' });
  }

  async deleteAgent(id: string): Promise<void> {
    await this.request(`/agents/${id}`, { method: 'DELETE' });
  }

  async sendMessage(id: string, text: string): Promise<void> {
    await this.request(`/agents/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async waitForAgent(id: string, timeout: number): Promise<Record<string, unknown>> {
    return this.request(`/agents/${id}/wait?timeout=${timeout}`);
  }

  async getAgent(id: string): Promise<Record<string, unknown>> {
    return this.request(`/agents/${id}`);
  }

  streamMessages(agentId: string, onMessage: (msg: Record<string, unknown>) => void, onClose?: () => void): WebSocket {
    const ws = new WebSocket(`${this.wsBase}/socket.io/?EIO=4&transport=websocket`);
    let connected = false;

    ws.on('open', () => {
      // Socket.IO handshake
      ws.send('40');
    });

    ws.on('message', (data) => {
      const str = data.toString();

      // Socket.IO open packet
      if (str.startsWith('0')) {
        return;
      }

      // Socket.IO connect ack
      if (str === '40') {
        connected = true;
        // Subscribe to agent updates
        ws.send(`42${JSON.stringify(['subscribe', agentId])}`);
        return;
      }

      // Socket.IO event
      if (str.startsWith('42')) {
        try {
          const payload = JSON.parse(str.slice(2));
          const [event, eventData] = payload;
          if (event === 'agent:message' && eventData?.agentId === agentId) {
            onMessage(eventData.message);
          }
          if (event === 'agent:status' && eventData?.agentId === agentId) {
            if (eventData.status === 'stopped' || eventData.status === 'error') {
              onClose?.();
            }
          }
        } catch {
          // ignore parse errors
        }
        return;
      }

      // Ping
      if (str === '2') {
        ws.send('3');
      }
    });

    ws.on('close', () => {
      if (connected) onClose?.();
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
      onClose?.();
    });

    return ws;
  }
}
