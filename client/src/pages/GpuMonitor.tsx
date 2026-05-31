import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import type { GpuServer, GpuSnapshot, GpuInfo } from '../api/client';
import { getSocket } from '../api/socket';
import { GpuTerminalView } from '../components/GpuTerminalView';
import { useTranslation } from '../i18n';

function shortName(server: GpuServer): string {
  const prefix = `${server.group}-`;
  return server.name.startsWith(prefix) ? server.name.slice(prefix.length) : server.name;
}

function ProgressBar({ percent, colorClass }: { percent: number; colorClass: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="gpu-bar">
      <div className={`gpu-bar-fill ${colorClass}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function utilColor(pct: number): string {
  if (pct >= 80) return 'gpu-high';
  if (pct <= 10) return 'gpu-low';
  return 'gpu-mid';
}

function tempColor(temp: number): string {
  if (temp >= 80) return 'gpu-hot';
  if (temp >= 65) return 'gpu-warm';
  return 'gpu-cool';
}

function statusLabel(status: GpuSnapshot['status']): string {
  return { ok: 'OK', offline: 'OFFLINE', nosmi: 'NO-SMI', pending: 'PENDING' }[status];
}

function statusClass(status: GpuSnapshot['status']): string {
  return { ok: 'gpu-status-ok', offline: 'gpu-status-offline', nosmi: 'gpu-status-nosmi', pending: 'gpu-status-pending' }[status];
}

function GpuRow({ gpu }: { gpu: GpuInfo }) {
  return (
    <div className="gpu-row">
      <span className="gpu-idx">G{gpu.index}</span>
      <span className="gpu-label">U</span>
      <ProgressBar percent={gpu.utilization} colorClass={utilColor(gpu.utilization)} />
      <span className="gpu-pct">{gpu.utilization}%</span>
      <span className="gpu-label">M</span>
      <ProgressBar percent={gpu.memoryPercent} colorClass={utilColor(gpu.memoryPercent)} />
      <span className="gpu-pct">{gpu.memoryPercent}%</span>
      <span className={`gpu-temp ${tempColor(gpu.temperature)}`}>{gpu.temperature}C</span>
    </div>
  );
}

function ServerCard({
  server,
  snapshot,
  selected,
  onClick,
}: {
  server: GpuServer;
  snapshot: GpuSnapshot;
  selected: boolean;
  onClick: () => void;
}) {
  const name = shortName(server);
  return (
    <div className={`gpu-card ${selected ? 'gpu-card-selected' : ''}`} onClick={onClick}>
      <div className="gpu-card-header">
        <span className="gpu-card-name">{name}</span>
        <span className={`gpu-card-role`}>{server.role}</span>
        <span className={`gpu-status-badge ${statusClass(snapshot.status)}`}>
          {statusLabel(snapshot.status)}
        </span>
      </div>
      <div className="gpu-card-body">
        {snapshot.status === 'ok' && snapshot.gpus.map((gpu) => (
          <GpuRow key={gpu.index} gpu={gpu} />
        ))}
        {snapshot.status === 'offline' && (
          <div className="gpu-card-message gpu-card-message-offline">offline / auth error</div>
        )}
        {snapshot.status === 'nosmi' && (
          <div className="gpu-card-message">nvidia-smi not found</div>
        )}
        {snapshot.status === 'pending' && (
          <div className="gpu-card-message">waiting for first poll...</div>
        )}
      </div>
    </div>
  );
}

export function GpuMonitor() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<GpuServer[]>([]);
  const [snapshots, setSnapshots] = useState<Map<string, GpuSnapshot>>(new Map());
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.getGpuServers();
      setServers(data.servers);
      setEnabled(data.enabled);
      const map = new Map<string, GpuSnapshot>();
      for (const snap of data.snapshots) {
        map.set(snap.serverName, snap);
      }
      setSnapshots(map);
    } catch (err) {
      console.error('Failed to fetch GPU servers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const socket = getSocket();
    const onSnapshot = (snapshot: GpuSnapshot) => {
      setSnapshots((prev) => {
        const next = new Map(prev);
        next.set(snapshot.serverName, snapshot);
        return next;
      });
    };
    socket.on('gpu:snapshot', onSnapshot);
    return () => {
      socket.off('gpu:snapshot', onSnapshot);
    };
  }, [fetchData]);

  const handleCardClick = (name: string) => {
    if (selectedServer === name) {
      setSelectedServer(null);
      setTerminalOpen(false);
    } else {
      setSelectedServer(name);
      setTerminalOpen(false);
    }
  };

  const selectedServerObj = selectedServer ? servers.find(s => s.name === selectedServer) : null;
  const selectedSnapshot = selectedServer ? snapshots.get(selectedServer) : null;

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('common.loading')}</div>;
  }

  if (!enabled) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <h2>{t('gpu.title')}</h2>
        <p>{t('gpu.notConfigured')}</p>
      </div>
    );
  }

  const onlineCount = Array.from(snapshots.values()).filter(s => s.status === 'ok').length;

  return (
    <div className="gpu-monitor">
      <div className="page-header">
        <h1 className="page-title">{t('gpu.title')}</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span className="gpu-meta">{t('gpu.serverCount', { count: String(servers.length) })}</span>
          <span className="gpu-meta gpu-meta-online">{t('gpu.onlineCount', { count: String(onlineCount) })}</span>
          <button className="btn btn-sm btn-outline" onClick={fetchData}>{t('gpu.refresh')}</button>
        </div>
      </div>

      <div className="gpu-grid">
        {servers.map((server) => {
          const snapshot = snapshots.get(server.name) || {
            serverName: server.name,
            status: 'pending' as const,
            gpus: [],
            timestamp: 0,
          };
          return (
            <ServerCard
              key={server.name}
              server={server}
              snapshot={snapshot}
              selected={selectedServer === server.name}
              onClick={() => handleCardClick(server.name)}
            />
          );
        })}
      </div>

      {selectedServerObj && selectedSnapshot && (
        <div className="gpu-detail">
          <div className="gpu-detail-header">
            <div className="gpu-detail-info">
              <h3>{shortName(selectedServerObj)}</h3>
              <span className="gpu-detail-meta">{selectedServerObj.ip}</span>
              <span className="gpu-detail-meta">{selectedServerObj.role}</span>
              <span className={`gpu-status-badge ${statusClass(selectedSnapshot.status)}`}>
                {statusLabel(selectedSnapshot.status)}
              </span>
              {selectedSnapshot.status === 'ok' && (
                <span className="gpu-detail-meta">
                  {selectedSnapshot.gpus.length} GPUs
                </span>
              )}
            </div>
            <div className="gpu-detail-actions">
              <button
                className={`btn btn-sm ${terminalOpen ? 'btn-outline' : ''}`}
                onClick={() => setTerminalOpen(!terminalOpen)}
              >
                {terminalOpen ? t('gpu.closeTerminal') : t('gpu.openTerminal')}
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => { setSelectedServer(null); setTerminalOpen(false); }}
              >
                {t('common.close')}
              </button>
            </div>
          </div>

          {selectedSnapshot.status === 'ok' && (
            <div className="gpu-detail-summary">
              {selectedSnapshot.gpus.map((gpu) => (
                <div key={gpu.index} className="gpu-detail-gpu">
                  <span className="gpu-detail-gpu-label">GPU {gpu.index}</span>
                  <div className="gpu-detail-gpu-stats">
                    <span>Util: {gpu.utilization}%</span>
                    <span>Mem: {gpu.memoryUsed}/{gpu.memoryTotal} MiB ({gpu.memoryPercent}%)</span>
                    <span className={tempColor(gpu.temperature)}>Temp: {gpu.temperature}C</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {terminalOpen && (
            <div className="gpu-detail-terminal">
              <GpuTerminalView serverName={selectedServer!} visible={terminalOpen} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
