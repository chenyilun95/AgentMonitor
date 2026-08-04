import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api, type DirListing, type FilePreview } from '../api/client';
import { resolveImageSource } from '../lib/imageSources';
import { prepareMarkdown, REMARK_MATH, REHYPE_MATH } from '../lib/markdown';

interface FileBrowserViewProps {
  rootPath: string;
  visible: boolean;
  targetFilePath?: string | null;
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

export function FileBrowserView({ rootPath, visible, targetFilePath }: FileBrowserViewProps) {
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

  if (!visible) return null;

  return (
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
              <span className="file-browser-entry-icon">{entry.isDirectory ? '>' : entry.isTextPreviewable ? '-' : 'x'}</span>
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
                </>
              )}
              {(() => {
                if (!wikiDir || !preview.isMarkdown) return null;
                const wikiSubdir = wikiDir + '/wiki/';
                if (!preview.path.startsWith(wikiSubdir)) return null;
                const pageName = preview.path.slice(wikiSubdir.length);
                if (!pageName.endsWith('.md')) return null;
                const isPublic = publicPages.includes(pageName);
                const publicUrl = `/wiki/${pageName.replace(/\.md$/, '')}`;
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
            </div>
          )}
        </div>

        {error && <div className="file-preview-error">{error}</div>}
        {loadingFile && <div className="file-preview-empty">Loading file...</div>}
        {!loadingFile && preview && (
          viewMode === 'preview' && preview.isMarkdown
            ? (
              <div className="file-preview-markdown">
                <ReactMarkdown
                  remarkPlugins={REMARK_MATH}
                  rehypePlugins={REHYPE_MATH}
                  components={{
                    img: ({ src, alt, title }) => (
                      <img src={resolveMarkdownAsset(preview.path, src, frontmatterOrigin)} alt={alt || ''} title={title} loading="lazy" />
                    ),
                  }}
                >
                  {markdownBody}
                </ReactMarkdown>
              </div>
            )
            : <pre className="file-preview-raw">{preview.content}</pre>
        )}
        {!loadingFile && !preview && !error && (
          <div className="file-preview-empty">Open a file from the workspace.</div>
        )}
      </section>
    </div>
  );
}
