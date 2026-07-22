import { describe, expect, it } from 'vitest';
import { resolveWorkspaceMarkdownLink } from '../../src/lib/markdownFileLinks';

describe('resolveWorkspaceMarkdownLink', () => {
  const workspace = '/repo/.agent-worktrees/agent-123';
  const configured = '/repo';

  it('resolves relative Markdown files inside the active workspace', () => {
    expect(resolveWorkspaceMarkdownLink('README.md', workspace, configured)).toBe(`${workspace}/README.md`);
    expect(resolveWorkspaceMarkdownLink('README.md:12:4', workspace, configured)).toBe(`${workspace}/README.md`);
    expect(resolveWorkspaceMarkdownLink('./docs/guide.md#usage', workspace, configured)).toBe(`${workspace}/docs/guide.md`);
    expect(resolveWorkspaceMarkdownLink('docs/My%20Guide.markdown:12', workspace, configured)).toBe(`${workspace}/docs/My Guide.markdown`);
  });

  it('maps configured repository paths into an isolated worktree', () => {
    expect(resolveWorkspaceMarkdownLink('/repo/README.md:42', workspace, configured)).toBe(`${workspace}/README.md`);
    expect(resolveWorkspaceMarkdownLink(`file://${workspace}/AGENTS.md#L10`, workspace, configured)).toBe(`${workspace}/AGENTS.md`);
  });

  it('does not intercept web links, non-Markdown files, or paths outside the workspace', () => {
    expect(resolveWorkspaceMarkdownLink('https://example.com/README.md', workspace, configured)).toBeNull();
    expect(resolveWorkspaceMarkdownLink('src/main.ts', workspace, configured)).toBeNull();
    expect(resolveWorkspaceMarkdownLink('../secret.md', workspace, configured)).toBeNull();
    expect(resolveWorkspaceMarkdownLink('/tmp/notes.md', workspace, configured)).toBeNull();
  });
});
