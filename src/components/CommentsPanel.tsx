import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { CommentDTO, VideoDTO } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useToast } from '../lib/toast.tsx';
import { timeAgo } from '../lib/format.ts';
import { Avatar } from './Avatar.tsx';
import { Icon } from './Icon.tsx';
import { ReportDialog } from './ReportDialog.tsx';

interface CommentsPanelProps {
  video: VideoDTO;
  onClose?: () => void;
  onCountChange: (count: number) => void;
  inline?: boolean;
}

export function CommentsPanel({ video, onClose, onCountChange, inline = false }: CommentsPanelProps) {
  const { user } = useAuth();
  const config = useConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<CommentDTO[] | null>(null);
  const [total, setTotal] = useState(video.commentCount);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [reportTarget, setReportTarget] = useState<CommentDTO | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items?: CommentDTO[]; comments?: CommentDTO[]; hasMore: boolean; total?: number }>(
        `/api/videos/${video.id}/comments`,
      )
      .then((data) => {
        if (cancelled) return;
        setItems(data.items ?? data.comments ?? []);
        setHasMore(data.hasMore);
        setTotal(data.total ?? video.commentCount);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : 'Comments could not load.');
      });
    return () => {
      cancelled = true;
    };
  }, [video.id]);

  const close = () => {
    if (inline) return;
    setClosing(true);
    setTimeout(() => onClose?.(), 160);
  };

  useEffect(() => {
    if (inline) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline]);

  useEffect(() => {
    if (inline) return;
    const panel = panelRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const focusable =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      panel?.querySelector<HTMLElement>(focusable)?.focus();
    }, 30);
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel || document.querySelector('dialog[open]')) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(focusable)).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keepFocusInside);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', keepFocusInside);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [inline]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await api.get<{
        items?: CommentDTO[];
        comments?: CommentDTO[];
        hasMore: boolean;
        total?: number;
      }>(`/api/videos/${video.id}/comments?page=${next}`);
      setItems((current) => [...(current ?? []), ...(data.items ?? data.comments ?? [])]);
      setHasMore(data.hasMore);
      setPage(next);
      if (typeof data.total === 'number') setTotal(data.total);
    } catch {
      toast.notify('Could not load more comments.', { tone: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    setError(null);
    try {
      const data = await api.post<{ comment: CommentDTO; total: number }>(`/api/videos/${video.id}/comments`, {
        body: text,
      });
      setBody('');
      if (data.comment) setItems((current) => [data.comment, ...(current ?? [])]);
      setTotal(data.total);
      onCountChange(data.total);
      toast.notify('Comment added.');
    } catch (postError) {
      if (postError instanceof ApiError && postError.status === 401) {
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      } else {
        setError(postError instanceof Error ? postError.message : 'The comment did not post.');
      }
    } finally {
      setPosting(false);
    }
  };

  const remove = async (comment: CommentDTO) => {
    try {
      await api.delete(`/api/comments/${comment.id}`);
      setItems((current) => current?.filter((item) => item.id !== comment.id) ?? null);
      setTotal((current) => {
        const next = Math.max(0, current - 1);
        onCountChange(next);
        return next;
      });
      toast.notify('Comment deleted.');
    } catch {
      toast.notify('Could not delete that comment.', { tone: 'error' });
    }
  };

  return (
    <>
      {!inline ? <div className="scrim" onClick={close} aria-hidden="true" /> : null}
      <section
        ref={panelRef}
        className={`comments-panel${inline ? ' comments-panel--inline' : ''}${closing ? ' is-closing' : ''}`}
        role={inline ? 'region' : 'dialog'}
        aria-modal={inline ? undefined : true}
        aria-label="Comments"
      >
        <header className="comments-panel__head">
          <span className="comments-panel__title">Comments</span>
          <span className="comments-panel__count">{total}</span>
          {!inline ? (
            <button
              type="button"
              className="iconbtn"
              style={{ marginLeft: 'auto' }}
              onClick={close}
              aria-label="Close comments"
            >
              <Icon name="close" size={18} />
            </button>
          ) : null}
        </header>

        <div className="comments-panel__body">
          {items === null ? (
            <div className="comments-empty">Loading comments…</div>
          ) : error && items.length === 0 ? (
            <div className="comments-empty">{error}</div>
          ) : items.length === 0 ? (
            <div className="comments-empty">
              No comments yet. Say something about this goat.
            </div>
          ) : (
            <>
              <ul>
                {items.map((comment) => (
                  <li key={comment.id} className="comment">
                    <Link to={`/u/${comment.author.username}`} onClick={close}>
                      <Avatar
                        displayName={comment.author.displayName}
                        username={comment.author.username}
                        avatarUrl={comment.author.avatarUrl}
                        size={32}
                      />
                    </Link>
                    <div className="comment__body">
                      <div className="comment__head">
                        <Link to={`/u/${comment.author.username}`} className="comment__name" onClick={close}>
                          {comment.author.displayName}
                        </Link>
                        <Link to={`/u/${comment.author.username}`} className="comment__handle" onClick={close}>
                          @{comment.author.username}
                        </Link>
                        <span className="comment__handle">{timeAgo(comment.createdAt)}</span>
                      </div>
                      <p className="comment__text">{comment.body}</p>
                      <div className="comment__actions">
                        {comment.canDelete ? (
                          <button type="button" className="comment__link is-danger" onClick={() => remove(comment)}>
                            Delete
                          </button>
                        ) : null}
                        {user && !comment.canDelete ? (
                          <button type="button" className="comment__link" onClick={() => setReportTarget(comment)}>
                            Report
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {hasMore ? (
                <div className="comments-more">
                  <button type="button" className="btn btn--quiet btn--sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Show older comments'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="comments-panel__foot">
          {user ? (
            <form className="comment-form" onSubmit={submit} ref={formRef}>
              <label className="visually-hidden" htmlFor="comment-body">
                Add a comment
              </label>
              <textarea
                id="comment-body"
                className="textarea"
                value={body}
                maxLength={500}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Add a comment about this goat…"
                aria-invalid={Boolean(error)}
              />
              <div className="comment-form__row">
                <span className="comment-form__hint">
                  {error ? <span className="field__error">{error}</span> : `${body.length}/500 · Be kind.`}
                </span>
                <button type="submit" className="btn btn--primary btn--sm" disabled={posting || !body.trim()}>
                  {posting ? <span className="btn__spinner" /> : null}
                  Comment
                </button>
              </div>
            </form>
          ) : (
            <div className="comment-signin">
              <span>Sign in to join the conversation.</span>
              <Link className="btn btn--primary btn--sm" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
                Sign in
              </Link>
            </div>
          )}
        </div>

        <ReportDialog
          open={Boolean(reportTarget)}
          title="Report this comment"
          subject={reportTarget ? `“${reportTarget.body.slice(0, 120)}”` : ''}
          reasons={config?.reportReasons.comment ?? ['Spam', 'Harassment', 'Hate speech', 'Something else']}
          onClose={() => setReportTarget(null)}
          onSubmit={async (reason, note) => {
            if (!reportTarget) return;
            await api.post(`/api/comments/${reportTarget.id}/report`, { reason, note });
            toast.notify('Report sent to the moderator.');
          }}
        />
      </section>
    </>
  );
}
