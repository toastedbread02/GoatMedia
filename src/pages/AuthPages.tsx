import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfig } from '../lib/config';
import { useToast } from '../lib/toast';

function AuthShell({
  title,
  blurb,
  children,
  footer,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth">
      <div className="auth__card">
        <h1 className="auth__title">{title}</h1>
        <p className="auth__blurb">{blurb}</p>
        {children}
        {footer ? <div className="auth__footer">{footer}</div> : null}
      </div>
      <aside className="auth__aside">
        <h2 className="aside-title">Every goat gets watched</h2>
        <p className="aside-text">
          Posts wait in a review queue until a human has looked at them. It keeps the feed honest
          and the animals safe, at the cost of a little patience.
        </p>
        <ul className="checklist">
          <li>Nothing is published automatically.</li>
          <li>Pending posts stay private.</li>
          <li>Rejections come with a reason.</li>
        </ul>
      </aside>
    </div>
  );
}

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthShell
      title="Sign in"
      blurb="Back to the goats."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="inline-link">
            Create an account
          </Link>
        </>
      }
    >
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await signIn(identifier, password);
            toast('Signed in', 'success');
            navigate('/');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field__label">Email or username</span>
          <input
            className="input"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button button--wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <Link to="/forgot" className="text-link text-link--button">
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { signUp } = useAuth();
  const config = useConfig();
  const navigate = useNavigate();
  const toast = useToast();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usernameOk = /^[a-z0-9_]{3,20}$/.test(username);

  return (
    <AuthShell
      title="Create an account"
      blurb="Post goats, follow the ones you like, and borrow their sounds."
      footer={
        <>
          Already have one?{' '}
          <Link to="/signin" className="inline-link">
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await signUp({ email, username, displayName, password });
            toast('Account created', 'success');
            navigate('/');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="input"
            autoComplete="name"
            value={displayName}
            maxLength={40}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
          <span className="field__hint">Shown on your posts and profile.</span>
        </label>
        <label className="field">
          <span className="field__label">Username</span>
          <input
            className="input"
            autoComplete="username"
            value={username}
            maxLength={20}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            required
            aria-describedby="username-hint"
          />
          <span className="field__hint" id="username-hint">
            {username && !usernameOk
              ? 'Use 3–20 lowercase letters, numbers or underscores.'
              : `Your profile will be at /u/${username || 'yourname'}`}
          </span>
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <span className="field__hint">Only used for sign-in and moderation questions.</span>
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={10}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <span className="field__hint">At least 10 characters. Longer is better.</span>
        </label>
        <p className="fine-print">
          By creating an account you agree to the{' '}
          <Link to="/terms" className="inline-link">
            terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="inline-link">
            privacy note
          </Link>
          . Posts must follow the{' '}
          <Link to="/guidelines" className="inline-link">
            guidelines
          </Link>
          . We collect the minimum: {config.limits.maxCaptionLength}-character captions and a
          username.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button button--wide" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [resetPath, setResetPath] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const link = resetPath ? `${window.location.origin}${window.location.pathname}#${resetPath}` : '';

  return (
    <AuthShell
      title="Recover your account"
      blurb="Enter the email you signed up with and we will prepare a reset link."
      footer={
        <Link to="/signin" className="inline-link">
          Back to sign in
        </Link>
      }
    >
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const result = await api.requestReset(email);
            setResetPath(result.resetPath);
            setSent(true);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button button--wide" disabled={busy}>
          {busy ? 'Checking…' : 'Get a reset link'}
        </button>
      </form>

      {sent ? (
        <div className="notice notice--info">
          <Icon name="link" size={18} />
          <div>
            <p>If that email has an account, this link resets it. It expires in 30 minutes.</p>
            {link ? (
              <p className="reset-link">
                <a href={link}>{link}</a>
              </p>
            ) : (
              <p className="muted">No account matched that address.</p>
            )}
            <p className="hint">
              This deployment has no mail provider connected, so the link is shown here instead of
              being emailed.
            </p>
          </div>
        </div>
      ) : null}
    </AuthShell>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = params.get('token') || '';

  return (
    <AuthShell title="Choose a new password" blurb="You will be signed out everywhere else.">
      {token ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.resetPassword(token, password);
              toast('Password changed. Sign in with it.', 'success');
              navigate('/signin');
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span className="field__label">New password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <span className="field__hint">At least 10 characters.</span>
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="button button--wide" disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      ) : (
        <div className="empty empty--small">
          <p className="empty__title">This link is incomplete</p>
          <p>Request a fresh one from the recovery page.</p>
          <Link to="/forgot" className="button">
            Recover account
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
