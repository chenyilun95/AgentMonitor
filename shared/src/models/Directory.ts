export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
  extension?: string;
  isTextPreviewable?: boolean;
}

export interface DirListing {
  path: string;
  parent: string;
  entries: DirEntry[];
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
