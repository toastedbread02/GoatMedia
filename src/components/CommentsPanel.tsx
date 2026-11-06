import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { CommentDTO, PostDTO } from '../../shared/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { relativeTime } from '../lib/format';
import { useToast } from '../lib/toast';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ReportDialog, type ReportTarget } from './ReportDialog';

interface CommentsPanelProps {
  post: PostDTO;
  onClose?: () => void;
  onCountChange?: (postId: string, count: number) => void;
  inline?: boolean;
}

export function CommentsPanel({ post, onClose, onCountChange, inline = false }: CommentsPanelProps) {
  const { me } = useAuth();
  const toast = useToast();
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(
    async (nextPage: number) => {
      try {
        const result = await api.comments(post.id, nextPage);
        setComments((current) => (nextPage === 1 ? result.comments : [...current, ...result.comments]));
        setHasMore(result.hasMore);
        setPage(nextPage);
      } catch (error) {
        toast((error as Error).message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [post.id, toast],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  useEffect(() => {
    if (inline) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [inline, onClose]);

  const submit = async () => {
    if (!me) return;
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const result = await api.addComment(post.id, text);
      setComments((current) => [result.comment, ...current]);
      setBody('');
      onCountChange?.(post.id, post.commentCount + 1);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const panel = (
    <section
      className={`comments ${inline ? 'comments--inline' : ''}`}
      role={inline ? 'region' : 'dialog'}
      aria-modal={inline ? undefined : true}
      aria-label="Comments"
    >
      <header className="comments__head">
        <h2>
          {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
        </h2>
        {!inline ? (
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close comments">
            <Icon name="close" />
          </button>
        ) : null}
      </header>

      <div className="comments__list">
        {loading ? (
          <div className="comments__skeletons" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div className="comment-skeleton" key={row} style={{ '--i': row } as CSSProperties} />
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div className="empty empty--small">
            <p className="empty__title">No comments yet</p>
            <p>Say something about the goat.</p>
          </div>
        ) : (
          comments.map((comment, index) => (
            <article className="comment" key={comment.id} style={{ '--i': Math.min(index, 8) } as CSSProperties}>
              <Link to={`/u/${comment.author.username}`} aria-label={comment.author.displayName}>
                <Avatar user={comment.author} size={32} />
              </Link>
              <div className="comment__body">
                <p className="comment__meta">
                  <Link to={`/u/${comment.author.username}`} className="comment__author">
                    {comment.author.displayName}
                  </Link>
                  <time dateTime={new Date(comment.createdAt).toISOString()}>
                    {relativeTime(comment.createdAt)}
                  </time>
                </p>
                <p className="comment__text">{comment.body}</p>
                <div className="comment__tools">
                  {comment.canDelete ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={async () => {
                        try {
                          await api.deleteComment(comment.id);
                          setComments((current) => current.filter((item) => item.id !== comment.id));
                          onCountChange?.(post.id, Math.max(0, post.commentCount - 1));
                        } catch (error) {
                          toast((error as Error).message, 'error');
                        }
                      }}
                    >
                      Delete
                    </button>
                  ) : me ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setTarget({ type: 'comment', id: comment.id, label: comment.body.slice(0, 60) })
                      }
                    >
                      Report
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        )}
        {hasMore ? (
          <button type="button" className="button button--quiet comments__more" onClick={() => load(page + 1)}>
            Load more comments
          </button>
        ) : null}
      </div>

      <footer className="comments__compose">
        {me ? (
          <>
            <Avatar user={me} size={32} />
            <label className="visually-hidden" htmlFor={`comment-input-${post.id}`}>
              Write a comment
            </label>
            <textarea
              id={`comment-input-${post.id}`}
              className="comments__input"
              rows={1}
              maxLength={400}
              placeholder="Add a comment…"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <button type="button" className="button button--small" onClick={submit} disabled={!body.trim() || sending}>
              {sending ? 'Posting…' : 'Post'}
            </button>
          </>
        ) : (
          <p className="comments__signin">
            <Link to="/signin" className="inline-link">
              Sign in
            </Link>{' '}
            to join the conversation.
          </p>
        )}
      </footer>
    </section>
  );

  return (
    <>
      {inline ? (
        panel
      ) : (
        <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose?.()}>
          {panel}
        </div>
      )}
      {target ? <ReportDialog target={target} onClose={() => setTarget(null)} /> : null}
    </>
  );
}
