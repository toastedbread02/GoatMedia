import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SoundPageDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { plural } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { SoundCredit } from '../components/SoundCredit.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { GridSkeleton } from '../components/Skeleton.tsx';

/**
 * A shared sound and every post that borrowed it. Sound was already a thing
 * you could pick at upload; this is where it becomes something you can follow.
 */
export function SoundPage() {
  const params = useParams();
  const id = params.id || '';
  const [data, setData] = useState<SoundPageDTO | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(data ? data.sound.title : 'Sound');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setPage(1);
    api
      .get<SoundPageDTO>(`/api/sounds/${encodeURIComponent(id)}`)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'That sound could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const loadMore = async () => {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const more = await api.get<SoundPageDTO>(`/api/sounds/${encodeURIComponent(id)}?page=${next}`);
      setData((current) =>
        current
          ? { ...current, items: [...current.items, ...more.items], hasMore: more.hasMore }
          : more,
      );
      setPage(next);
    } catch {
      setError('More posts could not load.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{data ? data.sound.title : 'Sound'}</h1>
          <p className="page-sub">
            {data
              ? `${plural(data.sound.postCount, 'post')} · ${data.sound.useCount} uses`
              : 'Posts that share one sound.'}
          </p>
        </div>
        <Link className="btn btn--quiet btn--sm" to="/upload">
          <Icon name="plus" size={16} /> Use a sound
        </Link>
      </div>

      {data ? (
        <div className="sound-page__credit">
          <SoundCredit sound={data.sound} />
        </div>
      ) : null}

      {loading ? (
        <GridSkeleton count={6} label="Loading sound" />
      ) : error && !data ? (
        <div className="empty-state">
          <Icon name="alert" size={24} />
          <h2>That sound is not here</h2>
          <p>{error}</p>
          <div className="empty-state__actions">
            <Link className="btn btn--quiet btn--sm" to="/search">
              Search instead
            </Link>
          </div>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="empty-state">
          <h2>No posts use this sound yet</h2>
          <p>A sound appears here once a post that carries it is approved.</p>
        </div>
      ) : (
        <>
          <div className="video-grid">
            {data.items.map((post, index) => (
              <VideoCard key={post.id} video={post} showCreator index={index} />
            ))}
          </div>
          {data.hasMore ? (
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
          {error ? <p className="section-note">{error}</p> : null}
        </>
      )}
    </div>
  );
}
