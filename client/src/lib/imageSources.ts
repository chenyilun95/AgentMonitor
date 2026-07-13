function isBrowserImageSource(src: string): boolean {
  return /^(https?:|data:image\/|blob:|\/api\/)/i.test(src);
}

function normalizePath(filePath: string): string {
  const absolute = filePath.startsWith('/');
  const parts: string[] = [];
  for (const part of filePath.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

/** Convert an agent-visible local image path into the authenticated asset route. */
export function resolveImageSource(workspacePath: string, source?: string): string | undefined {
  if (!source) return source;
  if (isBrowserImageSource(source)) return source;

  let localSource = source.split(/[?#]/, 1)[0];
  if (localSource.startsWith('file://')) localSource = localSource.slice('file://'.length);
  if (localSource.startsWith('sandbox:')) localSource = localSource.slice('sandbox:'.length);
  try {
    localSource = decodeURI(localSource);
  } catch {
    // Keep malformed-but-usable paths unchanged.
  }

  const resolved = localSource.startsWith('/')
    ? normalizePath(localSource)
    : normalizePath(`${workspacePath}/${localSource}`);
  return `/api/directories/asset?path=${encodeURIComponent(resolved)}`;
}
