import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TagPageDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { plural } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { GridSkeleton } from '../components/Skeleton.tsx';

/**
 * A hashtag as a place, not a search string. Everything the tag is attached to
 * lives here, so a link from a caption leads somewhere that stays put.
 */
export function TagPage() {
  const params = useParams();
  const tag = (params.tag || '').replace(/^#/, '').toLowerCase();
  const [data, setData] = useState<TagPageDTO | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(tag ? `#${tag}` : 'Hashtag');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setPage(1);
    api
      .get<TagPageDTO>(`/api/tags/${encodeURIComponent(tag)}`)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'That hashtag could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tag]);

  const loadMore = async () => {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const more = await api.get<TagPageDTO>(`/api/tags/${encodeURIComponent(tag)}?page=${next}`);
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
          <h1 className="page-title">#{tag}</h1>
          <p className="page-sub">
            {data ? `${plural(data.total, 'post')} tagged #${tag}` : 'Everything tagged with this hashtag.'}
          </p>
        </div>
        <Link className="btn btn--quiet btn--sm" to={`/search?q=%23${encodeURIComponent(tag)}`}>
          <Icon name="search" size={16} /> Search
        </Link>
      </div>

      {loading ? (
        <GridSkeleton count={6} label={`Loading #${tag}`} />
      ) : error && !data ? (
        <div className="empty-state">
          <Icon name="alert" size={24} />
          <h2>That hashtag could not be loaded</h2>
          <p>{error}</p>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing tagged #{tag} yet</h2>
          <p>Add #{tag} to a caption when you upload and it will show up here.</p>
          <div className="empty-state__actions">
            <Link className="btn btn--primary btn--sm" to="/upload">
              Upload a post
            </Link>
          </div>
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
