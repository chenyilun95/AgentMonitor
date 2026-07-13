import { describe, expect, it } from 'vitest';
import { resolveImageSource } from '../src/lib/imageSources';

describe('resolveImageSource', () => {
  it('keeps browser-loadable sources unchanged', () => {
    expect(resolveImageSource('/repo', 'https://example.com/image.png')).toBe('https://example.com/image.png');
    expect(resolveImageSource('/repo', 'data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });

  it('routes absolute and provider-prefixed local paths through the asset endpoint', () => {
    expect(resolveImageSource('/repo', '/tmp/generated image.png')).toBe(
      '/api/directories/asset?path=%2Ftmp%2Fgenerated%20image.png',
    );
    expect(resolveImageSource('/repo', 'file:///tmp/result.webp')).toBe(
      '/api/directories/asset?path=%2Ftmp%2Fresult.webp',
    );
    expect(resolveImageSource('/repo', 'sandbox:/tmp/result.png')).toBe(
      '/api/directories/asset?path=%2Ftmp%2Fresult.png',
    );
  });

  it('resolves relative paths against the agent workspace', () => {
    expect(resolveImageSource('/repo/worktree', 'artifacts/../output/chart.svg')).toBe(
      '/api/directories/asset?path=%2Frepo%2Fworktree%2Foutput%2Fchart.svg',
    );
  });
});
