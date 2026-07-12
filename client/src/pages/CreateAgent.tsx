import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type AgentProvider, type DirListing, type Template, type SessionInfo, type RuntimeCapabilities, type Skill } from '../api/client';
import { useTranslation } from '../i18n';
import { getInstructionFileName, replaceInstructionFileName } from '../lib/instructionFiles';
import {
  getModelOptions,
  normalizeModelSelection,
  type ModelSelection,
} from '../lib/modelOptions';
import {
  getReasoningEffortOptions,
  normalizeReasoningEffortSelection,
  type ReasoningEffortSelection,
} from '../lib/reasoningEffort';

export function CreateAgent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const [cloneSource, setCloneSource] = useState<string | null>(null);
  const [provider, setProvider] = useState<AgentProvider>('claude');
  const [name, setName] = useState('');
  const nameManualRef = useRef(false);
  const [directory, setDirectory] = useState('');
  const [prompt, setPrompt] = useState('');
  const [claudeMd, setClaudeMd] = useState('');
  const [instructionTouched, setInstructionTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [fullAuto, setFullAuto] = useState(true);
  const [sandboxDangerFullAccess, setSandboxDangerFullAccess] = useState(true);
  const [chrome, setChrome] = useState(false);
  const [permissionMode, setPermissionMode] = useState('');
  const [maxBudgetUsd, setMaxBudgetUsd] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [disallowedTools, setDisallowedTools] = useState('');
  const [addDirs, setAddDirs] = useState('');
  const [mcpConfig, setMcpConfig] = useState('');
  const [labelsInput, setLabelsInput] = useState('');
  const [resumeSession, setResumeSession] = useState('');
  const [model, setModel] = useState<ModelSelection>('default');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortSelection>('default');
  const [workspaceMode, setWorkspaceMode] = useState<'worktree' | 'direct'>('direct');
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Directory validation
  const [dirExists, setDirExists] = useState<boolean | null>(null);
  const [dirListing, setDirListing] = useState<DirListing | null>(null);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [claudeMdPrompt, setClaudeMdPrompt] = useState<{ content: string; fileName: string } | null>(null);

  // Templates, sessions, skills, and prompt suggestions
  const [templates, setTemplates] = useState<Template[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
  const [newSuggestion, setNewSuggestion] = useState('');
  const [showAddSuggestion, setShowAddSuggestion] = useState(false);
  const [pathHistory, setPathHistory] = useState<Record<string, string[]>>({});
  const [showPathDropdown, setShowPathDropdown] = useState(false);
  const isDropdownInteractingRef = useRef(false);

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(() => {});
    api.getSkills().then(setSkills).catch(() => {});
    api.getSettings().then((s) => {
      setPromptSuggestions(s.promptSuggestions || []);
      setPathHistory(s.pathHistory || {});
    }).catch(() => {});
    api.getRuntimeCapabilities().then(setRuntimeCapabilities).catch(() => {});

    // Clone from existing agent
    const fromId = searchParams.get('from');
    if (fromId) {
      api.getAgent(fromId).then((source) => {
        setCloneSource(source.name);
        setProvider(source.config.provider);
        setName(`${source.name} (copy)`);
        setDirectory(source.config.directory);
        // Use originalPrompt (stored at creation time), falling back to first user message
        setPrompt(source.originalPrompt || source.messages?.find((m: { role: string }) => m.role === 'user')?.content || source.config.prompt);
        setClaudeMd(source.config.claudeMd || '');
        setInstructionTouched(!!source.config.claudeMd);
        setAdminEmail(source.config.adminEmail || '');
        setWhatsappPhone(source.config.whatsappPhone || '');
        setSlackWebhookUrl(source.config.slackWebhookUrl || '');
        const f = source.config.flags || {};
        setSkipPermissions(!!f.dangerouslySkipPermissions);
        setFullAuto(!!f.fullAuto);
        setSandboxDangerFullAccess(!!f.sandboxDangerFullAccess);
        setChrome(!!f.chrome);
        setPermissionMode((f.permissionMode as string) || '');
        setMaxBudgetUsd(f.maxBudgetUsd ? String(f.maxBudgetUsd) : '');
        setAllowedTools((f.allowedTools as string) || '');
        setDisallowedTools((f.disallowedTools as string) || '');
        setAddDirs((f.addDirs as string) || '');
        setMcpConfig((f.mcpConfig as string) || '');
        setModel(normalizeModelSelection(source.config.provider, f.model, runtimeCapabilities, true));
        setReasoningEffort(normalizeReasoningEffortSelection(source.config.provider, f.reasoningEffort, runtimeCapabilities));
        setWorkspaceMode(source.workspaceMode === 'direct' ? 'direct' : 'worktree');
        if (source.config.skills) setSelectedSkills(source.config.skills);
      }).catch(() => {});
    }

    // Pre-fill directory and workspace mode from Dashboard directory group
    const dirParam = searchParams.get('directory');
    if (dirParam) {
      setDirectory(dirParam);
      if (!fromId) {
        const seg = dirParam.replace(/\/+$/, '').split('/').pop() || '';
        if (seg) setName(`修改${seg}代理`);
      }
    }
    const modeParam = searchParams.get('mode');
    if (modeParam === 'worktree' || modeParam === 'direct') {
      setWorkspaceMode(modeParam);
    }

    // Pre-select a session from the history picker (Esc×2 in AgentChat)
    const sessionParam = searchParams.get('session');
    if (sessionParam) {
      setResumeSession(sessionParam);
    }
  }, [searchParams]);

  useEffect(() => {
    setReasoningEffort((current) => normalizeReasoningEffortSelection(provider, current, runtimeCapabilities));
    setModel((current) => normalizeModelSelection(provider, current, runtimeCapabilities, true));
  }, [provider, runtimeCapabilities]);

  useEffect(() => {
    let cancelled = false;

    api.getSessions(provider).then((nextSessions) => {
      if (cancelled) return;
      setSessions(nextSessions);
      setResumeSession((current) => (
        current && nextSessions.some((session) => session.id === current)
          ? current
          : ''
      ));
    }).catch(() => {
      if (!cancelled) {
        setSessions([]);
        setResumeSession('');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  const autoName = (dirPath: string) => {
    const seg = dirPath.replace(/\/+$/, '').split('/').pop() || '';
    return seg ? `修改${seg}代理` : '';
  };

  const onDirectoryChange = (dirPath: string) => {
    setDirectory(dirPath);
    setDirExists(null);
    setShowPathDropdown(true);
    if (!nameManualRef.current) {
      setName(autoName(dirPath));
    }
  };

  const addSuggestion = async () => {
    const text = newSuggestion.trim();
    if (!text) return;
    const updated = [...promptSuggestions, text];
    setPromptSuggestions(updated);
    setNewSuggestion('');
    setShowAddSuggestion(false);
    try { await api.updateSettings({ promptSuggestions: updated }); } catch {}
  };

  const handleProviderChange = (nextProvider: AgentProvider) => {
    setProvider(nextProvider);
    setReasoningEffort((current) => normalizeReasoningEffortSelection(nextProvider, current, runtimeCapabilities));
    setModel((current) => normalizeModelSelection(nextProvider, current, runtimeCapabilities));
    if (directory) {
      void checkInstructionFile(directory, nextProvider);
    }
  };

  const removeSuggestion = async (index: number) => {
    const updated = promptSuggestions.filter((_, i) => i !== index);
    setPromptSuggestions(updated);
    try { await api.updateSettings({ promptSuggestions: updated }); } catch {}
  };

  const validateDir = async (dirPath: string) => {
    if (!dirPath.trim()) {
      setDirExists(null);
      return;
    }
    try {
      const { exists, path: normalizedPath } = await api.validateDirectory(dirPath);
      const finalPath = exists && normalizedPath && normalizedPath !== dirPath ? normalizedPath : dirPath;
      if (exists && finalPath !== dirPath) {
        onDirectoryChange(finalPath);
        setShowPathDropdown(false);
      }
      setDirExists(exists);
      if (exists) {
        void browseTo(finalPath);
      }
    } catch {
      setDirExists(null);
    }
  };

  const browseTo = async (dirPath?: string) => {
    try {
      setError('');
      const listing = await api.listDirectory(dirPath);
      setDirListing(listing);
      setShowDirBrowser(true);
      setShowPathDropdown(false);
    } catch (err) {
      setError(String(err));
    }
  };

  const selectDirectory = async (dirPath: string) => {
    onDirectoryChange(dirPath);
    setShowDirBrowser(false);
    setShowPathDropdown(false);
    setDirExists(true);
    await checkInstructionFile(dirPath);
  };

  const checkInstructionFile = async (dirPath: string, targetProvider = provider) => {
    try {
      const result = await api.checkInstructionFile(dirPath, targetProvider);
      if (result.exists && result.content && result.fileName) {
        if (!instructionTouched || !claudeMd.trim()) {
          setClaudeMd(result.content);
          setClaudeMdPrompt(null);
          return;
        }
        if (claudeMd.trim() !== result.content.trim()) {
          setClaudeMdPrompt({ content: result.content, fileName: result.fileName });
          return;
        }
        setClaudeMdPrompt(null);
      } else {
        setClaudeMdPrompt(null);
      }
    } catch {
      setClaudeMdPrompt(null);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    if (templateId === '__empty__') {
      setClaudeMd('');
      setInstructionTouched(false);
      return;
    }
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setClaudeMd(tmpl.content);
      setInstructionTouched(true);
    }
  };

  const handleCreate = async () => {
    if (!name || !directory) {
      setError(t('create.requiredFields'));
      return;
    }
    setCreating(true);
    setError('');
    try {
      const parsedLabels: Record<string, string> = {};
      if (labelsInput.trim()) {
        for (const part of labelsInput.split(',')) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            parsedLabels[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
          } else {
            parsedLabels[trimmed] = '';
          }
        }
      }
      const agent = await api.createAgent({
        name,
        provider,
        directory,
        prompt,
        claudeMd: claudeMd || undefined,
        adminEmail: adminEmail || undefined,
        whatsappPhone: whatsappPhone || undefined,
        slackWebhookUrl: slackWebhookUrl || undefined,
        labels: Object.keys(parsedLabels).length > 0 ? parsedLabels : undefined,
        workspaceMode,
        skills: selectedSkills.length > 0 ? selectedSkills : undefined,
        flags: {
          dangerouslySkipPermissions: skipPermissions || undefined,
          fullAuto: fullAuto || undefined,
          sandboxDangerFullAccess: sandboxDangerFullAccess || undefined,
          chrome: chrome || undefined,
          permissionMode: permissionMode || undefined,
          maxBudgetUsd: maxBudgetUsd ? Number(maxBudgetUsd) : undefined,
          allowedTools: allowedTools || undefined,
          disallowedTools: disallowedTools || undefined,
          addDirs: addDirs || undefined,
          mcpConfig: mcpConfig || undefined,
          resume: resumeSession || undefined,
          model: model !== 'default' ? model : undefined,
          reasoningEffort: reasoningEffort !== 'default' ? reasoningEffort : undefined,
        },
      });
      navigate(`/agent/${agent.id}`);
    } catch (err) {
      setError(String(err));
      setCreating(false);
    }
  };

  const instructionFileName = getInstructionFileName(provider);
  const instructionFieldLabel = replaceInstructionFileName(t('create.claudeMd'), instructionFileName);
  const instructionFieldPlaceholder = replaceInstructionFileName(t('create.claudeMdPlaceholder'), instructionFileName);
  const modelOptions = getModelOptions(provider, runtimeCapabilities, model !== 'default' ? model : undefined);
  const reasoningEffortOptions = getReasoningEffortOptions(provider, runtimeCapabilities);

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="page-header">
        <h1 className="page-title">
          {cloneSource ? `${t('create.cloneFrom')} ${cloneSource}` : t('create.title')}
        </h1>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'var(--red)', color: '#fff', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      <div className="form-group">
        <label>{t('common.provider')}</label>
        <div className="provider-selector">
          <button
            className={`provider-btn ${provider === 'claude' ? 'active' : ''}`}
            onClick={() => handleProviderChange('claude')}
            type="button"
          >
            {t('common.claudeCode')}
          </button>
          <button
            className={`provider-btn ${provider === 'codex' ? 'active' : ''}`}
            onClick={() => handleProviderChange('codex')}
            type="button"
          >
            {t('common.codex')}
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>{t('create.workingDir')}</label>
        <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={directory}
            onChange={(e) => onDirectoryChange(e.target.value)}
            onFocus={() => setShowPathDropdown(true)}
            onBlur={() => {
              setTimeout(() => setShowPathDropdown(false), 200);
              if (directory.trim() && !showPathDropdown) {
                validateDir(directory);
                checkInstructionFile(directory);
                if (dirExists) {
                  void browseTo(directory);
                }
              }
            }}
            placeholder={t('create.workingDirPlaceholder')}
          />
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => showDirBrowser ? setShowDirBrowser(false) : void browseTo(directory.trim() || undefined)}
          >
            {t('common.browse')}
          </button>
          {showPathDropdown && (() => {
            const allPaths = Object.entries(pathHistory).flatMap(([machine, paths]) =>
              paths.map(p => ({ machine, path: p }))
            );
            const filtered = allPaths.filter(item =>
              !directory || item.path.toLowerCase().includes(directory.toLowerCase())
            );
            if (filtered.length === 0) return null;
            return (
              <div className="path-dropdown">
                {Object.entries(
                  filtered.reduce<Record<string, string[]>>((acc, item) => {
                    (acc[item.machine] = acc[item.machine] || []).push(item.path);
                    return acc;
                  }, {})
                ).map(([machine, paths]) => (
                  <div key={machine}>
                    <div className="path-dropdown-machine">{machine}</div>
                    {paths.map(p => (
                      <div
                        key={p}
                        className="path-dropdown-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onDirectoryChange(p);
                          setShowPathDropdown(false);
                          setDirExists(true);
                          checkInstructionFile(p);
                        }}
                      >
                        {p}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        {directory.trim() && dirExists === false && (
          <small style={{ color: 'var(--yellow)', marginTop: 4, display: 'block' }}>
            {t('create.pathWillCreate')}
          </small>
        )}
      </div>

      {showDirBrowser && dirListing && (
        <div className="dir-browser" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
            <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{dirListing.path}</code>
            <button type="button" className="btn btn-sm" onClick={() => void selectDirectory(dirListing.path)}>
              {t('common.select')}
            </button>
          </div>
          {dirListing.parent && dirListing.parent !== dirListing.path && (
            <div className="dir-entry is-dir" onClick={() => void browseTo(dirListing.parent)}>
              ../
            </div>
          )}
          {dirListing.entries
            .filter(entry => entry.isDirectory)
            .map(entry => (
              <div key={entry.path} className="dir-entry is-dir" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span onClick={() => void browseTo(entry.path)} style={{ flex: 1 }}>
                  {entry.name}/
                </span>
                <button type="button" className="btn btn-sm" onClick={() => void selectDirectory(entry.path)}>
                  {t('common.select')}
                </button>
              </div>
            ))}
        </div>
      )}

      <div className="form-group">
        <label>{t('create.name')}</label>
        <input
          value={name}
          onChange={(e) => { nameManualRef.current = true; setName(e.target.value); }}
          placeholder={t('create.namePlaceholder')}
        />
      </div>

      <div className="form-group">
        <label>{t('create.labels')}</label>
        <input
          value={labelsInput}
          onChange={(e) => setLabelsInput(e.target.value)}
          placeholder={t('create.labelsPlaceholder')}
        />
        <small style={{ color: 'var(--text-muted)' }}>{t('create.labelsHint')}</small>
      </div>

      <div className="form-group">
        <label>{t('create.workspaceMode')}</label>
        <div className="workspace-mode-toggle" role="radiogroup">
          <button
            type="button"
            role="radio"
            aria-checked={workspaceMode === 'worktree'}
            className={`workspace-mode-option ${workspaceMode === 'worktree' ? 'is-selected' : ''}`}
            onClick={() => setWorkspaceMode('worktree')}
          >
            <span className="workspace-mode-icon" aria-hidden>⎇</span>
            <span className="workspace-mode-label">{t('create.workspaceMode.worktree')}</span>
            <span className="workspace-mode-desc">{t('create.workspaceMode.worktreeDesc')}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={workspaceMode === 'direct'}
            className={`workspace-mode-option ${workspaceMode === 'direct' ? 'is-selected' : ''}`}
            onClick={() => setWorkspaceMode('direct')}
          >
            <span className="workspace-mode-icon" aria-hidden>🔗</span>
            <span className="workspace-mode-label">{t('create.workspaceMode.direct')}</span>
            <span className="workspace-mode-desc">{t('create.workspaceMode.directDesc')}</span>
          </button>
        </div>
        {workspaceMode === 'direct' && (
          <small className="workspace-mode-warning">
            {t('create.workspaceMode.directWarning')}
          </small>
        )}
      </div>

      {claudeMdPrompt && (
        <div style={{ padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            {replaceInstructionFileName(t('create.claudeMdFound'), claudeMdPrompt.fileName)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => {
              setClaudeMd(claudeMdPrompt.content);
              setInstructionTouched(false);
              setClaudeMdPrompt(null);
            }}>
              {replaceInstructionFileName(t('create.loadExisting'), claudeMdPrompt.fileName)}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setClaudeMdPrompt(null)}>
              {t('create.keepCustom')}
            </button>
          </div>
        </div>
      )}

      <div className="form-group">
        <label>{t('create.prompt')}</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('create.promptPlaceholder')}
        />
        {promptSuggestions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {promptSuggestions.map((s, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', fontSize: 12, borderRadius: 12,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  cursor: 'pointer', maxWidth: '100%',
                }}
              >
                <span
                  onClick={() => setPrompt(prev => prev ? prev + '\n' + s : s)}
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={s}
                >
                  {s}
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); removeSuggestion(i); }}
                  style={{ cursor: 'pointer', opacity: 0.5, fontSize: 14, lineHeight: 1, flexShrink: 0 }}
                  title={t('create.removeSuggestion')}
                >&times;</span>
              </span>
            ))}
            {!showAddSuggestion && (
              <span
                onClick={() => setShowAddSuggestion(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '4px 10px', fontSize: 12, borderRadius: 12,
                  background: 'var(--bg-card)', border: '1px dashed var(--border)',
                  cursor: 'pointer', opacity: 0.7,
                }}
                title={t('create.addSuggestion')}
              >+ {t('create.addSuggestion')}</span>
            )}
          </div>
        )}
        {promptSuggestions.length === 0 && (
          <div style={{ marginTop: 8 }}>
            <span
              onClick={() => setShowAddSuggestion(true)}
              style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '4px 10px', fontSize: 12, borderRadius: 12,
                background: 'var(--bg-card)', border: '1px dashed var(--border)',
                cursor: 'pointer', opacity: 0.7,
              }}
            >+ {t('create.addSuggestion')}</span>
          </div>
        )}
        {showAddSuggestion && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              value={newSuggestion}
              onChange={(e) => setNewSuggestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSuggestion()}
              placeholder={t('create.suggestionPlaceholder')}
              style={{ flex: 1, fontSize: 12 }}
              autoFocus
            />
            <button className="btn btn-sm" onClick={addSuggestion}>{t('common.save')}</button>
            <button className="btn btn-sm btn-outline" onClick={() => { setShowAddSuggestion(false); setNewSuggestion(''); }}>{t('common.cancel')}</button>
          </div>
        )}
      </div>

      <div className="form-group">
        <label>{t('create.model')}</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ModelSelection)}
        >
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === 'default' ? t('chat.defaultModel') : option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>{t('create.reasoningEffort')}</label>
        <select
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffortSelection)}
        >
          {reasoningEffortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === 'default' ? t('create.reasoningEffortDefault') : option.label}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          {t(`create.reasoningEffortHint.${provider}`)}
        </div>
      </div>

      <div className="form-group">
        <label>{t('create.flags')}</label>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
            />
            {provider === 'claude'
              ? '--dangerously-skip-permissions'
              : '--dangerously-bypass-approvals-and-sandbox'}
          </label>
          {provider === 'codex' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={fullAuto}
                onChange={(e) => setFullAuto(e.target.checked)}
              />
              approval_policy="never"
            </label>
          )}
          {provider === 'codex' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={sandboxDangerFullAccess}
                onChange={(e) => setSandboxDangerFullAccess(e.target.checked)}
              />
              --sandbox danger-full-access
            </label>
          )}
          {provider === 'claude' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={chrome}
                onChange={(e) => setChrome(e.target.checked)}
              />
              --chrome
            </label>
          )}
        </div>
      </div>

      {provider === 'claude' && (
        <>
          <div className="form-group">
            <label>--permission-mode</label>
            <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)}>
              <option value="">Default</option>
              <option value="acceptEdits">acceptEdits</option>
              <option value="bypassPermissions">bypassPermissions</option>
              <option value="plan">plan</option>
            </select>
          </div>

          <div className="form-group">
            <label>--max-budget-usd</label>
            <input
              value={maxBudgetUsd}
              onChange={(e) => setMaxBudgetUsd(e.target.value)}
              placeholder="e.g. 5.00"
              type="number"
              step="0.01"
              min="0"
            />
          </div>

          <div className="form-group">
            <label>--allowedTools</label>
            <input
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              placeholder='e.g. Bash(git:*) Edit Read'
            />
          </div>

          <div className="form-group">
            <label>--disallowedTools</label>
            <input
              value={disallowedTools}
              onChange={(e) => setDisallowedTools(e.target.value)}
              placeholder='e.g. Bash(rm:*) Write'
            />
          </div>

          <div className="form-group">
            <label>--add-dir</label>
            <input
              value={addDirs}
              onChange={(e) => setAddDirs(e.target.value)}
              placeholder="Additional directories (comma-separated)"
            />
          </div>

          <div className="form-group">
            <label>--mcp-config</label>
            <input
              value={mcpConfig}
              onChange={(e) => setMcpConfig(e.target.value)}
              placeholder="Path to MCP config JSON file"
            />
          </div>
        </>
      )}

      <div className="form-group">
        <label>{t('create.resumeSession')}</label>
        <select value={resumeSession} onChange={(e) => setResumeSession(e.target.value)}>
          <option value="">{t('create.newSession')}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.projectPath} - {new Date(s.lastModified).toLocaleString()}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>
          {instructionFieldLabel}{' '}
          {templates.length > 0 && (
            <select
              style={{ marginLeft: 8, padding: '2px 4px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12 }}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>{t('create.loadTemplate')}</option>
              <option value="__empty__">{t('create.emptyTemplate')}</option>
              {templates.map((tmpl) => (
                <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
              ))}
            </select>
          )}
        </label>
        <textarea
          value={claudeMd}
          onChange={(e) => {
            setClaudeMd(e.target.value);
            setInstructionTouched(true);
          }}
          placeholder={instructionFieldPlaceholder}
          style={{ minHeight: 160 }}
        />
      </div>

      {skills.length > 0 && (
        <div className="form-group">
          <div className="skill-picker-header">
            <div>
              <label>{t('create.skills')}</label>
              <div className="skill-picker-hint">{t('create.skillsHint')}</div>
            </div>
            <div className="skill-picker-actions">
              <span className="skill-picker-count">
                {t('create.skillsSelected', { selected: selectedSkills.length, total: skills.length })}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={selectedSkills.length === skills.length}
                onClick={() => setSelectedSkills(skills.map((skill) => skill.name))}
              >
                {t('create.skillsSelectAll')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={selectedSkills.length === 0}
                onClick={() => setSelectedSkills([])}
              >
                {t('create.skillsClear')}
              </button>
            </div>
          </div>
          <div className="skill-picker">
            {skills.map((skill) => {
              const selected = selectedSkills.includes(skill.name);
              return (
              <label key={skill.name} className={`skill-picker-item ${selected ? 'is-selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedSkills(prev => prev.includes(skill.name) ? prev : [...prev, skill.name]);
                    } else {
                      setSelectedSkills(prev => prev.filter(s => s !== skill.name));
                    }
                  }}
                />
                <span className="skill-picker-copy">
                  <span className="skill-picker-name">{skill.name}</span>
                  <span className="skill-picker-description">{skill.description || t('skills.noDescription')}</span>
                </span>
                <span className="skill-picker-check" aria-hidden>{selected ? '✓' : '+'}</span>
              </label>
            );})}
          </div>
        </div>
      )}

      <div className="form-group">
        <label>{t('create.adminEmail')}</label>
        <input
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          placeholder={t('create.adminEmailPlaceholder')}
          type="email"
        />
      </div>

      <div className="form-group">
        <label>{t('create.whatsappPhone')}</label>
        <input
          value={whatsappPhone}
          onChange={(e) => setWhatsappPhone(e.target.value)}
          placeholder={t('create.whatsappPhonePlaceholder')}
          type="tel"
        />
      </div>

      <div className="form-group">
        <label>{t('create.slackWebhook')}</label>
        <input
          value={slackWebhookUrl}
          onChange={(e) => setSlackWebhookUrl(e.target.value)}
          placeholder={t('create.slackWebhookPlaceholder')}
          type="url"
        />
      </div>

      <button className="btn" onClick={handleCreate} disabled={creating}>
        {creating ? t('create.creating') : t('create.createAgent')}
      </button>
    </div>
  );
}
