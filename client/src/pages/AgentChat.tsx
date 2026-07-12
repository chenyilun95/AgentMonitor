import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Agent, type RuntimeCapabilities } from '../api/client';
import { getSocket, joinAgent, leaveAgent } from '../api/socket';
import { useTranslation } from '../i18n';
import { TerminalView } from '../components/TerminalView';
import { FileBrowserView } from '../components/FileBrowserView';
import { PendingQuestionBanner } from '../components/PendingQuestionBanner';
import { HistoryPicker } from '../components/HistoryPicker';
import { BtwPopup } from '../components/BtwPopup';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAgentStatusClass, getAgentStatusLabel } from '../lib/agentStatus';
import { buildCommitPrompt } from '../lib/commitPrompt';
import { buildResumeCommand } from '../lib/resumeCommand';
import { getToolMessageDetails, type ToolMessageDetails } from '../lib/toolMessages';
import { getSlashCommandDefinitions, executeSlashCommand } from '../lib/slashCommands';
import {
  getReasoningEffortLabel,
  getReasoningEffortOptions,
  normalizeReasoningEffortSelection,
  type ReasoningEffortSelection,
} from '../lib/reasoningEffort';

type ChatMessage = Agent['messages'][number];
type LocalMessage = { id: string; role: string; content: string; timestamp: number };
type DisplayMessage = ChatMessage | LocalMessage;
type ChatMessageGroup = { id: string; messages: DisplayMessage[] };

type PendingQuestion = NonNullable<Agent['pendingQuestion']>;

