import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PostDTO, PublicUser } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { count, fullDate, plural } from '../lib/format';
import { useToast } from '../lib/toast';

export function ProfilePage() {
  const { username = '' } = useParams();
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [posts, setPosts] = useState<PostDTO[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'live' | 'review'>('live');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, list] = await Promise.all([api.profile(username), api.userPosts(username, 1)]);
      setUser(profile.user);
      setPosts(list.items);
      setHasMore(list.hasMore);
      setPage(1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const loadMore = async () => {
    try {
      const list = await api.userPosts(username, page + 1);
      setPosts((current) => [...current, ...list.items]);
      setHasMore(list.hasMore);
      setPage(page + 1);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="column" aria-busy="true">
        <div className="profile-skeleton">
          <div className="profile-skeleton__avatar" />
          <div className="profile-skeleton__lines" />
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="column">
        <div className="empty">
          <p className="empty__title">No creator by that name</p>
          <p>{error || 'Check the spelling, or search for someone else.'}</p>
          <Link to="/search" className="button">
            Search creators
          </Link>
        </div>
      </div>
    );
  }

  const isSelf = user.isSelf || me?.username === user.username;
  const visible = posts.filter((post) =>
    filter === 'live' ? post.status === 'approved' : post.status !== 'approved',
  );
  const reviewCount = posts.filter((post) => post.status !== 'approved').length;

  return (
    <div className="column">
      <header className="profile">
        <Avatar user={user} size={88} />
        <div className="profile__main">
          <div className="profile__top">
            <div>
              <h1 className="profile__name">{user.displayName}</h1>
              <p className="profile__handle">@{user.username}</p>
            </div>
            <div className="profile__actions">
              {isSelf ? (
                <Link to="/settings" className="button button--quiet">
                  Edit profile
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    className={`button ${user.isFollowing ? 'button--quiet' : ''}`}
                    onClick={async () => {
                      if (!me) {
                        navigate('/signin');
                        return;
                      }
                      try {
                        const result = await api.follow(user.username, !user.isFollowing);
                        setUser({
                          ...user,
                          isFollowing: result.following,
                          followerCount: result.followerCount,
                        });
                      } catch (err) {
                        toast((err as Error).message, 'error');
                      }
                    }}
                  >
                    {user.isFollowing ? 'Following' : 'Follow'}
                  </button>
                  <Menu
                    label="Profile options"
                    items={[
                      ...(user.isBlocked
                        ? [
                            {
                              label: 'Unblock',
                              icon: 'users' as const,
                              onSelect: async () => {
                                await api.block(user.username, false);
                                setUser({ ...user, isBlocked: false });
                                toast('Unblocked');
                              },
                            },
                          ]
                        : [
                            {
                              label: 'Block',
                              icon: 'eye-off' as const,
                              onSelect: async () => {
                                await api.block(user.username, true);
                                setUser({ ...user, isBlocked: true, isFollowing: false });
                                toast('Blocked. Their posts are hidden from your feeds.');
                              },
                            },
                          ]),
                      {
                        label: 'Report account',
                        icon: 'flag' as const,
                        tone: 'danger' as const,
                        onSelect: () => navigate(`/report/user/${user.username}`),
                      },
                    ]}
                  />
                </>
              )}
            </div>
          </div>

          <p className="profile__bio">{user.bio || (isSelf ? 'Add a short bio in settings.' : 'No bio yet.')}</p>

          <dl className="profile__stats">
            <div>
              <dt>Posts</dt>
              <dd>{count(user.postCount)}</dd>
            </div>
            <div>
              <dt>Followers</dt>
              <dd>{count(user.followerCount)}</dd>
            </div>
            <div>
              <dt>Following</dt>
              <dd>{count(user.followingCount)}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</dd>
            </div>
          </dl>
          <p className="profile__note">
            {plural(user.postCount, 'approved post', 'approved posts')}
            {isSelf ? ` · ${fullDate(user.createdAt)}` : ''}
          </p>
        </div>
      </header>

      {user.status === 'suspended' ? (
        <div className="notice notice--warning">
          <Icon name="alert" size={18} />
          This account is suspended. Its posts are not shown anywhere.
        </div>
      ) : null}

      {user.isBlocked && !isSelf ? (
        <div className="notice">
          <Icon name="eye-off" size={18} />
          You blocked this account. Unblock from the menu to see their posts.
        </div>
      ) : null}

      {isSelf ? (
        <div className="segmented" role="tablist" aria-label="Your posts">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'live'}
            className={filter === 'live' ? 'is-active' : ''}
            onClick={() => setFilter('live')}
          >
            Live
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'review'}
            className={filter === 'review' ? 'is-active' : ''}
            onClick={() => setFilter('review')}
          >
            In review{reviewCount ? ` (${reviewCount})` : ''}
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="empty">
          <p className="empty__title">
            {isSelf && filter === 'review'
              ? 'Nothing waiting for review'
              : isSelf
                ? 'You have not posted a goat yet'
                : 'No approved posts yet'}
          </p>
          <p>
            {isSelf
              ? 'Every post is looked at by a human before it appears here.'
              : 'When a post is approved it will show up here.'}
          </p>
          {isSelf ? (
            <Link to="/upload" className="button">
              Post a goat
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="post-grid">
          {visible.map((post, index) => (
            <li key={post.id} style={{ '--i': Math.min(index, 11) } as CSSProperties}>
              <Link to={`/p/${post.id}`} className="post-grid__tile" aria-label={post.caption || 'Goat post'}>
                {post.photos[0] ? (
                  <img src={post.photos[0].url} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="post-grid__missing">No photo</span>
                )}
                {post.photos.length > 1 ? (
                  <span className="post-grid__count" aria-label={`${post.photos.length} photos`}>
                    <Icon name="grid" size={13} />
                    {post.photos.length}
                  </span>
                ) : null}
                {post.status !== 'approved' ? (
                  <span className={`post-grid__status post-grid__status--${post.status}`}>
                    {post.status === 'pending'
                      ? 'In review'
                      : post.status === 'rejected'
                        ? 'Not approved'
                        : 'Removed'}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <button type="button" className="button button--quiet profile__more" onClick={loadMore}>
          Load more
        </button>
      ) : null}
    </div>
  );
}
