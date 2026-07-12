import type { Writable } from 'stream';
import type { ProcessStartOpts } from '../AgentProcess.js';

export interface AgentCommand {
  bin: string;
  args: string[];
}

export interface AgentRunner {
  buildCommand(opts: ProcessStartOpts): AgentCommand;
  handleStartInput(stdin: Writable | null | undefined, opts: ProcessStartOpts): void;
  formatUserMessage(text: string): string | undefined;
}

/** Shell-escape a string for use with spawn shell: true. */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
