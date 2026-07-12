import type { AgentClientView } from '@agent-monitor/shared';

type Agent = AgentClientView;

export function getAgentStatusClass(status: Agent['status']) {
  return status === 'stopped' ? 'waiting_input' : status;
}

export function getAgentStatusLabel(status: Agent['status']) {
  return status === 'stopped' || status === 'waiting_input' ? 'waiting' : status;
}
