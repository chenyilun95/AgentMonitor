import os from 'os';
import path from 'path';

export function expandHomePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function normalizeUserPath(inputPath: string): string {
  const expanded = expandHomePath(inputPath);
  return expanded ? path.resolve(expanded) : expanded;
}

export function normalizeOptionalUserPath(inputPath: string | undefined): string | undefined {
  if (inputPath === undefined) return undefined;
  const normalized = normalizeUserPath(inputPath);
  return normalized || undefined;
}

/** Store paths below the current user's home in a machine-portable form. */
export function portableUserPath(inputPath: string): string {
  const resolved = normalizeUserPath(inputPath);
  const home = path.resolve(os.homedir());
  const relative = path.relative(home, resolved);
  if (relative === '') return '~';
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `~/${relative.split(path.sep).join('/')}`;
  }
  return resolved;
}
