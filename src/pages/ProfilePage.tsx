import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { PublicUser, VideoDTO, VideoStatus } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useToast } from '../lib/toast.tsx';
import { monthYear, plural } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';
import { Popover } from '../components/Popover.tsx';
import { VideoCard } from '../components/VideoCard.tsx';

type Tab = 'published' | 'pending' | 'rejected' | 'removed';

const TAB_LABEL: Record<Tab, string> = {
  published: 'Published',
  pending: 'In review',
  rejected: 'Not approved',
  removed: 'Removed',
};

const EMPTY_COPY: Record<Tab, string> = {
  published: 'Nothing published yet. The first approved video will show up here.',
  pending: 'Nothing waiting for review right now.',
  rejected: 'No videos have been turned down.',
  removed: 'No videos have been removed.',
};

export function ProfilePage() {
  const { username = '' } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoDTO[] | null>(null);
  const [counts, setCounts] = useState<Record<VideoStatus, number> | null>(null);
  const [tab, setTab] = useState<Tab>('published');
  const [followPending, setFollowPending] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useDocumentTitle(profile ? `${profile.displayName} (@${profile.username})` : 'Profile');

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setProfileError(null);
    setVideos(null);
    setCounts(null);
    setTab('published');
    setConfirmBlock(false);
    api
      .get<{ user: PublicUser }>(`/api/users/${username}`)
      .then((data) => {
        if (cancelled) return;
        setProfile(data.user);
        setBlocked(data.user.isBlocked);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setProfileError(loadError instanceof Error ? loadError.message : 'That profile could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setVideos(null);
    api
      .get<{ items: VideoDTO[]; counts: Record<VideoStatus, number> | null }>(
        `/api/users/${username}/videos?tab=${tab}`,
      )
      .then((data) => {
        if (cancelled) return;
        setVideos(data.items);
        setCounts(data.counts);
      })
      .catch(() => {
        if (!cancelled) setVideos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, username, tab]);

  if (profileError) {
    return (
      <div className="page">
        <div className="empty-state" style={{ paddingTop: 48 }}>
          <Icon name="user" size={26} />
          <h2>Profile not found</h2>
          <p>{profileError}</p>
          <Link className="btn btn--primary" to="/">
            Back to the feed
          </Link>
        </div>
      </div>
    );
  }

  if (!profile || authLoading) {
    return (
      <div className="page">
        <div className="feed-empty">
          <div className="spinner spinner--dark" />
          <p>Loading profile…</p>
        </div>
      </div>
    );
  }

  const isSelf = user?.id === profile.id;

  const toggleFollow = async () => {
    if (!user) {
      notify('Sign in to follow this creator.', {
        actionLabel: 'Sign in',
        onAction: () => navigate(`/login?next=${encodeURIComponent(location.pathname)}`),
      });
      return;
    }
    const next = !profile.isFollowing;
    setFollowPending(true);
    setProfile({
      ...profile,
      isFollowing: next,
      followerCount: Math.max(0, profile.followerCount + (next ? 1 : -1)),
    });
    try {
      if (next) await api.post(`/api/users/${profile.id}/follow`);
      else await api.delete(`/api/users/${profile.id}/follow`);
    } catch {
      setProfile(profile);
      notify('Could not update that follow.', { tone: 'error' });
    } finally {
      setFollowPending(false);
    }
  };

  const block = async () => {
    try {
      await api.post(`/api/users/${profile.id}/block`);
      setBlocked(true);
      setConfirmBlock(false);
      setProfile({ ...profile, isFollowing: false });
      notify(`Blocked @${profile.username}. You can undo this in settings.`);
    } catch {
      notify('Could not block that account.', { tone: 'error' });
    }
  };

  const unblock = async () => {
    try {
      await api.delete(`/api/users/${profile.id}/block`);
      setBlocked(false);
      notify(`Unblocked @${profile.username}.`);
    } catch {
      notify('Could not unblock that account.', { tone: 'error' });
    }
  };

  const tabs: Tab[] = ['published', 'pending', 'rejected', ...(counts?.removed ? (['removed'] as Tab[]) : [])];

  return (
    <div className="page">
      <header className="profile-head">
        <Avatar
          displayName={profile.displayName}
          username={profile.username}
          avatarUrl={profile.avatarUrl}
          size={92}
          className="profile-avatar"
        />
        <div className="profile-head__body">
          <h1 className="profile-name">{profile.displayName}</h1>
          <p className="profile-username">@{profile.username}</p>
          <p className="profile-bio">{profile.bio || (isSelf ? 'Add a short bio in settings.' : 'No bio yet.')}</p>
          <p className="profile-counts">
            <strong>{profile.followerCount}</strong> {plural(profile.followerCount, 'follower')}
            <span className="meta-sep" aria-hidden="true">
              ·
            </span>
            <strong>{profile.followingCount}</strong> following
            <span className="meta-sep" aria-hidden="true">
              ·
            </span>
            <strong>{profile.videoCount}</strong> {plural(profile.videoCount, 'video')}
          </p>
          <p className="profile-joined">Joined {monthYear(profile.createdAt)}</p>
        </div>
        <div className="profile-actions">
          {isSelf ? (
            <>
              <Link className="btn btn--quiet" to="/settings">
                Edit profile
              </Link>
              <Link className="btn btn--primary" to="/upload">
                <Icon name="plus" size={17} /> Upload
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`btn ${profile.isFollowing ? 'btn--quiet is-following' : 'btn--primary'}`}
                onClick={toggleFollow}
                disabled={followPending}
                aria-pressed={profile.isFollowing}
              >
                {profile.isFollowing ? 'Following' : 'Follow'}
              </button>
              <Popover
                label="Profile options"
                trigger={
                  <button type="button" className="iconbtn" aria-label="More profile options">
                    <Icon name="more" size={19} />
                  </button>
                }
              >
                {(close) => (
                  <>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close();
                        void navigator.clipboard.writeText(`${window.location.origin}/u/${profile.username}`).then(
                          () => notify('Profile link copied.'),
                          () => notify('Could not copy the link.', { tone: 'error' }),
                        );
                      }}
                    >
                      <Icon name="link" size={17} /> Copy profile link
                    </button>
                    {blocked ? (
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          void unblock();
                        }}
                      >
                        <Icon name="user" size={17} /> Unblock @{profile.username}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="menu-item menu-item--danger"
                        onClick={() => {
                          close();
                          if (!user) {
                            notify('Sign in to block this account.', {
                              actionLabel: 'Sign in',
                              onAction: () => navigate(`/login?next=${encodeURIComponent(location.pathname)}`),
                            });
                            return;
                          }
                          setConfirmBlock(true);
                        }}
                      >
                        <Icon name="eye-off" size={17} /> Block @{profile.username}
                      </button>
                    )}
                  </>
                )}
              </Popover>
            </>
          )}
        </div>
      </header>

      {blocked ? (
        <div className="notice">
          <Icon name="eye-off" size={18} />
          <p>You blocked this account, so their videos and comments are hidden for you.</p>
          <button type="button" className="btn btn--quiet btn--sm" onClick={unblock}>
            Unblock
          </button>
        </div>
      ) : null}

      {confirmBlock ? (
        <div className="inline-confirm">
          <p>
            Block @{profile.username}? Their videos and comments will be hidden from your feed and you will stop
            following each other.
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn--danger btn--sm" onClick={block}>
              Block account
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirmBlock(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="profile-tabs" role="tablist" aria-label={isSelf ? 'Your videos' : 'Videos'}>
        {(isSelf ? tabs : (['published'] as Tab[])).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`profile-tab${tab === item ? ' is-active' : ''}`}
            onClick={() => setTab(item)}
          >
            {TAB_LABEL[item]}
            {isSelf && counts ? <span className="profile-tab__count">{counts[item === 'published' ? 'approved' : item] ?? 0}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'pending' && isSelf ? (
        <p className="section-note profile-note">
          Every upload is watched by a person before it goes public. Nothing here is visible to anyone else.
        </p>
      ) : null}

      {videos === null ? (
        <div className="video-grid" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div className="video-skeleton" key={index} />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <h2>{tab === 'published' && isSelf ? 'No videos yet' : EMPTY_COPY[tab]}</h2>
          <p>
            {tab === 'published' && isSelf
              ? 'Upload a video of your goats. It will appear here after the moderator approves it.'
              : tab === 'published'
                ? 'This creator has not had a video approved yet.'
                : 'That is a good sign.'}
          </p>
          {isSelf && tab === 'published' ? (
            <div className="empty-state__actions">
              <Link className="btn btn--primary" to="/upload">
                Upload a video
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="video-grid">
          {videos.map((video, index) => (
            <VideoCard key={video.id} video={video} showStatus={isSelf && tab !== 'published'} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
