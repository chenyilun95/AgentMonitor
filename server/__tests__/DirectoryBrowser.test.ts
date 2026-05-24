import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DirectoryBrowser } from '../src/services/DirectoryBrowser.js';

describe('DirectoryBrowser', () => {
  let tmpDir: string;
  let browser: DirectoryBrowser;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dirbrowser-test-'));
    browser = new DirectoryBrowser();

    // Create test structure
    fs.mkdirSync(path.join(tmpDir, 'subdir1'));
    fs.mkdirSync(path.join(tmpDir, 'subdir2'));
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'file2.js'), 'world');
    fs.writeFileSync(path.join(tmpDir, 'notes.md'), '# Notes\n\nhello');
    fs.writeFileSync(path.join(tmpDir, 'image.png'), Buffer.from([0, 1, 2, 3]));
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists directory contents', () => {
    const entries = browser.listDirectory(tmpDir);
    // Should not include hidden directories
    const names = entries.map((e) => e.name);
    expect(names).toContain('subdir1');
    expect(names).toContain('subdir2');
    expect(names).toContain('file1.txt');
    expect(names).not.toContain('.hidden');
  });

  it('directories come before files', () => {
    const entries = browser.listDirectory(tmpDir);
    const firstFile = entries.findIndex((e) => !e.isDirectory);
    const lastDir = entries.findLastIndex((e) => e.isDirectory);
    if (firstFile !== -1 && lastDir !== -1) {
      expect(lastDir).toBeLessThan(firstFile);
    }
  });

  it('throws for nonexistent directory', () => {
    expect(() => browser.listDirectory('/nonexistent/path')).toThrow();
  });

  it('returns parent directory', () => {
    const parent = browser.getParent(tmpDir);
    expect(parent).toBe(path.dirname(tmpDir));
  });

  it('marks previewable text files in listings', () => {
    const entries = browser.listDirectory(tmpDir);
    expect(entries.find((e) => e.name === 'notes.md')?.isTextPreviewable).toBe(true);
    expect(entries.find((e) => e.name === 'image.png')?.isTextPreviewable).toBe(false);
  });

  it('reads markdown file previews', () => {
    const preview = browser.readTextFile(path.join(tmpDir, 'notes.md'));
    expect(preview.name).toBe('notes.md');
    expect(preview.content).toContain('# Notes');
    expect(preview.isMarkdown).toBe(true);
    expect(preview.language).toBe('markdown');
    expect(preview.truncated).toBe(false);
  });

  it('truncates large text file previews', () => {
    const preview = browser.readTextFile(path.join(tmpDir, 'file1.txt'), { maxBytes: 2 });
    expect(preview.content).toBe('he');
    expect(preview.truncated).toBe(true);
  });

  it('rejects directories and unsupported files', () => {
    expect(() => browser.readTextFile(path.join(tmpDir, 'subdir1'))).toThrow(/Not a file/);
    expect(() => browser.readTextFile(path.join(tmpDir, 'image.png'))).toThrow(/not previewable/);
  });
});
