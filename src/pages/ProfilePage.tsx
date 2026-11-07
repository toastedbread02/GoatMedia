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
import { GridSkeleton, ProfileSkeleton } from '../components/Skeleton.tsx';

type Tab = 'published' | 'saved' | 'pending' | 'rejected' | 'removed';
type PeopleList = 'followers' | 'following';

const TAB_LABEL: Record<Tab, string> = {
  published: 'Published',
  saved: 'Saved',
  pending: 'In review',
  rejected: 'Not approved',
  removed: 'Removed',
};

const EMPTY_COPY: Record<Tab, string> = {
  published: 'Nothing published yet. The first approved post will show up here.',
  saved: 'Nothing saved yet. Tap Save on a post to keep it here.',
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
  const [people, setPeople] = useState<PeopleList | null>(null);
  const [peopleItems, setPeopleItems] = useState<PublicUser[] | null>(null);
  const [peoplePage, setPeoplePage] = useState(1);
  const [peopleHasMore, setPeopleHasMore] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [followPendingIds, setFollowPendingIds] = useState<Record<string, boolean>>({});

  useDocumentTitle(profile ? `${profile.displayName} (@${profile.username})` : 'Profile');

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setProfileError(null);
    setVideos(null);
    setCounts(null);
    setTab('published');
    setConfirmBlock(false);
    setPeople(null);
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
    const path =
      tab === 'saved' ? '/api/me/saved' : `/api/users/${username}/videos?tab=${tab}`;
    api
      .get<{ items: VideoDTO[]; counts: Record<VideoStatus, number> | null }>(path)
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

  useEffect(() => {
    if (!people) {
      setPeopleItems(null);
      setPeopleHasMore(false);
      setPeoplePage(1);
      setPeopleError(null);
      return;
    }
    let cancelled = false;
    setPeopleItems(null);
    setPeopleError(null);
    setPeoplePage(1);
    setPeopleHasMore(false);
    api
      .get<{ users: PublicUser[]; hasMore: boolean }>(`/api/users/${username}/${people}?page=1`)
      .then((data) => {
        if (cancelled) return;
        setPeopleItems(data.users);
        setPeopleHasMore(data.hasMore);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setPeopleItems([]);
        setPeopleError(loadError instanceof Error ? loadError.message : 'That list could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [people, username]);

  const loadMorePeople = async () => {
    if (!people || peopleLoading) return;
    const next = peoplePage + 1;
    setPeopleLoading(true);
    try {
      const data = await api.get<{ users: PublicUser[]; hasMore: boolean }>(
        `/api/users/${username}/${people}?page=${next}`,
      );
      setPeopleItems((current) => [...(current ?? []), ...data.users]);
      setPeopleHasMore(data.hasMore);
      setPeoplePage(next);
    } catch {
      notify('Could not load more people.', { tone: 'error' });
    } finally {
      setPeopleLoading(false);
    }
  };

  const togglePersonFollow = async (person: PublicUser) => {
    if (!user) {
      notify('Sign in to follow this creator.', {
        actionLabel: 'Sign in',
        onAction: () => navigate(`/login?next=${encodeURIComponent(location.pathname)}`),
      });
      return;
    }
    const next = !person.isFollowing;
    setFollowPendingIds((current) => ({ ...current, [person.id]: true }));
    setPeopleItems((current) =>
      current?.map((item) => (item.id === person.id ? { ...item, isFollowing: next } : item)) ?? current,
    );
    try {
      if (next) await api.post(`/api/users/${person.username}/follow`);
      else await api.delete(`/api/users/${person.username}/follow`);
    } catch {
      setPeopleItems((current) =>
        current?.map((item) => (item.id === person.id ? { ...item, isFollowing: !next } : item)) ?? current,
      );
      notify('Could not update that follow.', { tone: 'error' });
    } finally {
      setFollowPendingIds((current) => {
        const copy = { ...current };
        delete copy[person.id];
        return copy;
      });
    }
  };

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

  if (!profile || authLoading) return <ProfileSkeleton />;

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
      if (next) await api.post(`/api/users/${profile.username}/follow`);
      else await api.delete(`/api/users/${profile.username}/follow`);
    } catch {
      setProfile(profile);
      notify('Could not update that follow.', { tone: 'error' });
    } finally {
      setFollowPending(false);
    }
  };

  const block = async () => {
    try {
      await api.post(`/api/users/${profile.username}/block`);
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
      await api.delete(`/api/users/${profile.username}/block`);
      setBlocked(false);
      notify(`Unblocked @${profile.username}.`);
    } catch {
      notify('Could not unblock that account.', { tone: 'error' });
    }
  };

  const tabs: Tab[] = [
    'published',
    'saved',
    'pending',
    'rejected',
    ...(counts?.removed ? (['removed'] as Tab[]) : []),
  ];

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
            {profile.followsPrivate && !isSelf ? (
              <>
                <span>
                  <strong>{profile.videoCount}</strong> {plural(profile.videoCount, 'post')}
                </span>
                <span className="meta-sep" aria-hidden="true">
                  ·
                </span>
                <span>Follower lists private</span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`profile-count${people === 'followers' ? ' is-active' : ''}`}
                  aria-expanded={people === 'followers'}
                  aria-controls="profile-people"
                  onClick={() => setPeople(people === 'followers' ? null : 'followers')}
                >
                  <strong>{profile.followerCount}</strong> {plural(profile.followerCount, 'follower')}
                </button>
                <span className="meta-sep" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  className={`profile-count${people === 'following' ? ' is-active' : ''}`}
                  aria-expanded={people === 'following'}
                  aria-controls="profile-people"
                  onClick={() => setPeople(people === 'following' ? null : 'following')}
                >
                  <strong>{profile.followingCount}</strong> following
                </button>
                <span className="meta-sep" aria-hidden="true">
                  ·
                </span>
                <span>
                  <strong>{profile.videoCount}</strong> {plural(profile.videoCount, 'post')}
                </span>
              </>
            )}
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
                    {!isSelf ? (
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          navigate(`/contact?topic=person&username=${encodeURIComponent(profile.username)}`);
                        }}
                      >
                        <Icon name="flag" size={17} /> Report @{profile.username}
                      </button>
                    ) : null}
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

      {people && !(profile.followsPrivate && !isSelf) ? (
        <section id="profile-people" className="profile-people" aria-label={`${people === 'followers' ? 'Followers' : 'Following'} of @${profile.username}`}>
          <div className="profile-people__head">
            <h2>{people === 'followers' ? 'Followers' : 'Following'}</h2>
            <button type="button" className="textlink" onClick={() => setPeople(null)}>
              Close
            </button>
          </div>

          {peopleItems === null ? (
            <p className="section-note" role="status">
              Loading…
            </p>
          ) : peopleError ? (
            <p className="section-note">{peopleError}</p>
          ) : peopleItems.length === 0 ? (
            <p className="section-note">
              {people === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
            </p>
          ) : (
            <ul className="mini-list">
              {peopleItems.map((person) => (
                <li key={person.id} className="mini-video">
                  <Link to={`/u/${person.username}`} className="mini-video__avatar">
                    <Avatar
                      displayName={person.displayName}
                      username={person.username}
                      avatarUrl={person.avatarUrl}
                      size={40}
                    />
                  </Link>
                  <div className="mini-video__body">
                    <Link to={`/u/${person.username}`}>{person.displayName}</Link>
                    <span className="field__hint">
                      @{person.username}
                      {person.bio ? ` · ${person.bio}` : ''}
                    </span>
                  </div>
                  {person.isSelf ? (
                    <span className="field__hint">You</span>
                  ) : (
                    <button
                      type="button"
                      className={`btn btn--sm ${person.isFollowing ? 'btn--quiet is-following' : 'btn--primary'}`}
                      onClick={() => togglePersonFollow(person)}
                      disabled={Boolean(followPendingIds[person.id])}
                      aria-pressed={person.isFollowing}
                    >
                      {person.isFollowing ? 'Following' : 'Follow'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {peopleHasMore ? (
            <div className="profile-people__more">
              <button type="button" className="btn btn--quiet btn--sm" onClick={loadMorePeople} disabled={peopleLoading}>
                {peopleLoading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

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
            {isSelf && counts && item !== 'saved' ? (
              <span className="profile-tab__count">
                {counts[item === 'published' ? 'approved' : item] ?? 0}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'pending' && isSelf ? (
        <p className="section-note profile-note">
          Every upload is watched by a person before it goes public. Nothing here is visible to anyone else.
        </p>
      ) : null}

      {videos === null ? (
        <GridSkeleton count={6} label="Loading posts" />
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <h2>{tab === 'published' && isSelf ? 'Nothing posted yet' : EMPTY_COPY[tab]}</h2>
          <p>
            {tab === 'published' && isSelf
              ? 'Post a video or a set of photos of your goats. It will appear here after the moderator approves it.'
              : tab === 'published'
                ? 'This creator has not had a post approved yet.'
                : tab === 'saved'
                  ? 'Posts you save stay here, even after you close the tab.'
                  : 'That is a good sign.'}
          </p>
          {isSelf && tab === 'published' ? (
            <div className="empty-state__actions">
              <Link className="btn btn--primary" to="/upload">
                Upload a post
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
