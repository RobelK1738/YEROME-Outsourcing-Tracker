// Single login screen offering YEROME (email) or Owner (username) sign-in.
// There is intentionally NO signup / create-account option.

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Field, TextInput } from '../components/ui/Field.jsx';
import { Loading } from '../components/ui/Loading.jsx';
import { Logo } from '../components/ui/Logo.jsx';
import { APP_NAME } from '../lib/constants.js';

export default function LoginPage() {
  const { isAuthenticated, role, loading, configured, adminLogin, ownerLogin } = useAuth();
  const [mode, setMode] = useState('owner');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading full />;
  if (isAuthenticated) return <Navigate to={role === 'admin' ? '/admin' : '/owner'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'admin') {
        await adminLogin(email.trim(), password);
      } else {
        await ownerLogin(username.trim(), password);
      }
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <Logo size={34} className="login-brand__logo" />
          <span className="login-brand__name">{APP_NAME}</span>
        </div>
        <p className="login-sub">Sign in to your account.</p>

        {!configured ? (
          <div className="form-error">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your environment.
          </div>
        ) : null}

        <div className="login-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'owner'}
            className={`login-tab ${mode === 'owner' ? 'login-tab--active' : ''}`}
            onClick={() => {
              setMode('owner');
              setError('');
            }}
          >
            Owner
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'admin'}
            className={`login-tab ${mode === 'admin' ? 'login-tab--active' : ''}`}
            onClick={() => {
              setMode('admin');
              setError('');
            }}
          >
            YEROME
          </button>
        </div>

        {error ? <div className="form-error">{error}</div> : null}

        <form onSubmit={submit}>
          {mode === 'admin' ? (
            <Field label="Email" htmlFor="admin-email" required>
              <TextInput
                id="admin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </Field>
          ) : (
            <Field label="Username" htmlFor="owner-username" required>
              <TextInput
                id="owner-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your-username"
                required
              />
            </Field>
          )}

          <Field label="Password" htmlFor="password" required>
            <TextInput
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="login-note">
          Access is provisioned by YEROME. There is no public sign-up.
        </p>
      </div>
    </div>
  );
}
