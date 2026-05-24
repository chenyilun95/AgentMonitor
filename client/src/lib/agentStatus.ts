import type { Agent } from '../api/client';

export function getAgentStatusClass(status: Agent['status']) {
  return status === 'stopped' ? 'waiting_input' : status;
}

export function getAgentStatusLabel(status: Agent['status']) {
  return status === 'stopped' || status === 'waiting_input' ? 'waiting' : status;
}
