import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { FeedResponse, VideoDTO } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCategories, useConfig } from '../lib/config.tsx';
import { useToast } from '../lib/toast.tsx';
import { removeVideoFromCaches } from '../lib/feedCache.ts';
import { compactNumber, formatDate, timeAgo } from '../lib/format.ts';
import { shareLink } from '../lib/share.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Player } from '../components/Player.tsx';
import { AuthorizedPlayer } from '../components/AuthorizedMedia.tsx';
import { PhotoAlbum } from '../components/PhotoAlbum.tsx';
import { SoundCredit } from '../components/SoundCredit.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';
import { Popover } from '../components/Popover.tsx';
import { CommentsPanel } from '../components/CommentsPanel.tsx';
import { ReportDialog } from '../components/ReportDialog.tsx';
import { StatusTag } from '../components/StatusTag.tsx';
import { PostSkeleton } from '../components/Skeleton.tsx';

export function VideoPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const config = useConfig();
  const categories = useCategories();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const loginHref = `/login?next=${encodeURIComponent(location.pathname)}`;

  const [video, setVideo] = useState<VideoDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [related, setRelated] = useState<VideoDTO[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  useDocumentTitle(video ? video.caption.slice(0, 48) || 'Goat post' : 'Post');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ post?: VideoDTO; video?: VideoDTO }>(`/api/videos/${id}`)
      .then((data) => {
        if (cancelled) return;
        const item = data.post ?? data.video;
        if (!item) throw new Error('That post could not be loaded.');
        setVideo(item);
        setLiked(item.liked);
        setLikeCount(item.likeCount);
        setCommentCount(item.commentCount);
        setFollowing(item.creator.isFollowing);
        setCaption(item.caption);
        setCategory(item.category);
        setHashtags(item.hashtags.join(' '));
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'That video could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    api
      .get<FeedResponse>('/api/feed?tab=trending&page=1')
      .then((data) => {
        if (!cancelled) setRelated(data.items.filter((item) => item.id !== id).slice(0, 5));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!video || video.kind !== 'photos') return;
    api.post(`/api/videos/${video.id}/events`, { kind: 'view' }).catch(() => {});
  }, [video?.id, video?.kind]);

  const requireAuth = () => {
    if (user) return true;
    notify('Sign in to do that.', { actionLabel: 'Sign in', onAction: () => navigate(loginHref) });
    return false;
  };

  const toggleLike = async () => {
    if (!requireAuth() || !video) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    try {
      const data = await api.post<{ liked: boolean; likeCount: number }>(`/api/videos/${video.id}/like`);
      setLiked(data.liked);
      setLikeCount(data.likeCount);
    } catch {
      setLiked(!next);
      setLikeCount((count) => Math.max(0, count + (next ? -1 : 1)));
      notify('That like did not save.', { tone: 'error' });
    }
  };

  const toggleFollow = async () => {
    if (!requireAuth() || !video) return;
    const next = !following;
    setFollowing(next);
    try {
      if (next) await api.post(`/api/users/${video.creator.username}/follow`, { fromVideoId: video.id });
      else await api.delete(`/api/users/${video.creator.username}/follow`);
    } catch {
      setFollowing(!next);
      notify('Could not update that follow.', { tone: 'error' });
    }
  };

  const share = async () => {
    if (!video) return;
    const url = shareLink(`v/${video.id}`, 'share' in navigator ? 'native' : 'copy');
    try {
      if (navigator.share) await navigator.share({ title: video.caption || 'GoatMedia', url });
      else {
        await navigator.clipboard.writeText(url);
        notify('Link copied.');
      }
    } catch {
      /* dismissed */
    }
  };

  if (loading) return <PostSkeleton />;

  if (error || !video) {
    return (
      <div className="page">
        <div className="empty-state" style={{ paddingTop: 48 }}>
          <Icon name="alert" size={26} />
          <h2>This post is not available</h2>
          <p>{error ?? 'It may have been removed, or it never existed.'}</p>
          <div className="empty-state__actions">
            <Link className="btn btn--primary" to="/">
              Back to the feed
            </Link>
            {error?.includes('sign') ? (
              <Link className="btn btn--quiet" to={loginHref}>
                Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const isOwner = video.creator.isSelf;

  return (
    <div className="page page--video">
      <div className="video-layout">
        <div className="video-column">
          <div className="video-player-wrap">
            {video.kind === 'photos' || !video.videoUrl ? (
              <PhotoAlbum
                photos={video.photos}
                caption={video.caption}
                eager
                gated={video.status !== 'approved'}
                onDoubleTap={() => {
                  if (!liked) void toggleLike();
                }}
              />
            ) : video.status !== 'approved' ? (
              <AuthorizedPlayer src={video.videoUrl} active />
            ) : (
              <Player
                src={video.videoUrl}
                poster={video.posterUrl}
                active
                resumeAt={video.watchProgress}
                onProgress={(seconds) => {
                  if (!user) return;
                  api
                    .post(`/api/videos/${video.id}/progress`, {
                      positionMs: Math.round(seconds * 1000),
                      durationMs: Math.round((video.duration || 0) * 1000),
                    })
                    .catch(() => {});
                }}
                // A like already saved is feedback only, not another write.
                onDoubleTap={() => {
                  if (!liked) void toggleLike();
                }}
                onWatch={(stats) => {
                  api
                    .post(`/api/videos/${video.id}/events`, {
                      watchSeconds: stats.watchSeconds,
                      completed: stats.completed,
                      rewatched: stats.rewatched,
                      skipped: stats.watchSeconds < 2 && !stats.completed,
                    })
                    .catch(() => {});
                }}
              />
            )}
          </div>

          {video.kind === 'photos' && video.sound ? (
            <SoundCredit sound={video.sound} gated={video.status !== 'approved'} className="video-sound" />
          ) : null}

          {video.status !== 'approved' ? (
            <div className={`owner-notice owner-notice--${video.status}`}>
              <StatusTag status={video.status} />
              <p>
                {video.status === 'pending'
                  ? 'Only you and the moderator can see this video until it is approved. It is not in any public feed.'
                  : video.status === 'rejected'
                    ? `Not approved: ${video.rejectReason ?? 'no reason given'}`
                    : `Removed: ${video.rejectReason ?? 'no reason given'}`}
              </p>
              {isOwner && video.status !== 'removed' ? (
                <Link className="textlink" to="/settings">
                  Manage your uploads
                </Link>
              ) : null}
            </div>
          ) : null}

          <h1 className="video-title">{video.caption || 'Untitled goat post'}</h1>

          <div className="video-meta">
            <span>{compactNumber(video.viewCount)} views</span>
            <span className="meta-sep" aria-hidden="true">
              ·
            </span>
            <span>{formatDate(video.publishedAt ?? video.createdAt)}</span>
            <span className="meta-sep" aria-hidden="true">
              ·
            </span>
            <Link to={`/search?q=${encodeURIComponent(video.categoryLabel)}`}>{video.categoryLabel}</Link>
          </div>

          {video.hashtags.length ? (
            <p className="video-tags">
              {video.hashtags.map((tag) => (
                <Link key={tag} className="taglink" to={`/tag/${encodeURIComponent(tag)}`}>
                  #{tag}
                </Link>
              ))}
            </p>
          ) : null}

          <div className="video-actions">
            <div className="creator">
              <Link to={`/u/${video.creator.username}`}>
                <Avatar
                  displayName={video.creator.displayName}
                  username={video.creator.username}
                  avatarUrl={video.creator.avatarUrl}
                  size={40}
                />
              </Link>
              <div className="creator__text">
                <Link className="creator__name" to={`/u/${video.creator.username}`}>
                  {video.creator.displayName}
                </Link>
                <span className="creator__handle">
                  <span className="creator__handle-text">@{video.creator.username}</span>
                  {video.creator.isModerator ? (
                    <span className="modbadge" title="Moderator" aria-label="Moderator">
                      <Icon name="shield" size={12} filled />
                    </span>
                  ) : null}
                </span>
              </div>
              {!isOwner ? (
                <button
                  type="button"
                  className={`btn btn--sm btn--quiet${following ? ' is-following' : ''}`}
                  onClick={toggleFollow}
                  aria-pressed={following}
                >
                  {following ? 'Following' : 'Follow'}
                </button>
              ) : null}
            </div>

            <div className="video-action-buttons">
              <button
                type="button"
                className={`action${liked ? ' is-active' : ''}`}
                onClick={toggleLike}
                aria-pressed={liked}
                aria-label={liked ? 'Unlike video' : 'Like video'}
              >
                <Icon name="heart" size={18} filled={liked} />
                <span className="action__count">{compactNumber(likeCount)}</span>
              </button>                <button type="button" className="action" onClick={share} aria-label="Share post">
                <Icon name="share" size={18} />
                <span className="action__label">Share</span>
              </button>
              {isOwner ? (
                <button type="button" className="action" onClick={() => setEditing((current) => !current)}>
                  <Icon name="settings" size={18} />
                  <span className="action__label">Edit details</span>
                </button>
              ) : (
                <Popover
                  label="Video options"
                  trigger={
                    <button type="button" className="action" aria-label="More options">
                      <Icon name="more" size={18} />
                    </button>
                  }
                >
                  {(close) => (
                    <button
                      type="button"
                      className="menu-item menu-item--danger"
                      onClick={() => {
                        close();
                        if (requireAuth()) setReportOpen(true);
                      }}
                    >
                      <Icon name="flag" size={17} /> Report post
                    </button>
                  )}
                </Popover>
              )}
            </div>
          </div>

          {editing && isOwner ? (
            <form
              className="edit-panel"
              onSubmit={async (event) => {
                event.preventDefault();
                setSaving(true);
                setEditError(null);
                try {
                  const data = await api.patch<{ video: VideoDTO; message: string }>(`/api/videos/${video.id}`, {
                    caption,
                    category,
                    hashtags,
                  });
                  setVideo(data.video);
                  setEditing(false);
                  notify(data.message);
                } catch (saveError) {
                  setEditError(saveError instanceof Error ? saveError.message : 'Could not save changes.');
                } finally {
                  setSaving(false);
                }
              }}
            >
              <div className="field">
                <label className="field__label" htmlFor="edit-caption">
                  Caption
                </label>
                <textarea
                  id="edit-caption"
                  className="textarea"
                  maxLength={config?.limits.maxCaptionLength ?? 300}
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                />
              </div>
              <div className="form-row">
                <div className="field">
                  <label className="field__label" htmlFor="edit-category">
                    Category
                  </label>
                  <select
                    id="edit-category"
                    className="select"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="edit-tags">
                    Hashtags
                  </label>
                  <input
                    id="edit-tags"
                    className="input"
                    value={hashtags}
                    onChange={(event) => setHashtags(event.target.value)}
                    placeholder="goatkids, climbing"
                  />
                </div>
              </div>
              <p className="field__hint">
                {video.status === 'approved'
                  ? 'Saving changes to a published video sends it back for review.'
                  : 'Saving changes puts this video back in the review queue.'}
              </p>
              {editError ? <p className="field__error">{editError}</p> : null}
              <div className="form-actions">
                <button type="submit" className="btn btn--primary" disabled={saving || removing}>
                  {saving ? <span className="btn__spinner" /> : null}
                  Save changes
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
              <div className="edit-panel__danger">
                {confirmRemove ? (
                  <div className="inline-confirm">
                    <p>
                      Remove this video from GoatMedia? It disappears from your profile and every feed. This cannot
                      be undone.
                    </p>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={removing}
                        onClick={async () => {
                          setRemoving(true);
                          try {
                            await api.delete(`/api/videos/${video.id}`);
                            removeVideoFromCaches(video.id);
                            notify('Video removed.');
                            navigate(`/u/${user!.username}`, { replace: true });
                          } catch (removeError) {
                            notify(removeError instanceof Error ? removeError.message : 'Could not remove the video.', {
                              tone: 'error',
                            });
                            setRemoving(false);
                          }
                        }}
                      >
                        {removing ? <span className="btn__spinner" /> : null}
                        Remove video
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        onClick={() => setConfirmRemove(false)}
                        disabled={removing}
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmRemove(true)}>
                    Remove video
                  </button>
                )}
              </div>
            </form>
          ) : null}

          {video.credit ? <p className="feed-credit">Sample clip · {video.credit}</p> : null}

          <CommentsPanel video={video} onCountChange={setCommentCount} inline />

          {commentCount === 0 ? <span className="visually-hidden">{commentCount} comments</span> : null}
        </div>

        <aside className="video-side">
          <h2 className="section-title">More goats</h2>
          {related.length === 0 ? (
            <p className="section-note">Nothing else is approved yet. Check back later.</p>
          ) : (
            <ul className="side-list">
              {related.map((item) => (
                <li key={item.id}>
                  <Link className="side-video" to={`/v/${item.id}`}>
                    <div className="side-video__thumb">
                      {item.posterUrl ? <img src={item.posterUrl} alt="" loading="lazy" /> : <span aria-hidden="true" />}
                    </div>
                    <div className="side-video__body">
                      <p className="side-video__title">{item.caption || 'Untitled goat post'}</p>
                      <p className="side-video__meta">
                        @{item.creator.username} · {timeAgo(item.publishedAt ?? item.createdAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="video-side__footer">
            <Link className="textlink" to="/trending">
              See all trending videos
            </Link>
          </div>
        </aside>
      </div>

      <ReportDialog
        open={reportOpen}
        title="Report this post"
        subject={video.caption}
        reasons={config?.reportReasons.video ?? ['Not actually a goat', 'Animal mistreatment', 'Spam or misleading']}
        onClose={() => setReportOpen(false)}
        onSubmit={async (reason, note) => {
          try {
            await api.post(`/api/videos/${video.id}/report`, { reason, note });
            notify('Report sent to the moderator.');
          } catch (reportError) {
            if (reportError instanceof ApiError && reportError.status === 401) {
              navigate(loginHref);
              return;
            }
            throw reportError;
          }
        }}
      />
    </div>
  );
}
