import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { api, type Agent, type RuntimeCapabilities } from '../api/client';
import { getSocket, joinAgent, leaveAgent } from '../api/socket';
import { useTranslation } from '../i18n';
import { FileBrowserView } from '../components/FileBrowserView';
import { PendingQuestionBanner } from '../components/PendingQuestionBanner';
import { HistoryPicker } from '../components/HistoryPicker';
import { BtwPopup } from '../components/BtwPopup';
import { ChatMessageItem } from '../components/ChatMessageItem';
import { getAgentStatusClass, getAgentStatusLabel } from '../lib/agentStatus';
import { buildCommitPrompt, buildMergeToBasePrompt, buildUpdateFromBasePrompt } from '../lib/commitPrompt';
import { buildResumeCommand } from '../lib/resumeCommand';
import { getSlashCommandDefinitions, executeSlashCommand } from '../lib/slashCommands';
import {
  getReasoningEffortLabel,
  getReasoningEffortOptions,
  normalizeReasoningEffortSelection,
  type ReasoningEffortSelection,
} from '../lib/reasoningEffort';

type LocalMessage = { id: string; role: string; content: string; timestamp: number };

type PendingQuestion = NonNullable<Agent['pendingQuestion']>;

const CHAT_MESSAGE_PAGE_SIZE = 50;
const TerminalView = lazy(() => import('../components/TerminalView').then(module => ({
  default: module.TerminalView,
})));

