import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type PipelineTask, type AgentManagerConfig, type AgentProvider, type Template, type HarnessState } from '../api/client';
import { getSocket } from '../api/socket';
import { useTranslation } from '../i18n';

export function Pipeline() {
  const [tasks, setTasks] = useState<PipelineTask[]>([]);
  const [metaConfig, setMetaConfig] = useState<AgentManagerConfig | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // New task form
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newDir, setNewDir] = useState('');
  const [newProvider, setNewProvider] = useState<AgentProvider>('claude');
  const [newModel, setNewModel] = useState('');
  const [newOrder, setNewOrder] = useState<number | ''>('');
  const [newClaudeMd, setNewClaudeMd] = useState('');
  const [newSkipPerms, setNewSkipPerms] = useState(true);
  const [newChrome, setNewChrome] = useState(false);
  const [newFullAuto, setNewFullAuto] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pathHistory, setPathHistory] = useState<Record<string, string[]>>({});
  const [showPathDropdown, setShowPathDropdown] = useState(false);
  const [newDependsOn, setNewDependsOn] = useState<'new' | 'parallel' | number>('new');

  // Config form
  const [cfgClaudeMd, setCfgClaudeMd] = useState('');
  const [cfgDir, setCfgDir] = useState('');
  const [cfgProvider, setCfgProvider] = useState<AgentProvider>('claude');
  const [cfgPollInterval, setCfgPollInterval] = useState(5000);
  const [cfgAdminEmail, setCfgAdminEmail] = useState('');
  const [cfgWhatsappPhone, setCfgWhatsappPhone] = useState('');
  const [cfgSlackWebhook, setCfgSlackWebhook] = useState('');
  const [cfgStuckTimeout, setCfgStuckTimeout] = useState(300000);

  // Harness mode state
  const [mode, setMode] = useState<'simple' | 'harness'>('simple');
  const [harnessState, setHarnessState] = useState<HarnessState | null>(null);
  const [harnessGoal, setHarnessGoal] = useState('');
  const [harnessEvalCriteria, setHarnessEvalCriteria] = useState('');
  const [harnessMaxRevisions, setHarnessMaxRevisions] = useState(3);

  const fetchData = useCallback(async () => {
    try {
      const [taskData, cfgData, tmplData, settings, harnessData] = await Promise.all([
        api.getTasks(),
        api.getMetaConfig(),
        api.getTemplates(),
        api.getSettings().catch(() => ({ pathHistory: {} })),
        api.getHarnessStatus().catch(() => null),
      ]);
      setTasks(taskData);
      setMetaConfig(cfgData);
      setTemplates(tmplData);
      setPathHistory((settings as Record<string, unknown>).pathHistory as Record<string, string[]> || {});
      if (harnessData) {
        setHarnessState(harnessData);
        if (harnessData.status !== 'idle') setMode('harness');
      }
    } catch (err) {
      console.error('Failed to fetch pipeline data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const socket = getSocket();
    socket.on('task:update', () => fetchData());
    socket.on('pipeline:complete', () => fetchData());
    socket.on('meta:status', () => fetchData());
    socket.on('agent:status', () => fetchData());
    socket.on('harness:complete', () => fetchData());
    socket.on('harness:failed', () => fetchData());

    return () => {
      socket.off('task:update');
      socket.off('pipeline:complete');
      socket.off('meta:status');
      socket.off('agent:status');
      socket.off('harness:complete');
      socket.off('harness:failed');
    };
  }, [fetchData]);

  const handleAddTask = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    await api.createTask({
      name: newName.trim(),
      prompt: newPrompt.trim(),
      directory: newDir.trim() || undefined,
      provider: newProvider,
      model: newModel.trim() || undefined,
      claudeMd: newClaudeMd.trim() || undefined,
      flags: {
        dangerouslySkipPermissions: newSkipPerms,
        chrome: (newProvider === 'claude' && newChrome) || undefined,
        fullAuto: (newProvider === 'codex' && newFullAuto) || undefined,
      },
      order: (() => {
        if (newDependsOn === 'new') {
          // New step after all existing
          const maxOrder = tasks.length > 0 ? Math.max(...tasks.map(t => t.order)) : -1;
          return maxOrder + 1;
        }
        if (newDependsOn === 'parallel') {
          // Parallel with the last step
          return tasks.length > 0 ? Math.max(...tasks.map(t => t.order)) : 0;
        }
        // Parallel with a specific step
        return newDependsOn;
      })(),
    });
    setShowAddTask(false);
    setNewName('');
    setNewPrompt('');
    setNewDir('');
    setNewModel('');
    setNewOrder('');
    setNewClaudeMd('');
    setNewSkipPerms(true);
    setNewChrome(false);
    setNewFullAuto(false);
    fetchData();
  };

  const handleDeleteTask = async (id: string) => {
    await api.deleteTask(id);
    fetchData();
  };

  const handleResetTask = async (id: string) => {
    await api.resetTask(id);
    fetchData();
  };

  const handleClearCompleted = async () => {
    await api.clearCompletedTasks();
    fetchData();
  };

  const handleStartMeta = async () => {
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) {
      showToast(t('pipeline.noTasksWarning'));
      return;
    }
    await api.startMetaAgent();
    fetchData();
  };

  const handleStopMeta = async () => {
    await api.stopMetaAgent();
    fetchData();
  };

  const handleStartHarness = async () => {
    if (!harnessGoal.trim()) return;
    await api.startHarness({
      goal: harnessGoal.trim(),
      evaluationCriteria: harnessEvalCriteria.trim() || undefined,
      maxRevisions: harnessMaxRevisions,
    });
    fetchData();
  };

  const handleStopHarness = async () => {
    await api.stopHarness();
    fetchData();
  };

  const handleSaveConfig = async () => {
    await api.updateMetaConfig({
      claudeMd: cfgClaudeMd,
      defaultDirectory: cfgDir,
      defaultProvider: cfgProvider,
      pollIntervalMs: cfgPollInterval,
      adminEmail: cfgAdminEmail.trim() || undefined,
      whatsappPhone: cfgWhatsappPhone.trim() || undefined,
      slackWebhookUrl: cfgSlackWebhook.trim() || undefined,
      stuckTimeoutMs: cfgStuckTimeout,
    });
    setShowConfig(false);
    fetchData();
  };

  const openConfig = () => {
    if (metaConfig) {
      setCfgClaudeMd(metaConfig.claudeMd);
      setCfgDir(metaConfig.defaultDirectory);
      setCfgProvider(metaConfig.defaultProvider);
      setCfgPollInterval(metaConfig.pollIntervalMs);
      setCfgAdminEmail(metaConfig.adminEmail || '');
      setCfgWhatsappPhone(metaConfig.whatsappPhone || '');
      setCfgSlackWebhook(metaConfig.slackWebhookUrl || '');
      setCfgStuckTimeout(metaConfig.stuckTimeoutMs || 300000);
    }
    setShowConfig(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'var(--text-muted)';
      case 'running': return 'var(--green)';
      case 'completed': return 'var(--primary)';
      case 'failed': return 'var(--red)';
      case 'evaluating': return 'var(--yellow, #f59e0b)';
      case 'revision': return 'var(--orange, #f97316)';
      default: return 'var(--text-muted)';
    }
  };

  const getRoleBadge = (role?: string) => {
    if (!role) return null;
    const colors: Record<string, string> = {
      planner: 'var(--purple, #8b5cf6)',
      generator: 'var(--blue, #3b82f6)',
      evaluator: 'var(--yellow, #f59e0b)',
    };
    return (
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 8,
        background: colors[role] || 'var(--text-muted)',
        color: 'white',
        textTransform: 'uppercase',
        marginLeft: 6,
      }}>
        {t(`pipeline.role${role.charAt(0).toUpperCase() + role.slice(1)}` as 'pipeline.rolePlanner')}
      </span>
    );
  };

  // Group tasks by order
  const orderGroups = tasks.reduce<Map<number, PipelineTask[]>>((acc, task) => {
    const group = acc.get(task.order) || [];
    group.push(task);
    acc.set(task.order, group);
    return acc;
  }, new Map());

  const sortedOrders = [...orderGroups.keys()].sort((a, b) => a - b);

  if (loading) return <div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('pipeline.title')}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <button
              className={`btn btn-sm ${mode === 'simple' ? '' : 'btn-outline'}`}
              style={{ borderRadius: 0, borderRight: 'none' }}
              onClick={() => setMode('simple')}
              disabled={harnessState?.status !== 'idle' && harnessState?.status !== undefined && harnessState?.status !== 'complete' && harnessState?.status !== 'failed'}
            >
              {t('pipeline.modeSimple')}
            </button>
            <button
              className={`btn btn-sm ${mode === 'harness' ? '' : 'btn-outline'}`}
              style={{ borderRadius: 0 }}
              onClick={() => setMode('harness')}
              disabled={metaConfig?.running && !metaConfig?.harnessMode}
            >
              {t('pipeline.modeHarness')}
            </button>
          </div>

          {mode === 'simple' && (
            <>
              <button className="btn btn-sm" onClick={() => setShowAddTask(true)}>
                {t('pipeline.addTask')}
              </button>
              <span
                style={{
                  fontSize: 13,
                  padding: '4px 10px',
                  borderRadius: 12,
                  background: metaConfig?.running ? 'var(--green)' : 'var(--bg-input)',
                  color: metaConfig?.running ? 'white' : 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                {t('pipeline.manager')} {metaConfig?.running ? t('pipeline.running') : t('pipeline.stopped')}
              </span>
              {metaConfig?.running ? (
                <button className="btn btn-danger btn-sm" onClick={handleStopMeta}>
                  {t('pipeline.stopManager')}
                </button>
              ) : (
                <button className="btn btn-sm" onClick={handleStartMeta}>
                  {t('pipeline.startManager')}
                </button>
              )}
            </>
          )}

          <button className="btn btn-sm btn-outline" onClick={openConfig}>
            {t('pipeline.configure')}
          </button>
          {tasks.some(tsk => tsk.status === 'completed' || tsk.status === 'failed') && (
            <button className="btn btn-sm btn-outline" onClick={handleClearCompleted}>
              {t('pipeline.clearDone')}
            </button>
          )}
        </div>
      </div>

      {/* Harness mode panel */}
      {mode === 'harness' && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          {(!harnessState || harnessState.status === 'idle' || harnessState.status === 'complete' || harnessState.status === 'failed') ? (
            <div>
              <div className="form-group">
                <label>{t('pipeline.harnessGoal')}</label>
                <textarea
                  value={harnessGoal}
                  onChange={(e) => setHarnessGoal(e.target.value)}
                  placeholder={t('pipeline.harnessGoalPlaceholder')}
                  style={{ minHeight: 80 }}
                />
              </div>
              <div className="form-group">
                <label>{t('pipeline.harnessEvalCriteria')}</label>
                <textarea
                  value={harnessEvalCriteria}
                  onChange={(e) => setHarnessEvalCriteria(e.target.value)}
                  placeholder={t('pipeline.harnessEvalCriteriaPlaceholder')}
                  style={{ minHeight: 60 }}
                />
              </div>
              <div className="form-group">
                <label>{t('pipeline.harnessMaxRevisions')}</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={harnessMaxRevisions}
                  onChange={(e) => setHarnessMaxRevisions(Number(e.target.value))}
                />
              </div>
              <button className="btn" onClick={handleStartHarness} disabled={!harnessGoal.trim()}>
                {t('pipeline.harnessStart')}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{
                fontSize: 13,
                padding: '4px 10px',
                borderRadius: 12,
                background: 'var(--green)',
                color: 'white',
                fontWeight: 600,
              }}>
                {t('pipeline.harnessStatus')}: {t(`pipeline.harness${harnessState.status.charAt(0).toUpperCase() + harnessState.status.slice(1)}` as 'pipeline.harnessPlanning')}
              </span>
              {harnessState.totalGenerators > 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {harnessState.completedGenerators}/{harnessState.totalGenerators} tasks
                  {harnessState.failedGenerators > 0 && ` (${harnessState.failedGenerators} failed)`}
                </span>
              )}
              <button className="btn btn-danger btn-sm" onClick={handleStopHarness}>
                {t('pipeline.harnessStop')}
              </button>
            </div>
          )}
        </div>
      )}

      {tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          {t('pipeline.empty')}
        </div>
      ) : (
        <div className="pipeline-timeline">
          {sortedOrders.map((order, idx) => {
            const group = orderGroups.get(order)!;
            const isParallel = group.length > 1;

            return (
              <div key={order}>
                {idx > 0 && (
                  <div className="pipeline-arrow">
                    <svg width="24" height="32" viewBox="0 0 24 32">
                      <path d="M12 0 L12 24 M6 18 L12 24 L18 18" stroke="var(--text-muted)" strokeWidth="2" fill="none" />
                    </svg>
                  </div>
                )}
                <div className="pipeline-group">
                  <div className="pipeline-group-label">
                    {t('pipeline.step')} {order} {isParallel && <span style={{ color: 'var(--primary)' }}>{t('pipeline.parallel')}</span>}
                  </div>
                  <div className={`pipeline-tasks ${isParallel ? 'parallel' : ''}`}>
                    {group.map((task) => (
                      <div key={task.id} className="pipeline-task-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>
                            {task.name}
                            {getRoleBadge(task.role)}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '1px 8px',
                              borderRadius: 10,
                              background: getStatusColor(task.status),
                              color: 'white',
                            }}
                          >
                            {task.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                          {task.prompt.length > 80 ? task.prompt.slice(0, 80) + '...' : task.prompt}
                        </div>
                        {task.directory && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {t('pipeline.dir')} {task.directory}
                          </div>
                        )}
                        {task.provider && (
                          <span className={`provider-badge provider-${task.provider}`} style={{ marginTop: 4, display: 'inline-block' }}>
                            {task.provider.toUpperCase()}
                          </span>
                        )}
                        {task.error && (
                          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                            {t('pipeline.error')} {task.error}
                          </div>
                        )}
                        {task.evaluationResult && (
                          <div style={{ fontSize: 11, marginTop: 4, color: task.evaluationResult === 'pass' ? 'var(--green)' : 'var(--red)' }}>
                            {t(task.evaluationResult === 'pass' ? 'pipeline.evalPass' : 'pipeline.evalFail')}
                            {task.evaluationFeedback && ` — ${task.evaluationFeedback.slice(0, 100)}`}
                          </div>
                        )}
                        {task.revisionCount !== undefined && task.revisionCount > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {t('pipeline.revisionCount')}: {task.revisionCount}/{task.maxRevisions || '?'}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          {task.status === 'pending' && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteTask(task.id)}>
                              {t('common.delete')}
                            </button>
                          )}
                          {(task.status === 'failed' || task.status === 'completed') && (
                            <button className="btn btn-sm btn-outline" onClick={() => handleResetTask(task.id)}>
                              {t('common.reset')}
                            </button>
                          )}
                          {task.agentId && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => navigate(`/agent/${task.agentId}`)}
                            >
                              {t('pipeline.viewAgent')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Task Modal */}
      {showAddTask && (
        <div className="modal-overlay" onClick={() => setShowAddTask(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('pipeline.addTaskTitle')}</span>
              <button className="btn btn-sm btn-outline" onClick={() => setShowAddTask(false)}>
                {t('common.cancel')}
              </button>
            </div>
            <div className="form-group">
              <label>{t('pipeline.taskName')}</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('pipeline.taskNamePlaceholder')} />
            </div>
            <div className="form-group">
              <label>{t('create.prompt')}</label>
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder={t('pipeline.promptPlaceholder')}
                style={{ minHeight: 80 }}
              />
            </div>
            <div className="form-group" style={{ position: 'relative' }}>
              <label>{t('pipeline.workingDirOptional')}</label>
              <input
                value={newDir}
                onChange={(e) => { setNewDir(e.target.value); setShowPathDropdown(true); }}
                onFocus={() => setShowPathDropdown(true)}
                onBlur={() => setTimeout(() => setShowPathDropdown(false), 200)}
                placeholder={t('pipeline.workingDirPlaceholder')}
              />
              {showPathDropdown && (() => {
                const allPaths = Object.entries(pathHistory).flatMap(([, paths]) => paths);
                const filtered = allPaths.filter(p => !newDir || p.toLowerCase().includes(newDir.toLowerCase()));
                if (filtered.length === 0) return null;
                return (
                  <div className="path-dropdown">
                    {filtered.map(p => (
                      <div key={p} className="path-dropdown-item" onMouseDown={(e) => { e.preventDefault(); setNewDir(p); setShowPathDropdown(false); }}>
                        {p}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('common.provider')}</label>
                <select value={newProvider} onChange={(e) => setNewProvider(e.target.value as AgentProvider)}>
                  <option value="claude">{t('common.claudeCode')}</option>
                  <option value="codex">{t('common.codex')}</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('pipeline.modelOptional')}</label>
                <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="e.g., claude-sonnet-4-5-20250514" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('pipeline.stepOrder')}</label>
                <select
                  value={String(newDependsOn)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewDependsOn(v === 'new' ? 'new' : v === 'parallel' ? 'parallel' : parseInt(v));
                  }}
                >
                  <option value="new">{t('pipeline.newStep')}</option>
                  {tasks.length > 0 && (
                    <option value="parallel">{t('pipeline.parallelWithLast')}</option>
                  )}
                  {[...new Set(tasks.map(t => t.order))].sort((a, b) => a - b).map(order => {
                    const names = tasks.filter(t => t.order === order).map(t => t.name).join(', ');
                    return (
                      <option key={order} value={order}>
                        {t('pipeline.parallelWith')} Step {order} ({names})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>
                {t('pipeline.claudeMdOptional')}{' '}
                {templates.length > 0 && (
                  <select
                    style={{ marginLeft: 8, padding: '2px 4px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12 }}
                    onChange={(e) => {
                      const tmpl = templates.find(t => t.id === e.target.value);
                      if (tmpl) setNewClaudeMd(tmpl.content);
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>{t('create.loadTemplate')}</option>
                    {templates.map((tmpl) => (
                      <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
                    ))}
                  </select>
                )}
              </label>
              <textarea
                value={newClaudeMd}
                onChange={(e) => setNewClaudeMd(e.target.value)}
                placeholder={t('pipeline.claudeMdPlaceholder')}
                style={{ minHeight: 60 }}
              />
            </div>
            <div className="checkbox-group" style={{ marginBottom: 16 }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newSkipPerms}
                  onChange={(e) => setNewSkipPerms(e.target.checked)}
                />
                {newProvider === 'claude'
                  ? t('pipeline.skipPermissions')
                  : '--dangerously-bypass-approvals-and-sandbox'}
              </label>
              {newProvider === 'codex' && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={newFullAuto}
                    onChange={(e) => setNewFullAuto(e.target.checked)}
                  />
                  {t('pipeline.fullAuto')}
                </label>
              )}
              {newProvider === 'claude' && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={newChrome}
                    onChange={(e) => setNewChrome(e.target.checked)}
                  />
                  {t('pipeline.chrome')}
                </label>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={handleAddTask} disabled={!newName.trim() || !newPrompt.trim()}>
                {t('pipeline.addTaskBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfig && (
        <div className="modal-overlay" onClick={() => setShowConfig(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('pipeline.configTitle')}</span>
              <button className="btn btn-sm btn-outline" onClick={() => setShowConfig(false)}>
                {t('common.cancel')}
              </button>
            </div>
            <div className="form-group">
              <label>{t('pipeline.defaultDir')}</label>
              <input value={cfgDir} onChange={(e) => setCfgDir(e.target.value)} placeholder={t('pipeline.defaultDirPlaceholder')} />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('pipeline.defaultProvider')}</label>
                <select value={cfgProvider} onChange={(e) => setCfgProvider(e.target.value as AgentProvider)}>
                  <option value="claude">{t('common.claudeCode')}</option>
                  <option value="codex">{t('common.codex')}</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('pipeline.pollInterval')}</label>
                <input
                  type="number"
                  value={cfgPollInterval}
                  onChange={(e) => setCfgPollInterval(parseInt(e.target.value) || 5000)}
                  min={1000}
                  step={1000}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('pipeline.adminEmail')}</label>
                <input
                  value={cfgAdminEmail}
                  onChange={(e) => setCfgAdminEmail(e.target.value)}
                  placeholder={t('pipeline.adminEmailPlaceholder')}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{t('pipeline.whatsappPhone')}</label>
                <input
                  value={cfgWhatsappPhone}
                  onChange={(e) => setCfgWhatsappPhone(e.target.value)}
                  placeholder={t('pipeline.whatsappPhonePlaceholder')}
                />
              </div>
            </div>
            <div className="form-group">
              <label>{t('pipeline.slackWebhook')}</label>
              <input
                value={cfgSlackWebhook}
                onChange={(e) => setCfgSlackWebhook(e.target.value)}
                placeholder={t('pipeline.slackWebhookPlaceholder')}
              />
            </div>
            <div className="form-group">
              <label>{t('pipeline.stuckTimeout')}</label>
              <input
                type="number"
                value={cfgStuckTimeout / 60000}
                onChange={(e) => setCfgStuckTimeout((parseInt(e.target.value) || 5) * 60000)}
                min={1}
                step={1}
              />
            </div>
            <div className="form-group">
              <label>{t('pipeline.defaultClaudeMd')}</label>
              <textarea
                value={cfgClaudeMd}
                onChange={(e) => setCfgClaudeMd(e.target.value)}
                style={{ minHeight: 200 }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={handleSaveConfig}>
                {t('pipeline.saveConfig')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            background: 'var(--bg-card)',
            border: '1px solid var(--red)',
            borderRadius: 'var(--radius)',
            color: 'var(--red)',
            fontSize: 14,
            fontWeight: 500,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {toast}
          <span
            onClick={() => setToast(null)}
            style={{ cursor: 'pointer', opacity: 0.6, fontSize: 16, lineHeight: 1 }}
          >&times;</span>
        </div>
      )}
    </div>
  );
}
