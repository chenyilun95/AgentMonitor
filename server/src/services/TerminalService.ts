import * as pty from 'node-pty';
import { EventEmitter } from 'events';

interface TerminalSession {
  ptyProcess: pty.IPty;
  agentId: string;
  cwd: string;
  exitDisposable: pty.IDisposable;
}

export class TerminalService extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();

  /**
   * Create or get existing terminal session for an agent.
   * Returns the session key (agentId).
   */
  create(agentId: string, cwd: string, cols = 120, rows = 30, initialCommand?: string): string {
    // Destroy existing session if alive — a new terminal:open means a fresh PTY is wanted
    // Dispose exit handler first to avoid triggering the client's "reopen shell" loop
    const existing = this.sessions.get(agentId);
    if (existing) {
      existing.exitDisposable.dispose();
      try {
        process.kill(-existing.ptyProcess.pid, 'SIGTERM');
      } catch {
        existing.ptyProcess.kill();
      }
      this.sessions.delete(agentId);
    }

    const shell = process.env.SHELL || '/bin/bash';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        CLAUDECODE: '', // Unset so claude can launch inside PTY
      } as Record<string, string>,
    });

    ptyProcess.onData((data: string) => {
      this.emit('data', agentId, data);
    });

    const exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(agentId);
      this.emit('exit', agentId, exitCode);
    });

    this.sessions.set(agentId, { ptyProcess, agentId, cwd, exitDisposable });

    // Auto-run initial command (e.g. claude --resume <sessionId>)
    if (initialCommand) {
      // Small delay to let the shell initialize before sending command
      setTimeout(() => {
        if (this.sessions.has(agentId)) {
          ptyProcess.write(initialCommand + '\r');
        }
      }, 300);
    }

    return agentId;
  }

  write(agentId: string, data: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.ptyProcess.write(data);
    }
  }

  resize(agentId: string, cols: number, rows: number): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  destroy(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      // Kill the entire process group to ensure child processes (e.g. claude)
      // are also terminated, preventing zombie processes.
      const pid = session.ptyProcess.pid;
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Process group kill failed — fall back to direct kill
        session.ptyProcess.kill();
      }
      this.sessions.delete(agentId);
    }
  }

  createSsh(sessionId: string, sshArgs: string[], cols = 120, rows = 30): string {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.exitDisposable.dispose();
      try {
        process.kill(-existing.ptyProcess.pid, 'SIGTERM');
      } catch {
        existing.ptyProcess.kill();
      }
      this.sessions.delete(sessionId);
    }

    const ptyProcess = pty.spawn('ssh', sshArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    });

    ptyProcess.onData((data: string) => {
      this.emit('data', sessionId, data);
    });

    const exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId);
      this.emit('exit', sessionId, exitCode);
    });

    this.sessions.set(sessionId, { ptyProcess, agentId: sessionId, cwd: '', exitDisposable });
    return sessionId;
  }

  has(agentId: string): boolean {
    return this.sessions.has(agentId);
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }
}
