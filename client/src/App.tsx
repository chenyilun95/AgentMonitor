import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Login } from './pages/Login';
import { useAuth } from './hooks/useAuth';
import { LanguageProvider, useTranslation } from './i18n';
import { api } from './api/client';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: '#e55', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <h3 style={{ margin: '0 0 1rem' }}>Page Error</h3>
          <p>{this.state.error.message}</p>
          <pre style={{ fontSize: 11, opacity: 0.7, maxHeight: '50vh', overflow: 'auto' }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: '1rem', padding: '8px 16px' }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const CreateAgent = lazy(() => import('./pages/CreateAgent').then(module => ({ default: module.CreateAgent })));
const AgentChat = lazy(() => import('./pages/AgentChat').then(module => ({ default: module.AgentChat })));
const Templates = lazy(() => import('./pages/Templates').then(module => ({ default: module.Templates })));
const Skills = lazy(() => import('./pages/Skills').then(module => ({ default: module.Skills })));
const Pipeline = lazy(() => import('./pages/Pipeline').then(module => ({ default: module.Pipeline })));
const GpuMonitor = lazy(() => import('./pages/GpuMonitor').then(module => ({ default: module.GpuMonitor })));
const DirectoryBrowser = lazy(() => import('./pages/DirectoryBrowser').then(module => ({ default: module.DirectoryBrowser })));
const Wiki = lazy(() => import('./pages/Wiki').then(module => ({ default: module.Wiki })));

function NavBar({ onLogout }: { onLogout?: () => void }) {
  const location = useLocation();
  const { t } = useTranslation();
  const [theme, setTheme] = useState(() => localStorage.getItem('agentmonitor-theme') || 'light');
  const [wikiInput, setWikiInput] = useState('');
  const [wikiCreating, setWikiCreating] = useState(false);
  const [wikiDir, setWikiDir] = useState<string | null>(null);

  useEffect(() => {
    api.getWikiConfig().then(c => { if (c.exists) setWikiDir(c.wikiDirectory); }).catch(() => {});
  }, []);

  const handleWikiAdd = async () => {
    const source = wikiInput.trim();
    if (!source || !wikiDir) return;
    setWikiCreating(true);
    try {
      const slug = source.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      await api.createAgent({
        name: `wiki-${slug || 'source'}`,
        directory: wikiDir,
        prompt: source,
        workspaceMode: 'direct' as const,
        labels: { type: 'wiki', source },
      });
      setWikiInput('');
    } catch (err) {
      console.error('Failed to create wiki agent:', err);
    } finally {
      setWikiCreating(false);
    }
  };

  return (
    <nav className="nav">
      <Link to="/" className="nav-brand">{t('nav.brand')}</Link>
      <div className="nav-links">
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
          {t('nav.dashboard')}
        </Link>
        <Link to="/pipeline" className={location.pathname === '/pipeline' ? 'active' : ''}>
          {t('nav.pipeline')}
        </Link>
        <Link to="/templates" className={location.pathname === '/templates' ? 'active' : ''}>
          {t('nav.templates')}
        </Link>
        <Link to="/skills" className={location.pathname === '/skills' ? 'active' : ''}>
          {t('nav.skills')}
        </Link>
        <Link to="/wiki" className={location.pathname === '/wiki' ? 'active' : ''}>
          {t('nav.wiki')}
        </Link>
        <Link to="/servers" className={location.pathname === '/servers' ? 'active' : ''}>
          {t('nav.servers')}
        </Link>
      </div>
      {wikiDir && (
        <div className="nav-wiki-search">
          <input
            value={wikiInput}
            onChange={e => setWikiInput(e.target.value)}
            placeholder={t('wiki.sourcePlaceholder')}
            onKeyDown={e => { if (e.key === 'Enter' && wikiInput.trim()) handleWikiAdd(); }}
            disabled={wikiCreating}
          />
          <button className="btn btn-sm" onClick={handleWikiAdd} disabled={!wikiInput.trim() || wikiCreating}>
            {wikiCreating ? '...' : '+'}
          </button>
        </div>
      )}
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
        {theme === 'light' ? '☽' : '☀'}
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
        <ErrorBoundary>
          <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/servers" element={<GpuMonitor />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/create" element={<CreateAgent />} />
              <Route path="/agent/:id" element={<AgentChat />} />
              <Route path="/browse" element={<DirectoryBrowser />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/wiki" element={<Wiki />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
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
