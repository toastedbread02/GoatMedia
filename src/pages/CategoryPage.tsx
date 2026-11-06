import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PostDTO } from '../../shared/types';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useConfig } from '../lib/config';

export function CategoryPage() {
  const { id = '' } = useParams();
  const config = useConfig();
  const category = config.categories.find((item) => item.id === id);
  const [items, setItems] = useState<PostDTO[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .category(id, 1)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setHasMore(result.hasMore);
        setPage(1);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="column">
      <header className="page-head">
        <Link to="/" className="back-link">
          <Icon name="arrow-left" size={17} />
          All goats
        </Link>
        <h1 className="page-title">{category?.label || 'Category'}</h1>
        <p className="page-blurb">{category?.blurb || 'Posts in this part of GoatMedia.'}</p>
      </header>

      {loading ? (
        <div className="post-grid" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div className="post-grid__skeleton" key={row} style={{ '--i': row } as CSSProperties} />
          ))}
        </div>
      ) : error ? (
        <div className="empty">
          <p className="empty__title">This category did not load</p>
          <p>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Nothing here yet</p>
          <p>Be the first to post in {category?.label.toLowerCase() || 'this category'}.</p>
          <Link to="/upload" className="button">
            Post a goat
          </Link>
        </div>
      ) : (
        <>
          <ul className="post-grid">
            {items.map((post, index) => (
              <li key={post.id} style={{ '--i': Math.min(index, 11) } as CSSProperties}>
                <Link to={`/p/${post.id}`} className="post-grid__tile" aria-label={post.caption || 'Goat post'}>
                  {post.photos[0] ? <img src={post.photos[0].url} alt="" loading="lazy" /> : null}
                  {post.photos.length > 1 ? (
                    <span className="post-grid__count">
                      <Icon name="grid" size={13} />
                      {post.photos.length}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <button
              type="button"
              className="button button--quiet profile__more"
              onClick={async () => {
                const result = await api.category(id, page + 1);
                setItems((current) => [...current, ...result.items]);
                setHasMore(result.hasMore);
                setPage(page + 1);
              }}
            >
              Load more
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
