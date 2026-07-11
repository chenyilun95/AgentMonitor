import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { CreateAgent } from './pages/CreateAgent';
import { AgentChat } from './pages/AgentChat';
import { Templates } from './pages/Templates';
import { Pipeline } from './pages/Pipeline';
import { GpuMonitor } from './pages/GpuMonitor';
import { Login } from './pages/Login';
import { useAuth } from './hooks/useAuth';
import { LanguageProvider, useTranslation } from './i18n';

function NavBar({ onLogout }: { onLogout?: () => void }) {
  const location = useLocation();
  const { t } = useTranslation();
  const [theme, setTheme] = useState(() => localStorage.getItem('agentmonitor-theme') || 'dark');

  return (
    <nav className="nav">
      <Link to="/" className="nav-brand">{t('nav.brand')}</Link>
      <div className="nav-links">
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
          {t('nav.dashboard')}
        </Link>
        <Link to="/servers" className={location.pathname === '/servers' ? 'active' : ''}>
          {t('nav.servers')}
        </Link>
        <Link to="/pipeline" className={location.pathname === '/pipeline' ? 'active' : ''}>
          {t('nav.pipeline')}
        </Link>
        <Link to="/templates" className={location.pathname === '/templates' ? 'active' : ''}>
          {t('nav.templates')}
        </Link>
      </div>
      <button
        className="nav-control"
        onClick={() => {
          const next = theme === 'light' ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', next);
          localStorage.setItem('agentmonitor-theme', next);
          setTheme(next);
        }}
        title={t('nav.theme')}
      >
        {theme === 'light' ? '\u263D' : '\u2600'}
      </button>
      {onLogout && (
        <button
          className="nav-control"
          onClick={onLogout}
          title="Logout"
        >
          Logout
        </button>
      )}
    </nav>
  );
}

function AuthenticatedApp() {
  const { authenticated, loading, logout } = useAuth();

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text, #e2e8f0)' }}>Loading...</div>;
  }

  if (!authenticated) {
    return null; // useAuth will redirect to /login
  }

  return (
    <div className="app">
      <NavBar onLogout={logout} />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/servers" element={<GpuMonitor />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/create" element={<CreateAgent />} />
          <Route path="/agent/:id" element={<AgentChat />} />
          <Route path="/templates" element={<Templates />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('agentmonitor-theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    const savedScheme = localStorage.getItem('agentmonitor-scheme');
    if (savedScheme && savedScheme !== 'default') {
      document.documentElement.setAttribute('data-scheme', savedScheme);
    }
  }, []);

  return (
    <LanguageProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </LanguageProvider>
  );
}
