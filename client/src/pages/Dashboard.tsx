import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Agent, type DeleteSessionFilesPolicy } from '../api/client';
import { getSocket } from '../api/socket';
import { useTranslation } from '../i18n';
import { getAgentStatusClass } from '../lib/agentStatus';

export function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [retentionHours, setRetentionHours] = useState(24);
  const [deleteSessionFilesPolicy, setDeleteSessionFilesPolicy] = useState<DeleteSessionFilesPolicy>('keep');
  const [deleteDialog, setDeleteDialog] = useState<{
    agentId: string;
    agentName: string;
    canPurge: boolean;
    purgeSessionFiles: boolean;
    dontAskAgain: boolean;
  } | null>(null);
  const [showExternal, setShowExternal] = useState(() => localStorage.getItem('agentmonitor-show-external') !== 'false');
  const [labelFilter, setLabelFilter] = useState('');
  const navigate = useNavigate();
  const { t } = useTranslation();

  const fetchAgents = async () => {
    try {
      const data = await api.getAgents();
      setAgents(data);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const s = await api.getSettings();
      setRetentionHours(s.agentRetentionMs / 3_600_000);
      setDeleteSessionFilesPolicy(s.deleteSessionFilesPolicy || 'keep');
    } catch {
      // ignore
    }
  };

  const handleSaveSettings = async () => {
    await api.updateSettings({
      agentRetentionMs: retentionHours * 3_600_000,
      deleteSessionFilesPolicy,
    });
    setShowSettings(false);
  };

  useEffect(() => {
    fetchAgents();
    fetchSettings();

    const socket = getSocket();

    // Real-time: use agent:snapshot to update individual cards without full re-fetch
    const onSnapshot = (data: { agentId: string; agent: Agent }) => {
      if (data.agent) {
        setAgents((prev) => {
          const idx = prev.findIndex((a) => a.id === data.agentId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = data.agent;
            return next;
          }
          // New agent appeared
          return [...prev, data.agent];
        });
      }
    };

    // Fallback for status changes (e.g., stop/delete which don't emit snapshot)
    const onStatus = () => {
      fetchAgents();
    };

    socket.on('agent:snapshot', onSnapshot);
    socket.on('agent:status', onStatus);

    return () => {
      socket.off('agent:snapshot', onSnapshot);
      socket.off('agent:status', onStatus);
    };
  }, []);

  const handleStopAll = async () => {
    await api.stopAllAgents();
    fetchAgents();
  };

  const executeDelete = async (id: string, purgeSessionFiles: boolean) => {
    await api.deleteAgent(id, { purgeSessionFiles });
    fetchAgents();
  };

  const handleDelete = async (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    if (deleteSessionFilesPolicy !== 'purge') {
      setDeleteDialog({
        agentId: agent.id,
        agentName: agent.name,
        canPurge: !!agent.sessionId,
        purgeSessionFiles: false,
        dontAskAgain: false,
      });
      return;
    }
    await executeDelete(agent.id, !!agent.sessionId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialog) return;
    const shouldPurge = deleteDialog.canPurge && deleteDialog.purgeSessionFiles;
    if (deleteDialog.dontAskAgain && shouldPurge) {
      const nextPolicy: DeleteSessionFilesPolicy = 'purge';
      await api.updateSettings({ deleteSessionFilesPolicy: nextPolicy });
      setDeleteSessionFilesPolicy(nextPolicy);
    }
    await executeDelete(deleteDialog.agentId, shouldPurge);
    setDeleteDialog(null);
  };

  const handleStop = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.stopAgent(id);
    fetchAgents();
  };

  const handleRename = async (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    const nextName = window.prompt(t('chat.renamePrompt'), agent.name)?.trim();
    if (!nextName || nextName === agent.name) return;

    setAgents((prev) => prev.map((item) => (
      item.id === agent.id ? { ...item, name: nextName } : item
    )));
    try {
      await api.renameAgent(agent.id, nextName);
    } catch (err) {
      console.error('Failed to rename agent:', err);
      fetchAgents();
    }
  };

  const formatDuration = (createdAt: number, lastActivity: number) => {
    const now = Date.now();
    const elapsed = Math.floor((lastActivity - createdAt) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const duration = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;

    const agoSec = Math.floor((now - lastActivity) / 1000);
    const ago = agoSec < 60 ? `${agoSec}s ago`
      : agoSec < 3600 ? `${Math.floor(agoSec / 60)}m ago`
      : `${Math.floor(agoSec / 3600)}h ago`;

    return `${duration} · ${ago}`;
  };

  const getLastMessage = (agent: Agent) => {
    if (agent.messages.length === 0) return t('dashboard.noMessages');
    const last = agent.messages[agent.messages.length - 1];
    const text = last.content;
    return text.length > 100 ? text.slice(0, 100) + '...' : text;
  };

  const formatStatus = (status: Agent['status']) => {
    switch (status) {
      case 'waiting_input':
        return t('dashboard.status.needsInput');
      case 'running':
        return t('dashboard.status.running');
      case 'stopped':
        return t('dashboard.status.needsInput');
      case 'error':
        return t('dashboard.status.error');
      default:
        return status;
    }
  };

  if (loading) return <div>{t('common.loading')}</div>;

  const activeExternalAgents = agents.filter(
    (a) => a.source === 'external' && (a.status === 'running' || a.status === 'waiting_input'),
  );
  const displayAgents = agents.filter((a) => {
    if (!labelFilter) return true;
    const sep = labelFilter.indexOf('=');
    if (sep < 0) {
      // Filter by key existence
      return a.labels && labelFilter in a.labels;
    }
    const k = labelFilter.slice(0, sep);
    const v = labelFilter.slice(sep + 1);
    return a.labels?.[k] === v;
  }).sort((a, b) => {
    const byLastActivity = b.lastActivity - a.lastActivity;
    if (byLastActivity !== 0) return byLastActivity;
    return b.createdAt - a.createdAt;
  });

  // Collect all unique labels for the filter dropdown
  const allLabels = Array.from(new Set(
    agents.flatMap(a => Object.entries(a.labels || {}).map(([k, v]) => v ? `${k}=${v}` : k))
  ));
  const visibleAgents = displayAgents.filter(a => showExternal || a.source !== 'external');
  const waitingInputAgents = visibleAgents.filter(a => a.status === 'waiting_input');

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('dashboard.title')}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {allLabels.length > 0 && (
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.85em' }}
            >
              <option value="">All Labels</option>
              {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          <button className="btn" onClick={() => navigate('/create')}>
            {t('dashboard.newAgent')}
          </button>
          {displayAgents.length > 0 && (
            <button className="btn btn-danger" onClick={handleStopAll}>
              {t('dashboard.stopAll')}
            </button>
          )}
          {(() => {
            const extCount = activeExternalAgents.length;
            if (extCount === 0) return null;
            return (
              <button
                className={`btn ${showExternal ? 'btn-outline' : 'btn-outline'}`}
                onClick={() => {
                  setShowExternal(prev => {
                    const next = !prev;
                    localStorage.setItem('agentmonitor-show-external', String(next));
                    return next;
                  });
                }}
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: showExternal ? 'var(--green, #22c55e)' : 'var(--text-muted)',
                  display: 'inline-block',
                }} />
                {showExternal ? t('dashboard.externalShow', { count: extCount }) : t('dashboard.externalHidden', { count: extCount })}
              </button>
            );
          })()}
          <button className="btn btn-outline" onClick={() => setShowSettings(true)} title={t('dashboard.settings')} style={{ fontSize: 30, lineHeight: 1 }}>
            &#9881;
          </button>
        </div>
      </div>

      {waitingInputAgents.length > 0 && (
        <div className="dashboard-attention">
          <span className="dashboard-attention-label">
            {t('dashboard.needsInputCount', { count: waitingInputAgents.length })}
          </span>
          <div className="dashboard-attention-list">
            {waitingInputAgents.map((waitingAgent) => (
              <button
                key={waitingAgent.id}
                type="button"
                className="dashboard-attention-agent"
                onClick={() => navigate(`/agent/${waitingAgent.id}`)}
              >
                {waitingAgent.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {visibleAgents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          {t('dashboard.empty')}
        </div>
      ) : (
        <div className="card-grid">
          {visibleAgents.map((agent) => {
            const contextTotal = agent.contextWindow?.total ?? 0;
            const rawContextPercent = contextTotal > 0
              ? (agent.contextWindow!.used / contextTotal) * 100
              : 0;
            const contextPercent = Math.max(0, Math.min(100, rawContextPercent));

            return (
              <div
                key={agent.id}
                className="card"
                onClick={() => navigate(`/agent/${agent.id}`)}
              >
              <div className="card-header">
                <span className="card-name">
                  <span className={`provider-badge provider-${agent.config.provider || 'claude'}`}>
                    {(agent.config.provider || 'claude').toUpperCase()}
                  </span>
                  {agent.source === 'external' && (
                    <span className="provider-badge" style={{ background: '#6366f1', color: '#fff', marginLeft: 4 }}>{t('dashboard.externalBadge')}</span>
                  )}
                  {agent.labels && Object.entries(agent.labels).map(([k, v]) => (
                    <span key={k} className="provider-badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', marginLeft: 4, fontSize: '0.7em' }}>{v ? `${k}=${v}` : k}</span>
                  ))}
                  <span className="agent-title-text">{agent.name}</span>
                  <button
                    type="button"
                    className="agent-rename-btn"
                    aria-label={`${t('chat.slashRename')}: ${agent.name}`}
                    title={t('chat.slashRename')}
                    onClick={(e) => handleRename(e, agent)}
                  >
                    &#9998;
                  </button>
                </span>
                <span className={`status status-${getAgentStatusClass(agent.status)}`}>
                  <span className="status-dot" />
                  {formatStatus(agent.status)}
                </span>
              </div>

              {/* Project & Branch */}
              <div className="card-meta">
                <span className="card-meta-item" title={agent.config.directory}>
                  <span className="card-meta-icon">&#128193;</span>
                  {agent.projectName || agent.config.directory.split('/').pop()}
                  {agent.workspaceMode === 'direct' ? (
                    <span className="card-direct" title={t('workspaceMode.directTooltip')}>
                      <span className="direct-icon" aria-hidden>🔗</span>
                      {t('workspaceMode.direct')}
                    </span>
                  ) : agent.worktreeBranch ? (
                    <span className="card-branch" title={agent.worktreeBranch}>
                      <svg className="branch-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                        <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
                      </svg>
                      {t('workspaceMode.worktreeChip', { branch: agent.worktreeBranch.replace(/^agent-/, '') })}
                    </span>
                  ) : null}
                </span>
                {agent.prUrl && (
                  <a
                    className="card-pr-link"
                    href={agent.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                    </svg>
                    PR #{agent.prUrl.split('/').pop()}
                  </a>
                )}
              </div>

              {/* Model & Context */}
              <div className="card-meta">
                {typeof agent.config.flags.model === 'string' && agent.config.flags.model && (
                  <span className="card-meta-item">
                    <svg className="card-meta-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                      <path d="M5.433 2.304A4.492 4.492 0 0 0 3.5 6c0 1.598.832 3.002 2.09 3.802.518.328.929.923.902 1.64v.008l-.164 3.092a.75.75 0 1 1-1.498-.08l.164-3.084c.007-.13-.112-.383-.527-.626A5.98 5.98 0 0 1 1.5 6a5.993 5.993 0 0 1 2.567-4.92.75.75 0 1 1 .866 1.224Zm5.135 0a.75.75 0 0 1 .866-1.224A5.993 5.993 0 0 1 14 6a5.98 5.98 0 0 1-2.967 5.178c-.414.243-.534.496-.527.626l.164 3.084a.75.75 0 1 1-1.498.08l-.164-3.092v-.008c-.027-.717.384-1.312.902-1.64A4.492 4.492 0 0 0 12 6a4.492 4.492 0 0 0-1.433-3.696Z" />
                    </svg>
                    {String(agent.config.flags.model)}
                  </span>
                )}
                {agent.contextWindow && contextTotal > 0 && (
                  <span className="card-meta-item card-context">
                    <span className="card-context-bar">
                      <span
                        className="card-context-fill"
                        style={{ width: `${contextPercent}%` }}
                      />
                    </span>
                    {Math.round(contextPercent)}%
                  </span>
                )}
              </div>

              {/* Task description */}
              <div className="card-body">
                {agent.currentTask || getLastMessage(agent)}
              </div>

              {/* MCP Servers */}
              {agent.mcpServers && agent.mcpServers.length > 0 && (
                <div className="card-mcp">
                  {agent.mcpServers.map((s) => (
                    <span key={s} className="card-mcp-tag">{s}</span>
                  ))}
                </div>
              )}

              <div className="card-footer">
                <span>{formatDuration(agent.createdAt, agent.lastActivity)}</span>
                {agent.costUsd !== undefined && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    ${agent.costUsd.toFixed(4)}
                  </span>
                )}
                {agent.tokenUsage && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {agent.tokenUsage.input + agent.tokenUsage.output} {t('common.tokens')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={(e) => { e.stopPropagation(); navigate(`/create?from=${agent.id}`); }}
                  title={t('dashboard.cloneAgent')}
                >
                  {t('dashboard.clone')}
                </button>
                {(agent.status === 'running' || agent.status === 'waiting_input') && (
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={(e) => handleStop(e, agent.id)}
                  >
                    {t('common.stop')}
                  </button>
                )}
                {agent.source === 'external' ? (
                  <span
                    className="quick-tooltip"
                    data-tooltip={t('dashboard.externalDeleteDisabled')}
                    style={{ display: 'inline-flex', cursor: 'not-allowed' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="btn btn-sm btn-danger"
                      disabled
                      style={{ pointerEvents: 'none', opacity: 0.6 }}
                    >
                      {t('common.delete')}
                    </button>
                  </span>
                ) : (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={(e) => handleDelete(e, agent)}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
              </div>
            );
          })}
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('dashboard.settings')}</h2>
            <div className="form-group">
              <label>{t('dashboard.retentionHours')}</label>
              <input
                type="number"
                min="0"
                step="1"
                value={retentionHours}
                onChange={(e) => setRetentionHours(Math.max(0, Number(e.target.value)))}
                placeholder={t('dashboard.retentionDisabled')}
              />
              {retentionHours === 0 && (
                <small style={{ color: 'var(--text-muted)' }}>{t('dashboard.retentionDisabled')}</small>
              )}
            </div>
            <div className="form-group">
              <label>{t('dashboard.deleteSessionPolicy')}</label>
              <select
                value={deleteSessionFilesPolicy}
                onChange={(e) => setDeleteSessionFilesPolicy(e.target.value as DeleteSessionFilesPolicy)}
              >
                <option value="ask">{t('dashboard.deleteSessionPolicy.ask')}</option>
                <option value="keep">{t('dashboard.deleteSessionPolicy.keep')}</option>
                <option value="purge">{t('dashboard.deleteSessionPolicy.purge')}</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => setShowSettings(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn" onClick={handleSaveSettings}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteDialog && (
        <div className="modal-overlay" onClick={() => setDeleteDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('dashboard.deleteConfirmTitle')}</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: 6, marginBottom: 12 }}>
              {t('dashboard.deleteConfirmMessage', { name: deleteDialog.agentName })}
            </p>
            <label className="checkbox-label" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={deleteDialog.purgeSessionFiles}
                disabled={!deleteDialog.canPurge}
                onChange={(e) => setDeleteDialog((prev) => prev ? {
                  ...prev,
                  purgeSessionFiles: e.target.checked,
                  dontAskAgain: e.target.checked ? prev.dontAskAgain : false,
                } : prev)}
              />
              {t('dashboard.deleteConfirmPurge')}
            </label>
            {!deleteDialog.canPurge && (
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 10 }}>
                {t('dashboard.deleteConfirmNoSession')}
              </small>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={deleteDialog.dontAskAgain}
                disabled={!deleteDialog.canPurge || !deleteDialog.purgeSessionFiles}
                onChange={(e) => setDeleteDialog((prev) => prev ? { ...prev, dontAskAgain: e.target.checked } : prev)}
              />
              {t('dashboard.deleteConfirmDontAsk')}
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => setDeleteDialog(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={handleDeleteConfirm}>
                {t('dashboard.deleteConfirmAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