export function AgentChat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [directPeers, setDirectPeers] = useState<Agent[]>([]);
  const [input, setInput] = useState('');
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [selectedHint, setSelectedHint] = useState(0);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [inputRequired, setInputRequired] = useState<{ prompt: string; choices?: string[] } | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [showTerminal, setShowTerminal] = useState(false);
  const [hasOpenedTerminal, setHasOpenedTerminal] = useState(false);
  const [showFiles, setShowFiles] = useState(() => searchParams.get('view') === 'files');
  const [targetFilePath, setTargetFilePath] = useState<string | null>(null);
  const [renderMarkdown, setRenderMarkdown] = useState(() => localStorage.getItem('agentmonitor-markdown') !== 'false');
  const [atBottom, setAtBottom] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
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
  const [btwState, setBtwState] = useState<{ status: 'input' | 'loading' | 'answer'; question?: string; answer?: string; error?: string } | null>(null);
  const btwInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffortSelection>('default');
  const [updatingReasoningEffort, setUpdatingReasoningEffort] = useState(false);
  const [gitAction, setGitAction] = useState<'update' | 'merge' | null>(null);
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [loadingEarlierMessages, setLoadingEarlierMessages] = useState(false);
  const [scrollingToTop, setScrollingToTop] = useState(false);

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

  const refreshDirectPeers = useCallback(async (currentAgent: Agent) => {
    if (currentAgent.workspaceMode !== 'direct') {
      setDirectPeers([]);
      return;
    }
    const currentProjectKey = currentAgent.projectKey
      || (currentAgent.repositoryRoot
        ? `git:${currentAgent.repositoryRoot}`
        : `dir:${currentAgent.config.directory}`);
    try {
      const allAgents = await api.getAgents();
      setDirectPeers(allAgents.filter(candidate => {
        const candidateProjectKey = candidate.projectKey
          || (candidate.repositoryRoot
            ? `git:${candidate.repositoryRoot}`
            : `dir:${candidate.config.directory}`);
        return candidate.id !== currentAgent.id
          && candidate.workspaceMode === 'direct'
          && candidateProjectKey === currentProjectKey
          && (candidate.status === 'running' || candidate.status === 'waiting_input');
      }));
    } catch {
      // Keep the current warning during transient list refresh failures.
    }
  }, []);

  const fetchAgent = useCallback(async (forceOverwrite = false) => {
    if (!id) return;
    try {
      const data = await api.getAgent(id, { messageLimit: CHAT_MESSAGE_PAGE_SIZE });
      setLoadError(false);
      void refreshDirectPeers(data);
      setAgent(prev => {
        if (!prev || forceOverwrite) return data;
        // Polling returns only the latest page. Merge it with any older pages
        // already loaded locally and retain optimistic messages.
        const byId = new Map(prev.messages.map(message => [message.id, message]));
        for (const message of data.messages) byId.set(message.id, message);
        const messages = [...byId.values()];
        const messagePage = prev.messagePage?.hasMore === false
          ? { ...data.messagePage, ...prev.messagePage, total: data.messagePage?.total ?? prev.messagePage.total }
          : data.messagePage;
        return { ...data, messages, messagePage };
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
      // A temporary network/server interruption must not eject the user from
      // the conversation. Keep the current snapshot and retry through the
      // socket reconnect/fallback polling paths.
      setLoadError(true);
    }
  }, [id, refreshDirectPeers]);

  const loadEarlierMessages = useCallback(async () => {
    const current = agentRef.current;
    const beforeMessageId = current?.messages[0]?.id;
    if (!id || !current?.messagePage?.hasMore || !beforeMessageId || loadingEarlierMessages) return;

    setLoadingEarlierMessages(true);
    try {
      const page = await api.getAgent(id, {
        messageLimit: CHAT_MESSAGE_PAGE_SIZE,
        beforeMessageId,
      });
      setAgent(prev => {
        if (!prev) return page;
        const existingIds = new Set(prev.messages.map(message => message.id));
        return {
          ...prev,
          messages: [
            ...page.messages.filter(message => !existingIds.has(message.id)),
            ...prev.messages,
          ],
          messagePage: page.messagePage,
        };
      });
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    } finally {
      setLoadingEarlierMessages(false);
    }
  }, [id, loadingEarlierMessages]);

  useEffect(() => {
    setDirectPeers([]);
    fetchAgent();
    api.getRuntimeCapabilities().then(setRuntimeCapabilities).catch(() => {});
    if (!id) return;

    joinAgent(id);
    const socket = getSocket();
    let lastSocketActivityAt = Date.now();
    const markSocketActivity = () => {
      lastSocketActivityAt = Date.now();
    };

    // Primary: incremental delta (lightweight, only new messages + metadata)
    const onDelta = (data: { agentId: string; delta: { messages: Agent['messages']; status: string; costUsd?: number; tokenUsage?: Agent['tokenUsage']; contextWindow?: Agent['contextWindow']; lastActivity: number; interactionMode?: Agent['interactionMode']; pendingPlan?: Agent['pendingPlan']; pendingQuestion?: Agent['pendingQuestion']; currentBranch?: string } }) => {
      if (data.agentId !== id) return;
      markSocketActivity();
      setAgent(prev => {
        if (!prev) return prev;
        const existingIds = new Set(prev.messages.map(m => m.id));
        const newMsgs = data.delta.messages.filter(m => !existingIds.has(m.id));
        const messages = [...prev.messages, ...newMsgs];
        return {
          ...prev,
          messages,
          messagePage: prev.messagePage ? {
            ...prev.messagePage,
            total: Math.max(prev.messagePage.total + newMsgs.length, messages.length),
          } : undefined,
          status: data.delta.status as Agent['status'],
          costUsd: data.delta.costUsd ?? prev.costUsd,
          tokenUsage: data.delta.tokenUsage ?? prev.tokenUsage,
          contextWindow: data.delta.contextWindow ?? prev.contextWindow,
          lastActivity: data.delta.lastActivity,
          interactionMode: data.delta.interactionMode ?? prev.interactionMode,
          pendingPlan: data.delta.pendingPlan === undefined ? prev.pendingPlan : (data.delta.pendingPlan || undefined),
          pendingQuestion: data.delta.pendingQuestion === undefined ? prev.pendingQuestion : (data.delta.pendingQuestion || undefined),
          currentBranch: data.delta.currentBranch ?? prev.currentBranch,
        };
      });
    };

    const onUpdate = (data: { agentId: string; agent: Agent }) => {
      if (data.agentId === id && data.agent) {
        markSocketActivity();
        setAgent(prev => {
          if (!prev) return data.agent;
          const byId = new Map(prev.messages.map(m => [m.id, m]));
          for (const m of data.agent.messages) byId.set(m.id, m);
          const messages = [...byId.values()];
          return {
            ...data.agent,
            messages,
            messagePage: prev.messagePage
              ? { ...prev.messagePage, total: Math.max(prev.messagePage.total, messages.length) }
              : undefined,
          };
        });
      }
    };

    // Status change
    const onStatus = (data: { agentId: string; status: string }) => {
      if (data.agentId === id) {
        markSocketActivity();
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
        markSocketActivity();
        setInputRequired(data.inputInfo);
        // Focus the input field
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    socket.on('agent:delta', onDelta);
    socket.on('agent:update', onUpdate);
    socket.on('agent:status', onStatus);
    socket.on('agent:input_required', onInputRequired);
    const onSnapshot = (data: { agentId: string; agent: Agent }) => {
      if (data.agentId !== id || !data.agent) return;
      markSocketActivity();
      setAgent(prev => prev ? {
        ...prev,
        ...data.agent,
        messages: prev.messages,
        messagePage: prev.messagePage,
        structuredOutput: data.agent.structuredOutput ?? prev.structuredOutput,
        codeSnapshots: data.agent.codeSnapshots ?? prev.codeSnapshots,
      } : prev);
    };
    socket.on('agent:snapshot', onSnapshot);

    // Re-join room on reconnect (socket.io assigns new socket id after reconnect)
    const onReconnect = () => {
      console.log('[AgentChat] Socket reconnected, re-joining room');
      joinAgent(id);
      fetchAgent();
    };
    socket.on('connect', onReconnect);

    // Poll only as a fallback for an active conversation with a stale socket.
    // Stopped chats can have large histories and should stay completely idle.
    const pollInterval = setInterval(() => {
      const cur = agentRef.current;
      const active = cur?.status === 'running' || cur?.status === 'waiting_input';
      const hasQueue = (cur?.queuedMessages?.length || 0) > 0;
      const visible = document.visibilityState === 'visible';
      const socketStale = !socket.connected || Date.now() - lastSocketActivityAt > 15_000;
      if ((active || hasQueue) && visible && socketStale) fetchAgent();
    }, 10_000);

    return () => {
      leaveAgent(id);
      clearInterval(pollInterval);
      socket.off('agent:delta', onDelta);
      socket.off('agent:update', onUpdate);
      socket.off('agent:status', onStatus);
      socket.off('agent:input_required', onInputRequired);
      socket.off('agent:snapshot', onSnapshot);
      socket.off('connect', onReconnect);
    };
  }, [id, fetchAgent]);

  const scrollToLatestMessage = useCallback(() => {
    virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: 'smooth' });
  }, []);

  const scrollToEarliestMessage = useCallback(() => {
    if (agentRef.current?.messagePage?.hasMore && !loadingEarlierMessages) {
      setScrollingToTop(true);
      void loadEarlierMessages();
    } else {
      virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'smooth' });
    }
  }, [loadingEarlierMessages, loadEarlierMessages]);

  useEffect(() => {
    if (!scrollingToTop || loadingEarlierMessages) return;
    if (agentRef.current?.messagePage?.hasMore) {
      void loadEarlierMessages();
    } else {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'smooth' });
      });
      setScrollingToTop(false);
    }
  }, [scrollingToTop, loadingEarlierMessages, loadEarlierMessages]);

  const handleToggleExpand = useCallback((msgId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const handleStartReached = useCallback(() => {
    if (agentRef.current?.messagePage?.hasMore && !loadingEarlierMessages) {
      void loadEarlierMessages();
    }
  }, [loadingEarlierMessages, loadEarlierMessages]);

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
    const text = buildCommitPrompt(agent);
    try {
      const result = await api.sendMessage(id, text);
      setAgent(result.agent);
    } catch (err) {
      addLocalMessage(`[Error] ${String(err)}`);
    }
  };

  const handleWorktreeAction = async (action: 'update' | 'merge') => {
    if (!id || !agent) return;
    setGitAction(action);
    try {
      const prompt = action === 'update'
        ? buildUpdateFromBasePrompt(agent)
        : buildMergeToBasePrompt(agent);
      const result = await api.sendMessage(id, prompt);
      setAgent(result.agent);
    } catch (err) {
      addLocalMessage(`[Error] ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGitAction(null);
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

    setInput('');
    setAttachedFiles([]);
    setInputRequired(null);
    const queueMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const expectQueue = agentRef.current?.status === 'running';
    if (expectQueue) {
      setAgent(prev => prev ? {
        ...prev,
        queuedMessages: [
          ...(prev.queuedMessages || []),
          {
            id: queueMessageId,
            text,
            createdAt: Date.now(),
            interactionMode: prev.interactionMode,
          },
        ],
      } : prev);
    }

    try {
      const result = await api.sendMessage(id, text, queueMessageId);
      setAgent(prev => {
        if (!prev || result.disposition === 'started') return result.agent;
        const queuedById = new Map((prev.queuedMessages || []).map(message => [message.id, message]));
        for (const message of result.agent.queuedMessages || []) queuedById.set(message.id, message);
        if (result.queuedMessage) queuedById.set(result.queuedMessage.id, result.queuedMessage);
        return {
          ...prev,
          status: result.agent.status,
          queuedMessages: Array.from(queuedById.values()).sort((a, b) => a.createdAt - b.createdAt),
          queuePaused: result.agent.queuePaused,
          lastActivity: Math.max(prev.lastActivity, result.agent.lastActivity),
        };
      });
    } catch (err) {
      setAgent(prev => prev ? {
        ...prev,
        queuedMessages: (prev.queuedMessages || []).filter(message => message.id !== queueMessageId),
      } : prev);
      setInput(text);
      addLocalMessage(`[Error] ${String(err)}`);
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
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedHint((s) => Math.max(s - 1, 0));
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[selectedHint]) {
          e.preventDefault();
          handleSlashSelect(filtered[selectedHint].cmd);
          return;
        }
        setShowSlash(false);
      } else if (e.key === 'Escape') {
        setShowSlash(false);
        return;
      } else {
        return;
      }
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

  const filteredCommands = useMemo(
    () => slashCommands.filter((c) => c.cmd.startsWith(slashFilter || '/')),
    [slashCommands, slashFilter],
  );

  const displayMessages = useMemo(
    () => agent
      ? [...agent.messages, ...localMessages].sort((a, b) => a.timestamp - b.timestamp)
      : [],
    [agent?.messages, localMessages],
  );

  const [visibleStartIndex, setVisibleStartIndex] = useState(0);

  const firstItemIndex = Math.max(0, (agent?.messagePage?.total ?? displayMessages.length) - displayMessages.length);

  const stickyUserMessageInfo = useMemo(() => {
    if (displayMessages.length === 0) return null;
    const arrayStart = Math.min(
      Math.max(0, visibleStartIndex - firstItemIndex),
      displayMessages.length - 1,
    );
    for (let i = arrayStart - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'user') {
        return { index: i, content: displayMessages[i].content };
      }
    }
    return null;
  }, [displayMessages, visibleStartIndex, firstItemIndex]);

  const handleStickyInputClick = useCallback(() => {
    if (stickyUserMessageInfo) {
      virtuosoRef.current?.scrollToIndex({ index: stickyUserMessageInfo.index + firstItemIndex, align: 'start', behavior: 'smooth' });
    }
  }, [stickyUserMessageInfo, firstItemIndex]);

  const workspacePath = agent?.worktreePath || agent?.config.directory || '';

  const openWorkspaceMarkdownFile = useCallback((markdownPath: string) => {
    setTargetFilePath(markdownPath);
    setShowTerminal(false);
    setShowFiles(true);
  }, []);

  if (!agent) {
    if (!loadError) return <div>{t('common.loading')}</div>;
    return (
      <div className="chat-load-error" role="alert">
        <span>{t('chat.loadFailed')}</span>
        <button type="button" className="btn btn-outline" onClick={() => void fetchAgent()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const reasoningEffortOptions = getReasoningEffortOptions(agent.config.provider, runtimeCapabilities);
  const interactionMode = agent.interactionMode || 'default';
  const isPlanMode = interactionMode === 'plan';

  return (
    <div className="chat-container">
      {loadError && (
        <div className="chat-connection-warning" role="status">
          {t('chat.connectionInterrupted')}
        </div>
      )}
      <div className="chat-header">
        <div className="chat-header-main">
          <div className="chat-agent-title">
            <div className="chat-title-line">
              <span className={`provider-badge provider-${agent.config.provider || 'claude'}`}>
                {(agent.config.provider || 'claude').toUpperCase()}
              </span>
              {agent.source === 'external' && (
                <span className="provider-badge" style={{ background: 'var(--primary)', color: '#fff' }}>EXT</span>
              )}
              <h2 className="agent-title-text">{agent.name}</h2>
              <button
                type="button"
                className="agent-rename-btn"
                aria-label={`${t('chat.slashRename')}: ${agent.name}`}
                title={t('chat.slashRename')}
                onClick={renameCurrentAgent}
              >
                &#9998;
              </button>
              <span className={`status status-${getAgentStatusClass(agent.status)} chat-desktop-status`}>
                <span className="status-dot" />
                {getAgentStatusLabel(agent.status)}
              </span>
            </div>
          </div>
          <div className="chat-agent-meta">
            <span className="chat-directory-meta" title={agent.config.directory}>
              <span aria-hidden>📁</span>
              <span className="chat-directory-path">{agent.config.directory}</span>
            </span>
            {agent.workspaceMode === 'direct' ? (
              <>
                <span className="card-direct" title={t('workspaceMode.directTooltip')}>
                  <span className="direct-icon" aria-hidden>🔗</span>
                  {agent.baseBranch ? `${agent.baseBranch} (Direct Edit)` : t('workspaceMode.direct')}
                </span>
                {agent.currentBranch && agent.baseBranch && agent.currentBranch !== agent.baseBranch && (
                  <span
                    className="branch-drift-badge"
                    title={t('workspaceMode.branchDriftWarning', { initial: agent.baseBranch, current: agent.currentBranch })}
                  >
                    {agent.currentBranch}
                  </span>
                )}
              </>
            ) : agent.worktreeBranch ? (
              <span className="card-branch" title={`${t('workspaceMode.worktreeTooltip')}\n${agent.worktreeBranch}`}>
                <svg className="branch-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                  <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
                </svg>
                {agent.baseBranch
                  ? `${agent.baseBranch} (Worktree-${agent.worktreeBranch.replace(/^agent-/, '')})`
                  : t('workspaceMode.worktreeChip', { branch: agent.worktreeBranch.replace(/^agent-/, '') })}
              </span>
            ) : null}
            <label className="chat-reasoning-control">
              <span>{t('chat.currentReasoningEffort')}</span>
              <select
                value={selectedReasoningEffort}
                disabled={updatingReasoningEffort}
                onChange={(e) => handleReasoningEffortChange(e.target.value as ReasoningEffortSelection)}
                title={t(`chat.reasoningEffortHint.${agent.config.provider}`)}
              >
                {reasoningEffortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === 'default' ? t('chat.defaultReasoningEffort') : option.label}
                  </option>
                ))}
              </select>
            </label>
            {(agent.costUsd !== undefined || agent.tokenUsage) && (
              <span className="chat-usage-meta">
                {agent.costUsd !== undefined && `$${agent.costUsd.toFixed(4)}`}
                {agent.costUsd !== undefined && agent.tokenUsage && ' · '}
                {agent.tokenUsage && `${agent.tokenUsage.input + agent.tokenUsage.output} ${t('common.tokens')}`}
              </span>
            )}
          </div>
        </div>
        <div className="chat-mobile-header-controls">
          <button
            type="button"
            className={`btn btn-sm btn-outline chat-mobile-actions-toggle status-${getAgentStatusClass(agent.status)}`}
            aria-expanded={showMobileActions}
            aria-label={t('common.actions')}
            title={getAgentStatusLabel(agent.status)}
            onClick={() => setShowMobileActions(open => !open)}
          >
            <span className="chat-mobile-status-dot" aria-hidden>
              <span className="status-dot" />
            </span>
            {t('common.actions')} {showMobileActions ? '\u25B2' : '\u25BC'}
          </button>
        </div>
        <div
          className={`chat-header-actions${showMobileActions ? ' is-open' : ''}`}
          role="toolbar"
          aria-label={t('common.actions')}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) setShowMobileActions(false);
          }}
        >
          <div className="chat-view-actions">
            <button
              className={`btn btn-sm ${renderMarkdown ? 'btn-primary' : 'btn-outline'}`}
              aria-pressed={renderMarkdown}
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
              aria-pressed={showTerminal}
              onClick={() => {
                const next = !showTerminal;
                if (next) {
                  setHasOpenedTerminal(true);
                  setShowFiles(false);
                } else {
                  // Pick up messages that arrived while the terminal was visible.
                  fetchAgent();
                }
                setShowTerminal(next);
              }}
              title="Toggle live terminal"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="2" width="14" height="11" rx="1.5" />
                <polyline points="4,7 6,5 4,3" transform="translate(0,2)" />
                <line x1="7" y1="10" x2="11" y2="10" />
              </svg>
              Terminal
            </button>
            <button
              className={`btn btn-sm ${showFiles ? 'btn-primary' : 'btn-outline'}`}
              aria-pressed={showFiles}
              onClick={() => {
                setShowFiles(prev => {
                  const next = !prev;
                  if (next) {
                    setTargetFilePath(null);
                    setShowTerminal(false);
                  }
                  return next;
                });
              }}
              title="Browse workspace files"
            >
              Files
            </button>
          </div>
          <div className="chat-task-actions">
            <button
              className="btn btn-sm btn-outline"
              onClick={handleCommit}
              title={t(agent.workspaceMode !== 'direct' && agent.worktreeBranch
                ? 'dashboard.commitWorktreeTooltip'
                : 'dashboard.commitTooltip')}
            >
              {t(agent.workspaceMode !== 'direct' && agent.worktreeBranch
                ? 'dashboard.commitWorktree'
                : 'dashboard.commit')}
            </button>
            {agent.workspaceMode !== 'direct' && agent.worktreeBranch && agent.baseBranch && (
              <>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={agent.status === 'running' || agent.status === 'waiting_input' || gitAction !== null}
                  onClick={() => void handleWorktreeAction('update')}
                >
                  {t('dashboard.updateFromBase', { branch: agent.baseBranch })}
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={agent.status === 'running' || agent.status === 'waiting_input' || gitAction !== null}
                  onClick={() => void handleWorktreeAction('merge')}
                >
                  {t('dashboard.mergeToBase', { branch: agent.baseBranch })}
                </button>
              </>
            )}
            {(agent.status === 'running' || agent.status === 'waiting_input') && (
              <button
                className="btn btn-sm btn-danger"
                onClick={() => id && api.stopAgent(id)}
              >
                {t('common.stop')}
              </button>
            )}
          </div>
        </div>
      </div>

      {directPeers.length > 0 && (
        <div className="chat-direct-concurrency-warning" role="alert">
          {t('chat.directConcurrencyWarning', {
            agents: directPeers.map(peer => peer.name).join(', '),
          })}
        </div>
      )}

      {id && hasOpenedTerminal && (
        <Suspense fallback={<div className="terminal-view terminal-loading">{t('common.loading')}</div>}>
          <TerminalView agentId={id} visible={showTerminal} resumeCommand={buildResumeCommand(agent, runtimeCapabilities)} />
        </Suspense>
      )}
      <FileBrowserView
        rootPath={workspacePath}
        visible={showFiles}
        targetFilePath={targetFilePath}
      />
      <div className="chat-messages-wrapper" style={{ display: showTerminal || showFiles ? 'none' : undefined }}>
        <Virtuoso
          ref={virtuosoRef}
          className="chat-messages"
          style={{ height: 'auto', flex: 1, minHeight: 0 }}
          data={displayMessages}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={Math.max(0, displayMessages.length - 1)}
          followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}
          atBottomThreshold={50}
          atBottomStateChange={setAtBottom}
          rangeChanged={({ startIndex }) => setVisibleStartIndex(startIndex)}
          startReached={handleStartReached}
          overscan={200}
          increaseViewportBy={200}
          itemContent={(_index, msg) => (
            <ChatMessageItem
              key={msg.id}
              msg={msg}
              renderMarkdown={renderMarkdown}
              workspacePath={workspacePath}
              configuredRoot={agent.config.directory}
              isExpanded={expandedTools.has(msg.id)}
              onToggleExpand={handleToggleExpand}
              onOpenMarkdownFile={openWorkspaceMarkdownFile}
            />
          )}
          components={{
            Header: () => agent.messagePage && agent.messages.length > 0 ? (
              <div className="chat-load-earlier">
                <span>{t('chat.messageCount', {
                  loaded: agent.messages.length,
                  total: agent.messagePage.total,
                })}</span>
              </div>
            ) : null,
            Footer: () => (
              <>
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
                      {'📋'} Structured Output
                    </div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.85em', overflow: 'auto', maxHeight: 400 }}>
                      {JSON.stringify(agent.structuredOutput, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            ),
          }}
        />
        {stickyUserMessageInfo && (
          <div
            className="chat-message user chat-sticky-user-message"
            onClick={handleStickyInputClick}
            role="button"
            tabIndex={0}
            title={t('chat.jumpToInput')}
          >
            {stickyUserMessageInfo.content}
          </div>
        )}
        {agent.messagePage?.hasMore && (
          <button
            className={`chat-scroll-fab chat-scroll-fab-top${scrollingToTop ? ' loading' : ''}`}
            onClick={scrollToEarliestMessage}
            disabled={scrollingToTop}
            title={t('chat.loadEarlier')}
          >
            {scrollingToTop ? (
              <span className="thinking-dots"><span /><span /><span /></span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            )}
          </button>
        )}
        {!atBottom && (
          <button
            className="chat-scroll-fab chat-scroll-fab-bottom"
            onClick={scrollToLatestMessage}
            title={t('chat.jumpToLatest')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>
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
        {((agent.status === 'waiting_input' || inputRequired) || (agent.queuedMessages?.length || 0) > 0) && (
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
            {(agent.queuedMessages?.length || 0) > 0 && (
              <div className="chat-notify-queue">
                <span className="chat-notify-queue-label">{t('chat.queued')} ({agent.queuedMessages?.length || 0})</span>
                {agent.queuePaused && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={async () => {
                      try {
                        setAgent(await api.resumeQueuedMessages(agent.id));
                      } catch (err) {
                        addLocalMessage(`[Error] ${String(err)}`);
                      }
                    }}
                  >
                    {t('chat.resumeQueue')}
                  </button>
                )}
                {(agent.queuedMessages || []).map((q) => (
                  <div key={q.id} className="chat-notify-queue-item">
                    <span>{q.text.length > 120 ? q.text.slice(0, 120) + '...' : q.text}</span>
                    <button
                      type="button"
                      className="chat-notify-queue-remove"
                      aria-label={`${t('common.delete')}: ${q.text}`}
                      title={t('common.delete')}
                      onClick={async () => {
                        try {
                          setAgent(await api.cancelQueuedMessage(agent.id, q.id));
                        } catch (err) {
                          addLocalMessage(`[Error] ${String(err)}`);
                        }
                      }}
                    >
                      &minus;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="chat-input-area">
          <button
            className={`btn btn-sm chat-mode-btn ${isPlanMode ? '' : 'btn-outline'}`}
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
            autoFocus={!window.matchMedia?.('(max-width: 768px)').matches}
            rows={1}
            style={{ resize: 'none', overflowY: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 160) + 'px';
            }}
          />
          <button
            className="btn btn-outline btn-sm chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            style={{ padding: '6px 8px', fontSize: 16, lineHeight: 1 }}
          >
            {'\uD83D\uDCCE'}
          </button>
          <button className="btn chat-send-btn" onClick={handleSend}>
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
