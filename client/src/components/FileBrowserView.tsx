import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api, type DirListing, type FilePreview } from '../api/client';
import { resolveImageSource } from '../lib/imageSources';
import { prepareMarkdown, REMARK_MATH, REHYPE_MATH } from '../lib/markdown';

export type { FilePreview };

interface FileBrowserViewProps {
  rootPath: string;
  visible: boolean;
  targetFilePath?: string | null;
  toolbarActions?: (preview: FilePreview) => React.ReactNode;
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.ogg']);

function isVideoUrl(src?: string): boolean {
  if (!src) return false;
  const clean = src.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 && VIDEO_EXTENSIONS.has(clean.slice(dot).toLowerCase());
}

function formatBytes(size?: number): string {
  if (size === undefined) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function pathLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length ? `/${parts.slice(-3).join('/')}` : '/';
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx > 0 ? filePath.slice(0, idx) : '/';
}

function resolveMarkdownAsset(markdownPath: string, src?: string, frontmatterOrigin?: string): string | undefined {
  if (!src) return src;
  if (frontmatterOrigin && src.startsWith('/')) return frontmatterOrigin + src;
  return resolveImageSource(dirname(markdownPath), src);
}

function fileIcon(entry: { isDirectory: boolean; isTextPreviewable?: boolean; name: string }): string {
  if (entry.isDirectory) return '\u{1F4C1}';
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  if (['md', 'mdx'].includes(ext)) return '\u{1F4DD}';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return '\u{1F5BC}';
  if (['mp4', 'webm', 'mov', 'ogg'].includes(ext)) return '\u{1F3AC}';
  if (entry.isTextPreviewable) return '\u{1F4C4}';
  return '\u{1F4CE}';
}

export function FileBrowserView({ rootPath, visible, targetFilePath, toolbarActions }: FileBrowserViewProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequestRef = useRef(0);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>(() =>
    localStorage.getItem('agentmonitor-file-view-mode') === 'raw' ? 'raw' : 'preview',
  );
  const [readerMode, setReaderMode] = useState(false);

  const [wikiDir, setWikiDir] = useState<string | null>(null);
  const [publicPages, setPublicPages] = useState<string[]>([]);
  useEffect(() => {
    api.getWikiConfig().then(cfg => {
      if (cfg.exists) {
        setWikiDir(cfg.wikiDirectory);
        api.getWikiPublicPages().then(d => setPublicPages(d.pages)).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const prevRootRef = useRef(rootPath);
  useEffect(() => {
    if (rootPath !== prevRootRef.current) {
      prevRootRef.current = rootPath;
      setCurrentPath(rootPath);
      setPreview(null);
      setError(null);
    }
  }, [rootPath]);

  useEffect(() => {
    if (!readerMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReaderMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readerMode]);

  const loadDirectory = useCallback(async (dirPath: string) => {
    const requestId = ++listRequestRef.current;
    setLoadingList(true);
    setError(null);
    try {
      const next = await api.listDirectory(dirPath);
      if (requestId !== listRequestRef.current) return;
      setListing(next);
      setCurrentPath(next.path);
    } catch (err) {
      if (requestId !== listRequestRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === listRequestRef.current) setLoadingList(false);
    }
  }, []);

  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      void loadDirectory(currentPath);
    }
    wasVisible.current = visible;
  }, [visible, currentPath, loadDirectory]);

  const openFile = useCallback(async (filePath: string) => {
    setLoadingFile(true);
    setError(null);
    try {
      const next = await api.readFile(filePath);
      setPreview(next);
      if (!next.isMarkdown) setViewMode('raw');
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFile(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || !targetFilePath) return;
    const targetDirectory = dirname(targetFilePath);
    setCurrentPath(targetDirectory);
    void loadDirectory(targetDirectory);
    void openFile(targetFilePath);
  }, [loadDirectory, openFile, targetFilePath, visible]);

  const sortedEntries = useMemo(() => listing?.entries || [], [listing]);

  const { markdownBody, frontmatterOrigin } = useMemo(() => {
    if (!preview?.isMarkdown) return { markdownBody: '', frontmatterOrigin: undefined };
    const { body, origin } = prepareMarkdown(preview.content);
    return { markdownBody: body, frontmatterOrigin: origin };
  }, [preview?.content, preview?.isMarkdown]);

  const markdownComponents = useMemo(() => {
    if (!preview) return {};
    return {
      img: ({ src, alt, title }: { src?: string; alt?: string; title?: string }) => {
        const resolved = resolveMarkdownAsset(preview.path, src, frontmatterOrigin);
        if (isVideoUrl(src)) {
          return <video src={resolved} controls title={title} style={{ maxWidth: '100%' }} />;
        }
        return <img src={resolved} alt={alt || ''} title={title} loading="lazy" />;
      },
    };
  }, [preview?.path, frontmatterOrigin]);

  if (!visible) return null;

  const renderedMarkdown = preview?.isMarkdown ? (
    <ReactMarkdown
      remarkPlugins={REMARK_MATH}
      rehypePlugins={REHYPE_MATH}
      components={markdownComponents}
    >
      {markdownBody}
    </ReactMarkdown>
  ) : null;

  return (
    <>
      <div className="file-browser-view">
        <aside className="file-browser-sidebar">
          <div className="file-browser-toolbar">
            <button
              className="btn btn-sm btn-outline"
              onClick={() => listing?.parent && void loadDirectory(listing.parent)}
              disabled={!listing?.parent || loadingList}
              title="Up"
            >
              Up
            </button>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => void loadDirectory(currentPath)}
              disabled={loadingList}
              title="Refresh"
            >
              Refresh
            </button>
          </div>
          <div className="file-browser-path" title={currentPath}>{pathLabel(currentPath)}</div>
          <div className="file-browser-list">
            {loadingList && <div className="file-browser-empty">Loading...</div>}
            {!loadingList && sortedEntries.map((entry) => (
              <button
                key={entry.path}
                className={`file-browser-entry ${entry.isDirectory ? 'directory' : ''} ${preview?.path === entry.path ? 'selected' : ''}`}
                onClick={() => {
                  if (entry.isDirectory) {
                    setPreview(null);
                    void loadDirectory(entry.path);
                  } else {
                    void openFile(entry.path);
                  }
                }}
                title={entry.path}
              >
                <span className="file-browser-entry-icon">{fileIcon(entry)}</span>
                <span className="file-browser-entry-name">{entry.name}</span>
                {!entry.isDirectory && <span className="file-browser-entry-meta">{formatBytes(entry.size)}</span>}
              </button>
            ))}
            {!loadingList && sortedEntries.length === 0 && (
              <div className="file-browser-empty">No files</div>
            )}
          </div>
        </aside>

        <section className="file-preview">
          <div className="file-preview-toolbar">
            <div className="file-preview-title">
              {preview ? (
                <>
                  <strong>{preview.name}</strong>
                  <span>{formatBytes(preview.size)}{preview.truncated ? ' - truncated' : ''}</span>
                </>
              ) : (
                <span>Select a Markdown or text file</span>
              )}
            </div>
            {preview && (
              <div className="file-preview-actions">
                {preview.isMarkdown && (
                  <>
                    <button
                      className={`btn btn-sm ${viewMode === 'preview' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => {
                        setViewMode('preview');
                        localStorage.setItem('agentmonitor-file-view-mode', 'preview');
                      }}
                    >
                      Preview
                    </button>
                    <button
                      className={`btn btn-sm ${viewMode === 'raw' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => {
                        setViewMode('raw');
                        localStorage.setItem('agentmonitor-file-view-mode', 'raw');
                      }}
                    >
                      Raw
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => setReaderMode(true)}
                      title="Reader mode"
                    >
                      Reader
                    </button>
                  </>
                )}
                {(() => {
                  if (!wikiDir || !preview.isMarkdown) return null;
                  const wikiSubdir = wikiDir + '/wiki/';
                  if (!preview.path.startsWith(wikiSubdir)) return null;
                  const pageName = preview.path.slice(wikiSubdir.length);
                  if (!pageName.endsWith('.md')) return null;
                  const isPublic = publicPages.includes(pageName);
                  const slug = pageName.split('/').pop()?.replace(/\.md$/, '') || '';
                  const publicUrl = `/wiki/${slug}`;
                  return (
                    <>
                      <button
                        className={`btn btn-sm ${isPublic ? 'wiki-btn-public' : 'btn-outline'}`}
                        onClick={async () => {
                          try {
                            const result = await api.setWikiPagePublic(pageName, !isPublic);
                            setPublicPages(result.pages);
                          } catch (err) {
                            console.error('Failed to toggle public:', err);
                          }
                        }}
                      >
                        {isPublic ? '公开' : '私有'}
                      </button>
                      {isPublic && (
                        <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="wiki-public-link" title={publicUrl}>
                          &#128279;
                        </a>
                      )}
                    </>
                  );
                })()}
                {toolbarActions?.(preview)}
              </div>
            )}
          </div>

          {error && <div className="file-preview-error">{error}</div>}
          {loadingFile && <div className="file-preview-empty">Loading file...</div>}
          {!loadingFile && preview && (
            viewMode === 'preview' && preview.isMarkdown
              ? <div className="file-preview-markdown">{renderedMarkdown}</div>
              : <pre className="file-preview-raw">{preview.content}</pre>
          )}
          {!loadingFile && !preview && !error && (
            <div className="file-preview-empty">Open a file from the workspace.</div>
          )}
        </section>
      </div>

      {readerMode && preview?.isMarkdown && (
        <div className="file-reader-overlay">
          <div className="file-reader-topbar">
            <strong className="file-reader-title">{preview.name}</strong>
            <div className="file-reader-actions">
              {(() => {
                if (!wikiDir || !preview.isMarkdown) return null;
                const wikiSubdir = wikiDir + '/wiki/';
                if (!preview.path.startsWith(wikiSubdir)) return null;
                const pageName = preview.path.slice(wikiSubdir.length);
                if (!pageName.endsWith('.md')) return null;
                const isPublic = publicPages.includes(pageName);
                const slug = pageName.split('/').pop()?.replace(/\.md$/, '') || '';
                const publicUrl = `/wiki/${slug}`;
                return (
                  <>
                    <button
                      className={`btn btn-sm ${isPublic ? 'wiki-btn-public' : 'btn-outline'}`}
                      onClick={async () => {
                        try {
                          const result = await api.setWikiPagePublic(pageName, !isPublic);
                          setPublicPages(result.pages);
                        } catch (err) {
                          console.error('Failed to toggle public:', err);
                        }
                      }}
                    >
                      {isPublic ? '公开' : '私有'}
                    </button>
                    {isPublic && (
                      <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="wiki-public-link" title={publicUrl}>
                        &#128279;
                      </a>
                    )}
                  </>
                );
              })()}
              {toolbarActions?.(preview)}
              <button className="btn btn-sm btn-outline" onClick={() => setReaderMode(false)}>
                Close
              </button>
            </div>
          </div>
          <div className="file-reader-scroll">
            <article className="file-reader-content file-preview-markdown">
              {renderedMarkdown}
            </article>
          </div>
        </div>
      )}
    </>
  );
}
