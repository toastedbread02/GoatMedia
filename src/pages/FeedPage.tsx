import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FeedResponse, VideoDTO } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { getCachedFeed, patchCachedFeed, setCachedFeed } from '../lib/feedCache.ts';
import { useToast } from '../lib/toast.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { FeedItem } from '../components/FeedItem.tsx';
import { Icon } from '../components/Icon.tsx';

type Tab = 'foryou' | 'trending' | 'following';

const TITLES: Record<Tab, string> = {
  foryou: 'For You',
  trending: 'Trending',
  following: 'Following',
};

interface FeedPageProps {
  tab: Tab;
}

export function FeedPage({ tab }: FeedPageProps) {
  const { user, loading: authLoading } = useAuth();
  const { notify } = useToast();
  const cacheKey = `${tab}:${user?.id ?? 'guest'}`;
  const [items, setItems] = useState<VideoDTO[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  const scroller = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  const pageRef = useRef(page);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(false);
  const loadedKey = useRef<string | null>(null);
  const activeIndexRef = useRef(activeIndex);
  const frame = useRef(0);

  useDocumentTitle(TITLES[tab]);

  itemsRef.current = items;
  pageRef.current = page;
  hasMoreRef.current = hasMore;
  activeIndexRef.current = activeIndex;

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      try {
        const data = await api.get<FeedResponse>(`/api/feed?tab=${tab}&page=${nextPage}`);
        const seen = new Set(replace ? [] : itemsRef.current.map((item) => item.id));
        const nextItems = replace ? data.items : [...itemsRef.current, ...data.items.filter((item) => !seen.has(item.id))];
        setItems(nextItems);
        setPage(nextPage);
        setHasMore(data.hasMore);
        setCachedFeed(cacheKey, {
          items: nextItems,
          page: nextPage,
          hasMore: data.hasMore,
          activeIndex: replace ? 0 : Math.max(0, activeIndexRef.current),
          scrollTop: replace ? 0 : (scroller.current?.scrollTop ?? 0),
        });
        setError(null);
        setNeedsSignIn(false);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          setNeedsSignIn(true);
        } else {
          setError(loadError instanceof Error ? loadError.message : 'The feed could not load.');
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [tab, cacheKey],
  );

  useEffect(() => {
    if (loadedKey.current === cacheKey) return;
    if (authLoading) return;
    loadedKey.current = cacheKey;
    const cached = getCachedFeed(cacheKey);
    setHidden({});
    setError(null);
    setNeedsSignIn(false);

    if (tab === 'following' && !user) {
      setItems([]);
      setLoading(false);
      setNeedsSignIn(true);
      return;
    }
    if (cached && cached.items.length) {
      setItems(cached.items);
      setPage(cached.page);
      setHasMore(cached.hasMore);
      setActiveIndex(Math.max(0, cached.activeIndex));
      setLoading(false);
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = cached.scrollTop;
      });
      return;
    }
    setItems([]);
    setPage(0);
    setHasMore(true);
    setActiveIndex(0);
    setLoading(true);
    void load(1, true);
  }, [cacheKey, authLoading, user, tab, load]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current || needsSignIn) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void load(pageRef.current + 1, false);
  }, [load, needsSignIn]);

  const handleScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const element = scroller.current;
      if (!element) return;
      const height = element.clientHeight;
      if (!height) return;
      const rawIndex = Math.round(element.scrollTop / height);
      const nextActive = rawIndex >= itemsRef.current.length ? -1 : Math.max(0, rawIndex);
      setActiveIndex(nextActive);
      patchCachedFeed(cacheKey, { activeIndex: nextActive, scrollTop: element.scrollTop });
      if (nextActive >= itemsRef.current.length - 2) loadMore();
    });
  };

  useEffect(() => {
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (scroller.current) {
        patchCachedFeed(cacheKey, { scrollTop: scroller.current.scrollTop, activeIndex });
      }
    };
  }, [cacheKey, activeIndex]);

  const handleNotInterested = async (video: VideoDTO) => {
    setHidden((current) => ({ ...current, [video.id]: true }));
    try {
      await api.post(`/api/videos/${video.id}/not-interested`);
      notify('Hidden. Your feed will show fewer posts like this.', {
        actionLabel: 'Undo',
        onAction: async () => {
          try {
            await api.delete(`/api/videos/${video.id}/not-interested`);
          } catch {
            /* if the undo fails the video stays hidden, which is recoverable in settings */
          }
          setHidden((current) => ({ ...current, [video.id]: false }));
        },
      });
    } catch {
      setHidden((current) => ({ ...current, [video.id]: false }));
      notify('That did not save. Try again.', { tone: 'error' });
    }
  };

  if (needsSignIn) {
    return (
      <div className="feed-empty">
        <Icon name="users" size={26} />
        <h2>Follow a few goats first</h2>
        <p>Sign in to see posts from the people you follow, collected in one place.</p>
        <div className="empty-state__actions">
          <Link className="btn btn--primary" to={`/login?next=/following`}>
            Sign in
          </Link>
          <Link className="btn btn--quiet" to="/trending">
            Browse trending
          </Link>
        </div>
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="feed-empty">
        <div className="spinner spinner--dark" />
        <p>Finding goats you might like…</p>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="feed-empty">
        <Icon name="alert" size={26} />
        <h2>The feed did not load</h2>
        <p>{error}</p>
        <button type="button" className="btn btn--primary" onClick={() => load(1, true)}>
          Try again
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="feed-empty">
        <Icon name="play" size={26} />
        <h2>{tab === 'following' ? 'The goats are quiet' : 'No approved goats yet'}</h2>
        <p>
          {tab === 'following'
            ? 'The creators you follow have not posted anything approved yet. Find someone new while you wait.'
            : 'Every post is reviewed by a person before it appears here. Once the first one is approved, it will be waiting.'}
        </p>
        <div className="empty-state__actions">
          <Link className="btn btn--primary" to="/trending">
            Browse trending
          </Link>
          <Link className="btn btn--quiet" to={user ? '/upload' : '/login?next=/upload'}>
            Upload something
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="feed-page">
      <div
        className="feed-scroller"
        ref={scroller}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label={`${TITLES[tab]} feed`}
        onKeyDown={(event) => {
          const element = scroller.current;
          if (!element) return;
          const height = element.clientHeight;
          const index = Math.max(0, activeIndex);
          if (event.key === 'ArrowDown' || event.key === 'PageDown') {
            event.preventDefault();
            element.scrollTo({ top: (index + 1) * height, behavior: 'smooth' });
          } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
            event.preventDefault();
            element.scrollTo({ top: Math.max(0, index - 1) * height, behavior: 'smooth' });
          } else if (event.key === 'Home') {
            event.preventDefault();
            element.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
      >
        {items.map((video, index) =>
          hidden[video.id] ? (
            <div className="feed-item feed-item--hidden" key={video.id}>
              <div className="hidden-slide">
                <Icon name="eye-off" size={24} />
                <p>You will see fewer posts like this one.</p>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  onClick={async () => {
                    await api.delete(`/api/videos/${video.id}/not-interested`).catch(() => {});
                    setHidden((current) => ({ ...current, [video.id]: false }));
                  }}
                >
                  Undo
                </button>
              </div>
            </div>
          ) : (
            <FeedItem
              key={video.id}
              video={video}
              index={index}
              activeIndex={activeIndex}
              onNotInterested={handleNotInterested}
            />
          ),
        )}

        {!hasMore ? (
          <div className="feed-item feed-end">
            <strong>That is every goat for now</strong>
            <p>New posts appear after a person has watched and approved them.</p>
            <div className="empty-state__actions">
              <Link className="btn btn--quiet btn--sm" to="/trending">
                Try trending
              </Link>
              <Link className="btn btn--primary btn--sm" to={user ? '/upload' : '/login?next=/upload'}>
                Upload yours
              </Link>
            </div>
          </div>
        ) : null}
      </div>
      {loadingMore ? (
        <div className="feed-more" role="status">
          <div className="spinner" />
        </div>
      ) : null}
    </div>
  );
}
