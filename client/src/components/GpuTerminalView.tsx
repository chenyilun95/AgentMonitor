import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import { getSocket } from '../api/socket';

interface Props {
  serverName: string;
  visible: boolean;
}

export function GpuTerminalView({ serverName, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const openedRef = useRef(false);
  const everVisibleRef = useRef(false);

  if (visible) everVisibleRef.current = true;

  useEffect(() => {
    if (!everVisibleRef.current || !containerRef.current) return;
    if (termRef.current) return;

    const container = containerRef.current;
    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d364',
        brightWhite: '#f0f6fc',
      },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    term.loadAddon(new CanvasAddon());
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const socket = getSocket();

    const openPty = () => {
      openedRef.current = true;
      const dims = fit.proposeDimensions();
      socket.emit('gpu:terminal:open', {
        serverName,
        cols: dims?.cols || 120,
        rows: dims?.rows || 30,
      });
    };

    const onOutput = (data: { serverName: string; data: string }) => {
      if (data.serverName !== serverName) return;
      term.write(data.data);
    };
    socket.on('gpu:terminal:output', onOutput);

    const onExit = (data: { serverName: string; exitCode: number }) => {
      if (data.serverName !== serverName) return;
      openedRef.current = false;
      term.write('\x1b[?1049l');
      term.clear();
      term.write(`\x1b[90m[SSH exited with code ${data.exitCode}]\x1b[0m\r\n`);
      term.write('\x1b[90mReconnecting...\x1b[0m\r\n\r\n');
      setTimeout(() => openPty(), 1000);
    };
    socket.on('gpu:terminal:exit', onExit);

    const inputDisposable = term.onData((data: string) => {
      socket.emit('gpu:terminal:input', { serverName, data });
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      socket.emit('gpu:terminal:resize', { serverName, cols, rows });
    });

    const onWindowResize = () => {
      if (container.offsetHeight) fit.fit();
    };
    window.addEventListener('resize', onWindowResize);

    term.focus();
    setTimeout(() => openPty(), 200);

    return () => {
      socket.off('gpu:terminal:output', onOutput);
      socket.off('gpu:terminal:exit', onExit);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      window.removeEventListener('resize', onWindowResize);
      if (openedRef.current) {
        socket.emit('gpu:terminal:close', { serverName });
        openedRef.current = false;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [visible, serverName]);

  useEffect(() => {
    if (visible && termRef.current && fitRef.current) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        termRef.current?.focus();
      });
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="terminal-view"
      style={{ display: visible ? 'flex' : 'none' }}
    />
  );
}
