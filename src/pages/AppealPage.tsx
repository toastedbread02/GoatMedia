import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AppealLinkDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Logo } from '../components/Logo.tsx';
import { Icon } from '../components/Icon.tsx';

const STATUS_TEXT: Record<AppealLinkDTO['status'], string> = {
  sent: 'Not sent yet',
  open: 'Waiting for a moderator',
  accepted: 'Accepted',
  declined: 'Declined',
};

/**
 * The page behind the link in a warning or suspension email. It has to work
 * without a session, because a suspended account cannot sign in.
 */
export function AppealPage() {
  const { token = '' } = useParams();
  useDocumentTitle('Appeal');

  const [appeal, setAppeal] = useState<AppealLinkDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [context, setContext] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api
      .get<AppealLinkDTO>(`/api/appeals/${encodeURIComponent(token)}`)
      .then((data) => setAppeal(data))
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'That link could not be read.'));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/api/appeals/${encodeURIComponent(token)}`, { message, context });
      setSent(true);
      setAppeal((current) => (current ? { ...current, status: 'open', submittedAt: Date.now() } : current));
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'That did not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  const body = () => {
    if (loadError) {
      return (
        <div className="empty-state">
          <Icon name="alert" size={24} />
          <h2>This link does not work</h2>
          <p>{loadError}</p>
          <Link className="btn btn--quiet" to="/">
            Go to GoatMedia
          </Link>
        </div>
      );
    }

    if (!appeal) {
      return (
        <div className="appeal-loading">
          <span className="sk sk--line" />
          <span className="sk sk--line" />
          <span className="sk sk--line" />
        </div>
      );
    }

    const decided = appeal.status === 'accepted' || appeal.status === 'declined';

    return (
      <>
        <dl className="appeal-facts">
          <div>
            <dt>Account</dt>
            <dd>@{appeal.username}</dd>
          </div>
          <div>
            <dt>What this is</dt>
            <dd>{appeal.kind === 'ban' ? 'Suspension' : 'Warning'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{STATUS_TEXT[appeal.status]}</dd>
          </div>
          {appeal.kind === 'warning' ? (
            <div>
              <dt>Warnings on record</dt>
              <dd>{appeal.warnings}</dd>
            </div>
          ) : null}
        </dl>

        <h2>The reason given</h2>
        <blockquote className="appeal-reason">{appeal.reason}</blockquote>

        {appeal.kind === 'ban' ? (
          <p>
            A suspension hides your posts and comments and blocks signing in. If this appeal is accepted, the account is
            restored along with the posts that were hidden.
          </p>
        ) : (
          <p>
            A warning stays on the account and counts towards a suspension. If this appeal is accepted, the warning is
            removed from that count.
          </p>
        )}

        {decided ? (
          <div className={`notice ${appeal.status === 'accepted' ? 'notice--ok' : 'notice--error'}`}>
            <Icon name={appeal.status === 'accepted' ? 'check' : 'alert'} size={18} />
            <p>
              {appeal.status === 'accepted'
                ? 'This appeal was accepted.'
                : 'This appeal was declined, so the decision stands.'}
              {appeal.decisionNote ? ` ${appeal.decisionNote}` : ''}
            </p>
          </div>
        ) : appeal.status === 'open' || sent ? (
          <div className="notice">
            <Icon name="clock" size={18} />
            <p>
              Your appeal is with a moderator. A person reads every one, so it can take a few days. You will get an
              email when there is a decision.
            </p>
          </div>
        ) : (
          <form className="form-stack appeal-form" onSubmit={submit}>
            <div className="field">
              <label className="field__label" htmlFor="appeal-message">
                What should the moderator know?
              </label>
              <textarea
                id="appeal-message"
                className="textarea"
                rows={6}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Be specific. If the filter flagged something that is not gore, say what is actually in the clip."
                required
                minLength={10}
                maxLength={2000}
              />
              <p className="field__hint">{message.length} of 2000 characters. At least 10.</p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="appeal-context">
                Anything else useful (optional)
              </label>
              <input
                id="appeal-context"
                className="input"
                value={context}
                onChange={(event) => setContext(event.target.value)}
                placeholder="For example: the clip is a goat in a red barn"
                maxLength={400}
              />
            </div>
            {sendError ? (
              <p className="field__error" role="alert">
                {sendError}
              </p>
            ) : null}
            <button type="submit" className="btn btn--primary" disabled={sending || message.trim().length < 10}>
              {sending ? <span className="btn__spinner" /> : null}
              Send appeal
            </button>
            <p className="field__hint">
              Appeals go to a moderator, not an automated system. Abusive appeals are not answered.
            </p>
          </form>
        )}
      </>
    );
  };

  return (
    <div className="doc-page">
      <header className="doc-top">
        <Logo />
        <Link className="btn btn--quiet btn--sm" to="/">
          GoatMedia
        </Link>
      </header>
      <main className="doc-main">
        <h1 className="page-title">Appeal a decision</h1>
        <p className="doc-meta">One appeal per decision. A person reads it.</p>
        <div className="prose">{body()}</div>
      </main>
      <footer className="doc-foot">
        <Link to="/guidelines">Community guidelines</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/contact">Contact the moderator</Link>
      </footer>
    </div>
  );
}
