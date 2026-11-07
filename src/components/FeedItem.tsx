import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { VideoDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useToast } from '../lib/toast.tsx';
import { compactNumber, timeAgo } from '../lib/format.ts';
import { Avatar } from './Avatar.tsx';
import { Icon } from './Icon.tsx';
import { Popover } from './Popover.tsx';
import { Player, type WatchStats } from './Player.tsx';
import { PhotoAlbum } from './PhotoAlbum.tsx';
import { SoundCredit } from './SoundCredit.tsx';
import { CommentsPanel } from './CommentsPanel.tsx';
import { ReportDialog } from './ReportDialog.tsx';

interface FeedItemProps {
  video: VideoDTO;
  index: number;
  activeIndex: number;
  onNotInterested: (video: VideoDTO) => void;
}

export function FeedItem({ video, index, activeIndex, onNotInterested }: FeedItemProps) {
  const { user } = useAuth();
  const config = useConfig();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [following, setFollowing] = useState(video.creator.isFollowing);
  const [followPending, setFollowPending] = useState(false);
  const [liked, setLiked] = useState(video.liked);
  const [likeCount, setLikeCount] = useState(video.likeCount);
  const [pulse, setPulse] = useState(false);
  const [commentCount, setCommentCount] = useState(video.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const active = index === activeIndex;
  const shouldMount = Math.abs(index - activeIndex) <= 1;
  const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}v/${video.id}`;

  useEffect(() => {
    if (!active || video.kind === 'video') return;
    api.post(`/api/videos/${video.id}/events`, { kind: 'view' }).catch(() => {});
  }, [active, video.id, video.kind]);
  const loginHref = `/login?next=${encodeURIComponent(location.pathname)}`;

  const requireAuth = () => {
    if (user) return true;
    notify('Sign in to do that.', { actionLabel: 'Sign in', onAction: () => navigate(loginHref) });
    return false;
  };

  const toggleLike = async () => {
    if (!requireAuth()) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    if (next) {
      setPulse(true);
      setTimeout(() => setPulse(false), 360);
    }
    try {
      const data = await api.post<{ liked: boolean; likeCount: number }>(`/api/videos/${video.id}/like`);
      setLiked(data.liked);
      setLikeCount(data.likeCount);
    } catch {
      setLiked(!next);
      setLikeCount((count) => Math.max(0, count + (next ? -1 : 1)));
      notify('That like did not save. Try again.', { tone: 'error' });
    }
  };

  const toggleFollow = async () => {
    if (!requireAuth()) return;
    const next = !following;
    setFollowing(next);
    setFollowPending(true);
    try {
      if (next) {
        await api.post(`/api/users/${video.creator.id}/follow`, { fromVideoId: video.id });
      } else {
        await api.delete(`/api/users/${video.creator.id}/follow`);
      }
    } catch {
      setFollowing(!next);
      notify('Could not update that follow.', { tone: 'error' });
    } finally {
      setFollowPending(false);
    }
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: video.caption || 'GoatMedia', url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      notify('Link copied.', { actionLabel: 'Open video', onAction: () => navigate(`/v/${video.id}`) });
    } catch {
      /* the user dismissed the share sheet */
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      notify('Link copied.');
    } catch {
      notify('Could not copy the link.', { tone: 'error' });
    }
  };

  const caption = video.caption || 'Untitled goat post';

  return (
    <article className="feed-item" aria-label={`Post by ${video.creator.displayName}`}>
      {video.kind === 'photos' ? (
        <PhotoAlbum
          photos={video.photos}
          caption={caption}
          eager={active}
          className="feed-stage album"
        />
      ) : shouldMount && video.videoUrl ? (
        <Player
          src={video.videoUrl}
          poster={video.posterUrl}
          active={active}
          onWatch={(stats: WatchStats) => {
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
      ) : (
        <div className="feed-stage">
          {video.posterUrl ? (
            <img className="feed-poster" src={video.posterUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <div className="stage-loading">
              <Icon name="play" size={28} />
            </div>
          )}
        </div>
      )}

      <div className="feed-info">
        <div className="feed-info__top">
          <div className="creator">
            <Link to={`/u/${video.creator.username}`} aria-label={`${video.creator.displayName} profile`}>
              <Avatar
                displayName={video.creator.displayName}
                username={video.creator.username}
                avatarUrl={video.creator.avatarUrl}
                size={38}
              />
            </Link>
            <div className="creator__text">
              <Link to={`/u/${video.creator.username}`} className="creator__name">
                {video.creator.displayName}
              </Link>
              <div className="creator__handle">
                <span className="creator__handle-text">@{video.creator.username}</span>
                {video.creator.isModerator ? (
                  <span className="modbadge" title="Moderator" aria-label="Moderator">
                    <Icon name="shield" size={12} filled />
                  </span>
                ) : null}
              </div>
            </div>
            {!video.creator.isSelf ? (
              <button
                type="button"
                className={`btn btn--sm btn--quiet feed-follow${following ? ' is-following' : ''}`}
                onClick={toggleFollow}
                disabled={followPending}
                aria-pressed={following}
              >
                {following ? 'Following' : 'Follow'}
              </button>
            ) : null}
          </div>

          <Popover
            label="Post options"
            trigger={
              <button type="button" className="iconbtn" aria-label="More options">
                <Icon name="more" size={19} />
              </button>
            }
          >
            {(close) => (
              <>
                <Link to={`/v/${video.id}`} className="menu-item" onClick={close}>
                  <Icon name="eye" size={17} /> Open post
                </Link>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    void copyLink();
                  }}
                >
                  <Icon name="link" size={17} /> Copy link
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    if (requireAuth()) setReportOpen(true);
                  }}
                >
                  <Icon name="flag" size={17} /> Report this post
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item menu-item--danger"
                  onClick={() => {
                    close();
                    if (requireAuth()) onNotInterested(video);
                  }}
                >
                  <Icon name="eye-off" size={17} /> Show fewer like this
                </button>
              </>
            )}
          </Popover>
        </div>

        {video.reason ? (
          <p className="feed-reason">
            <Icon name="spark" size={14} /> {video.reason}
          </p>
        ) : null}

        <p className="feed-caption">
          {caption.split(/(#[\w]{2,24})/g).map((part, partIndex) =>
            part.startsWith('#') ? (
              <Link key={`${part}-${partIndex}`} className="taglink" to={`/search?q=${encodeURIComponent(part)}`}>
                {part}
              </Link>
            ) : (
              <span key={partIndex}>{part}</span>
            ),
          )}
        </p>

        {video.kind === 'photos' && video.sound ? (
          <SoundCredit sound={video.sound} active={active} />
        ) : null}

        <div className="feed-meta-line">
          <span>{compactNumber(video.viewCount)} views</span>
          <span className="meta-sep" aria-hidden="true">
            ·
          </span>
          <span>{timeAgo(video.publishedAt ?? video.createdAt)}</span>
          <span className="meta-sep" aria-hidden="true">
            ·
          </span>
          <Link to={`/search?q=${encodeURIComponent(video.categoryLabel)}`}>{video.categoryLabel}</Link>
        </div>

        <div className="feed-actions">
          <button
            type="button"
            className={`action${liked ? ' is-active is-liked' : ''}${pulse ? ' is-liked' : ''}`}
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? `Unlike post, ${likeCount} likes` : `Like post, ${likeCount} likes`}
          >
            <Icon name="heart" size={19} filled={liked} />
            <span className="action__count">{compactNumber(likeCount)}</span>
            <span className="action__label">{liked ? 'Liked' : 'Like'}</span>
          </button>
          <button
            type="button"
            className="action"
            onClick={() => setCommentsOpen(true)}
            aria-label={`Open comments, ${commentCount} comments`}
          >
            <Icon name="comment" size={19} />
            <span className="action__count">{compactNumber(commentCount)}</span>
            <span className="action__label">Comments</span>
          </button>
          <button type="button" className="action" onClick={share} aria-label="Share video">
            <Icon name="share" size={19} />
            <span className="action__label">Share</span>
          </button>
          <button
            type="button"
            className="action"
            onClick={() => {
              if (requireAuth()) onNotInterested(video);
            }}
            aria-label="Not interested"
          >
            <Icon name="eye-off" size={19} />
            <span className="action__label">Not interested</span>
          </button>
        </div>

        {video.credit ? (
          <p className="feed-credit">Sample clip · {video.credit}</p>
        ) : null}
      </div>

      {commentsOpen ? (
        <CommentsPanel video={video} onClose={() => setCommentsOpen(false)} onCountChange={setCommentCount} />
      ) : null}

      <ReportDialog
        open={reportOpen}
        title="Report this post"
        subject={caption}
        reasons={config?.reportReasons.video ?? ['Not actually a goat', 'Animal mistreatment', 'Spam or misleading', 'Harassment or hate']}
        onClose={() => setReportOpen(false)}
        onSubmit={async (reason, note) => {
          await api.post(`/api/videos/${video.id}/report`, { reason, note });
          notify('Report sent to the moderator.');
        }}
      />
    </article>
  );
}
