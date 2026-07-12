import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toggleTheme } from '../../src/lib/theme';

describe('toggleTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('toggles from dark to light', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('agentmonitor-theme')).toBe('light');
  });

  it('toggles from light to dark', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('agentmonitor-theme')).toBe('dark');
  });

  it('defaults to dark when no theme is set', () => {
    toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
