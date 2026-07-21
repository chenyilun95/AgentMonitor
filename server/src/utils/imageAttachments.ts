import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentMessageAttachment } from '../models/Agent.js';

const IMAGE_EXTENSION = '(?:bmp|gif|ico|jpe?g|png|svg|webp)';
const FULL_IMAGE_SOURCE_RE = new RegExp(`^(?:https?:\\/\\/|file:\\/\\/|sandbox:|\\.?\\.?\\/).+\\.${IMAGE_EXTENSION}(?:[?#].*)?$`, 'i');
const LOCAL_IMAGE_PATH_RE = new RegExp(`(?<![A-Za-z0-9._-])(?:file:\\/\\/|sandbox:)?(?:\\/|\\.\\.?\\/)[^\\s"'<>]+?\\.${IMAGE_EXTENSION}(?:[?#][^\\s"'<>]*)?`, 'gi');
const REMOTE_IMAGE_URL_RE = new RegExp(`https?:\\/\\/[^\\s"'<>]+?\\.${IMAGE_EXTENSION}(?:[?#][^\\s"'<>]*)?`, 'gi');
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+["'][^"']*["'])?\)/gi;
const MAX_DATA_URL_LENGTH = 15 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function mimeName(mimeType?: string): string | undefined {
  if (!mimeType?.startsWith('image/')) return undefined;
  const subtype = mimeType.slice('image/'.length).replace('jpeg', 'jpg').replace('+xml', '');
  return subtype ? `image.${subtype}` : undefined;
}

/** Extract image outputs from Claude, Codex, MCP, and plain-text tool result shapes. */
export function extractImageAttachments(value: unknown): AgentMessageAttachment[] {
  const attachments: AgentMessageAttachment[] = [];
  const seen = new Set<string>();

  const add = (source: unknown, name?: unknown, mimeType?: unknown) => {
    if (typeof source !== 'string' || !source || seen.has(source)) return;
    if (source.startsWith('data:image/') && source.length > MAX_DATA_URL_LENGTH) return;
    seen.add(source);
    attachments.push({
      type: 'image',
      source,
      name: typeof name === 'string' && name ? name : mimeName(typeof mimeType === 'string' ? mimeType : undefined),
      mimeType: typeof mimeType === 'string' ? mimeType : undefined,
    });
  };

  const scanString = (text: string) => {
    if (text.startsWith('data:image/')) {
      add(text);
      return;
    }
    if (FULL_IMAGE_SOURCE_RE.test(text)) add(text);
    for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) add(match[1]);
    for (const match of text.matchAll(REMOTE_IMAGE_URL_RE)) add(match[0]);
    const withoutRemoteUrls = text.replace(REMOTE_IMAGE_URL_RE, '');
    for (const match of withoutRemoteUrls.matchAll(LOCAL_IMAGE_PATH_RE)) add(match[0]);
  };

  const visit = (current: unknown, depth: number) => {
    if (depth > 7 || current == null) return;
    if (typeof current === 'string') {
      scanString(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const entry of current) visit(entry, depth + 1);
      return;
    }

    const record = asRecord(current);
    if (!record) return;
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    const mimeType = record.mimeType ?? record.mime_type ?? record.media_type;
    const source = asRecord(record.source);
    const imageUrl = asRecord(record.image_url);

    if (type === 'image' || type === 'output_image' || type === 'image_url') {
      if (source?.type === 'base64' && typeof source.data === 'string' && typeof source.media_type === 'string') {
        add(`data:${source.media_type};base64,${source.data}`, record.name, source.media_type);
      } else if (typeof record.data === 'string' && typeof mimeType === 'string') {
        add(`data:${mimeType};base64,${record.data}`, record.name, mimeType);
      }
      add(record.url ?? record.image_url, record.name, mimeType);
      add(imageUrl?.url, record.name, mimeType);
      add(record.path ?? record.file_path ?? record.output_path, record.name, mimeType);
    }

    for (const key of ['image_url', 'url', 'path', 'file_path', 'output_path', 'output_hint']) {
      const candidate = record[key];
      if (typeof candidate === 'string') scanString(candidate);
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key === 'data' && typeof nested === 'string') continue;
      visit(nested, depth + 1);
    }
  };

  visit(value, 0);
  return attachments;
}

function isLocalRelativePath(source: string): boolean {
  return !(/^(https?:|data:|blob:|file:|sandbox:)/i.test(source)) && !source.startsWith('/');
}

/**
 * Resolve relative attachment paths to absolute using the agent's execution
 * directory.  When the agent runs in a worktree, a `../` prefix escapes to
 * `.agent-worktrees/` rather than the repo root.  Fall back to the main repo
 * directory so gitignored assets (e.g. `raw/`) are still reachable.
 */
export function resolveAttachmentPaths(
  attachments: AgentMessageAttachment[],
  execDir: string,
  repoDir?: string,
): AgentMessageAttachment[] {
  if (attachments.length === 0) return attachments;

  for (const att of attachments) {
    if (!isLocalRelativePath(att.source)) continue;

    const resolved = path.resolve(execDir, att.source);
    if (existsSync(resolved)) {
      att.source = resolved;
      continue;
    }

    if (repoDir && repoDir !== execDir) {
      const fallback = path.resolve(repoDir, att.source);
      if (existsSync(fallback)) {
        att.source = fallback;
        continue;
      }
    }

    // Neither exists — keep the exec-dir resolved absolute path so the
    // frontend doesn't need to guess worktree structure.
    att.source = resolved;
  }
  return attachments;
}
