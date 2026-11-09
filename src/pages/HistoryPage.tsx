import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HistoryDTO, VideoDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useToast } from '../lib/toast.tsx';
import { Icon } from '../components/Icon.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { GridSkeleton } from '../components/Skeleton.tsx';

/**
 * What the viewer watched, most recent first. Views were already stored for
 * the recommender, so this is the same data finally facing the person it is
 * about, with a way to forget it.
 */
export function HistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<VideoDTO[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle('History');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    api
      .get<HistoryDTO>('/api/me/history')
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setHasMore(data.hasMore);
        setPage(1);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'History could not load.');
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await api.get<HistoryDTO>(`/api/me/history?page=${next}`);
      setItems((current) => [...(current ?? []), ...data.items]);
      setHasMore(data.hasMore);
      setPage(next);
    } catch {
      toast.notify('More history could not load.', { tone: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    try {
      await api.delete('/api/me/history');
      setItems([]);
      setConfirming(false);
      toast.notify('History cleared.');
    } catch {
      toast.notify('History could not be cleared.', { tone: 'error' });
    } finally {
      setClearing(false);
    }
  };

  if (authLoading) {
    return (
      <div className="page">
        <div className="feed-empty" role="status" aria-label="Loading history">
          <div className="spinner spinner--dark" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="empty-state">
          <Icon name="play" size={24} />
          <h2>History is for signed-in goats</h2>
          <p>Sign in and the posts you watch collect here, along with where you stopped.</p>
          <div className="empty-state__actions">
            <Link className="btn btn--primary btn--sm" to="/login?next=%2Fhistory">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">History</h1>
          <p className="page-sub">Posts you watched, newest first. Videos pick up where you left off.</p>
        </div>
        {items && items.length > 0 ? (
          confirming ? (
            <div className="inline-confirm">
              <p>Clear your watch history? Likes, follows and saved posts stay.</p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={clear}
                  disabled={clearing}
                >
                  {clearing ? 'Clearing…' : 'Clear history'}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => setConfirming(true)}
            >
              Clear history
            </button>
          )
        ) : null}
      </div>

      {error ? <p className="section-note">{error}</p> : null}

      {items === null ? (
        <GridSkeleton count={6} label="Loading history" />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing watched yet</h2>
          <p>Open a post and it lands here. A video you stopped partway through remembers the spot.</p>
          <div className="empty-state__actions">
            <Link className="btn btn--primary btn--sm" to="/">
              Go to For You
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="video-grid">
            {items.map((post, index) => (
              <VideoCard key={post.id} video={post} showCreator index={index} />
            ))}
          </div>
          {hasMore ? (
            <div className="page-more">
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Show more'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
