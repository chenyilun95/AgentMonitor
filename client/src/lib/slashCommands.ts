import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { Agent } from '../api/client';
import { api } from '../api/client';
import { toggleTheme } from './theme';

type LocalMessage = { id: string; role: string; content: string; timestamp: number };

export interface SlashCommandDefinition {
  cmd: string;
  desc: string;
}

export function getSlashCommandDefinitions(t: (key: string) => string): SlashCommandDefinition[] {
  return [
    { cmd: '/agents', desc: t('chat.slashAgents') },
    { cmd: '/btw', desc: t('chat.slashBtw') },
    { cmd: '/side', desc: t('chat.slashSide') },
    { cmd: '/clear', desc: t('chat.slashClear') },
    { cmd: '/compact', desc: t('chat.slashCompact') },
    { cmd: '/config', desc: t('chat.slashConfig') },
    { cmd: '/context', desc: t('chat.slashContext') },
    { cmd: '/copy', desc: t('chat.slashCopy') },
    { cmd: '/cost', desc: t('chat.slashCost') },
    { cmd: '/doctor', desc: t('chat.slashDoctor') },
    { cmd: '/effort', desc: t('chat.slashEffort') },
    { cmd: '/exit', desc: t('chat.slashExit') },
    { cmd: '/export', desc: t('chat.slashExport') },
    { cmd: '/fast', desc: t('chat.slashFast') },
    { cmd: '/feedback', desc: t('chat.slashFeedback') },
    { cmd: '/help', desc: t('chat.slashHelp') },
    { cmd: '/hooks', desc: t('chat.slashHooks') },
    { cmd: '/ide', desc: t('chat.slashIde') },
    { cmd: '/keybindings', desc: t('chat.slashKeybindings') },
    { cmd: '/login', desc: t('chat.slashLogin') },
    { cmd: '/logout', desc: t('chat.slashLogout') },
    { cmd: '/loop', desc: t('chat.slashLoop') },
    { cmd: '/mcp', desc: t('chat.slashMcp') },
    { cmd: '/memory', desc: t('chat.slashMemory') },
    { cmd: '/model', desc: t('chat.slashModel') },
    { cmd: '/new', desc: t('chat.slashNew') },
    { cmd: '/permissions', desc: t('chat.slashPermissions') },
    { cmd: '/plan', desc: t('chat.slashPlan') },
    { cmd: '/plugin', desc: t('chat.slashPlugin') },
    { cmd: '/plugins', desc: t('chat.slashPlugins') },
    { cmd: '/reload-plugins', desc: t('chat.slashReloadPlugins') },
    { cmd: '/remote-control', desc: t('chat.slashRemoteControl') },
    { cmd: '/rename', desc: t('chat.slashRename') },
    { cmd: '/rewind', desc: t('chat.slashRewind') },
    { cmd: '/skills', desc: t('chat.slashSkills') },
    { cmd: '/stats', desc: t('chat.slashStats') },
    { cmd: '/status', desc: t('chat.slashStatus') },
    { cmd: '/stop', desc: t('chat.slashStop') },
    { cmd: '/tasks', desc: t('chat.slashTasks') },
    { cmd: '/teleport', desc: t('chat.slashTeleport') },
    { cmd: '/theme', desc: t('chat.slashTheme') },
    { cmd: '/todos', desc: t('chat.slashTodos') },
    { cmd: '/usage', desc: t('chat.slashUsage') },
    { cmd: '/version', desc: t('chat.slashVersion') },
  ];
}

export interface SlashCommandContext {
  agent: Agent | null;
  id: string | undefined;
  addLocalMessage: (content: string, role?: string) => void;
  navigate: NavigateFunction;
  fetchAgent: () => void;
  setAgent: Dispatch<SetStateAction<Agent | null>>;
  setLocalMessages: Dispatch<SetStateAction<LocalMessage[]>>;
  toggleInteractionMode: () => void;
  renameCurrentAgent: () => void;
  formatReasoningEffort: (effort?: Agent['config']['flags']['reasoningEffort']) => string;
  btwInputRef: RefObject<HTMLTextAreaElement | null>;
  setBtwState: (state: { status: 'input' | 'loading' | 'answer'; question?: string; answer?: string; error?: string }) => void;
  t: (key: string) => string;
  getAgentStatusLabel: (status: Agent['status']) => string;
  commands: SlashCommandDefinition[];
}

export function executeSlashCommand(cmd: string, ctx: SlashCommandContext): void {
  const {
    agent, id, addLocalMessage, navigate, fetchAgent, setAgent, setLocalMessages,
    toggleInteractionMode, renameCurrentAgent, formatReasoningEffort,
    btwInputRef, setBtwState, t, getAgentStatusLabel, commands,
  } = ctx;

  switch (cmd) {
    case '/btw':
    case '/side':
      setBtwState({ status: 'input' });
      setTimeout(() => btwInputRef.current?.focus(), 50);
      break;
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
        commands.map((c) => `${c.cmd}  ${c.desc}`).join('\n'),
      );
      break;
    case '/clear':
    case '/new':
      if (id) {
        api.newConversation(id).then((updated) => {
          setAgent(updated);
          setLocalMessages([]);
          addLocalMessage(t('chat.newConversationStarted'));
        }).catch((err) => {
          addLocalMessage(`[Error] ${String(err)}`);
        });
      }
      break;
    case '/compact':
      if (id) {
        api.sendMessage(id, '/compact');
      }
      addLocalMessage('Compact requested. Token count will appear here when it completes.');
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
        addLocalMessage(`CLAUDE.md:\n${agent.config.claudeMd || '(empty)'}`);
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
      const skills = commands.map(c => `${c.cmd} - ${c.desc}`);
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
          `${t('chat.agentStatus')}: ${getAgentStatusLabel(agent.status)}`,
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
          addLocalMessage(`${t('chat.doctorOk')}\nStatus: ${getAgentStatusLabel(agent.status)}\nProvider: ${(agent.config.provider || 'claude').toUpperCase()}\nMessages: ${agent.messages.length}`);
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
      toggleInteractionMode();
      break;
    case '/plugin':
      addLocalMessage(t('chat.pluginInfo'));
      break;
    case '/rename':
      void renameCurrentAgent();
      break;
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
}
