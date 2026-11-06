import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PostDTO } from '../../shared/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { relativeTime, count, plural } from '../lib/format';
import { useSound, useSoundClaim } from '../lib/sound';
import { useToast } from '../lib/toast';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { PhotoCarousel } from './PhotoCarousel';
import { SoundSheet } from './SoundSheet';
import { StatusBadge } from './StatusBadge';

interface PostCardProps {
  post: PostDTO;
  onUpdate?: (patch: Partial<PostDTO>) => void;
  onRemove?: (id: string) => void;
  onOpenComments?: (post: PostDTO) => void;
  showStatus?: boolean;
  priority?: boolean;
  compact?: boolean;
}

function Caption({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/(#[a-z0-9_]{2,24})/gi);
  return (
    <p className="post__caption">
      {parts.map((part, index) =>
        part.startsWith('#') ? (
          <Link key={`${part}-${index}`} to={`/search?q=${encodeURIComponent(part)}`} className="inline-link">
            {part}
          </Link>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </p>
  );
}

export function PostCard({
  post,
  onUpdate,
  onRemove,
  onOpenComments,
  showStatus = false,
  priority = false,
  compact = false,
}: PostCardProps) {
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const sound = useSound();
  const [busy, setBusy] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.caption);
  const article = useRef<HTMLElement | null>(null);
  const seen = useRef({ view: false, dwell: 0 });
  const claimRef = useSoundClaim(post.id, post.sound?.url ?? null);
  const isActiveSound = Boolean(post.sound && sound.activeId === post.id && sound.enabled);

  useEffect(() => {
    if (!article.current || post.status !== 'approved') return;
    let viewTimer = 0;
    let completeTimer = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.55) {
            viewTimer = window.setTimeout(() => {
              if (!seen.current.view) {
                seen.current.view = true;
                void api.event(post.id, 'view').catch(() => undefined);
              }
            }, 700);
            completeTimer = window.setTimeout(() => {
              void api.event(post.id, 'complete').catch(() => undefined);
            }, 2800);
          } else if (entry.intersectionRatio < 0.2) {
            window.clearTimeout(viewTimer);
            window.clearTimeout(completeTimer);
          }
        }
      },
      { threshold: [0, 0.2, 0.55] },
    );
    observer.observe(article.current);
    return () => {
      window.clearTimeout(viewTimer);
      window.clearTimeout(completeTimer);
      observer.disconnect();
    };
  }, [post.id, post.status]);

  const toggleLike = async () => {
    if (!me) {
      navigate('/signin');
      return;
    }
    if (busy) return;
    setBusy(true);
    const optimistic = { liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) };
    onUpdate?.(optimistic);
    try {
      const result = await api.toggleLike(post.id);
      onUpdate?.(result);
    } catch (error) {
      onUpdate?.({ liked: post.liked, likeCount: post.likeCount });
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/p/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied', 'success');
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  const hide = async () => {
    try {
      await api.notInterested(post.id, true);
      onRemove?.(post.id);
      toast('You will see fewer posts like this');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const saveCaption = async () => {
    try {
      const result = await api.updatePost(post.id, { caption: draft });
      onUpdate?.({ caption: result.post.caption, hashtags: result.post.hashtags, status: result.post.status });
      setEditing(false);
      toast(result.needsReview ? 'Saved. It goes back in the queue for review.' : 'Caption updated', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const remove = async () => {
    try {
      await api.deletePost(post.id);
      onRemove?.(post.id);
      toast('Post deleted');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const menuItems = [];
  if (post.status === 'approved' && !post.creator.isSelf) {
    menuItems.push({ label: 'Not interested', icon: 'eye-off' as const, onSelect: hide });
  }
  if (!post.creator.isSelf) {
    menuItems.push({
      label: 'Report post',
      icon: 'flag' as const,
      tone: 'danger' as const,
      onSelect: () => navigate(`/report/post/${post.id}`),
    });
    menuItems.push({
      label: `View @${post.creator.username}`,
      icon: 'user' as const,
      onSelect: () => navigate(`/u/${post.creator.username}`),
    });
  }
  if (post.creator.isSelf) {
    menuItems.push({
      label: 'Edit caption',
      icon: 'edit' as const,
      onSelect: () => {
        setDraft(post.caption);
        setEditing(true);
      },
    });
    menuItems.push({
      label: 'Delete post',
      icon: 'trash' as const,
      tone: 'danger' as const,
      onSelect: remove,
    });
  }

  return (
    <article
      className={`post ${compact ? 'post--compact' : ''}`}
      ref={(node) => {
        article.current = node;
        claimRef.current = node;
      }}
    >
      <header className="post__head">
        <Link to={`/u/${post.creator.username}`} className="post__avatar" aria-label={post.creator.displayName}>
          <Avatar user={post.creator} size={40} />
        </Link>
        <div className="post__who">
          <Link to={`/u/${post.creator.username}`} className="post__name">
            {post.creator.displayName}
          </Link>
          <div className="post__meta">
            <Link to={`/u/${post.creator.username}`} className="post__handle">
              @{post.creator.username}
            </Link>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(post.publishedAt || post.createdAt).toISOString()}>
              {relativeTime(post.publishedAt || post.createdAt)}
            </time>
            <span aria-hidden="true">·</span>
            <Link to={`/c/${post.category}`} className="post__category">
              {post.categoryLabel}
            </Link>
          </div>
        </div>
        {!post.creator.isSelf ? (
          <button
            type="button"
            className={`follow-button ${post.creator.isFollowing ? 'is-following' : ''}`}
            onClick={async () => {
              if (!me) {
                navigate('/signin');
                return;
              }
              try {
                const result = await api.follow(post.creator.username, !post.creator.isFollowing);
                onUpdate?.({ creator: { ...post.creator, isFollowing: result.following } });
              } catch (error) {
                toast((error as Error).message, 'error');
              }
            }}
          >
            {post.creator.isFollowing ? 'Following' : 'Follow'}
          </button>
        ) : null}
        {menuItems.length ? <Menu items={menuItems} label="Post options" /> : null}
      </header>

      {showStatus && post.status !== 'approved' ? (
        <div className="post__notice">
          <StatusBadge status={post.status} />
          {post.rejectReason ? <p>{post.rejectReason}</p> : null}
          {post.removedReason ? <p>{post.removedReason}</p> : null}
        </div>
      ) : null}

      <PhotoCarousel photos={post.photos} caption={post.caption} eager={priority} />

      {post.sound ? (
        <div className="post__sound">
          <button
            type="button"
            className={`sound-bar ${isActiveSound ? 'is-playing' : ''}`}
            onClick={() => setSoundOpen(true)}
            aria-label={`Sound: ${post.sound.title}. Open details.`}
          >
            <span className="sound-bar__icon" aria-hidden="true">
              <Icon name="volume" size={16} />
            </span>
            <span className="sound-bar__text">
              {post.sound.title}
              <span className="sound-bar__owner"> · @{post.sound.owner.username}</span>
            </span>
            {post.sound.useCount > 0 ? (
              <span className="sound-bar__uses">{post.sound.useCount} uses</span>
            ) : null}
          </button>
          <button
            type="button"
            className={`icon-button sound-toggle ${isActiveSound ? 'is-active' : ''}`}
            aria-pressed={sound.enabled}
            aria-label={sound.enabled ? 'Turn sound off' : 'Turn sound on'}
            onClick={() => {
              sound.toggle();
              if (!sound.enabled) sound.claim(post.id, post.sound!.url);
            }}
          >
            <Icon name={sound.enabled ? 'volume' : 'mute'} size={18} />
          </button>
        </div>
      ) : null}

      <div className="post__actions">
        <button
          type="button"
          className={`action ${post.liked ? 'is-liked' : ''}`}
          onClick={toggleLike}
          aria-pressed={post.liked}
          aria-label={post.liked ? 'Unlike this post' : 'Like this post'}
        >
          <Icon name="heart" filled={post.liked} />
          <span>{post.likeCount ? count(post.likeCount) : 'Like'}</span>
        </button>
        <button
          type="button"
          className="action"
          onClick={() => (onOpenComments ? onOpenComments(post) : navigate(`/p/${post.id}`))}
          aria-label={`Comments, ${plural(post.commentCount, 'comment', 'comments')}`}
        >
          <Icon name="comment" />
          <span>{post.commentCount ? count(post.commentCount) : 'Comment'}</span>
        </button>
        <button type="button" className="action" onClick={share} aria-label="Copy a link to this post">
          <Icon name="share" />
          <span>Share</span>
        </button>
        <span className="post__views" title={`${post.viewCount} views`}>
          <Icon name="grid" size={16} />
          {count(post.viewCount)}
        </span>
      </div>

      <div className="post__body">
        {editing ? (
          <div className="caption-editor">
            <label className="field__label" htmlFor={`caption-${post.id}`}>
              Caption
            </label>
            <textarea
              id={`caption-${post.id}`}
              className="textarea"
              value={draft}
              maxLength={300}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="caption-editor__actions">
              <button type="button" className="button button--quiet" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="button" onClick={saveCaption}>
                Save
              </button>
            </div>
            <p className="hint">Caption changes send a live post back for review.</p>
          </div>
        ) : (
          <>
            <Caption text={post.caption} />
            {post.reason ? (
              <p className="post__reason">
                <Icon name="spark" size={15} />
                {post.reason}
              </p>
            ) : null}
          </>
        )}
      </div>

      {soundOpen && post.sound ? (
        <SoundSheet sound={post.sound} onClose={() => setSoundOpen(false)} />
      ) : null}
    </article>
  );
}
