import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { withAppBasePath } from '../lib/basePath';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  logout: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(withAppBasePath('/api/auth/check'), { credentials: 'include' })
      .then(res => {
        if (res.ok) {
          setAuthenticated(true);
          return;
        }

        // Local server mode has no auth routes; treat 404 as auth disabled.
        if (res.status === 404) {
          setAuthenticated(true);
          return;
        }

        if (res.status === 401) {
          setAuthenticated(false);
          navigate('/login');
          return;
        }

        // Any other non-OK status (e.g. 500) — default deny.
        setAuthenticated(false);
        navigate('/login');
      })
      .catch(() => {
        // If check endpoint doesn't exist (local mode), assume authenticated
        setAuthenticated(true);
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  const logout = useCallback(async () => {
    await fetch(withAppBasePath('/api/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {});
    setAuthenticated(false);
    navigate('/login');
  }, [navigate]);

  return { authenticated, loading, logout };
}
