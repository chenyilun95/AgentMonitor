import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Agent } from '../api/client';
import { getSocket } from '../api/socket';
import { useTranslation } from '../i18n';
import { getAgentStatusClass } from '../lib/agentStatus';
import { FileBrowserView } from '../components/FileBrowserView';

const WIKI_LABEL = 'wiki';

export function Wiki() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [wikiConfig, setWikiConfig] = useState<{ wikiDirectory: string; exists: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'files'>('agents');
  const [showSettings, setShowSettings] = useState(false);
  const [configDir, setConfigDir] = useState('');
  const navigate = useNavigate();
  const { t } = useTranslation();

  const fetchAll = async () => {
    try {
      const [agentsData, configData] = await Promise.all([
        api.getAgents(),
        api.getWikiConfig(),
      ]);
      const wikiAgents = agentsData.filter(a => a.labels && a.labels.type === WIKI_LABEL);
      setAgents(wikiAgents);
      setWikiConfig(configData);
      setConfigDir(configData.wikiDirectory);
    } catch (err) {
      console.error('Failed to fetch wiki data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();

    const socket = getSocket();
    const onSnapshot = (data: { agentId: string; agent: Agent }) => {
      if (data.agent?.labels?.type === WIKI_LABEL) {
        setAgents(prev => {
          const idx = prev.findIndex(a => a.id === data.agentId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = data.agent;
            return next;
          }
          return [...prev, data.agent];
        });
      }
    };
    const onStatus = (data: { agentId: string | null; status: Agent['status'] | 'deleted' }) => {
      if (!data.agentId) {
        fetchAll();
        return;
      }
      setAgents(prev =>
        data.status === 'deleted'
          ? prev.filter(a => a.id !== data.agentId)
          : prev.map(a => a.id === data.agentId ? { ...a, status: data.status as Agent['status'] } : a),
      );
    };

    socket.on('agent:snapshot', onSnapshot);
    socket.on('agent:status', onStatus);
    return () => {
      socket.off('agent:snapshot', onSnapshot);
      socket.off('agent:status', onStatus);
    };
  }, []);

  const handleSaveConfig = async () => {
    try {
      const result = await api.updateWikiConfig(configDir);
      setWikiConfig(result);
      setShowSettings(false);
      fetchAll();
    } catch (err) {
      console.error('Failed to save wiki config:', err);
    }
  };

  const handleStop = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.stopAgent(id);
    fetchAll();
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.deleteAgent(id);
    fetchAll();
  };

  const formatStatus = (status: Agent['status']) => {
    switch (status) {
      case 'waiting_input': return t('dashboard.status.needsInput');
      case 'running': return t('dashboard.status.running');
      case 'stopped': return t('dashboard.status.stopped');
      case 'error': return t('dashboard.status.error');
      default: return status;
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const sec = Math.floor((Date.now() - timestamp) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  };

  if (loading) return <div>{t('common.loading')}</div>;

  return (
    <div className="wiki-page">
      {wikiConfig && !wikiConfig.exists && (
        <div className="wiki-config-section">
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>{t('wiki.notConfigured')}</p>
          <label>{t('wiki.configDir')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={configDir}
              onChange={e => setConfigDir(e.target.value)}
              placeholder={t('wiki.configDirPlaceholder')}
            />
            <button className="btn" onClick={handleSaveConfig}>{t('common.save')}</button>
          </div>
        </div>
      )}

      {wikiConfig?.exists && (
        <>
          <div className="wiki-tabs">
            <button
              className={`wiki-tab ${activeTab === 'agents' ? 'active' : ''}`}
              onClick={() => setActiveTab('agents')}
            >
              {t('wiki.tabAgents')}
              <span className="wiki-tab-count">{agents.length}</span>
            </button>
            <button
              className={`wiki-tab ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              {t('dashboard.files')}
            </button>
            <button className="btn btn-outline btn-sm wiki-settings-btn" onClick={() => setShowSettings(s => !s)} title={t('wiki.settings')}>
              &#9881;
            </button>
          </div>

          {activeTab === 'agents' && (
            agents.length === 0 ? (
              <div className="wiki-empty">{t('wiki.empty')}</div>
            ) : (
              <div className="card-grid">
                {agents.sort((a, b) => b.lastActivity - a.lastActivity).map(agent => (
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
                        <span className="agent-title-text">{agent.name}</span>
                      </span>
                      <span className={`status status-${getAgentStatusClass(agent.status)}`}>
                        <span className="status-dot" />
                        {formatStatus(agent.status)}
                      </span>
                    </div>
                    {agent.labels?.source && (
                      <div className="card-meta">
                        <span className="card-meta-item" title={agent.labels.source} style={{ fontSize: 12, opacity: 0.8 }}>
                          {agent.labels.source.length > 60
                            ? agent.labels.source.slice(0, 60) + '...'
                            : agent.labels.source}
                        </span>
                      </div>
                    )}
                    <div className="card-body">
                      {agent.currentTask || (agent.messages.length > 0
                        ? (() => {
                            const last = agent.messages[agent.messages.length - 1].content;
                            return last.length > 100 ? last.slice(0, 100) + '...' : last;
                          })()
                        : t('dashboard.noMessages'))}
                    </div>
                    <div className="card-footer">
                      <span>{formatTimeAgo(agent.lastActivity)}</span>
                      {agent.costUsd !== undefined && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          ${agent.costUsd.toFixed(4)}
                        </span>
                      )}
                    </div>
                    <div className="card-actions">
                      {(agent.status === 'running' || agent.status === 'waiting_input') && (
                        <button className="btn btn-sm btn-outline" onClick={e => handleStop(e, agent.id)}>
                          {t('common.stop')}
                        </button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={e => handleDelete(e, agent.id)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          <div className="wiki-files-fullscreen" style={activeTab !== 'files' ? { display: 'none' } : undefined}>
            <FileBrowserView rootPath={wikiConfig.wikiDirectory} visible={activeTab === 'files'} />
          </div>
        </>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{t('wiki.settings')}</h2>
            <div className="wiki-config-section" style={{ border: 'none', padding: 0, background: 'none' }}>
              <label>{t('wiki.configDir')}</label>
              <input
                value={configDir}
                onChange={e => setConfigDir(e.target.value)}
                placeholder={t('wiki.configDirPlaceholder')}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => setShowSettings(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn" onClick={handleSaveConfig}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
