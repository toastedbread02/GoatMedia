import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { VideoDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useToast } from '../lib/toast.tsx';
import { compactNumber } from '../lib/format.ts';
import { shareLink } from '../lib/share.ts';
import { argGhost, argTrace, isEgg, postAge, profilePath } from '../lib/easterEgg.ts';
import { ArgTraceMark } from './ArgTrace.tsx';
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
  const [saved, setSaved] = useState(video.saved);
  const [commentCount, setCommentCount] = useState(video.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const active = index === activeIndex;
  // This post has no server side, so its interactions stay in this tab.
  const eggPost = isEgg(video.id);
  const shouldMount = Math.abs(index - activeIndex) <= 1;

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
    if (eggPost) {
      // Nothing is stored for this post, so the count only exists in this tab.
      setLiked(!liked);
      setLikeCount((count) => Math.max(0, count + (liked ? -1 : 1)));
      return;
    }
    if (!requireAuth()) return;
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
      notify('That like did not save. Try again.', { tone: 'error' });
    }
  };

  const toggleFollow = async () => {
    if (eggPost) {
      setFollowing(!following);
      return;
    }
    if (!requireAuth()) return;
    const next = !following;
    setFollowing(next);
    setFollowPending(true);
    try {
      if (next) {
        await api.post(`/api/users/${video.creator.username}/follow`, { fromVideoId: video.id });
      } else {
        await api.delete(`/api/users/${video.creator.username}/follow`);
      }
    } catch {
      setFollowing(!next);
      notify('Could not update that follow.', { tone: 'error' });
    } finally {
      setFollowPending(false);
    }
  };

  const share = async () => {
    const url = shareLink(`v/${video.id}`, 'share' in navigator ? 'native' : 'copy');
    try {
      if (navigator.share) {
        await navigator.share({ title: video.caption || 'GoatMedia', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      notify('Link copied.', { actionLabel: 'Open video', onAction: () => navigate(`/v/${video.id}`) });
    } catch {
      /* the user dismissed the share sheet */
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(`v/${video.id}`, 'copy'));
      notify('Link copied.');
    } catch {
      notify('Could not copy the link.', { tone: 'error' });
    }
  };

  const openShareTarget = (target: 'x' | 'whatsapp' | 'reddit') => {
    const text = video.caption || 'A goat video on GoatMedia';
    const link = shareLink(`v/${video.id}`, target === 'x' ? 'twitter' : target);
    const urls = {
      x: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`,
      reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent(text)}`,
    };
    window.open(urls[target], '_blank', 'noopener,noreferrer');
  };

  const toggleSave = async () => {
    if (eggPost) {
      setSaved(!saved);
      notify(saved ? 'Removed from saved.' : 'Saved to your profile.');
      return;
    }
    if (!requireAuth()) return;
    const next = !saved;
    setSaved(next);
    try {
      const data = await api.post<{ saved: boolean }>(`/api/videos/${video.id}/save`);
      setSaved(data.saved);
      notify(data.saved ? 'Saved to your profile.' : 'Removed from saved.');
    } catch {
      setSaved(!next);
      notify('That did not save. Try again.', { tone: 'error' });
    }
  };

  const caption = video.caption || 'Untitled goat post';
  const profileHref = profilePath(video.creator.username);

  return (
    <article className="feed-item" aria-label={`Post by ${video.creator.displayName}`}>
      <div className="feed-canvas">
        {video.kind === 'photos' ? (
          <PhotoAlbum
            photos={video.photos}
            caption={caption}
            eager={active}
            className="feed-stage album"
            onDoubleTap={() => {
              // Already liked? Then the tap is just feedback, not another write.
              if (!liked) void toggleLike();
            }}
          />
        ) : shouldMount && video.videoUrl ? (
          <Player
            src={video.videoUrl}
            poster={video.posterUrl}
            active={active}
            warm={index === activeIndex + 1}
            resumeAt={video.watchProgress}
            onProgress={(seconds) => {
              if (!user || eggPost) return;
              api
                .post(`/api/videos/${video.id}/progress`, {
                  positionMs: Math.round(seconds * 1000),
                  durationMs: Math.round((video.duration || 0) * 1000),
                })
                .catch(() => {});
            }}
            onDoubleTap={() => {
              // Already liked? Then the tap is just feedback, not another write.
              if (!liked) void toggleLike();
            }}
            onWatch={(stats: WatchStats) => {
              if (eggPost) return;
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

        <div className="feed-options">
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
                {(
                  <>
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
                        openShareTarget('x');
                      }}
                    >
                      <Icon name="share" size={17} /> Share to X
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close();
                        openShareTarget('whatsapp');
                      }}
                    >
                      <Icon name="share" size={17} /> Share to WhatsApp
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close();
                        openShareTarget('reddit');
                      }}
                    >
                      <Icon name="share" size={17} /> Share to Reddit
                    </button>
                  </>
                )}
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

        <div className="feed-overlay">
          <div className="feed-bottom">
            {eggPost && argGhost(video.id) ? (
              <Link className="arg-ghost" to={argGhost(video.id) as string} tabIndex={-1} aria-hidden="true">
                .
              </Link>
            ) : null}
            {eggPost && argTrace(video.id) ? <ArgTraceMark trace={argTrace(video.id)!} /> : null}
            <div className="feed-byline">
              <Link to={profileHref} className="feed-byline__name">
                {video.creator.displayName}
              </Link>
              <Link to={profileHref} className="feed-byline__handle">
                @{video.creator.username}
              </Link>
              {video.creator.isModerator ? (
                <span className="modbadge" title="Moderator" aria-label="Moderator">
                  <Icon name="shield" size={12} filled />
                </span>
              ) : null}
            </div>

            <p className="feed-caption">
              {caption.split(/(#[\w]{2,24})/g).map((part, partIndex) =>
                part.startsWith('#') ? (
                  <Link
                    key={`${part}-${partIndex}`}
                    className="taglink"
                    to={`/tag/${encodeURIComponent(part.slice(1))}`}
                  >
                    {part}
                  </Link>
                ) : (
                  <span key={partIndex}>{part}</span>
                ),
              )}
            </p>

            {video.reason ? (
              <p className="feed-reason">
                <Icon name="spark" size={14} /> {video.reason}
              </p>
            ) : null}

            {video.goatOfDay ? (
              <Link className="feed-dotd" to="/daily">
                Goat of the day
              </Link>
            ) : null}

            {video.kind === 'photos' && video.sound ? (
              <SoundCredit sound={video.sound} active={active} />
            ) : null}

            <div className="feed-meta-line">
              <span>{eggPost ? video.viewCount : compactNumber(video.viewCount)} views</span>
              <span className="meta-sep" aria-hidden="true">
                ·
              </span>
              <span>{postAge(video)}</span>
              <span className="meta-sep" aria-hidden="true">
                ·
              </span>
              <Link to={`/search?q=${encodeURIComponent(video.categoryLabel)}`}>{video.categoryLabel}</Link>
            </div>

            {video.credit ? <p className="feed-credit">Sample clip · {video.credit}</p> : null}
          </div>

          <div className="feed-rail">
            <div className="feed-rail__creator">
              <Link to={profileHref} aria-label={`${video.creator.displayName} profile`}>
                <Avatar
                  displayName={video.creator.displayName}
                  username={video.creator.username}
                  avatarUrl={video.creator.avatarUrl}
                  size={44}
                />
              </Link>
              {!video.creator.isSelf ? (
                <button
                  type="button"
                  className={`feed-rail__follow${following ? ' is-following' : ''}`}
                  onClick={toggleFollow}
                  disabled={followPending}
                  aria-pressed={following}
                  aria-label={
                    following ? `Unfollow @${video.creator.username}` : `Follow @${video.creator.username}`
                  }
                  title={following ? 'Following' : 'Follow'}
                >
                  <Icon name={following ? 'check' : 'plus'} size={13} strokeWidth={2.6} />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              className={`feed-rail__btn${liked ? ' is-liked' : ''}`}
              onClick={toggleLike}
              aria-pressed={liked}
              aria-label={liked ? `Unlike post, ${likeCount} likes` : `Like post, ${likeCount} likes`}
            >
              <span className="feed-rail__icon">
                <Icon name="heart" size={22} filled={liked} />
              </span>
              <span className="feed-rail__count">{compactNumber(likeCount)}</span>
            </button>

            <button
              type="button"
              className="feed-rail__btn"
              onClick={() => setCommentsOpen(true)}
              aria-label={`Open comments, ${commentCount} comments`}
            >
              <span className="feed-rail__icon">
                <Icon name="comment" size={21} />
              </span>
              <span className="feed-rail__count">{compactNumber(commentCount)}</span>
            </button>

            <button
              type="button"
              className={`feed-rail__btn${saved ? ' is-liked' : ''}`}
              onClick={toggleSave}
              aria-pressed={saved}
              aria-label={saved ? 'Remove from saved' : 'Save post'}
            >
              <span className="feed-rail__icon">
                <Icon name="bookmark" size={21} filled={saved} />
              </span>
              <span className="feed-rail__count">{saved ? 'Saved' : 'Save'}</span>
            </button>

            <button
              type="button"
              className="feed-rail__btn"
              onClick={share}
              aria-label="Share post"
            >
              <span className="feed-rail__icon">
                <Icon name="share" size={21} />
              </span>
              <span className="feed-rail__count">Share</span>
            </button>
          </div>
        </div>
      </div>

      {commentsOpen ? (
        <CommentsPanel video={video} onClose={() => setCommentsOpen(false)} onCountChange={setCommentCount} />
      ) : null}

      <ReportDialog
        open={reportOpen}
        title="Report this post"
        subject={caption}
        reasons={config?.reportReasons.video ?? ['Not actually a goat', 'Animal mistreatment', 'Spam or misleading', 'Harassment or hate']}
        onClose={() => setReportOpen(false)}          onSubmit={async (reason, note) => {
            if (!eggPost) await api.post(`/api/videos/${video.id}/report`, { reason, note });
            notify('Report sent to the moderator.');
        }}
      />
    </article>
  );
}
