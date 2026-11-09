import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  DmInboxDTO,
  DmMessageDTO,
  DmThreadViewDTO,
} from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useToast } from '../lib/toast.tsx';
import { timeAgo } from '../lib/format.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';

/**
 * One-to-one messages. The list and the conversation are two columns on a wide
 * screen and one column on a phone, where picking a thread swaps the view.
 */
export function MessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [inbox, setInbox] = useState<DmInboxDTO | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<DmThreadViewDTO | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useDocumentTitle('Messages');

  const refreshInbox = useCallback(async () => {
    try {
      const data = await api.get<DmInboxDTO>('/api/dm/threads');
      setInbox(data);
      setError(null);
      return data;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Messages could not load.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshInbox();
  }, [user, refreshInbox]);

  // ?to=someone is how a profile hands off to a conversation, creating it the
  // first time and reusing it after that.
  useEffect(() => {
    const to = params.get('to');
    if (!to || !user) return;
    let cancelled = false;
    api
      .post<{ id: string }>('/api/dm/threads', { username: to })
      .then((data) => {
        if (cancelled) return;
        setSelected(data.id);
        setParams({}, { replace: true });
        void refreshInbox();
      })
      .catch((openError) => {
        if (!cancelled) {
          setError(
            openError instanceof Error ? openError.message : 'That conversation could not be opened.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params, user, refreshInbox, setParams]);

  // The newest conversation opens on its own, so the page is never a blank
  // split waiting for a click.
  useEffect(() => {
    if (selected) return;
    const first = inbox?.threads[0];
    if (first) setSelected(first.id);
  }, [inbox, selected]);

  const loadThread = useCallback(async (id: string) => {
    try {
      const data = await api.get<DmThreadViewDTO>(`/api/dm/threads/${id}`);
      setView(data);
      setError(null);
    } catch (loadError) {
      setView(null);
      setError(loadError instanceof Error ? loadError.message : 'That conversation could not load.');
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setView(null);
      return;
    }
    setView((current) => (current?.thread.id === selected ? current : null));
    void loadThread(selected);
  }, [selected, loadThread]);

  // A conversation is only worth polling while it is open and the tab is
  // visible; a hidden tab does not ask for anything.
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void refreshInbox();
      if (selected) void loadThread(selected);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [user, selected, refreshInbox, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [view?.messages.length, selected]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    try {
      const data = await api.post<{ message: DmMessageDTO }>(
        `/api/dm/threads/${selected}/messages`,
        { body: text },
      );
      setBody('');
      setView((current) =>
        current && current.thread.id === selected
          ? {
              ...current,
              messages: [...current.messages, data.message],
              thread: {
                ...current.thread,
                lastAt: data.message.createdAt,
                lastBody: text,
                lastFromMe: true,
              },
            }
          : current,
      );
      void refreshInbox();
    } catch (sendError) {
      toast.notify(sendError instanceof Error ? sendError.message : 'That message did not send.', {
        tone: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  if (authLoading) {
    return (
      <div className="page">
        <div className="feed-empty" role="status" aria-label="Loading messages">
          <div className="spinner spinner--dark" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="empty-state">
          <Icon name="comment" size={24} />
          <h2>Messages are private</h2>
          <p>Sign in to talk to a creator one to one.</p>
          <div className="empty-state__actions">
            <Link className="btn btn--primary btn--sm" to="/login?next=%2Fmessages">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const threads = inbox?.threads ?? [];

  return (
    <div className="page page--messages">
      <div className="page-head">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-sub">
            Private notes between two people. Reports and moderation stay out of here.
          </p>
        </div>
      </div>

      {error ? <p className="section-note">{error}</p> : null}

      <div className={`messages${selected ? ' has-selection' : ''}`}>
        <aside className="messages__list" aria-label="Conversations">
          {inbox === null ? (
            <p className="section-note" role="status">
              Loading…
            </p>
          ) : threads.length === 0 ? (
            <div className="messages__empty">
              <p>No conversations yet.</p>
              <p className="field__hint">
                Open a creator’s profile and choose Message to start one.
              </p>
            </div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`thread${thread.id === selected ? ' is-active' : ''}`}
                onClick={() => setSelected(thread.id)}
                aria-pressed={thread.id === selected}
              >
                <Avatar
                  displayName={thread.user.displayName}
                  username={thread.user.username}
                  avatarUrl={thread.user.avatarUrl}
                  size={38}
                />
                <span className="thread__text">
                  <span className="thread__top">
                    <span className="thread__name">{thread.user.displayName}</span>
                    <span className="thread__time">{timeAgo(thread.lastAt)}</span>
                  </span>
                  <span className="thread__preview">
                    <span className="thread__snippet">
                      {thread.lastFromMe ? 'You: ' : ''}
                      {thread.lastBody || 'Say hello'}
                    </span>
                    {thread.unread > 0 ? (
                      <span className="thread__unread" aria-label={`${thread.unread} unread`}>
                        {thread.unread}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))
          )}
        </aside>

        <section className="conversation" aria-label="Conversation">
          {!selected || !view ? (
            <div className="conversation__placeholder">
              <Icon name="comment" size={24} />
              <p>Pick a conversation, or start one from a profile.</p>
            </div>
          ) : (
            <>
              <header className="conversation__head">
                <Link to={`/u/${view.thread.user.username}`} className="conversation__who">
                  <Avatar
                    displayName={view.thread.user.displayName}
                    username={view.thread.user.username}
                    avatarUrl={view.thread.user.avatarUrl}
                    size={32}
                  />
                  <span>
                    <strong>{view.thread.user.displayName}</strong>
                    <span className="field__hint">@{view.thread.user.username}</span>
                  </span>
                </Link>
                <Link className="btn btn--quiet btn--sm" to={`/u/${view.thread.user.username}`}>
                  Profile
                </Link>
              </header>

              <div className="bubbles" role="log" aria-live="polite" aria-label="Messages">
                {view.hasMore ? (
                  <p className="section-note">Older messages are not shown here yet.</p>
                ) : null}
                {view.messages.length === 0 ? (
                  <p className="section-note">No messages yet. Say hello.</p>
                ) : null}
                {view.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`bubble${message.mine ? ' bubble--mine' : ''}`}
                  >
                    <p>{message.body}</p>
                    <span className="bubble__meta">{timeAgo(message.createdAt)}</span>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              <form className="composer" onSubmit={send}>
                <label className="visually-hidden" htmlFor="dm-body">
                  Message @{view.thread.user.username}
                </label>
                <textarea
                  id="dm-body"
                  className="textarea"
                  value={body}
                  maxLength={2000}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={`Message @${view.thread.user.username}…`}
                />
                <button type="submit" className="btn btn--primary" disabled={sending || !body.trim()}>
                  {sending ? <span className="btn__spinner" /> : null}
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
