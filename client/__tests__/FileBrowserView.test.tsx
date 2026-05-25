import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileBrowserView } from '../src/components/FileBrowserView';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('FileBrowserView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('loads a directory and previews markdown files', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/directories/file')) {
        return jsonResponse({
          path: '/repo/README.md',
          name: 'README.md',
          extension: '.md',
          size: 14,
          mtime: 1,
          content: '# Hello\n\nWorld\n\n![Diagram](docs/diagram.png)',
          truncated: false,
          language: 'markdown',
          isMarkdown: true,
        });
      }

      return jsonResponse({
        path: '/repo',
        parent: '/',
        entries: [
          { name: 'docs', path: '/repo/docs', isDirectory: true },
          { name: 'README.md', path: '/repo/README.md', isDirectory: false, size: 14, isTextPreviewable: true },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FileBrowserView rootPath="/repo" visible />);

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('README.md'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    });
    expect(screen.getByText('World')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Diagram' })).toHaveAttribute(
      'src',
      '/api/directories/asset?path=%2Frepo%2Fdocs%2Fdiagram.png',
    );

    fireEvent.click(screen.getByText('Raw'));
    expect(screen.getByText((_, element) => element?.textContent === '# Hello\n\nWorld\n\n![Diagram](docs/diagram.png)')).toBeInTheDocument();
  });

  it('shows read errors from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/directories/file')) {
          return jsonResponse({ error: 'File type is not previewable: image.png' }, false, 415);
        }
        return jsonResponse({
          path: '/repo',
          parent: '/',
          entries: [
            { name: 'image.png', path: '/repo/image.png', isDirectory: false, size: 4, isTextPreviewable: false },
          ],
        });
      }),
    );

    render(<FileBrowserView rootPath="/repo" visible />);

    await waitFor(() => {
      expect(screen.getByText('image.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('image.png'));

    await waitFor(() => {
      expect(screen.getByText('File type is not previewable: image.png')).toBeInTheDocument();
    });
  });
});
