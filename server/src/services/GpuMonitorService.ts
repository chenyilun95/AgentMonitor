import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { GpuServer, GpuSnapshot, GpuInfo, GpuMonitorConfig } from '../models/GpuServer.js';

interface GpuMonitorOptions {
  serversConf: string;
  jumpHost: string;
  identityFile: string;
  pollInterval: number;
  sshAliveInterval: string;
  controlPath: string;
  remoteBashrc: string;
  useSshTarget: boolean;
}

export class GpuMonitorService extends EventEmitter {
  private servers: GpuServer[] = [];
  private snapshots: Map<string, GpuSnapshot> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private options: GpuMonitorOptions;
  private running = false;

  constructor(options: GpuMonitorOptions) {
    super();
    this.options = options;
    this.servers = this.readServers();
    for (const server of this.servers) {
      this.snapshots.set(server.name, {
        serverName: server.name,
        status: 'pending',
        gpus: [],
        timestamp: Date.now(),
      });
    }
  }

  private readServers(): GpuServer[] {
    const confPath = this.options.serversConf;
    if (!confPath || !fs.existsSync(confPath)) return [];
    const content = fs.readFileSync(confPath, 'utf-8');
    const servers: GpuServer[] = [];
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const [group, role, name, ip, user, port] = parts;
      const target = parts[6] || `${user}@${ip}`;
      servers.push({ group, role, name, ip, user, port, target });
    }
    return servers;
  }

  private resolveHome(p: string): string {
    if (p.startsWith('~/')) return path.join(process.env.HOME || '/root', p.slice(2));
    return p;
  }

  buildSshArgs(server: GpuServer): string[] {
    const { jumpHost, identityFile, sshAliveInterval, controlPath, useSshTarget } = this.options;
    const connectTarget = useSshTarget ? server.target : `${server.user}@${server.ip}`;
    const resolvedControlPath = this.resolveHome(controlPath);

    const args: string[] = [
      '-n', '-T',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'ConnectionAttempts=1',
      '-o', 'NumberOfPasswordPrompts=0',
      '-o', `ServerAliveInterval=${sshAliveInterval}`,
      '-o', 'ServerAliveCountMax=1',
      '-o', 'TCPKeepAlive=yes',
    ];

    const needsProxy = jumpHost &&
      (connectTarget.includes('@') && connectTarget.includes('.')) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(connectTarget);

    if (needsProxy && jumpHost) {
      const proxyControlPath = resolvedControlPath.replace(/%/g, '%%');
      const proxyCmd = `ssh -q -o BatchMode=yes -o ConnectTimeout=5 -o ConnectionAttempts=1 ` +
        `-o NumberOfPasswordPrompts=0 -o ControlMaster=auto -o ControlPersist=12h ` +
        `-o ControlPath=${proxyControlPath} -o ServerAliveInterval=${sshAliveInterval} ` +
        `-o ServerAliveCountMax=1 -o TCPKeepAlive=yes ${jumpHost} nc %h %p`;
      args.push(
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ControlMaster=auto',
        '-o', 'ControlPersist=12h',
        '-o', `ControlPath=${resolvedControlPath}`,
        '-o', `ProxyCommand=${proxyCmd}`,
      );
      const resolvedIdentity = this.resolveHome(identityFile);
      if (identityFile && fs.existsSync(resolvedIdentity)) {
        args.push('-i', resolvedIdentity, '-o', 'IdentitiesOnly=yes');
      }
      args.push('-p', server.port, connectTarget);
    } else {
      args.push(connectTarget);
    }

    return args;
  }

  buildInteractiveSshArgs(server: GpuServer): string[] {
    const { jumpHost, identityFile, sshAliveInterval, controlPath, useSshTarget } = this.options;
    const connectTarget = useSshTarget ? server.target : `${server.user}@${server.ip}`;
    const resolvedControlPath = this.resolveHome(controlPath);

    const args: string[] = [
      '-o', 'BatchMode=no',
      '-o', `ServerAliveInterval=${sshAliveInterval}`,
      '-o', 'ServerAliveCountMax=3',
      '-o', 'TCPKeepAlive=yes',
    ];

    const needsProxy = jumpHost &&
      (connectTarget.includes('@') && connectTarget.includes('.')) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(connectTarget);

    if (needsProxy && jumpHost) {
      const proxyControlPath = resolvedControlPath.replace(/%/g, '%%');
      const proxyCmd = `ssh -q -o BatchMode=yes -o ConnectTimeout=5 -o ConnectionAttempts=1 ` +
        `-o NumberOfPasswordPrompts=0 -o ControlMaster=auto -o ControlPersist=12h ` +
        `-o ControlPath=${proxyControlPath} -o ServerAliveInterval=${sshAliveInterval} ` +
        `-o ServerAliveCountMax=1 -o TCPKeepAlive=yes ${jumpHost} nc %h %p`;
      args.push(
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ControlMaster=auto',
        '-o', 'ControlPersist=12h',
        '-o', `ControlPath=${resolvedControlPath}`,
        '-o', `ProxyCommand=${proxyCmd}`,
      );
      const resolvedIdentity = this.resolveHome(identityFile);
      if (identityFile && fs.existsSync(resolvedIdentity)) {
        args.push('-i', resolvedIdentity, '-o', 'IdentitiesOnly=yes');
      }
      args.push('-p', server.port, connectTarget);
    } else {
      args.push(connectTarget);
    }

    return args;
  }

  private remoteGpuCommand(): string {
    const { remoteBashrc } = this.options;
    let cmd = '';
    if (remoteBashrc) {
      cmd += `if [ -f "${remoteBashrc}" ]; then . "${remoteBashrc}"; fi\n`;
    }
    cmd += `if ! command -v nvidia-smi >/dev/null 2>&1; then printf '__NO_NVIDIA_SMI__\\n'; exit 0; fi\n`;
    cmd += `nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits`;
    return cmd;
  }

  private parseOutput(stdout: string): GpuSnapshot['status'] | GpuInfo[] {
    const output = stdout.replace(/\r/g, '').trim();
    if (!output) return 'offline';
    if (output === '__NO_NVIDIA_SMI__') return 'nosmi';
    const gpus: GpuInfo[] = [];
    for (const line of output.split('\n')) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length < 6) continue;
      const [index, , util, memUsed, memTotal, temp] = parts;
      const used = parseInt(memUsed) || 0;
      const total = parseInt(memTotal) || 0;
      const memPct = total > 0 ? Math.round(used * 100 / total) : 0;
      gpus.push({
        index,
        utilization: parseInt(util) || 0,
        memoryPercent: memPct,
        temperature: parseInt(temp) || 0,
        memoryUsed: used,
        memoryTotal: total,
      });
    }
    return gpus.length > 0 ? gpus : 'offline';
  }

  private pollServer(server: GpuServer): void {
    const sshArgs = this.buildSshArgs(server);
    const timeout = Math.max(8000, (this.options.pollInterval - 1) * 1000);

    execFile('ssh', [...sshArgs, this.remoteGpuCommand()], { timeout }, (err, stdout) => {
      let snapshot: GpuSnapshot;
      if (err) {
        snapshot = { serverName: server.name, status: 'offline', gpus: [], timestamp: Date.now() };
      } else {
        const result = this.parseOutput(stdout);
        if (typeof result === 'string') {
          snapshot = { serverName: server.name, status: result, gpus: [], timestamp: Date.now() };
        } else {
          snapshot = { serverName: server.name, status: 'ok', gpus: result, timestamp: Date.now() };
        }
      }
      this.snapshots.set(server.name, snapshot);
      this.emit('gpu:snapshot', snapshot);
    });
  }

  start(): void {
    if (this.running || this.servers.length === 0) return;
    this.running = true;
    for (let i = 0; i < this.servers.length; i++) {
      const server = this.servers[i];
      // Stagger initial polls to avoid thundering herd
      setTimeout(() => {
        if (!this.running) return;
        this.pollServer(server);
        const timer = setInterval(() => this.pollServer(server), this.options.pollInterval * 1000);
        this.timers.set(server.name, timer);
      }, i * 500);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  getServers(): GpuServer[] {
    return this.servers;
  }

  getSnapshots(): GpuSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  getSnapshot(name: string): GpuSnapshot | undefined {
    return this.snapshots.get(name);
  }

  getServer(name: string): GpuServer | undefined {
    return this.servers.find(s => s.name === name) ||
      this.servers.find(s => {
        const short = s.name.startsWith(`${s.group}-`) ? s.name.slice(s.group.length + 1) : s.name;
        return short === name;
      });
  }

  getConfig(): GpuMonitorConfig {
    return {
      pollInterval: this.options.pollInterval,
      enabled: this.running,
      serverCount: this.servers.length,
    };
  }

  updatePollInterval(interval: number): void {
    if (interval < 5 || interval > 300) return;
    this.options.pollInterval = interval;
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  execCommand(serverName: string, command: string): Promise<{ stdout: string; exitCode: number }> {
    const server = this.getServer(serverName);
    if (!server) return Promise.reject(new Error(`Server not found: ${serverName}`));

    const sshArgs = this.buildSshArgs(server);
    const { remoteBashrc } = this.options;
    let remoteCmd = '';
    if (remoteBashrc) {
      remoteCmd += `if [ -f "${remoteBashrc}" ]; then . "${remoteBashrc}" >/dev/null 2>&1 || true; fi\n`;
    }
    remoteCmd += command;

    return new Promise((resolve) => {
      execFile('ssh', [...sshArgs, remoteCmd], { timeout: 30000 }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout + (stderr ? `\n${stderr}` : ''),
          exitCode: err && 'code' in err ? (err as { code: number }).code : (err ? 1 : 0),
        });
      });
    });
  }
}