export function AgentChat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [input, setInput] = useState('');
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [selectedHint, setSelectedHint] = useState(0);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [inputRequired, setInputRequired] = useState<{ prompt: string; choices?: string[] } | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [showTerminal, setShowTerminal] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [renderMarkdown, setRenderMarkdown] = useState(() => localStorage.getItem('agentmonitor-markdown') !== 'false');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  const lastEscRef = useRef(0);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const compositionEndTimeRef = useRef(0);
  const inputHistoryRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const savedInputRef = useRef('');
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [historyPickerIdx, setHistoryPickerIdx] = useState(0);
  const [historyRestoringIdx, setHistoryRestoringIdx] = useState<number | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [queuedMessages, setQueuedMessages] = useState<Array<{ id: string; text: string }>>([]);
  const [btwState, setBtwState] = useState<{ status: 'input' | 'loading' | 'answer'; question?: string; answer?: string; error?: string } | null>(null);
  const btwInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffortSelection>('default');
  const [updatingReasoningEffort, setUpdatingReasoningEffort] = useState(false);
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilities | null>(null);

  const addLocalMessage = (content: string, role = 'system') => {
    const timestamp = Date.now();
    setLocalMessages((prev) => [...prev, {
      id: `local-${timestamp}-${Math.random().toString(36).slice(2)}`,
      role,
      content,
      timestamp,
    }]);
  };

  const addStatusNotice = addLocalMessage;

  const formatReasoningEffort = (effort?: Agent['config']['flags']['reasoningEffort']) =>
    effort ? getReasoningEffortLabel(effort) : t('chat.defaultReasoningEffort');

  const slashCommands = getSlashCommandDefinitions(t);

  const fetchAgent = useCallback(async (forceOverwrite = false) => {
    if (!id) return;
    try {
      const data = await api.getAgent(id);
      setAgent(prev => {
        // Don't overwrite optimistic messages (pending-* ids) if server hasn't caught up
        // But allow overwrite when explicitly forced (e.g. after restore)
        if (!forceOverwrite && prev && data.messages.length < prev.messages.length) {
          return {
            ...prev,
            status: data.status as Agent['status'],
            costUsd: data.costUsd,
            tokenUsage: data.tokenUsage,
            contextWindow: data.contextWindow,
            interactionMode: data.interactionMode,
            pendingPlan: data.pendingPlan,
            pendingQuestion: data.pendingQuestion,
          };
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
    didInitialScrollRef.current = false;
    fetchAgent();
    api.getRuntimeCapabilities().then(setRuntimeCapabilities).catch(() => {});
    if (!id) return;

    joinAgent(id);
    const socket = getSocket();
    let socketWorking = false;

    // Primary: incremental delta (lightweight, only new messages + metadata)
    const onDelta = (data: { agentId: string; delta: { messages: Agent['messages']; status: string; costUsd?: number; tokenUsage?: Agent['tokenUsage']; contextWindow?: Agent['contextWindow']; lastActivity: number; interactionMode?: Agent['interactionMode']; pendingPlan?: Agent['pendingPlan']; pendingQuestion?: Agent['pendingQuestion']; currentGitBranch?: string } }) => {
      if (data.agentId !== id) return;
      socketWorking = true;
      if (data.delta.status !== 'running') {
        setQueuedMessages([]);
      }
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
          contextWindow: data.delta.contextWindow ?? prev.contextWindow,
          lastActivity: data.delta.lastActivity,
          interactionMode: data.delta.interactionMode ?? prev.interactionMode,
          pendingPlan: data.delta.pendingPlan === undefined ? prev.pendingPlan : (data.delta.pendingPlan || undefined),
          pendingQuestion: data.delta.pendingQuestion === undefined ? prev.pendingQuestion : (data.delta.pendingQuestion || undefined),
          currentGitBranch: data.delta.currentGitBranch ?? prev.currentGitBranch,
        };
      });
    };

    // Full snapshot (for status changes, initial load, dashboard sync)
    const onUpdate = (data: { agentId: string; agent: Agent }) => {
      if (data.agentId === id && data.agent) {
        socketWorking = true;
        if (data.agent.status !== 'running') {
          setQueuedMessages([]);
        }
        // Only apply if server has at least as many messages (avoid overwriting optimistic messages)
        setAgent(prev => {
          if (!prev) return data.agent;
          if (data.agent.messages.length >= prev.messages.length) return data.agent;
          // Server hasn't caught up with our optimistic message yet — merge status only
          return {
            ...prev,
            status: data.agent.status as Agent['status'],
            costUsd: data.agent.costUsd,
            tokenUsage: data.agent.tokenUsage,
            contextWindow: data.agent.contextWindow,
            interactionMode: data.agent.interactionMode,
            pendingPlan: data.agent.pendingPlan,
            pendingQuestion: data.agent.pendingQuestion,
          };
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

  useLayoutEffect(() => {
    if (!agent || didInitialScrollRef.current) return;
    const container = messagesContainerRef.current;
    if (container) {
      const previousScrollBehavior = container.style.scrollBehavior;
      container.style.scrollBehavior = 'auto';
      container.scrollTop = container.scrollHeight;
      container.style.scrollBehavior = previousScrollBehavior;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
    didInitialScrollRef.current = true;
  }, [agent]);

  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent?.messages?.length, localMessages.length]);

  useEffect(() => {
    if (agent) {
      setSelectedReasoningEffort(
        normalizeReasoningEffortSelection(agent.config.provider, agent.config.flags.reasoningEffort, runtimeCapabilities),
      );
    }
  }, [agent, agent?.config.flags.reasoningEffort, agent?.config.provider, runtimeCapabilities]);

  const restoreHistoryTurn = useCallback(async (turnIndex: number, restoreCode = true, restoreConv = true) => {
    if (!id || historyRestoringIdx !== null) return;
    setHistoryRestoringIdx(turnIndex);
    try {
      const result = await api.restoreConversation(id, turnIndex, restoreCode, restoreConv);
      if (result.restoredPrompt) {
        setInput(result.restoredPrompt);
      }
      await fetchAgent(true);
      if (result.warning) {
        addStatusNotice(`[Rewind] ${result.warning}`);
      } else {
        addStatusNotice(t('chat.rewindRestored'));
      }
      setShowHistoryPicker(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    } finally {
      setHistoryRestoringIdx(null);
    }
  }, [fetchAgent, historyRestoringIdx, id, t]);

  // Esc key handler: single = interrupt, double = conversation history picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Ignore Esc during IME composition (e.g. cancelling Chinese input candidates)
        if (composingRef.current || e.isComposing) return;

        // If history picker is open, close it
        if (showHistoryPicker) {
          setShowHistoryPicker(false);
          lastEscRef.current = 0;
          return;
        }
        const now = Date.now();
        if (now - lastEscRef.current < 500) {
          // Double Esc → show conversation history picker (start at most recent)
          lastEscRef.current = 0;
          if (escTimerRef.current) {
            clearTimeout(escTimerRef.current);
            escTimerRef.current = null;
          }
          const currentAgent = agentRef.current;
          const turns = currentAgent?.messages.filter(m => m.role === 'user') || [];
          setHistoryPickerIdx(Math.max(turns.length - 1, 0));
          setShowHistoryPicker(true);
        } else {
          // First Esc — wait to see if a second follows (debounce)
          lastEscRef.current = now;
          if (escTimerRef.current) clearTimeout(escTimerRef.current);
          escTimerRef.current = setTimeout(() => {
            escTimerRef.current = null;
            const currentAgent = agentRef.current;
            if (id && currentAgent?.status === 'running') {
              api.interruptAgent(id);
              addStatusNotice(t('chat.interrupted'));
            }
          }, 500);
        }
        return;
      }
      // Arrow-key navigation inside history picker
      if (showHistoryPicker) {
        const userTurns = (agent as any)?.preRestoreUserTurns ?? agent?.messages.filter(m => m.role === 'user') ?? [];
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHistoryPickerIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHistoryPickerIdx(i => Math.min(i + 1, userTurns.length - 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          void restoreHistoryTurn(historyPickerIdx);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [id, agent, showHistoryPicker, historyPickerIdx, navigate, restoreHistoryTurn, t]);

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

  const sendBtwQuestion = async (question: string) => {
    if (!id || !question.trim()) return;
    setBtwState({ status: 'loading', question });
    try {
      const { answer } = await api.btw(id, question.trim());
      setBtwState({ status: 'answer', question, answer });
    } catch (err) {
      setBtwState({ status: 'answer', question, error: String(err) });
    }
  };

  const handleSlashSelect = (cmd: string) => {
    setShowSlash(false);
    setInput('');
    executeSlashCommand(cmd, {
      agent, id, addLocalMessage, navigate, fetchAgent, setAgent, setLocalMessages,
      toggleInteractionMode, renameCurrentAgent, formatReasoningEffort,
      btwInputRef, setBtwState, t, getAgentStatusLabel, commands: slashCommands,
    });
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

  const setInteractionMode = async (mode: Agent['interactionMode']) => {
    if (!id || !mode) return;
    try {
      const updated = await api.updateInteractionMode(id, mode);
      setAgent(prev => {
        if (!prev) return updated;
        if (updated.messages.length >= prev.messages.length) return updated;
        return {
          ...prev,
          interactionMode: updated.interactionMode,
          pendingPlan: updated.pendingPlan,
          lastActivity: updated.lastActivity,
        };
      });
      addStatusNotice(mode === 'plan' ? t('chat.planModeEnabled') : t('chat.planModeDisabled'));
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    }
  };

  const toggleInteractionMode = () => {
    const nextMode = (agent?.interactionMode || 'default') === 'plan' ? 'default' : 'plan';
    void setInteractionMode(nextMode);
  };

  const renameCurrentAgent = async () => {
    if (!agent || !id) return;
    const nextName = window.prompt(t('chat.renamePrompt'), agent.name)?.trim();
    if (!nextName || nextName === agent.name) return;
    try {
      await api.renameAgent(id, nextName);
      setAgent(prev => prev ? { ...prev, name: nextName } : prev);
      addStatusNotice(`${t('chat.renamed')} ${nextName}`);
      fetchAgent();
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    }
  };

  const handleApprovePlan = async () => {
    if (!id) return;
    try {
      const updated = await api.approvePlan(id);
      setAgent(updated);
      setInputRequired(null);
      addStatusNotice(t('chat.planApproved'));
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    }
  };

  const handleRevisePlan = async () => {
    if (!id) return;
    try {
      const updated = await api.revisePlan(id);
      setAgent(updated);
      addStatusNotice(t('chat.planRevisionReady'));
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    }
  };

  const handleAnswerQuestion = async (answers: Record<string, string>) => {
    if (!id) return;
    try {
      const updated = await api.answerQuestion(id, answers);
      setAgent(updated);
      setInputRequired(null);
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    }
  };

  const handleCommit = async () => {
    if (!id || !agent) return;
    try {
      await api.sendMessage(id, buildCommitPrompt(agent));
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    }
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
          addStatusNotice('Compact requested. Token count will appear here when it completes.');
          return;
        }
        // /btw with args — send directly as ephemeral question
        if ((cmdName === '/btw' || cmdName === '/side') && args) {
          setInput('');
          sendBtwQuestion(args);
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

    const isRunning = agent?.status === 'running';
    setInput('');
    setAttachedFiles([]);
    setInputRequired(null);

    if (isRunning) {
      const qId = `q-${Date.now()}`;
      setQueuedMessages(prev => [...prev, { id: qId, text }]);
      api.sendMessage(id, text).catch(() => {
        setQueuedMessages(prev => prev.filter(q => q.id !== qId));
      });
    } else {
      setAgent(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          status: 'running' as Agent['status'],
          messages: [...prev.messages, { id: `pending-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }],
        };
      });
      api.sendMessage(id, text);
    }
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
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      setShowSlash(false);
      toggleInteractionMode();
      return;
    }

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

  const reasoningEffortOptions = getReasoningEffortOptions(agent.config.provider, runtimeCapabilities);
  const interactionMode = agent.interactionMode || 'default';
  const isPlanMode = interactionMode === 'plan';
  const displayMessages = [...agent.messages, ...localMessages].sort((a, b) => a.timestamp - b.timestamp);
  const chatMessageGroups = displayMessages.reduce<ChatMessageGroup[]>((groups, msg) => {
    if (msg.role === 'user' || groups.length === 0) {
      groups.push({ id: `turn-${msg.id}`, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
    return groups;
  }, []);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={`provider-badge provider-${agent.config.provider || 'claude'}`}>
              {(agent.config.provider || 'claude').toUpperCase()}
            </span>
            {agent.source === 'external' && (
              <span className="provider-badge" style={{ background: 'var(--primary)', color: '#fff', marginLeft: 4 }}>EXT</span>
            )}
            <span className="agent-title-text">{agent.name}</span>
            {agent.workspaceMode === 'direct' ? (
              <>
                <span className="card-direct" title={t('workspaceMode.directTooltip')}>
                  <span className="direct-icon" aria-hidden>🔗</span>
                  {agent.gitBranch ? `Direct Edit (${agent.gitBranch})` : t('workspaceMode.direct')}
                </span>
                {agent.currentGitBranch && agent.gitBranch && agent.currentGitBranch !== agent.gitBranch && (
                  <span
                    className="branch-drift-badge"
                    title={t('workspaceMode.branchDriftWarning', { initial: agent.gitBranch, current: agent.currentGitBranch })}
                  >
                    {agent.currentGitBranch}
                  </span>
                )}
              </>
            ) : agent.worktreeBranch ? (
              <span className="card-branch" title={`${t('workspaceMode.worktreeTooltip')}\n${agent.worktreeBranch}`}>
                <svg className="branch-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                  <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
                </svg>
                {agent.gitBranch
                  ? `${agent.gitBranch} → ${agent.worktreeBranch.replace(/^agent-/, '')}`
                  : t('workspaceMode.worktreeChip', { branch: agent.worktreeBranch.replace(/^agent-/, '') })}
              </span>
            ) : null}
            <button
              type="button"
              className="agent-rename-btn"
              aria-label={`${t('chat.slashRename')}: ${agent.name}`}
              title={t('chat.slashRename')}
              onClick={renameCurrentAgent}
            >
              &#9998;
            </button>
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
          <span className={`status status-${getAgentStatusClass(agent.status)}`}>
            <span className="status-dot" />
            {getAgentStatusLabel(agent.status)}
          </span>
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
                if (next) setShowFiles(false);
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
          <button
            className={`btn btn-sm ${showFiles ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => {
              setShowFiles(prev => {
                const next = !prev;
                if (next) setShowTerminal(false);
                return next;
              });
            }}
            title="Browse workspace files"
          >
            Files
          </button>
          <button className="btn btn-sm btn-outline" onClick={handleCommit} title={t('dashboard.commitTooltip')}>
            {t('dashboard.commit')}
          </button>
          {(agent.status === 'running' || agent.status === 'waiting_input') && (
            <button className="btn btn-sm btn-danger" onClick={() => id && api.stopAgent(id)}>
              {t('common.stop')}
            </button>
          )}
        </div>
      </div>

      {id && <TerminalView agentId={id} visible={showTerminal} resumeCommand={buildResumeCommand(agent, runtimeCapabilities)} />}
      <FileBrowserView rootPath={agent.worktreePath || agent.config.directory} visible={showFiles} />
      <div ref={messagesContainerRef} className="chat-messages" style={{ display: showTerminal || showFiles ? 'none' : undefined }}>
        {chatMessageGroups.map((group) => (
          <div key={group.id} className="chat-turn">
            {group.messages.map((msg) => {
              const toolDetails = getToolMessageDetails(msg as ChatMessage);
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
          </div>
        ))}
        {agent.status === 'running' && (
          <div className="chat-message assistant thinking">
            <span className="thinking-dots">
              <span /><span /><span />
            </span>
            {(agent.tokenUsage || agent.costUsd !== undefined) && (
              <span className="thinking-stats">
                {agent.tokenUsage && `${(agent.tokenUsage.input + agent.tokenUsage.output).toLocaleString()} tokens`}
                {agent.costUsd !== undefined && ` · $${agent.costUsd.toFixed(4)}`}
                {agent.contextWindow && ` · ${Math.round(agent.contextWindow.used / agent.contextWindow.total * 100)}% context`}
              </span>
            )}
          </div>
        )}
        {agent.structuredOutput != null && (agent.status === 'stopped' || agent.status === 'error') && (
          <div style={{ margin: '12px 0', padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📋</span> Structured Output
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.85em', overflow: 'auto', maxHeight: 400 }}>
              {JSON.stringify(agent.structuredOutput, null, 2)}
            </pre>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {!showTerminal && !showFiles && <div className="esc-hint">{t('chat.escHint')}</div>}

      {!showTerminal && !showFiles && agent.pendingQuestion && !agent.pendingQuestion.answeredAt && (
        <PendingQuestionBanner pending={agent.pendingQuestion} onSubmit={handleAnswerQuestion} />
      )}

      {!showTerminal && !showFiles && agent.pendingPlan && !agent.pendingPlan.approvedAt && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          margin: '0 0 8px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            <strong>{t('chat.planReady')}</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{t('chat.planReadyHint')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={handleApprovePlan}>
              {t('chat.approvePlan')}
            </button>
            <button className="btn btn-sm btn-outline" onClick={handleRevisePlan}>
              {t('chat.revisePlan')}
            </button>
          </div>
        </div>
      )}

      <div style={{ position: 'relative', display: showTerminal || showFiles ? 'none' : undefined }}>
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
        {((agent.status === 'waiting_input' || inputRequired) || queuedMessages.length > 0) && (
          <div className="chat-notify-bar">
            {(agent.status === 'waiting_input' || inputRequired) && (
              <>
                <div className="chat-notify-waiting">
                  <span className="chat-notify-dot" />
                  <span className="chat-notify-text">
                    {inputRequired?.prompt || t('chat.waitingInput')}
                  </span>
                </div>
                {inputRequired?.choices && inputRequired.choices.length > 0 && (
                  <div className="chat-notify-choices">
                    {inputRequired.choices.map((choice, i) => (
                      <button key={i} className="btn btn-sm btn-outline" onClick={() => handleChoiceSelect(choice)}>
                        {choice}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {queuedMessages.length > 0 && (
              <div className="chat-notify-queue">
                <span className="chat-notify-queue-label">{t('chat.queued')} ({queuedMessages.length})</span>
                {queuedMessages.map((q) => (
                  <div key={q.id} className="chat-notify-queue-item">
                    {q.text.length > 120 ? q.text.slice(0, 120) + '...' : q.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="chat-input-area">
          <button
            className={`btn btn-sm ${isPlanMode ? '' : 'btn-outline'}`}
            onClick={toggleInteractionMode}
            title={t('chat.planModeShortcut')}
            style={{
              minWidth: 76,
              whiteSpace: 'nowrap',
              borderColor: isPlanMode ? 'var(--accent)' : undefined,
            }}
          >
            {isPlanMode ? t('chat.modePlan') : t('chat.modeDefault')}
          </button>
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
            style={{ resize: 'none', overflowY: 'auto' }}
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

      {showHistoryPicker && (
        <HistoryPicker
          agent={agent}
          historyPickerIdx={historyPickerIdx}
          historyRestoringIdx={historyRestoringIdx}
          onClose={() => setShowHistoryPicker(false)}
          onRestore={(i) => void restoreHistoryTurn(i)}
          onHover={setHistoryPickerIdx}
          t={t}
        />
      )}

      {btwState && (
        <BtwPopup
          btwState={btwState}
          onClose={() => setBtwState(null)}
          onSubmit={sendBtwQuestion}
          btwInputRef={btwInputRef}
          t={t}
        />
      )}

    </div>
  );
}
