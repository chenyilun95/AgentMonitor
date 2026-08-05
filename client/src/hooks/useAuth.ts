import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();

  useEffect(() => {
    const returnTo = location.pathname + location.search;
    const loginTarget = returnTo && returnTo !== '/'
      ? `/login?returnTo=${encodeURIComponent(returnTo)}`
      : '/login';

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
          navigate(loginTarget);
          return;
        }

        // Any other non-OK status (e.g. 500) — default deny.
        setAuthenticated(false);
        navigate(loginTarget);
      })
      .catch(() => {
        // If check endpoint doesn't exist (local mode), assume authenticated
        setAuthenticated(true);
      })
      .finally(() => setLoading(false));
  }, [navigate, location.pathname, location.search]);

  const logout = useCallback(async () => {
    await fetch(withAppBasePath('/api/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {});
    setAuthenticated(false);
    navigate('/login');
  }, [navigate]);

  return { authenticated, loading, logout };
}
