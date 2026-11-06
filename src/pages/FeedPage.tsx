import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { PostDTO, SoundLibraryItem } from '../../shared/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfig } from '../lib/config';
import { duration, plural } from '../lib/format';
import { CommentsPanel } from '../components/CommentsPanel';
import { Icon } from '../components/Icon';
import { PostCard } from '../components/PostCard';
import { SoundSheet } from '../components/SoundSheet';

type Tab = 'foryou' | 'trending' | 'following';

const headings: Record<Tab, { title: string; blurb: string }> = {
  foryou: {
    title: 'For You',
    blurb: 'Picked from what you spend time on, with room for goats you have not met.',
  },
  trending: {
    title: 'Trending',
    blurb: 'What goat people have been looking at, liking and arguing about this week.',
  },
  following: {
    title: 'Following',
    blurb: 'The newest posts from the creators you follow.',
  },
};

export function FeedPage({ tab }: { tab: Tab }) {
  const { me } = useAuth();
  const config = useConfig();
  const [items, setItems] = useState<PostDTO[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [commentsFor, setCommentsFor] = useState<PostDTO | null>(null);
  const [sounds, setSounds] = useState<SoundLibraryItem[]>([]);
  const [soundOpen, setSoundOpen] = useState<SoundLibraryItem | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      const id = ++requestId.current;
      if (replace) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const result = await api.feed(tab, nextPage);
        if (id !== requestId.current) return;
        setItems((current) => (replace ? result.items : [...current, ...result.items]));
        setHasMore(result.hasMore);
        setPage(nextPage);
        setRequiresSignIn(Boolean(result.requiresSignIn));
        setSuspended(Boolean(result.suspended));
      } catch (err) {
        if (id !== requestId.current) return;
        setError((err as Error).message);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [tab],
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    void load(1, true);
  }, [load]);

  useEffect(() => {
    if (tab !== 'foryou') return;
    let cancelled = false;
    api
      .sounds('', 1)
      .then((result) => {
        if (!cancelled) setSounds(result.sounds.slice(0, 4));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(page + 1, false);
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, load, page]);

  const update = (id: string, patch: Partial<PostDTO>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const heading = headings[tab];

  return (
    <div className="layout">
      <div className="column">
        <header className="page-head">
          <h1 className="page-title">{heading.title}</h1>
          <p className="page-blurb">{heading.blurb}</p>
        </header>

        {suspended ? (
          <div className="empty">
            <Icon name="alert" size={26} />
            <p className="empty__title">This account is on hold</p>
            <p>The moderator needs a word before you can browse. Check your email or get in touch.</p>
          </div>
        ) : requiresSignIn && !me ? (
          <div className="empty">
            <p className="empty__title">Following is a signed-in feed</p>
            <p>Create an account to follow goat creators and keep track of their new posts.</p>
            <div className="empty__actions">
              <Link to="/register" className="button">
                Create an account
              </Link>
              <Link to="/signin" className="button button--quiet">
                Sign in
              </Link>
            </div>
          </div>
        ) : loading ? (
          <div className="feed" aria-busy="true">
            {[0, 1].map((row) => (
              <div className="post-skeleton" key={row} style={{ '--i': row } as CSSProperties}>
                <div className="post-skeleton__head" />
                <div className="post-skeleton__media" />
                <div className="post-skeleton__line" />
                <div className="post-skeleton__line post-skeleton__line--short" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="empty">
            <p className="empty__title">That feed did not load</p>
            <p>{error}</p>
            <button type="button" className="button" onClick={() => load(1, true)}>
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <p className="empty__title">
              {tab === 'following' ? 'Nothing from your people yet' : 'No approved goats here yet'}
            </p>
            <p>
              {tab === 'following'
                ? 'Follow a few creators and their new posts will land here.'
                : 'Every post is reviewed by a human first. Check back shortly, or add the first one.'}
            </p>
            <div className="empty__actions">
              <Link to="/upload" className="button">
                Post a goat
              </Link>
              {tab === 'following' ? (
                <Link to="/" className="button button--quiet">
                  Find creators
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="feed">
            {items.map((post, index) => (
              <PostCard
                key={post.id}
                post={post}
                priority={index === 0}
                onUpdate={(patch) => update(post.id, patch)}
                onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))}
                onOpenComments={(value) => setCommentsFor(value)}
              />
            ))}
            <div ref={sentinel} className="feed__sentinel" aria-hidden="true" />
            {loadingMore ? <p className="feed__loading">Loading more goats…</p> : null}
          </div>
        )}
      </div>

      <aside className="feed-aside" aria-label="About this feed">
        {tab === 'foryou' && sounds.length ? (
          <section className="aside-block">
            <h2 className="aside-title">Sounds worth borrowing</h2>
            <ul className="sound-list">
              {sounds.map((sound) => (
                <li key={sound.id}>
                  <button type="button" className="sound-row" onClick={() => setSoundOpen(sound)}>
                    <span className="sound-row__icon" aria-hidden="true">
                      <Icon name="play" size={13} />
                    </span>
                    <span className="sound-row__text">
                      <strong>{sound.title}</strong>
                      <span className="muted">
                        @{sound.owner.username} · {duration(sound.durationMs)} ·{' '}
                        {plural(sound.useCount, 'use', 'uses')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link to="/upload" className="text-link">
              Post with a sound
            </Link>
          </section>
        ) : null}

        <section className="aside-block">
          <h2 className="aside-title">Why you see this</h2>
          <p className="aside-text">
            Each post you linger on, like, comment on or skip nudges these scores. The weights are
            plain numbers: a like is worth 3, finishing a post 5, saying “not interested” −15.
          </p>
          <Link to="/settings?tab=feed" className="text-link">
            See and reset your interests
          </Link>
        </section>

        <section className="aside-block aside-block--quiet">
          <h2 className="aside-title">House rule</h2>
          <p className="aside-text">{config.guidelines[0]}</p>
          <Link to="/guidelines" className="text-link">
            Read the guidelines
          </Link>
        </section>
      </aside>

      {commentsFor ? (
        <CommentsPanel
          post={commentsFor}
          onClose={() => setCommentsFor(null)}
          onCountChange={(id, value) => update(id, { commentCount: value })}
        />
      ) : null}
      {soundOpen ? <SoundSheet sound={soundOpen} onClose={() => setSoundOpen(null)} /> : null}
    </div>
  );
}
