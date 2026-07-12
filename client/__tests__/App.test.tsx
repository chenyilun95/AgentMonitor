import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { App } from '../src/App';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
      })),
    );

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Agent Monitor')).toBeInTheDocument();
    });

    expect(screen.getByText(/Dashboard|代理面板/)).toBeInTheDocument();
    expect(screen.getByText(/Templates|模板/)).toBeInTheDocument();
    expect(screen.getByText(/Skills|技能/)).toBeInTheDocument();
  });
});
