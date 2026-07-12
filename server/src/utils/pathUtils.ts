import os from 'os';
import path from 'path';

export function normalizeUserPath(inputPath: string): string {
  const trimmedPath = inputPath.trim();
  const expandedPath = trimmedPath === '~'
    ? os.homedir()
    : trimmedPath.startsWith('~/')
      ? path.join(os.homedir(), trimmedPath.slice(2))
      : trimmedPath;

  return path.resolve(expandedPath);
}
