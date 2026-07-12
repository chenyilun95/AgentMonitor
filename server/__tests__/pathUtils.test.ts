import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { expandHomePath, normalizeUserPath, portableUserPath } from '../src/utils/pathUtils.js';

describe('pathUtils', () => {
  it('expands a bare home marker', () => {
    expect(expandHomePath('~')).toBe(os.homedir());
  });

  it('expands home-relative paths', () => {
    expect(normalizeUserPath('~/rep')).toBe(path.join(os.homedir(), 'rep'));
  });

  it('trims and resolves relative paths', () => {
    expect(normalizeUserPath(' ./server ')).toBe(path.resolve('server'));
  });

  it('keeps blank paths blank', () => {
    expect(normalizeUserPath('   ')).toBe('');
  });

  it('does not expand usernames that only start with tilde', () => {
    expect(normalizeUserPath('~other/project')).toBe(path.resolve('~other/project'));
  });

  it('stores paths below home with a tilde', () => {
    const absolute = path.join(os.homedir(), 'rep', 'project');
    expect(portableUserPath(absolute)).toBe('~/rep/project');
    expect(portableUserPath(os.homedir())).toBe('~');
  });

  it('keeps paths outside home absolute', () => {
    const outside = path.resolve(os.tmpdir(), 'portable-path-test');
    expect(portableUserPath(outside)).toBe(outside);
  });
});
