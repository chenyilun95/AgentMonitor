export interface GpuServer {
  group: string;
  role: string;
  name: string;
  ip: string;
  user: string;
  port: string;
  target: string;
}

export interface GpuInfo {
  index: string;
  utilization: number;
  memoryPercent: number;
  temperature: number;
  memoryUsed: number;
  memoryTotal: number;
}

export interface GpuSnapshot {
  serverName: string;
  status: 'ok' | 'offline' | 'nosmi' | 'pending';
  gpus: GpuInfo[];
  timestamp: number;
}

export interface GpuMonitorConfig {
  pollInterval: number;
  enabled: boolean;
  serverCount: number;
}
