import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { CommentDTO, VideoDTO } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useToast } from '../lib/toast.tsx';
import { compactNumber, timeAgo } from '../lib/format.ts';
import { Avatar } from './Avatar.tsx';
import { Icon } from './Icon.tsx';
import { ReportDialog } from './ReportDialog.tsx';
import { EGG_COMMENTS, isEgg, profilePath } from '../lib/easterEgg.ts';

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
  const [replyTo, setReplyTo] = useState<CommentDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [reportTarget, setReportTarget] = useState<CommentDTO | null>(null);
  const [sort, setSort] = useState<'new' | 'top'>('new');
  const [pinPending, setPinPending] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const odd = isEgg(video.id);

  useEffect(() => {
    let cancelled = false;
    setPage(1);
    if (isEgg(video.id)) {
      setItems(EGG_COMMENTS);
      setHasMore(false);
      setTotal(video.commentCount);
      return;
    }
    api
      .get<{ items?: CommentDTO[]; comments?: CommentDTO[]; hasMore: boolean; total?: number }>(
        `/api/videos/${video.id}/comments?sort=${sort}`,
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
  }, [video.id, sort]);

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
    if (odd) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await api.get<{
        items?: CommentDTO[];
        comments?: CommentDTO[];
        hasMore: boolean;
        total?: number;
      }>(`/api/videos/${video.id}/comments?page=${next}&sort=${sort}`);
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

  const setComment = (id: string, patch: Partial<CommentDTO>) => {
    setItems((current) => current?.map((item) => (item.id === id ? { ...item, ...patch } : item)) ?? null);
  };

  const like = async (comment: CommentDTO) => {
    if (odd) {
      setComment(comment.id, {
        liked: !comment.liked,
        likeCount: Math.max(0, comment.likeCount + (comment.liked ? -1 : 1)),
      });
      return;
    }
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    const next = !comment.liked;
    setComment(comment.id, {
      liked: next,
      likeCount: Math.max(0, comment.likeCount + (next ? 1 : -1)),
    });
    try {
      const data = next
        ? await api.post<{ liked: boolean; likeCount: number }>(`/api/comments/${comment.id}/like`)
        : await api.delete<{ liked: boolean; likeCount: number }>(`/api/comments/${comment.id}/like`);
      setComment(comment.id, { liked: data.liked, likeCount: data.likeCount });
    } catch {
      setComment(comment.id, { liked: comment.liked, likeCount: comment.likeCount });
      toast.notify('That like did not save.', { tone: 'error' });
    }
  };

  const togglePin = async (comment: CommentDTO) => {
    if (pinPending) return;
    const next = !comment.pinned;
    setPinPending(comment.id);
    setItems((current) =>
      current?.map((item) => {
        if (item.id === comment.id) return { ...item, pinned: next };
        return next && item.pinned ? { ...item, pinned: false } : item;
      }) ?? null,
    );
    try {
      if (next) await api.post(`/api/comments/${comment.id}/pin`);
      else await api.delete(`/api/comments/${comment.id}/pin`);
      toast.notify(next ? 'Comment pinned.' : 'Comment unpinned.');
    } catch {
      toast.notify('That pin did not save.', { tone: 'error' });
    } finally {
      setPinPending(null);
    }
  };

  const startReply = (comment: CommentDTO) => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    setReplyTo(comment);
    setError(null);
    window.requestAnimationFrame(() => bodyRef.current?.focus());
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
    const parentId = replyTo ? (replyTo.parentId ?? replyTo.id) : null;
    try {
      const data = await api.post<{ comment: CommentDTO; total: number }>(`/api/videos/${video.id}/comments`, {
        body: text,
        parentId,
      });
      setBody('');
      setReplyTo(null);
      setItems((current) => {
        if (!current) return [data.comment];
        return data.comment.parentId ? [...current, data.comment] : [data.comment, ...current];
      });
      setTotal(data.total);
      onCountChange(data.total);
      toast.notify(data.comment.parentId ? 'Reply added.' : 'Comment added.');
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
      const data = await api.delete<{ ok: boolean; removed?: number }>(`/api/comments/${comment.id}`);
      setItems(
        (current) => current?.filter((item) => item.id !== comment.id && item.parentId !== comment.id) ?? null,
      );
      if (replyTo && (replyTo.id === comment.id || replyTo.parentId === comment.id)) setReplyTo(null);
      const removed = data.removed ?? 1;
      setTotal((current) => {
        const next = Math.max(0, current - removed);
        onCountChange(next);
        return next;
      });
      toast.notify(removed > 1 ? 'Thread deleted.' : 'Comment deleted.');
    } catch {
      toast.notify('Could not delete that comment.', { tone: 'error' });
    }
  };

  const renderComment = (comment: CommentDTO, isReply: boolean) => (
    <li key={comment.id} className={`comment${isReply ? ' comment--reply' : ''}`}>
      <Link to={profilePath(comment.author.username)} onClick={close} aria-label={`${comment.author.displayName} profile`}>
        <Avatar
          displayName={comment.author.displayName}
          username={comment.author.username}
          avatarUrl={comment.author.avatarUrl}
          size={isReply ? 26 : 32}
        />
      </Link>
      <div className="comment__body">
        <div className="comment__head">
          <Link to={profilePath(comment.author.username)} className="comment__name" onClick={close}>
            {comment.author.displayName}
          </Link>
          {comment.pinned ? (
            <span className="comment__badge comment__badge--pin">Pinned</span>
          ) : null}
          {comment.isPostAuthor ? <span className="comment__badge">Creator</span> : null}
          <span className="comment__handle-line">
            <Link to={profilePath(comment.author.username)} className="comment__handle" onClick={close}>
              @{comment.author.username}
            </Link>
            {comment.author.isModerator ? (
              <span className="modbadge" title="Moderator" aria-label="Moderator">
                <Icon name="shield" size={12} filled />
              </span>
            ) : null}
          </span>
          <span className="comment__handle">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="comment__text">{comment.body}</p>
        <div className="comment__actions">
          <button
            type="button"
            className={`comment__like${comment.liked ? ' is-liked' : ''}`}
            onClick={() => like(comment)}
            aria-pressed={comment.liked}
            aria-label={`${comment.liked ? 'Unlike' : 'Like'} comment, ${comment.likeCount} likes`}
          >
            <Icon name="heart" size={14} filled={comment.liked} />
            <span>{comment.likeCount > 0 ? compactNumber(comment.likeCount) : 'Like'}</span>
          </button>
          <button type="button" className="comment__link" onClick={() => startReply(comment)}>
            {replyTo?.id === comment.id ? 'Replying' : 'Reply'}
          </button>
          {comment.canPin ? (
            <button
              type="button"
              className="comment__link"
              onClick={() => togglePin(comment)}
              disabled={pinPending === comment.id}
            >
              {comment.pinned ? 'Unpin' : 'Pin'}
            </button>
          ) : null}
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
  );

  const list = items ?? [];
  const roots = list.filter((comment) => !comment.parentId);

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
          <div className="comments-panel__sort" role="group" aria-label="Sort comments">
            <button
              type="button"
              className={`comment__link${sort === 'top' ? ' is-on' : ''}`}
              aria-pressed={sort === 'top'}
              onClick={() => setSort('top')}
            >
              Top
            </button>
            <button
              type="button"
              className={`comment__link${sort === 'new' ? ' is-on' : ''}`}
              aria-pressed={sort === 'new'}
              onClick={() => setSort('new')}
            >
              Newest
            </button>
          </div>
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
                {roots.map((comment) => {
                  const replies = list.filter((item) => item.parentId === comment.id);
                  return (
                    <li key={comment.id} className="comment-thread">
                      <ul>
                        {renderComment(comment, false)}
                        {replies.length ? (
                          <li className="comment__replies">
                            <ul>{replies.map((reply) => renderComment(reply, true))}</ul>
                          </li>
                        ) : null}
                      </ul>
                    </li>
                  );
                })}
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
          {odd ? (
            <div className="comment-signin">
              <span>This post is archived. Comments are closed.</span>
            </div>
          ) : user ? (
            <>
              {replyTo ? (
                <div className="comment-form__replying">
                  <span>
                    Replying to <strong>@{replyTo.author.username}</strong>
                  </span>
                  <button type="button" className="comment__link" onClick={() => setReplyTo(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}
              <form className="comment-form" onSubmit={submit}>
                <label className="visually-hidden" htmlFor="comment-body">
                  {replyTo ? `Reply to ${replyTo.author.username}` : 'Add a comment'}
                </label>
                <textarea
                  id="comment-body"
                  ref={bodyRef}
                  className="textarea"
                  value={body}
                  maxLength={400}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={replyTo ? `Reply to @${replyTo.author.username}…` : 'Add a comment about this goat…'}
                  aria-invalid={Boolean(error)}
                />
                <div className="comment-form__row">
                  <span className="comment-form__hint">
                    {error ? <span className="field__error">{error}</span> : `${body.length}/400 · Be kind.`}
                  </span>
                  <button type="submit" className="btn btn--primary btn--sm" disabled={posting || !body.trim()}>
                    {posting ? <span className="btn__spinner" /> : null}
                    {replyTo ? 'Reply' : 'Comment'}
                  </button>
                </div>
              </form>
            </>
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
