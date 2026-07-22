function normalizeAbsolutePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `/${parts.join('/')}`;
}

function isWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function stripLinkLocation(href: string): string {
  const withoutFragment = href.split('#', 1)[0];
  const withoutQuery = withoutFragment.split('?', 1)[0];
  return withoutQuery.replace(/:\d+(?::\d+)?$/, '');
}

/**
 * Resolve a Markdown link from agent output to a file in the active workspace.
 * HTTP(S), anchors, non-Markdown files, and paths outside the workspace are
 * intentionally left to the browser.
 */
export function resolveWorkspaceMarkdownLink(
  href: string | undefined,
  workspaceRoot: string,
  configuredRoot = workspaceRoot,
): string | null {
  if (!href?.trim() || !workspaceRoot.trim()) return null;

  let candidate = href.trim();
  if (candidate.startsWith('file://')) {
    candidate = candidate.slice('file://'.length);
  } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate) || /^(?:mailto|data|javascript):/i.test(candidate)) {
    return null;
  }

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }

  candidate = stripLinkLocation(candidate);
  if (!/\.(?:md|markdown)$/i.test(candidate)) return null;

  const activeRoot = normalizeAbsolutePath(workspaceRoot);
  const sourceRoot = normalizeAbsolutePath(configuredRoot);

  if (!candidate.startsWith('/')) {
    const resolved = normalizeAbsolutePath(`${activeRoot}/${candidate}`);
    return isWithinRoot(resolved, activeRoot) ? resolved : null;
  }

  const absolute = normalizeAbsolutePath(candidate);
  if (isWithinRoot(absolute, activeRoot)) return absolute;

  if (isWithinRoot(absolute, sourceRoot)) {
    const relative = absolute.slice(sourceRoot.length).replace(/^\//, '');
    const mapped = normalizeAbsolutePath(`${activeRoot}/${relative}`);
    return isWithinRoot(mapped, activeRoot) ? mapped : null;
  }

  return null;
}
