import { execFile, execFileSync } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { normalizeUserPath } from '../utils/pathUtils.js';

const execFileAsync = promisify(execFile);
const repositoryLocks = new Set<string>();

export interface GitDirectoryInfo {
  isGit: boolean;
  root?: string;
  repositoryRoot?: string;
  branch?: string;
  upstream?: string;
}

export class GitOperationError extends Error {
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
  }
}

function errorDetail(error: unknown, fallback: string): GitOperationError {
  const err = error as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
  const detail = String(err.stderr || err.stdout || err.message || error).trim();
  return new GitOperationError(detail || fallback);
}

function gitLocal(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
  } catch (error) {
    throw errorDetail(error, `git ${args[0]} failed`);
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw errorDetail(error, `git ${args[0]} failed`);
  }
}

function repositoryLockKey(directory: string): string {
  const cwd = normalizeUserPath(directory);
  const commonDir = gitLocal(cwd, ['rev-parse', '--git-common-dir']);
  return path.resolve(cwd, commonDir);
}

async function withRepositoryLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const key = repositoryLockKey(directory);
  if (repositoryLocks.has(key)) {
    throw new GitOperationError('Another Git operation is already running for this repository.');
  }
  repositoryLocks.add(key);
  try {
    return await operation();
  } finally {
    repositoryLocks.delete(key);
  }
}

async function requireClean(cwd: string, label: string): Promise<void> {
  const status = await git(cwd, ['status', '--porcelain']);
  if (status) throw new GitOperationError(`${label} has uncommitted changes. Commit or discard them first.`);
}

export function getGitDirectoryInfo(directory: string): GitDirectoryInfo {
  const cwd = normalizeUserPath(directory);
  try {
    const root = gitLocal(cwd, ['rev-parse', '--show-toplevel']);
    const worktrees = gitLocal(cwd, ['worktree', 'list', '--porcelain']);
    const repositoryRoot = worktrees.match(/^worktree (.+)$/m)?.[1] || root;
    const branch = gitLocal(cwd, ['branch', '--show-current']);
    let upstream: string | undefined;
    try {
      upstream = gitLocal(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    } catch { /* branch has no upstream */ }
    return { isGit: true, root, repositoryRoot, branch: branch || undefined, upstream };
  } catch {
    return { isGit: false };
  }
}

export async function pullDirectory(directory: string): Promise<GitDirectoryInfo> {
  const cwd = normalizeUserPath(directory);
  const info = getGitDirectoryInfo(cwd);
  if (!info.isGit || !info.root) throw new GitOperationError('This directory is not inside a Git repository.', 400);
  return withRepositoryLock(info.root, async () => {
    const current = getGitDirectoryInfo(info.root!);
    if (!current.branch) throw new GitOperationError('The original repository is in detached HEAD state.');
    if (!current.upstream) throw new GitOperationError(`Branch ${current.branch} has no upstream branch.`);
    await requireClean(info.root!, 'Original repository');
    await git(info.root!, ['pull', '--ff-only']);
    return getGitDirectoryInfo(info.root!);
  });
}

export async function pushDirectory(directory: string): Promise<GitDirectoryInfo> {
  const cwd = normalizeUserPath(directory);
  const info = getGitDirectoryInfo(cwd);
  if (!info.isGit || !info.root) throw new GitOperationError('This directory is not inside a Git repository.', 400);
  return withRepositoryLock(info.root, async () => {
    const current = getGitDirectoryInfo(info.root!);
    if (!current.branch) throw new GitOperationError('The original repository is in detached HEAD state.');
    if (!current.upstream) throw new GitOperationError(`Branch ${current.branch} has no upstream branch.`);
    await requireClean(info.root!, 'Original repository');
    await git(info.root!, ['push']);
    return getGitDirectoryInfo(info.root!);
  });
}
