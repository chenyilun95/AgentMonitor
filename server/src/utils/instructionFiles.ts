import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { AgentProvider } from '../models/Agent.js';
import {
  INSTRUCTION_FILE_BY_PROVIDER,
  getInstructionFileName,
} from '@agent-monitor/shared';

export { INSTRUCTION_FILE_BY_PROVIDER, getInstructionFileName };

export function getCompatibleInstructionFileNames(provider: AgentProvider): string[] {
  const primary = getInstructionFileName(provider);
  const fallback = Object.values(INSTRUCTION_FILE_BY_PROVIDER).filter((name) => name !== primary);
  return [primary, ...fallback];
}

export function getProviderForInstructionFile(fileName: string): AgentProvider | undefined {
  const entry = Object.entries(INSTRUCTION_FILE_BY_PROVIDER)
    .find(([, candidate]) => candidate === fileName);
  return entry?.[0] as AgentProvider | undefined;
}

export function findInstructionFile(
  dirPath: string,
  provider: AgentProvider,
): { fileName: string; content: string; matchedProvider?: AgentProvider } | null {
  for (const fileName of getCompatibleInstructionFileNames(provider)) {
    const filePath = path.join(dirPath, fileName);
    if (!existsSync(filePath)) continue;
    return {
      fileName,
      content: readFileSync(filePath, 'utf-8'),
      matchedProvider: getProviderForInstructionFile(fileName),
    };
  }
  return null;
}
