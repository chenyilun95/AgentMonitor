import { describe, expect, it } from 'vitest';
import { extractImageAttachments } from '../src/utils/imageAttachments.js';

describe('extractImageAttachments', () => {
  it('extracts local paths, markdown images, and remote URLs without duplicates', () => {
    const attachments = extractImageAttachments(
      'Generated /tmp/output.png and ![preview](artifacts/chart.webp), see https://example.com/photo.jpg',
    );
    expect(attachments.map((attachment) => attachment.source)).toEqual([
      'artifacts/chart.webp',
      'https://example.com/photo.jpg',
      '/tmp/output.png',
    ]);
  });

  it('extracts Anthropic base64 image blocks', () => {
    expect(extractImageAttachments({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'YWJj' },
    })).toEqual([{
      type: 'image',
      source: 'data:image/png;base64,YWJj',
      name: 'image.png',
      mimeType: 'image/png',
    }]);
  });

  it('extracts MCP image result paths and image_url objects', () => {
    expect(extractImageAttachments({
      result: {
        content: [
          { type: 'image', path: '/repo/generated.webp' },
          { type: 'image_url', image_url: { url: 'https://example.com/generated.png' } },
        ],
      },
    }).map((attachment) => attachment.source)).toEqual([
      '/repo/generated.webp',
      'https://example.com/generated.png',
    ]);
  });
});
