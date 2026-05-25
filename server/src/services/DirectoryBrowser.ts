import fs from 'fs';
import path from 'path';

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const PREVIEWABLE_EXTENSIONS = new Set([
  '.css',
  '.env',
  '.example',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mdx',
  '.markdown',
  '.py',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const PREVIEWABLE_NAMES = new Set([
  'CHANGELOG',
  'Dockerfile',
  'LICENSE',
  'Makefile',
  'README',
]);
const PREVIEWABLE_ASSET_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
  extension?: string;
  isTextPreviewable?: boolean;
}

export interface FilePreview {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtime: number;
  content: string;
  truncated: boolean;
  language: string;
  isMarkdown: boolean;
}

export interface FileAsset {
  path: string;
  name: string;
}

export class FileReadError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'FileReadError';
    this.statusCode = statusCode;
  }
}

export class DirectoryBrowser {
  listDirectory(dirPath: string): DirEntry[] {
    const resolved = path.resolve(dirPath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory not found: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => {
        const entryPath = path.join(resolved, e.name);
        const stat = fs.statSync(entryPath);
        const extension = e.isDirectory() ? '' : path.extname(e.name);
        return {
          name: e.name,
          path: entryPath,
          isDirectory: e.isDirectory(),
          size: e.isDirectory() ? undefined : stat.size,
          mtime: stat.mtimeMs,
          extension,
          isTextPreviewable: !e.isDirectory() && this.isPreviewableTextFile(e.name),
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  readTextFile(filePath: string, opts: { maxBytes?: number } = {}): FilePreview {
    const resolved = path.resolve(filePath);
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_FILE_BYTES;

    if (!fs.existsSync(resolved)) {
      throw new FileReadError(`File not found: ${resolved}`, 404);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new FileReadError(`Not a file: ${resolved}`, 400);
    }

    const name = path.basename(resolved);
    if (!this.isPreviewableTextFile(name)) {
      throw new FileReadError(`File type is not previewable: ${name}`, 415);
    }

    const fd = fs.openSync(resolved, 'r');
    try {
      const bytesToRead = Math.min(stat.size, maxBytes + 1);
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, 0);
      const chunk = buffer.subarray(0, bytesRead);
      if (chunk.includes(0)) {
        throw new FileReadError(`File appears to be binary: ${name}`, 415);
      }

      const truncated = stat.size > maxBytes;
      const contentBuffer = truncated ? chunk.subarray(0, maxBytes) : chunk;
      const extension = path.extname(name);
      return {
        path: resolved,
        name,
        extension,
        size: stat.size,
        mtime: stat.mtimeMs,
        content: contentBuffer.toString('utf-8'),
        truncated,
        language: this.getLanguage(name),
        isMarkdown: this.isMarkdownFile(name),
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  getPreviewAsset(filePath: string): FileAsset {
    const resolved = path.resolve(filePath);

    if (!fs.existsSync(resolved)) {
      throw new FileReadError(`File not found: ${resolved}`, 404);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new FileReadError(`Not a file: ${resolved}`, 400);
    }

    const name = path.basename(resolved);
    if (!PREVIEWABLE_ASSET_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      throw new FileReadError(`Asset type is not previewable: ${name}`, 415);
    }

    return { path: resolved, name };
  }

  getParent(dirPath: string): string {
    return path.dirname(path.resolve(dirPath));
  }

  private isPreviewableTextFile(fileName: string): boolean {
    return PREVIEWABLE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) || PREVIEWABLE_NAMES.has(fileName);
  }

  private isMarkdownFile(fileName: string): boolean {
    return ['.md', '.mdx', '.markdown'].includes(path.extname(fileName).toLowerCase());
  }

  private getLanguage(fileName: string): string {
    const ext = path.extname(fileName).slice(1).toLowerCase();
    if (!ext) return 'text';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'yml') return 'yaml';
    return ext;
  }
}
