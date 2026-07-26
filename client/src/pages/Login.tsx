import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { withAppBasePath } from '../lib/basePath';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(withAppBasePath('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        navigate('/');
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-card">
        <h2 className="login-title">Agent Monitor</h2>
        <p className="login-subtitle">Sign in to continue</p>
        <input
          type="password"
          className="login-input"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Enter password"
          autoFocus
        />
        {error && (
          <div className="login-error">{error}</div>
        )}
        <button
          type="submit"
          className="login-btn"
          disabled={loading || !password}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
