import {
  INSTRUCTION_FILE_BY_PROVIDER,
  getInstructionFileName,
} from '@agent-monitor/shared';

export { INSTRUCTION_FILE_BY_PROVIDER, getInstructionFileName };

export function replaceInstructionFileName(text: string, fileName: string): string {
  return text.replace(/CLAUDE\.md/g, fileName);
}
