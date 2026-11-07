import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CONTACT_CATEGORIES } from '../../shared/policy.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Icon } from '../components/Icon.tsx';

function summarizeDevice(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'a browser';
  const width = window.innerWidth;
  const height = window.innerHeight;
  const kind = navigator.maxTouchPoints > 1 ? (width < 760 ? 'phone' : 'tablet') : 'desktop';
  return `${browser} on ${platform} · ${kind} · ${width}×${height}`;
}

export function ContactPage() {
  useDocumentTitle('Contact the moderator');
  const { user } = useAuth();
  const [params] = useSearchParams();
  const requested = params.get('topic');
  const initialCategory =
    CONTACT_CATEGORIES.find((category) => category.id === requested)?.id ??
    (params.get('username') ? 'person' : 'problem');

  const [category, setCategory] = useState(initialCategory);
  const [email, setEmail] = useState(user?.email ?? '');
  const [targetUsername, setTargetUsername] = useState(params.get('username') ?? '');
  const [body, setBody] = useState('');
  const [device, setDevice] = useState(summarizeDevice);
  const [pageUrl, setPageUrl] = useState(
    typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`,
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) setEmail((current) => current || user.email);
  }, [user?.email]);

  const selected = useMemo(
    () => CONTACT_CATEGORIES.find((entry) => entry.id === category) ?? CONTACT_CATEGORIES[0],
    [category],
  );
  const needsUsername = category === 'person';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const data = await api.post<{ id: string }>('/api/contact', {
        category,
        email,
        targetUsername: targetUsername.replace(/^@/, '').trim() || null,
        body,
        device,
        pageUrl: pageUrl.trim() || null,
      });
      setSentId(data.id);
      setBody('');
      setTargetUsername('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The message did not send.');
    } finally {
      setSending(false);
    }
  };

  if (sentId) {
    return (
      <div className="page contact-page">
        <div className="contact-sent" role="status">
          <span className="contact-sent__icon">
            <Icon name="check" size={22} />
          </span>
          <h1>Message sent</h1>
          <p>
            A moderator has been notified and will look at this by hand. If you gave an email address, that is where a
            reply will go.
          </p>
          <p className="contact-sent__ref">
            Reference <strong>{sentId}</strong>
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn--quiet" onClick={() => setSentId(null)}>
              Send another message
            </button>
            <Link className="btn btn--primary" to="/">
              Back to the goats
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page contact-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Contact the moderator</h1>
          <p className="page-sub">
            Report a problem, report an account, or ask for help getting back into your account. A person reviews every
            message.
          </p>
        </div>
      </div>

      <div className="contact-layout">
        <form className="form-stack contact-form" onSubmit={submit}>
          <div className="field">
            <label className="field__label" htmlFor="contact-category">
              What is this about?
            </label>
            <select
              id="contact-category"
              className="select"
              value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}
            >
              {CONTACT_CATEGORIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <p className="field__hint">{selected.hint}</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="contact-email">
              Email for a reply
            </label>
            <input
              id="contact-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <p className="field__hint">Only the moderator sees this. It is never added to a public profile.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="contact-username">
              {needsUsername ? 'Account you are reporting' : 'Account this is about'}
            </label>
            <input
              id="contact-username"
              className="input"
              value={targetUsername}
              onChange={(event) => setTargetUsername(event.target.value)}
              placeholder={needsUsername ? '@username' : '@username, if it is relevant'}
              required={needsUsername}
              autoCapitalize="none"
              spellCheck={false}
            />
            <p className="field__hint">
              {needsUsername
                ? 'Required so the moderator knows which account to look at.'
                : 'Optional. Leave it blank if this is about the site itself.'}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="contact-body">
              What happened?
            </label>
            <textarea
              id="contact-body"
              className="textarea contact-form__message"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What were you trying to do, what went wrong, and what have you already tried?"
              minLength={10}
              maxLength={2000}
              required
            />
            <p className="field__hint">
              {body.length}/2000 · Details help. Please do not include anyone’s private address or phone number.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="contact-device">
              Device and browser
            </label>
            <input
              id="contact-device"
              className="input"
              value={device}
              onChange={(event) => setDevice(event.target.value)}
              required
            />
            <p className="field__hint">
              Filled in from this browser. Add the phone or computer model if you know it.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="contact-page">
              Page where it happened
            </label>
            <input
              id="contact-page"
              className="input"
              value={pageUrl}
              onChange={(event) => setPageUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>

          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={sending || body.trim().length < 10 || !email.trim() || device.trim().length < 3}
            >
              {sending ? <span className="btn__spinner" /> : null}
              Send to the moderator
            </button>
          </div>
          <p className="field__hint">
            Reports about animal mistreatment are reviewed first. You can also read the{' '}
            <Link className="textlink" to="/guidelines">
              community guidelines
            </Link>
            .
          </p>
        </form>

        <aside className="contact-aside">
          <h2>What happens next</h2>
          <p>Your message creates a private request in the moderator’s report center.</p>
          <p>
            For account problems, say which username or email the account used and what happens when you try to sign
            in. Do not send your password.
          </p>
          <p>
            For a person or a post, include the username and, if you can, the page link. The person you report is not
            told who reported them.
          </p>
          <p className="section-note">
            GoatMedia is moderated by hand. There is no automated approval or bot reply.
          </p>
        </aside>
      </div>
    </div>
  );
}
