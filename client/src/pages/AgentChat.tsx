import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Agent, type RuntimeCapabilities } from '../api/client';
import { getSocket, joinAgent, leaveAgent } from '../api/socket';
import { useTranslation } from '../i18n';
import { TerminalView } from '../components/TerminalView';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getInstructionFileName, replaceInstructionFileName } from '../lib/instructionFiles';
import {
  getReasoningEffortLabel,
  getReasoningEffortOptions,
  isReasoningEffortSupported,
  normalizeReasoningEffortSelection,
  type ReasoningEffortSelection,
} from '../lib/reasoningEffort';

type ChatMessage = Agent['messages'][number];
type ToolMessageDetails = {
  title: string;
  input?: string;
  output?: string;
  details?: string;
};

function normalizeToolField(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getToolMessageDetails(msg: ChatMessage): ToolMessageDetails | null {
  if (msg.role !== 'tool') return null;

  const toolInput = normalizeToolField(msg.toolInput);
  const toolResult = normalizeToolField(msg.toolResult);
  const content = normalizeToolField(msg.content);
  const lines = content?.split('\n') || [];
  const firstLine = lines[0];
  const remaining = lines.slice(1).join('\n').trim();
  const genericToolNames = new Set(['tool', 'command', 'command_execution', 'tool_call', 'function_call']);
  const normalizedToolName = normalizeToolField(msg.toolName);

  let title = (normalizedToolName && !genericToolNames.has(normalizedToolName))
    ? normalizedToolName
    : (firstLine || normalizedToolName || 'Tool');
  let details: string | undefined;

  if (toolInput || toolResult) {
    if (content) {
      const normalizedTitle = title.trim();
      const normalizedContent = content.trim();
      if (normalizedContent !== normalizedTitle && normalizedContent !== `Using tool: ${normalizedTitle}`) {
        details = normalizedContent;
      }
    }
  } else if (content) {
    if (firstLine?.startsWith('Command:')) {
      title = firstLine;
      details = remaining || content;
    } else if (firstLine?.startsWith('Tool:') || firstLine?.startsWith('Using tool:')) {
      title = firstLine;
      details = remaining || content;
    } else {
      title = firstLine || title;
      details = remaining || content;
    }
  }

  return {
    title,
    input: toolInput,
    output: toolResult,
    details,
  };
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('agentmonitor-theme', next);
}

/**
 * Build a provider-specific interactive resume command with the agent's flags
 * so the PTY terminal can reopen the same session in a shell.
 */
function buildResumeCommand(agent: Agent | null, runtimeCapabilities?: RuntimeCapabilities | null): string | undefined {
  if (!agent) return undefined;
  const provider = agent.config.provider || 'claude';
  if (!agent.sessionId) return undefined;
  if (agent.status === 'stopped' || agent.status === 'error') return undefined;

  // Convert camelCase flag keys to kebab-case for CLI
  const toKebab = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

  if (provider === 'codex') {
    const parts = ['codex', 'resume', '--include-non-interactive', agent.sessionId];
    const flags = agent.config.flags || {};

    for (const [key, value] of Object.entries(flags)) {
      if (key === 'resume') continue;
      if (key === 'dangerouslySkipPermissions' && value === true) {
        parts.push('--dangerously-bypass-approvals-and-sandbox');
        continue;
      }
      if (key === 'fullAuto' && value === true) {
        parts.push('--full-auto');
        continue;
      }
      if (key === 'askForApprovalNever' && value === true) {
        parts.push('--ask-for-approval', 'never');
        continue;
      }
      if (key === 'sandboxDangerFullAccess' && value === true) {
        parts.push('--sandbox', 'danger-full-access');
        continue;
      }
      if (key === 'reasoningEffort') {
        if (isReasoningEffortSupported(provider, value, runtimeCapabilities)) {
          parts.push('-c', `model_reasoning_effort="${String(value)}"`);
        }
        continue;
      }
      if (key === 'addDirs' && typeof value === 'string') {
        for (const dir of value.split(/[,\s]+/).filter(Boolean)) {
          parts.push('--add-dir', dir);
        }
        continue;
      }
      if (key === 'model' && value) {
        parts.push('--model', String(value));
        continue;
      }

      const flag = toKebab(key);
      if (value === true) {
        parts.push(`--${flag}`);
      } else if (value !== false && value !== undefined && value !== null && value !== '') {
        parts.push(`--${flag}`, String(value));
      }
    }

    const cwd = agent.worktreePath || agent.config.directory;
    if (cwd) {
      parts.push('--cd', cwd);
    }
    return parts.join(' ');
  }

  const parts = ['claude', '--resume', agent.sessionId];
  const flags = agent.config.flags || {};
  for (const [key, value] of Object.entries(flags)) {
    if (key === 'resume') continue; // already added
    if (key === 'reasoningEffort') {
      if (isReasoningEffortSupported(provider, value, runtimeCapabilities)) {
        parts.push('--effort', String(value));
      }
      continue;
    }
    const flag = toKebab(key);
    if (value === true) {
      parts.push(`--${flag}`);
    } else if (value !== false && value !== undefined && value !== null && value !== '') {
      parts.push(`--${flag}`, String(value));
    }
  }
  return parts.join(' ');
}

export function AgentChat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [input, setInput] = useState('');
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [selectedHint, setSelectedHint] = useState(0);
  const [editingClaudeMd, setEditingClaudeMd] = useState(false);
  const [claudeMdContent, setClaudeMdContent] = useState('');
  const [localMessages, setLocalMessages] = useState<Array<{ id: string; role: string; content: string }>>([]);
  const [inputRequired, setInputRequired] = useState<{ prompt: string; choices?: string[] } | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [showTerminal, setShowTerminal] = useState(false);
  const [renderMarkdown, setRenderMarkdown] = useState(() => localStorage.getItem('agentmonitor-markdown') !== 'false');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastEscRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const compositionEndTimeRef = useRef(0);
  const inputHistoryRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const savedInputRef = useRef('');
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [historyPickerIdx, setHistoryPickerIdx] = useState(0);
  const [historyRestoreTarget, setHistoryRestoreTarget] = useState<number | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffortSelection>('default');
  const [updatingReasoningEffort, setUpdatingReasoningEffort] = useState(false);
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilities | null>(null);

  const addLocalMessage = (content: string, role = 'system') => {
    setLocalMessages((prev) => [...prev, { id: `local-${Date.now()}`, role, content }]);
  };

  const formatReasoningEffort = (effort?: Agent['config']['flags']['reasoningEffort']) =>
    effort ? getReasoningEffortLabel(effort) : t('chat.defaultReasoningEffort');

  const slashCommands = [
    { cmd: '/agents', desc: t('chat.slashAgents') },
    { cmd: '/clear', desc: t('chat.slashClear') },
    { cmd: '/compact', desc: t('chat.slashCompact') },
    { cmd: '/config', desc: t('chat.slashConfig') },
    { cmd: '/context', desc: t('chat.slashContext') },
    { cmd: '/copy', desc: t('chat.slashCopy') },
    { cmd: '/cost', desc: t('chat.slashCost') },
    { cmd: '/doctor', desc: t('chat.slashDoctor') },
    { cmd: '/exit', desc: t('chat.slashExit') },
    { cmd: '/export', desc: t('chat.slashExport') },
    { cmd: '/help', desc: t('chat.slashHelp') },
    { cmd: '/memory', desc: t('chat.slashMemory') },
    { cmd: '/model', desc: t('chat.slashModel') },
    { cmd: '/permissions', desc: t('chat.slashPermissions') },
    { cmd: '/plan', desc: t('chat.slashPlan') },
    { cmd: '/plugin', desc: t('chat.slashPlugin') },
    { cmd: '/rename', desc: t('chat.slashRename') },
    { cmd: '/skills', desc: t('chat.slashSkills') },
    { cmd: '/stats', desc: t('chat.slashStats') },
    { cmd: '/status', desc: t('chat.slashStatus') },
    { cmd: '/stop', desc: t('chat.slashStop') },
    { cmd: '/tasks', desc: t('chat.slashTasks') },
    { cmd: '/theme', desc: t('chat.slashTheme') },
    { cmd: '/todos', desc: t('chat.slashTodos') },
    { cmd: '/usage', desc: t('chat.slashUsage') },
  ];

  const fetchAgent = useCallback(async (forceOverwrite = false) => {
    if (!id) return;
    try {
      const data = await api.getAgent(id);
      setAgent(prev => {
        // Don't overwrite optimistic messages (pending-* ids) if server hasn't caught up
        // But allow overwrite when explicitly forced (e.g. after restore)
        if (!forceOverwrite && prev && data.messages.length < prev.messages.length) {
          return { ...prev, status: data.status as Agent['status'], costUsd: data.costUsd, tokenUsage: data.tokenUsage };
        }
        return data;
      });
      // Initialize input history from existing user messages (most recent first)
      if (inputHistoryRef.current.length === 0 && data.messages) {
        const userMsgs = data.messages
          .filter((m: { role: string }) => m.role === 'user')
          .map((m: { content: string }) => m.content)
          .reverse();
        // Deduplicate
        const seen = new Set<string>();
        inputHistoryRef.current = userMsgs.filter((msg: string) => {
          if (seen.has(msg)) return false;
          seen.add(msg);
          return true;
        }).slice(0, 50);
      }
    } catch {
      navigate('/');
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchAgent();
    api.getRuntimeCapabilities().then(setRuntimeCapabilities).catch(() => {});
    if (!id) return;

    joinAgent(id);
    const socket = getSocket();
    let socketWorking = false;

    // Primary: incremental delta (lightweight, only new messages + metadata)
    const onDelta = (data: { agentId: string; delta: { messages: Agent['messages']; status: string; costUsd?: number; tokenUsage?: Agent['tokenUsage']; lastActivity: number } }) => {
      if (data.agentId !== id) return;
      socketWorking = true;
      setAgent(prev => {
        if (!prev) return prev;
        const existingIds = new Set(prev.messages.map(m => m.id));
        const newMsgs = data.delta.messages.filter(m => !existingIds.has(m.id));
        return {
          ...prev,
          messages: [...prev.messages, ...newMsgs],
          status: data.delta.status as Agent['status'],
          costUsd: data.delta.costUsd ?? prev.costUsd,
          tokenUsage: data.delta.tokenUsage ?? prev.tokenUsage,
          lastActivity: data.delta.lastActivity,
        };
      });
    };

    // Full snapshot (for status changes, initial load, dashboard sync)
    const onUpdate = (data: { agentId: string; agent: Agent }) => {
      if (data.agentId === id && data.agent) {
        socketWorking = true;
        // Only apply if server has at least as many messages (avoid overwriting optimistic messages)
        setAgent(prev => {
          if (!prev) return data.agent;
          if (data.agent.messages.length >= prev.messages.length) return data.agent;
          // Server hasn't caught up with our optimistic message yet — merge status only
          return { ...prev, status: data.agent.status as Agent['status'], costUsd: data.agent.costUsd, tokenUsage: data.agent.tokenUsage };
        });
      }
    };

    // Status change
    const onStatus = (data: { agentId: string; status: string }) => {
      if (data.agentId === id) {
        socketWorking = true;
        setAgent(prev => prev ? { ...prev, status: data.status as Agent['status'] } : prev);
        // Clear input prompt when agent resumes running
        if (data.status === 'running') {
          setInputRequired(null);
        }
      }
    };

    // Input required (permission prompts, choices)
    const onInputRequired = (data: { agentId: string; inputInfo: { prompt: string; choices?: string[] } }) => {
      if (data.agentId === id) {
        socketWorking = true;
        setInputRequired(data.inputInfo);
        // Focus the input field
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    socket.on('agent:delta', onDelta);
    socket.on('agent:update', onUpdate);
    socket.on('agent:status', onStatus);
    socket.on('agent:input_required', onInputRequired);

    // Re-join room on reconnect (socket.io assigns new socket id after reconnect)
    const onReconnect = () => {
      console.log('[AgentChat] Socket reconnected, re-joining room');
      joinAgent(id);
      fetchAgent();
    };
    socket.on('connect', onReconnect);

    // Polling fallback: if socket events aren't arriving, poll every 3s while agent is running
    const pollInterval = setInterval(() => {
      if (!socketWorking) {
        fetchAgent();
      }
      // Reset flag each interval — if no socket events arrive in the next interval, we'll poll again
      socketWorking = false;
    }, 3000);

    return () => {
      leaveAgent(id);
      clearInterval(pollInterval);
      socket.off('agent:delta', onDelta);
      socket.off('agent:update', onUpdate);
      socket.off('agent:status', onStatus);
      socket.off('agent:input_required', onInputRequired);
      socket.off('connect', onReconnect);
    };
  }, [id, fetchAgent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent?.messages?.length]);

  useEffect(() => {
    if (agent) {
      setSelectedReasoningEffort(
        normalizeReasoningEffortSelection(agent.config.provider, agent.config.flags.reasoningEffort, runtimeCapabilities),
      );
    }
  }, [agent, agent?.config.flags.reasoningEffort, agent?.config.provider, runtimeCapabilities]);

  // Esc key handler: single = interrupt, double = conversation history picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If history picker or restore confirm is open, close them
        if (historyRestoreTarget !== null) {
          setHistoryRestoreTarget(null);
          return;
        }
        if (showHistoryPicker) {
          setShowHistoryPicker(false);
          lastEscRef.current = 0;
          return;
        }
        const now = Date.now();
        if (now - lastEscRef.current < 500) {
          // Double Esc → show conversation history picker
          lastEscRef.current = 0;
          setHistoryPickerIdx(0);
          setShowHistoryPicker(true);
        } else {
          // Single Esc → interrupt
          lastEscRef.current = now;
          if (id) {
            api.interruptAgent(id);
            addLocalMessage(t('chat.interrupted'));
          }
        }
        return;
      }
      // Arrow-key navigation inside history picker
      if (showHistoryPicker && historyRestoreTarget === null) {
        const userTurns = agent?.messages.filter(m => m.role === 'user') || [];
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHistoryPickerIdx(i => Math.min(i + 1, userTurns.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHistoryPickerIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (userTurns[historyPickerIdx]) {
            setHistoryRestoreTarget(historyPickerIdx);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [id, agent, showHistoryPicker, historyPickerIdx, historyRestoreTarget, navigate, t]);

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.startsWith('/')) {
      setShowSlash(true);
      setSlashFilter(value);
      setSelectedHint(0);
    } else {
      setShowSlash(false);
    }
  };

  const handleSlashSelect = (cmd: string) => {
    setShowSlash(false);
    setInput('');

    switch (cmd) {
      case '/agents':
        api.getAgents().then((agents) => {
          if (agents.length === 0) {
            addLocalMessage(t('chat.noAgents'));
          } else {
            const lines = agents.map((a) => {
              const cost = a.costUsd !== undefined ? `$${a.costUsd.toFixed(4)}` : '';
              return `${a.name} | ${(a.config.provider || 'claude').toUpperCase()} | ${a.status} ${cost}`;
            });
            addLocalMessage(lines.join('\n'));
          }
        });
        break;
      case '/help':
        addLocalMessage(
          slashCommands.map((c) => `${c.cmd}  ${c.desc}`).join('\n'),
        );
        break;
      case '/clear':
        setLocalMessages([]);
        break;
      case '/compact':
        // Support /compact [instructions] - send as message if has args
        addLocalMessage(t('chat.compactMsg'));
        break;
      case '/config':
        if (agent) {
          const info = [
            `Provider: ${agent.config.provider}`,
            `Directory: ${agent.config.directory}`,
            `Flags: ${JSON.stringify(agent.config.flags)}`,
            agent.config.adminEmail ? `Admin Email: ${agent.config.adminEmail}` : null,
          ].filter(Boolean).join('\n');
          addLocalMessage(info);
        }
        break;
      case '/cost':
        if (agent) {
          const costInfo = agent.costUsd !== undefined
            ? `$${agent.costUsd.toFixed(4)}`
            : agent.tokenUsage
              ? `Input: ${agent.tokenUsage.input} | Output: ${agent.tokenUsage.output} | Total: ${agent.tokenUsage.input + agent.tokenUsage.output} tokens`
              : t('chat.noCostData');
          addLocalMessage(costInfo);
        }
        fetchAgent();
        break;
      case '/export': {
        if (agent) {
          const exported = agent.messages
            .map((m) => `[${m.role}] ${m.content}`)
            .join('\n\n---\n\n');
          const blob = new Blob([exported], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${agent.name}-conversation.txt`;
          a.click();
          URL.revokeObjectURL(url);
          addLocalMessage(t('chat.exportedMsg'));
        }
        break;
      }
      case '/memory':
        if (agent) {
          setClaudeMdContent(agent.config.claudeMd || '');
          setEditingClaudeMd(true);
        }
        break;
      case '/model':
        if (agent) {
          const modelInfo = [
            agent.config.flags?.model
              ? `${t('chat.currentModel')}: ${agent.config.flags.model}`
              : `${t('chat.currentModel')}: ${t('chat.defaultModel')}`,
            `${t('chat.currentReasoningEffort')}: ${formatReasoningEffort(agent.config.flags.reasoningEffort)}`,
          ].filter(Boolean).join('\n');
          addLocalMessage(modelInfo);
        }
        break;
      case '/skills': {
        const skills = slashCommands.map(c => `${c.cmd} - ${c.desc}`);
        addLocalMessage(t('chat.availableSkills') + '\n\n' + skills.join('\n'));
        break;
      }
      case '/stats':
        if (agent) {
          const msgs = agent.messages;
          const userMsgs = msgs.filter((m) => m.role === 'user').length;
          const assistantMsgs = msgs.filter((m) => m.role === 'assistant').length;
          const toolMsgs = msgs.filter((m) => m.role === 'tool').length;
          const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
          const duration = agent.lastActivity - agent.createdAt;
          const durationStr = duration > 60000
            ? `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`
            : `${Math.floor(duration / 1000)}s`;
          const statsLines = [
            `${t('chat.statsMessages')}: ${msgs.length} (${t('chat.statsUser')}: ${userMsgs}, ${t('chat.statsAssistant')}: ${assistantMsgs}, ${t('chat.statsTool')}: ${toolMsgs})`,
            `${t('chat.statsChars')}: ${totalChars.toLocaleString()}`,
            `${t('chat.statsDuration')}: ${durationStr}`,
            agent.costUsd !== undefined ? `${t('chat.statsCost')}: $${agent.costUsd.toFixed(4)}` : null,
            agent.tokenUsage ? `Tokens: ${(agent.tokenUsage.input + agent.tokenUsage.output).toLocaleString()}` : null,
          ].filter(Boolean).join('\n');
          addLocalMessage(statsLines);
        }
        fetchAgent();
        break;
      case '/status':
        if (agent) {
          const statusInfo = [
            `${t('chat.agentName')}: ${agent.name}`,
            `${t('chat.agentStatus')}: ${agent.status}`,
            `Provider: ${(agent.config.provider || 'claude').toUpperCase()}`,
            `Directory: ${agent.config.directory}`,
            `${t('chat.currentReasoningEffort')}: ${formatReasoningEffort(agent.config.flags.reasoningEffort)}`,
            agent.costUsd !== undefined ? `Cost: $${agent.costUsd.toFixed(4)}` : null,
            agent.tokenUsage ? `Tokens: ${agent.tokenUsage.input + agent.tokenUsage.output}` : null,
          ].filter(Boolean).join('\n');
          addLocalMessage(statusInfo);
        }
        fetchAgent();
        break;
      case '/stop':
        if (id) api.stopAgent(id);
        break;
      case '/context':
        if (agent) {
          const totalTokens = agent.tokenUsage
            ? agent.tokenUsage.input + agent.tokenUsage.output
            : 0;
          const contextUsed = agent.contextWindow?.used ?? totalTokens;
          const maxContext = agent.contextWindow?.total ?? 200000;
          const displayUsed = Math.max(0, Math.min(maxContext, contextUsed));
          const rawPct = maxContext > 0 ? (displayUsed / maxContext) * 100 : 0;
          const pct = Math.max(0, Math.min(100, Math.round(rawPct)));
          const filled = Math.max(0, Math.min(20, Math.round(pct / 5)));
          const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
          const contextLines = [
            `${t('chat.contextUsage')}:`,
            `[${bar}] ${pct}%`,
            `${displayUsed.toLocaleString()} / ${maxContext.toLocaleString()} tokens`,
            agent.tokenUsage ? `Input: ${agent.tokenUsage.input.toLocaleString()} | Output: ${agent.tokenUsage.output.toLocaleString()}` : '',
          ].filter(Boolean).join('\n');
          addLocalMessage(contextLines);
        }
        fetchAgent();
        break;
      case '/copy': {
        if (agent) {
          const lastAssistant = [...agent.messages].reverse().find(m => m.role === 'assistant');
          if (lastAssistant) {
            navigator.clipboard.writeText(lastAssistant.content).then(() => {
              addLocalMessage(t('chat.copiedMsg'));
            }).catch(() => {
              addLocalMessage(t('chat.copiedMsg'));
            });
          } else {
            addLocalMessage(t('chat.noCopyContent'));
          }
        }
        break;
      }
      case '/doctor':
        if (agent) {
          const issues: string[] = [];
          if (agent.status === 'error') issues.push('Agent is in error state');
          if (!agent.config.directory) issues.push('No working directory configured');
          if (agent.messages.length === 0) issues.push('No messages in conversation');
          if (issues.length === 0) {
            addLocalMessage(`${t('chat.doctorOk')}\nStatus: ${agent.status}\nProvider: ${(agent.config.provider || 'claude').toUpperCase()}\nMessages: ${agent.messages.length}`);
          } else {
            addLocalMessage(`${t('chat.doctorError')}\n${issues.join('\n')}`);
          }
        }
        fetchAgent();
        break;
      case '/exit':
        navigate('/');
        break;
      case '/permissions':
        if (agent) {
          const flags = agent.config.flags || {};
          const flagLines = Object.entries(flags)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n');
          addLocalMessage(`${t('chat.permissionsTitle')}:\n${flagLines || '  (none)'}`);
        }
        break;
      case '/plan':
        if (id) {
          api.sendMessage(id, '/plan');
          addLocalMessage(t('chat.planSent'));
        }
        break;
      case '/plugin':
        addLocalMessage(t('chat.pluginInfo'));
        break;
      case '/rename': {
        const newName = window.prompt(t('chat.renamePrompt'), agent?.name || '');
        if (newName && newName.trim() && id) {
          api.renameAgent(id, newName.trim()).then(() => {
            addLocalMessage(`${t('chat.renamed')} ${newName.trim()}`);
            fetchAgent();
          });
        }
        break;
      }
      case '/tasks':
        api.getTasks().then((tasks) => {
          if (tasks.length === 0) {
            addLocalMessage(t('chat.noTasks'));
          } else {
            const taskLines = tasks.map(tk =>
              `[${tk.status}] ${tk.name} (step ${tk.order})${tk.error ? ' - ' + tk.error : ''}`
            );
            addLocalMessage(taskLines.join('\n'));
          }
        });
        break;
      case '/theme':
        toggleTheme();
        addLocalMessage(t('chat.themeToggled'));
        break;
      case '/todos': {
        if (agent) {
          const todoPattern = /\b(TODO|FIXME|HACK|XXX|NOTE)\b[:\s]*(.*)/gi;
          const todos: string[] = [];
          for (const msg of agent.messages) {
            let match;
            while ((match = todoPattern.exec(msg.content)) !== null) {
              todos.push(`${match[1]}: ${match[2].trim()}`);
            }
          }
          if (todos.length === 0) {
            addLocalMessage(t('chat.noTodos'));
          } else {
            addLocalMessage(`${t('chat.todosFound')}\n${todos.join('\n')}`);
          }
        }
        break;
      }
      case '/usage':
        if (agent) {
          const usageLines = [
            `${t('chat.usageInfo')}:`,
            agent.costUsd !== undefined ? `Cost: $${agent.costUsd.toFixed(4)}` : 'Cost: N/A',
            agent.tokenUsage ? `Tokens: ${(agent.tokenUsage.input + agent.tokenUsage.output).toLocaleString()}` : 'Tokens: N/A',
            `Messages: ${agent.messages.length}`,
            `Provider: ${(agent.config.provider || 'claude').toUpperCase()}`,
          ].join('\n');
          addLocalMessage(usageLines);
        }
        fetchAgent();
        break;
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pasteFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) pasteFiles.push(file);
      }
    }
    if (pasteFiles.length > 0) {
      e.preventDefault();
      setAttachedFiles(prev => [...prev, ...pasteFiles]);
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || !id) return;

    // Save to input history
    const trimmed = input.trim();
    const hist = inputHistoryRef.current;
    if (trimmed && hist[0] !== trimmed) {
      hist.unshift(trimmed);
      if (hist.length > 50) hist.pop();
    }
    historyIdxRef.current = -1;
    savedInputRef.current = '';

    // Upload attached files now (not earlier)
    const uploadedPaths: { name: string; path: string }[] = [];
    if (attachedFiles.length > 0) {
      setUploadingCount(attachedFiles.length);
      for (const file of attachedFiles) {
        try {
          const result = await api.uploadFile(file);
          uploadedPaths.push({ name: file.name, path: result.path });
        } catch (err) {
          addLocalMessage(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setUploadingCount(prev => prev - 1);
        }
      }
    }

    if (input.startsWith('/')) {
      // Handle commands with arguments (e.g., /compact [instructions])
      const parts = input.trim().split(/\s+/);
      const cmdName = parts[0];
      const args = parts.slice(1).join(' ');

      const cmd = slashCommands.find((c) => c.cmd === cmdName);
      if (cmd) {
        // For /compact with args, send as message to agent
        if (cmdName === '/compact' && args) {
          api.sendMessage(id, input.trim());
          setInput('');
          addLocalMessage(t('chat.compactMsg'));
          return;
        }
        handleSlashSelect(cmd.cmd);
        return;
      }
    }

    // Build message text with file paths prepended
    const filePrefixes = uploadedPaths.map(f => {
      const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.name);
      return isImage ? `[Image: ${f.path}]` : `[File: ${f.path}]`;
    }).join('\n');
    const userText = input.trim();
    const text = filePrefixes
      ? (userText ? `${filePrefixes}\n\n${userText}` : filePrefixes)
      : userText;

    if (!text) return;

    // Optimistic: show user message immediately
    setAgent(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'running' as Agent['status'],
        messages: [...prev.messages, { id: `pending-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }],
      };
    });
    setInput('');
    setAttachedFiles([]);
    setInputRequired(null);
    api.sendMessage(id, text);
  };

  const handleChoiceSelect = (choice: string) => {
    if (!id) return;
    setAgent(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'running' as Agent['status'],
        messages: [...prev.messages, { id: `pending-${Date.now()}`, role: 'user', content: choice, timestamp: Date.now() }],
      };
    });
    setInputRequired(null);
    api.sendMessage(id, choice);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlash) {
      const filtered = slashCommands.filter((c) =>
        c.cmd.startsWith(slashFilter),
      );
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedHint((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedHint((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filtered[selectedHint]) {
          handleSlashSelect(filtered[selectedHint].cmd);
        }
      }
      return;
    }

    // ArrowUp/ArrowDown: cycle through input history
    // Activate when: already browsing history (idx >= 0), or input is empty, or cursor at pos 0
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const el = e.currentTarget as HTMLTextAreaElement;
      const browsing = historyIdxRef.current >= 0;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const empty = !input;
      if (browsing || atStart || empty) {
        const hist = inputHistoryRef.current;
        if (hist.length === 0) return;
        e.preventDefault();
        if (historyIdxRef.current === -1) {
          savedInputRef.current = input;
        }
        const newIdx = Math.min(historyIdxRef.current + 1, hist.length - 1);
        historyIdxRef.current = newIdx;
        handleInputChange(hist[newIdx]);
      }
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      if (historyIdxRef.current >= 0) {
        e.preventDefault();
        const newIdx = historyIdxRef.current - 1;
        historyIdxRef.current = newIdx;
        if (newIdx < 0) {
          handleInputChange(savedInputRef.current);
        } else {
          handleInputChange(inputHistoryRef.current[newIdx]);
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
      // Reject Enter keys within 300ms of compositionEnd — these are IME confirmations, not send intent
      if (Date.now() - compositionEndTimeRef.current < 300) {
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveClaudeMd = async () => {
    if (!id) return;
    await api.updateClaudeMd(id, claudeMdContent);
    setEditingClaudeMd(false);
  };

  const handleReasoningEffortChange = async (nextValue: ReasoningEffortSelection) => {
    if (!id || !agent) return;

    const nextEffort = nextValue === 'default' ? undefined : nextValue;
    setSelectedReasoningEffort(nextValue);
    setUpdatingReasoningEffort(true);
    setAgent(prev => prev ? {
      ...prev,
      config: {
        ...prev.config,
        flags: {
          ...prev.config.flags,
          reasoningEffort: nextEffort,
        },
      },
    } : prev);

    try {
      const updated = await api.updateReasoningEffort(id, nextEffort);
      setAgent(prev => {
        if (!prev) return updated;
        if (updated.messages.length >= prev.messages.length) return updated;
        return {
          ...prev,
          config: updated.config,
          status: updated.status,
          costUsd: updated.costUsd,
          tokenUsage: updated.tokenUsage,
        };
      });
    } catch (err) {
      fetchAgent(true);
      addLocalMessage(`[Error] ${String(err)}`);
    } finally {
      setUpdatingReasoningEffort(false);
    }
  };

  const filteredCommands = slashCommands.filter((c) =>
    c.cmd.startsWith(slashFilter || '/'),
  );

  if (!agent) return <div>{t('common.loading')}</div>;

  const instructionFileName = getInstructionFileName(agent.config.provider || 'claude');
  const editInstructionLabel = replaceInstructionFileName(t('chat.editClaudeMd'), instructionFileName);
  const editInstructionTitle = replaceInstructionFileName(t('chat.editClaudeMdTitle'), instructionFileName);
  const reasoningEffortOptions = getReasoningEffortOptions(agent.config.provider, runtimeCapabilities);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>
            <span className={`provider-badge provider-${agent.config.provider || 'claude'}`}>
              {(agent.config.provider || 'claude').toUpperCase()}
            </span>
            {agent.source === 'external' && (
              <span className="provider-badge" style={{ background: '#6366f1', color: '#fff', marginLeft: 4 }}>EXT</span>
            )}
            {' '}{agent.name}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {agent.config.directory}
            {agent.costUsd !== undefined && ` | $${agent.costUsd.toFixed(4)}`}
            {agent.tokenUsage && ` | ${agent.tokenUsage.input + agent.tokenUsage.output} ${t('common.tokens')}`}
            {` | ${t('chat.currentReasoningEffort')}: ${formatReasoningEffort(agent.config.flags.reasoningEffort)}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {t('chat.currentReasoningEffort')}
            </span>
            <select
              value={selectedReasoningEffort}
              disabled={updatingReasoningEffort}
              onChange={(e) => handleReasoningEffortChange(e.target.value as ReasoningEffortSelection)}
              style={{
                width: 'auto',
                minWidth: 110,
                padding: '8px 10px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontSize: 13,
              }}
              title={t(`chat.reasoningEffortHint.${agent.config.provider}`)}
            >
              {reasoningEffortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === 'default' ? t('chat.defaultReasoningEffort') : option.label}
                </option>
              ))}
            </select>
          </div>
          <span className={`status status-${agent.status}`}>
            <span className="status-dot" />
            {agent.status}
          </span>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => navigate(`/create?from=${id}`)}
            title={t('dashboard.cloneAgent')}
          >
            {t('dashboard.clone')}
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => {
              setClaudeMdContent(agent.config.claudeMd || '');
              setEditingClaudeMd(true);
            }}
          >
            {editInstructionLabel}
          </button>
          <button
            className={`btn btn-sm ${renderMarkdown ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => {
              setRenderMarkdown(prev => {
                const next = !prev;
                localStorage.setItem('agentmonitor-markdown', String(next));
                return next;
              });
            }}
            title="Toggle Markdown / Raw"
          >
            {renderMarkdown ? 'MD' : 'Raw'}
          </button>
          <button
            className={`btn btn-sm ${showTerminal ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => {
              setShowTerminal(prev => {
                const next = !prev;
                // When switching back to chat view, re-fetch agent data to pick up
                // any messages that arrived while in terminal view
                if (!next) fetchAgent(true);
                return next;
              });
            }}
            title="Toggle live terminal"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4 }}>
              <rect x="1" y="2" width="14" height="11" rx="1.5" />
              <polyline points="4,7 6,5 4,3" transform="translate(0,2)" />
              <line x1="7" y1="10" x2="11" y2="10" />
            </svg>
            Terminal
          </button>
          {(agent.status === 'running' || agent.status === 'waiting_input') && (
            <button className="btn btn-sm btn-danger" onClick={() => id && api.stopAgent(id)}>
              {t('common.stop')}
            </button>
          )}
        </div>
      </div>

      {id && <TerminalView agentId={id} visible={showTerminal} resumeCommand={buildResumeCommand(agent, runtimeCapabilities)} />}
      <div className="chat-messages" style={{ display: showTerminal ? 'none' : undefined }}>
        {agent.messages.map((msg) => {
          const toolDetails = getToolMessageDetails(msg);
          const isToolMsg = !!toolDetails;
          const isExpanded = expandedTools.has(msg.id);
          return (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              {isToolMsg ? (
                <>
                  <div
                    className="tool-header"
                    onClick={() => setExpandedTools(prev => {
                      const next = new Set(prev);
                      if (next.has(msg.id)) next.delete(msg.id);
                      else next.add(msg.id);
                      return next;
                    })}
                  >
                    <span className="tool-toggle">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                    <span className="tool-name">{toolDetails.title}</span>
                  </div>
                  {isExpanded && (
                    <div className="tool-details">
                      {toolDetails.input && (
                        <div className="tool-section">
                          <div className="tool-section-label">Input</div>
                          <pre className="tool-content">{toolDetails.input}</pre>
                        </div>
                      )}
                      {toolDetails.output && (
                        <div className="tool-section">
                          <div className="tool-section-label">Output</div>
                          <pre className="tool-content">{toolDetails.output}</pre>
                        </div>
                      )}
                      {toolDetails.details && (
                        <div className="tool-section">
                          <div className="tool-section-label">Details</div>
                          <pre className="tool-content">{toolDetails.details}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                renderMarkdown && msg.role === 'assistant'
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  : msg.content
              )}
            </div>
          );
        })}
        {localMessages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {agent.status === 'running' && (
          <div className="chat-message assistant thinking">
            <span className="thinking-dots">
              <span /><span /><span />
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {!showTerminal && <div className="esc-hint">{t('chat.escHint')}</div>}

      {/* Input required notification banner */}
      {!showTerminal && (agent.status === 'waiting_input' || inputRequired) && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--yellow, #f59e0b)',
          color: '#000',
          borderRadius: 'var(--radius)',
          margin: '0 0 8px 0',
          fontSize: 13,
          fontWeight: 500,
          animation: 'pulse 2s infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: inputRequired?.choices ? 8 : 0 }}>
            <span style={{ fontSize: 16, flexShrink: 0, lineHeight: '20px' }}>&#9888;</span>
            <span style={{
              maxHeight: inputRequired?.choices ? 60 : 120,
              overflowY: 'auto',
              display: 'block',
              lineHeight: '20px',
            }}>{inputRequired?.prompt || t('chat.waitingInput')}</span>
          </div>
          {inputRequired?.choices && inputRequired.choices.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, paddingTop: 6, borderTop: '1px solid rgba(0,0,0,0.15)' }}>
              {inputRequired.choices.map((choice, i) => (
                <button
                  key={i}
                  onClick={() => handleChoiceSelect(choice)}
                  style={{
                    padding: '6px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: '2px solid rgba(0,0,0,0.4)',
                    background: 'rgba(255,255,255,0.95)',
                    color: '#000',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ position: 'relative', display: showTerminal ? 'none' : undefined }}>
        {showSlash && filteredCommands.length > 0 && (
          <div className="slash-hints">
            {filteredCommands.map((cmd, i) => (
              <div
                key={cmd.cmd}
                className={`slash-hint ${i === selectedHint ? 'selected' : ''}`}
                onClick={() => handleSlashSelect(cmd.cmd)}
              >
                <strong>{cmd.cmd}</strong>{' '}
                <span style={{ color: 'var(--text-muted)' }}>{cmd.desc}</span>
              </div>
            ))}
          </div>
        )}
        {/* File attachment indicator */}
        {(attachedFiles.length > 0 || uploadingCount > 0) && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            padding: '6px 8px',
            marginBottom: 4,
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}>
            {attachedFiles.map((file, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                background: 'var(--bg-input)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--text)',
              }}>
                <span style={{ fontSize: 14 }}>{file.type.startsWith('image/') ? '\uD83D\uDDBC' : '\uD83D\uDCCE'}</span>
                <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({(file.size / 1024).toFixed(0)}KB)</span>
                <button
                  onClick={() => removeAttachedFile(i)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                  title="Remove"
                >
                  &times;
                </button>
              </div>
            ))}
            {uploadingCount > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}>
                Uploading {uploadingCount} file{uploadingCount > 1 ? 's' : ''}...
              </div>
            )}
          </div>
        )}
        <div className="chat-input-area">
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) {
                setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                e.target.value = '';
              }
            }}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { compositionEndTimeRef.current = Date.now(); setTimeout(() => { composingRef.current = false; }, 100); }}
            placeholder={
              agent.status === 'waiting_input' ? t('chat.inputRequiredPlaceholder') :
              (agent.status === 'stopped' || agent.status === 'error') ? t('chat.resumePlaceholder') :
              t('chat.inputPlaceholder')
            }
            autoFocus
            rows={1}
            style={{ resize: 'none', overflow: 'hidden' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 160) + 'px';
            }}
          />
          <button
            className="btn btn-outline btn-sm"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            style={{ padding: '6px 8px', fontSize: 16, lineHeight: 1 }}
          >
            {'\uD83D\uDCCE'}
          </button>
          <button className="btn" onClick={handleSend}>
            {t('common.send')}
          </button>
        </div>
      </div>

      {/* Conversation history picker (double-Esc) */}
      {showHistoryPicker && (() => {
        const userTurns = agent?.messages.filter(m => m.role === 'user') || [];
        return (
          <div className="modal-overlay" onClick={() => { setShowHistoryPicker(false); setHistoryRestoreTarget(null); }}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header">
                <span className="modal-title">{t('chat.historyPickerTitle')}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('chat.historyPickerHint')}</span>
                <button className="btn btn-sm btn-outline" onClick={() => { setShowHistoryPicker(false); setHistoryRestoreTarget(null); }}>{t('common.cancel')}</button>
              </div>

              {/* Restore options panel (matches local Claude CLI) */}
              {historyRestoreTarget !== null && (() => {
                const turnContent = userTurns[historyRestoreTarget]?.content || '';
                const doRestore = async (restoreCode: boolean, restoreConv: boolean) => {
                  if (!id || historyRestoreTarget === null) return;
                  if (restoreCode || restoreConv) {
                    const result = await api.restoreConversation(id, historyRestoreTarget, restoreCode, restoreConv);
                    if (result.restoredPrompt) {
                      setInput(result.restoredPrompt);
                    }
                    await fetchAgent(true);
                  }
                  setShowHistoryPicker(false);
                  setHistoryRestoreTarget(null);
                  setTimeout(() => inputRef.current?.focus(), 100);
                };
                const options = [
                  { label: t('chat.restoreCodeAndConv'), action: () => doRestore(true, true) },
                  { label: t('chat.restoreConversation'), action: () => doRestore(false, true) },
                  { label: t('chat.restoreCodeOnly'), action: () => doRestore(true, false) },
                  { label: t('chat.summarizeFromHere'), action: () => {
                    if (id) {
                      api.sendMessage(id, `/compact Summarize conversation up to this point`);
                    }
                    setShowHistoryPicker(false);
                    setHistoryRestoreTarget(null);
                  }},
                  { label: t('chat.neverMind'), action: () => setHistoryRestoreTarget(null) },
                ];
                return (
                  <div style={{ padding: '14px 16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 48, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Turn {historyRestoreTarget + 1}: {turnContent.slice(0, 100)}{turnContent.length > 100 ? '…' : ''}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {options.map((opt, i) => (
                        <button
                          key={i}
                          className="btn btn-sm btn-outline"
                          style={{ textAlign: 'left', justifyContent: 'flex-start', fontWeight: 400 }}
                          onClick={opt.action}
                        >
                          {i + 1}. {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div style={{ overflowY: 'auto', flex: 1 }}>
                {!agent?.sessionId && (
                  <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                    Note: No session ID — restore will not resume JSONL.
                  </div>
                )}
                {userTurns.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>{t('chat.noHistory')}</div>
                ) : userTurns.map((msg, i) => (
                  <div
                    key={msg.id}
                    onClick={() => setHistoryRestoreTarget(i)}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      background: i === historyPickerIdx ? 'var(--primary)' : 'transparent',
                      color: i === historyPickerIdx ? '#fff' : 'var(--text)',
                      borderBottom: '1px solid var(--border)',
                      borderLeft: historyRestoreTarget === i ? '3px solid var(--yellow, #f59e0b)' : '3px solid transparent',
                    }}
                    onMouseEnter={() => setHistoryPickerIdx(i)}
                  >
                    <div style={{ fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {msg.content.slice(0, 80)}{msg.content.length > 80 ? '…' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: i === historyPickerIdx ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', marginTop: 2 }}>
                      Turn {i + 1} &nbsp;·&nbsp; {new Date(msg.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {editingClaudeMd && (
        <div className="modal-overlay" onClick={() => setEditingClaudeMd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editInstructionTitle}</span>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setEditingClaudeMd(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
            <textarea
              value={claudeMdContent}
              onChange={(e) => setClaudeMdContent(e.target.value)}
              style={{
                width: '100%',
                minHeight: 300,
                padding: 12,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={handleSaveClaudeMd}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
