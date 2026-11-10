import { useCallback, useEffect, useRef, useState } from 'react';
import { compactNumber } from '../lib/format.ts';
import { Link, useLocation } from 'react-router-dom';
import type { FeedResponse, VideoDTO } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { getCachedFeed, patchCachedFeed, setCachedFeed } from '../lib/feedCache.ts';
import { useToast } from '../lib/toast.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { FeedItem } from '../components/FeedItem.tsx';
import { Icon } from '../components/Icon.tsx';
import { FeedSkeleton } from '../components/Skeleton.tsx';
import { CreatorSuggestions } from '../components/CreatorSuggestions.tsx';
import { InterestPicker } from '../components/InterestPicker.tsx';
import { EGG_VIDEO, countRefresh, eggUnlocked, isEgg } from '../lib/easterEgg.ts';

type Tab = 'foryou' | 'trending' | 'following';

/* Pull-to-refresh travel in pixels: how far the feed can be dragged, the point
   that fires a refresh, where the indicator rests while loading, and the floor
   for how long that loading state stays readable. */
const PULL_MAX = 96;
const PULL_TRIGGER = 64;
const PULL_HOLD = 52;
const REFRESH_MIN_MS = 800;

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
  const [refreshing, setRefreshing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pull, setPull] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    try {
      return localStorage.getItem('gm-follow-nudge') === 'dismissed';
    } catch {
      return true;
    }
  });
  const watchedAsGuest = useRef<Set<string>>(new Set());
  const [highlights, setHighlights] = useState<VideoDTO[] | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [invite, setInvite] = useState<{ comments: number } | null>(null);
  const askedHighlights = useRef(false);
  const location = useLocation();

  const scroller = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  const pageRef = useRef(page);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(false);
  const loadedKey = useRef<string | null>(null);
  const activeIndexRef = useRef(activeIndex);
  const [nudgeFor, setNudgeFor] = useState<{ username: string; displayName: string } | null>(null);
  const frame = useRef(0);
  const wheelDelta = useRef(0);
  const wheelResetTimer = useRef(0);
  // A gesture stays "used" until the wheel goes quiet, so a long flick or a
  // held trackpad scroll can never consume more than one post.
  const gestureUsed = useRef(false);
  const refreshPull = useRef(0);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const eggRef = useRef(eggUnlocked());

  useDocumentTitle(TITLES[tab]);

  // After a few clips a signed-out reader has shown real interest, so it is
  // worth one quiet line about following the creator. It never blocks the feed
  // and stays dismissed once closed.
  useEffect(() => {
    if (user || nudgeDismissed || tab === 'following') return;
    const item = items[activeIndex];
    if (!item?.creator) return;
    watchedAsGuest.current.add(item.id);
    if (watchedAsGuest.current.size < 3) return;
    setNudgeFor((current) =>
      current ?? { username: item.creator.username, displayName: item.creator.displayName },
    );
  }, [activeIndex, items, user, nudgeDismissed, tab]);

  // The closing card is worth one request: a few recent clips that did well,
  // and a nudge for anyone who keeps commenting but never posts.
  useEffect(() => {
    if (hasMore || loading || askedHighlights.current) return;
    askedHighlights.current = true;
    const exclude = itemsRef.current
      .map((item) => item.id)
      .slice(0, 40)
      .join(',');
    api
      .get<{ items: VideoDTO[]; invite: { comments: number } | null }>(
        `/api/feed/highlights?exclude=${encodeURIComponent(exclude)}`,
      )
      .then((data) => {
        setHighlights(data.items);
        setInvite(data.invite);
      })
      .catch(() => setHighlights([]));
  }, [hasMore, loading]);

  itemsRef.current = items;
  pageRef.current = page;
  hasMoreRef.current = hasMore;
  activeIndexRef.current = activeIndex;

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      try {
        const data = await api.get<FeedResponse>(`/api/feed?tab=${tab}&page=${nextPage}`);
        const seen = new Set(replace ? [] : itemsRef.current.map((item) => item.id));
        const fresh = replace ? data.items : [...itemsRef.current, ...data.items.filter((item) => !seen.has(item.id))];
        // Once this browser has seen it, the odd post rides above page one so a
        // refresh that replaces the list cannot drop it back out.
        const nextItems =
          replace && nextPage === 1 && eggRef.current && !fresh.some((item) => isEgg(item.id))
            ? [EGG_VIDEO, ...fresh]
            : fresh;
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

  // A new account has no signal yet, so For You opens with a choice instead of
  // a guess. Skipping is remembered; choosing reloads the feed with weights.
  useEffect(() => {
    if (!user || tab !== 'foryou') return;
    try {
      if (localStorage.getItem('gm-interest-picker') === 'skipped') return;
    } catch {
      return;
    }
    let cancelled = false;
    api
      .get<{ interests?: unknown[]; items?: unknown[] }>('/api/me/interests')
      .then((data) => {
        if (cancelled) return;
        if (!(data.interests ?? data.items ?? []).length) setShowPicker(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, tab]);

  const closePicker = (saved: boolean) => {
    setShowPicker(false);
    try {
      if (!saved) localStorage.setItem('gm-interest-picker', 'skipped');
    } catch {
      /* private browsing */
    }
    if (saved) {
      loadedKey.current = null;
      setLoading(true);
      void load(1, true);
    }
  };

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current || needsSignIn) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void load(pageRef.current + 1, false);
  }, [load, needsSignIn]);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setPulling(false);
    setRefreshing(true);
    setPull(PULL_HOLD);
    if (countRefresh()) eggRef.current = true;
    const startedAt = performance.now();
    await load(1, true);
    // A fast response must not blink past: the label is here to be read.
    const elapsed = performance.now() - startedAt;
    if (elapsed < REFRESH_MIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_MIN_MS - elapsed));
    }
    setRefreshing(false);
    setPull(0);
    refreshingRef.current = false;
  }, [load]);

  refreshRef.current = () => {
    void refresh();
  };

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

  // A wheel or trackpad flick can cross two or three posts before snap has a
  // say. Every gesture is turned into exactly one post, with a short lock so
  // the momentum that follows the first step is spent rather than repeated.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const insideScrollable = (target: EventTarget | null, deltaY: number) => {
      let node = target instanceof Element ? target : null;
      while (node && node !== element) {
        const style = window.getComputedStyle(node);
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 1
        ) {
          const room =
            deltaY > 0 ? node.scrollHeight - node.clientHeight - node.scrollTop : node.scrollTop;
          if (room > 1) return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const step = (direction: 1 | -1) => {
      const height = element.clientHeight;
      if (!height) return;
      const slides = Math.max(1, Math.round((element.scrollHeight - height) / height) + 1);
      const current = Math.round(element.scrollTop / height);
      const next = Math.max(0, Math.min(slides - 1, current + direction));
      if (next === current) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollTo({ top: next * height, behavior: reduced ? 'auto' : 'smooth' });
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (insideScrollable(event.target, event.deltaY)) return;
      const target = event.target instanceof Element ? event.target : null;
      // Menus, the comment sheet and dialogs own their own scroll: hold the
      // feed still instead of moving a post behind them.
      if (target?.closest('.comments-panel, .popover, [role="dialog"], .scrim')) {
        event.preventDefault();
        return;
      }
      event.preventDefault();

      // The idle gap is what marks the end of a gesture. Every event within a
      // flick keeps postponing it, which is what keeps momentum from becoming
      // a second step.
      window.clearTimeout(wheelResetTimer.current);
      wheelResetTimer.current = window.setTimeout(() => {
        gestureUsed.current = false;
        wheelDelta.current = 0;
        refreshPull.current = 0;
        if (!refreshingRef.current) {
          setPulling(false);
          setPull(0);
        }
      }, 300);
      if (gestureUsed.current) return;

      const height = element.clientHeight || 1;
      const delta =
        event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * height : event.deltaY;

      // Scrolling up from the first post asks for new posts rather than a post
      // that is not there, once the gesture has travelled far enough.
      if (delta < 0 && element.scrollTop <= 1) {
        refreshPull.current = Math.min(PULL_MAX, refreshPull.current + -delta * 0.35);
        setPulling(true);
        setPull(Math.round(refreshPull.current));
        if (refreshPull.current >= PULL_TRIGGER) {
          refreshPull.current = 0;
          gestureUsed.current = true;
          refreshRef.current();
        }
        return;
      }
      if (refreshPull.current) {
        refreshPull.current = 0;
        if (!refreshingRef.current) {
          setPulling(false);
          setPull(0);
        }
      }
      wheelDelta.current += delta;
      if (Math.abs(wheelDelta.current) < 30) return;
      const direction = wheelDelta.current > 0 ? 1 : -1;
      gestureUsed.current = true;
      wheelDelta.current = 0;
      step(direction);
    };

    let touchStart = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchStart = element.scrollTop <= 1 && event.touches.length === 1 ? event.touches[0].clientY : 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touchStart) return;
      const distance = Math.max(0, Math.min(PULL_MAX, (event.touches[0].clientY - touchStart) * 0.55));
      pullRef.current = distance;
      setPulling(true);
      setPull(Math.round(distance));
    };
    const onTouchEnd = () => {
      const distance = pullRef.current;
      pullRef.current = 0;
      touchStart = 0;
      setPulling(false);
      if (distance >= PULL_TRIGGER) refreshRef.current();
      else setPull(0);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
      window.clearTimeout(wheelResetTimer.current);
      gestureUsed.current = false;
    };
    // The scroller only exists once posts have arrived, so re-attach when the
    // feed switches between empty and populated.
  }, [items.length > 0]);

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
    // The odd post is not in the API, so hiding it stays in this tab too.
    if (isEgg(video.id)) return;
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
      <FeedSkeleton
        label={
          tab === 'trending'
            ? 'Loading trending posts'
            : tab === 'following'
              ? 'Loading posts from creators you follow'
              : 'Loading your feed'
        }
      />
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
        <CreatorSuggestions limit={4} />
      </div>
    );
  }

  return (
    <div className={`feed-page${pulling ? ' is-pulling' : ''}`}>
      <div
        className={`feed-pull${refreshing ? ' is-busy' : ''}`}
        style={{
          transform: `translate(-50%, ${pull - PULL_HOLD}px)`,
          opacity: pull > 2 ? 1 : 0,
        }}
        role="status"
        aria-live="polite"
      >
        <span
          className="feed-pull__ring"
          style={{ transform: `rotate(${Math.round(pull * 3.5)}deg)` }}
          aria-hidden="true"
        />
        <span>{refreshing ? 'Refreshing…' : pull >= PULL_TRIGGER ? 'Release to refresh' : 'Pull to refresh'}</span>
      </div>
      <div
        className="feed-scroller"
        style={{ transform: pull ? `translateY(${pull}px)` : undefined }}
        ref={scroller}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label={`${TITLES[tab]} feed`}
        onKeyDown={(event) => {
          if (event.repeat) return;
          const element = scroller.current;
          if (!element) return;
          const height = element.clientHeight;
          if (!height) return;
          const index = Math.max(0, activeIndex);
          const slides = Math.max(1, Math.round((element.scrollHeight - height) / height) + 1);
          if (event.key === 'ArrowDown' || event.key === 'PageDown') {
            event.preventDefault();
            element.scrollTo({ top: Math.min(slides - 1, index + 1) * height, behavior: 'smooth' });
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
            <strong>{highlights && highlights.length ? 'You are caught up' : 'That is every goat for now'}</strong>
            <p>
              Every post is watched and approved by a person, so the shelf refills slowly.
              {highlights && highlights.length ? ' In the meantime, these did well this week.' : ''}
            </p>
            {highlights && highlights.length ? (
              <div className="end-picks">
                {highlights.map((item) => {
                  const thumb = item.posterUrl || item.photos[0]?.url || null;
                  return (
                    <Link key={item.id} to={`/v/${item.id}`} className="end-pick">
                      <span className="end-pick__thumb">
                        {thumb ? (
                          <img src={thumb} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <Icon name="play" size={16} />
                        )}
                      </span>
                      <span className="end-pick__text">
                        <span className="end-pick__caption">{item.caption || 'A goat post'}</span>
                        <span className="end-pick__meta">
                          @{item.creator.username} · {compactNumber(item.viewCount)} views
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
            {invite ? (
              <p className="feed-end__invite">
                You have commented {invite.comments} times. If you have goats of your own, they
                would fit right in here.
              </p>
            ) : null}
            <div className="empty-state__actions">
              <Link className="btn btn--primary btn--sm" to={user ? '/upload' : '/login?next=/upload'}>
                Upload yours
              </Link>
              <Link className="btn btn--quiet btn--sm" to="/trending">
                Try trending
              </Link>
            </div>
          </div>
        ) : null}
      </div>
      {nudgeFor && !user && !nudgeDismissed ? (
        <div className="feed-nudge" role="status">
          <p>
            Follow <strong>@{nudgeFor.username}</strong> to keep their goats in your feed.
          </p>
          <div className="feed-nudge__actions">
            <Link
              className="btn btn--primary btn--sm"
              to={`/login?next=${encodeURIComponent(location.pathname)}`}
            >
              Sign in
            </Link>
            <button
              type="button"
              className="btn btn--quiet btn--sm feed-nudge__close"
              aria-label="Dismiss"
              onClick={() => {
                setNudgeDismissed(true);
                setNudgeFor(null);
                try {
                  localStorage.setItem('gm-follow-nudge', 'dismissed');
                } catch {
                  /* private browsing */
                }
              }}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </div>
      ) : null}

      {loadingMore ? (
        <div className="feed-more" role="status">
          <div className="spinner" />
        </div>
      ) : null}

      {showPicker ? (
        <InterestPicker onSkip={() => closePicker(false)} onSaved={() => closePicker(true)} />
      ) : null}
    </div>
  );
}
