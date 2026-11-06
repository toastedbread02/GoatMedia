import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { MeDTO } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Logo } from '../components/Logo.tsx';
import { Icon } from '../components/Icon.tsx';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <Logo />
      <div className="auth-card">
        <h1>{title}</h1>
        <p className="auth-sub">{subtitle}</p>
        {children}
      </div>
      <p className="auth-alt">
        GoatMedia is a small, human-run video community. Every video is reviewed before it goes live.
      </p>
    </div>
  );
}

function fieldError(fields: Record<string, string> | undefined, name: string) {
  return fields?.[name];
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. The goats have been busy.">
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          try {
            const data = await api.post<{ user: MeDTO }>('/api/auth/login', { identifier, password });
            setUser(data.user);
            navigate(destination, { replace: true });
          } catch (loginError) {
            setError(loginError instanceof Error ? loginError.message : 'Could not sign in.');
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="identifier">
            Email or username
          </label>
          <input
            id="identifier"
            className="input"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {error ? <p className="field__error">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={pending}>
          {pending ? <span className="btn__spinner" /> : null}
          Sign in
        </button>
      </form>
      <p className="auth-foot">
        <Link className="textlink" to="/forgot-password">
          Forgot your password?
        </Link>
        <span aria-hidden="true">·</span>
        <Link className="textlink" to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}

export function SignupPage() {
  useDocumentTitle('Create an account');
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AuthLayout title="Join GoatMedia" subtitle="An account takes a minute. A good username takes two.">
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          setFields({});
          try {
            const data = await api.post<{ user: MeDTO }>('/api/auth/register', {
              displayName,
              username,
              email,
              password,
            });
            setUser(data.user);
            const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
            navigate(destination, { replace: true });
          } catch (signupError) {
            if (signupError instanceof ApiError) {
              setFields(signupError.fields ?? {});
              setError(signupError.fields ? null : signupError.message);
            } else {
              setError('Could not create the account.');
            }
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="displayName">
            Display name
          </label>
          <input
            id="displayName"
            className="input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={40}
            required
            autoFocus
            autoComplete="name"
          />
          {fieldError(fields, 'displayName') ? <span className="field__error">{fields.displayName}</span> : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            maxLength={20}
            required
            autoComplete="username"
            aria-describedby="username-hint"
            aria-invalid={Boolean(fieldError(fields, 'username'))}
            placeholder="goatperson"
          />
          <span className="field__hint" id="username-hint">
            Letters, numbers and underscores. 3–20 characters.
          </span>
          {fieldError(fields, 'username') ? <span className="field__error">{fields.username}</span> : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            aria-invalid={Boolean(fieldError(fields, 'email'))}
          />
          <span className="field__hint">Used for sign-in and account recovery. Never shown publicly.</span>
          {fieldError(fields, 'email') ? <span className="field__error">{fields.email}</span> : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            aria-describedby="password-hint"
            aria-invalid={Boolean(fieldError(fields, 'password'))}
          />
          <span className="field__hint" id="password-hint">
            At least 8 characters.
          </span>
          {fieldError(fields, 'password') ? <span className="field__error">{fields.password}</span> : null}
        </div>
        {error ? <p className="field__error">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={pending}>
          {pending ? <span className="btn__spinner" /> : null}
          Create account
        </button>
        <p className="field__hint">
          By joining you agree to the{' '}
          <Link className="textlink" to="/guidelines">
            community guidelines
          </Link>{' '}
          and{' '}
          <Link className="textlink" to="/terms">
            terms
          </Link>
          .
        </p>
      </form>
      <p className="auth-foot">
        <span>Already have an account?</span>
        <Link className="textlink" to="/login">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  useDocumentTitle('Reset password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AuthLayout title="Reset your password" subtitle="We will send a link to the email on your account.">
      {sent ? (
        <div className="form-stack">
          <p className="auth-note">{sent}</p>
          {resetUrl ? (
            <div className="field">
              <span className="field__hint">
                Development mode: no email service is configured, so the reset link is shown here.
              </span>
              <Link className="btn btn--primary" to={resetUrl.replace(window.location.origin, '')}>
                Open reset link
              </Link>
            </div>
          ) : null}
          <Link className="btn btn--quiet" to="/login">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            try {
              const data = await api.post<{ ok: boolean; resetUrl?: string }>('/api/auth/password/request', { email });
              setSent('If that address belongs to an account, a reset link is on its way.');
              setResetUrl(data.resetUrl ?? null);
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : 'Could not request a reset.');
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor="reset-email">
              Email
            </label>
            <input
              id="reset-email"
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
              autoComplete="email"
            />
          </div>
          {error ? <p className="field__error">{error}</p> : null}
          <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
            {pending ? <span className="btn__spinner" /> : null}
            Send reset link
          </button>
          <Link className="textlink" to="/login">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthLayout title="Link incomplete" subtitle="This reset link is missing its token.">
        <Link className="btn btn--primary" to="/forgot-password">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You will be signed in once it is saved.">
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (password !== confirm) {
            setError('The two passwords do not match.');
            return;
          }
          setPending(true);
          setError(null);
          try {
            const data = await api.post<{ user: MeDTO }>('/api/auth/password/reset', { token, password });
            setUser(data.user);
            navigate('/', { replace: true });
          } catch (resetError) {
            setError(resetError instanceof Error ? resetError.message : 'Could not reset the password.');
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
            autoFocus
            autoComplete="new-password"
          />
          <span className="field__hint">At least 8 characters.</span>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="confirm-password">
            Confirm password
          </label>
          <input
            id="confirm-password"
            className="input"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        {error ? <p className="field__error">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
          {pending ? <span className="btn__spinner" /> : null}
          Save password
        </button>
      </form>
    </AuthLayout>
  );
}

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="page">
      <div className="empty-state" style={{ paddingTop: 60 }}>
        <Icon name="alert" size={26} />
        <h2>This page wandered off</h2>
        <p>The link may be old, or the video may have been removed.</p>
        <div className="empty-state__actions">
          <Link className="btn btn--primary" to="/">
            Back to the feed
          </Link>
          <Link className="btn btn--quiet" to="/trending">
            See what is trending
          </Link>
        </div>
      </div>
    </div>
  );
}
