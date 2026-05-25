import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type DirListing, type FilePreview } from '../api/client';

interface FileBrowserViewProps {
  rootPath: string;
  visible: boolean;
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

function isExternalUrl(src: string): boolean {
  return /^(https?:|data:|blob:|mailto:|#)/i.test(src);
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx > 0 ? filePath.slice(0, idx) : '/';
}

function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

function resolveMarkdownAsset(markdownPath: string, src?: string): string | undefined {
  if (!src || isExternalUrl(src)) return src;
  const cleanSrc = src.split(/[?#]/, 1)[0];
  let localSrc = cleanSrc;
  try {
    localSrc = decodeURI(cleanSrc);
  } catch {
    localSrc = cleanSrc;
  }
  const resolved = localSrc.startsWith('/')
    ? normalizePath(localSrc)
    : normalizePath(`${dirname(markdownPath)}/${localSrc}`);
  return `/api/directories/asset?path=${encodeURIComponent(resolved)}`;
}

export function FileBrowserView({ rootPath, visible }: FileBrowserViewProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>(() =>
    localStorage.getItem('agentmonitor-file-view-mode') === 'raw' ? 'raw' : 'preview',
  );

  useEffect(() => {
    setCurrentPath(rootPath);
    setPreview(null);
    setError(null);
  }, [rootPath]);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoadingList(true);
    setError(null);
    try {
      const next = await api.listDirectory(dirPath);
      setListing(next);
      setCurrentPath(next.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void loadDirectory(currentPath);
  }, [currentPath, loadDirectory, visible]);

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

  const sortedEntries = useMemo(() => listing?.entries || [], [listing]);

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
                  setCurrentPath(entry.path);
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
          {preview?.isMarkdown && (
            <div className="file-preview-actions">
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
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt, title }) => (
                      <img src={resolveMarkdownAsset(preview.path, src)} alt={alt || ''} title={title} loading="lazy" />
                    ),
                  }}
                >
                  {preview.content}
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
