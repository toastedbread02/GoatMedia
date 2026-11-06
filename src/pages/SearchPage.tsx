import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PostDTO, PublicUser } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { count } from '../lib/format';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') || '';
  const [query, setQuery] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const [posts, setPosts] = useState<PostDTO[]>([]);
  const [creators, setCreators] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const value = params.get('q') || '';
    setQuery(value);
    setSubmitted(value);
  }, [params]);

  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .search(submitted)
      .then((result) => {
        if (cancelled) return;
        setPosts(result.posts);
        setCreators(result.creators);
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
  }, [submitted]);

  return (
    <div className="column">
      <header className="page-head">
        <h1 className="page-title">Search</h1>
        <p className="page-blurb">Find goats, creators and captions. A hashtag works too.</p>
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            setParams(query.trim() ? { q: query.trim() } : {});
          }}
          role="search"
        >
          <Icon name="search" size={19} />
          <label className="visually-hidden" htmlFor="search-input">
            Search GoatMedia
          </label>
          <input
            id="search-input"
            ref={input}
            className="search-form__input"
            type="search"
            value={query}
            placeholder="Baby goats, @adagoats, #parkour…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="button button--small">
            Search
          </button>
        </form>
      </header>

      {!submitted ? (
        <div className="search-idle">
          <h2 className="aside-title">Try a category</h2>
          <ul className="link-list">
            {['baby-goats', 'parkour', 'mountain-goats', 'goat-sounds'].map((id) => (
              <li key={id}>
                <Link to={`/c/${id}`} className="text-link">
                  {id.replace(/-/g, ' ')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : loading ? (
        <p className="feed__loading">Looking for goats…</p>
      ) : error ? (
        <div className="empty">
          <p className="empty__title">Search did not run</p>
          <p>{error}</p>
        </div>
      ) : posts.length === 0 && creators.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No goats matched “{submitted}”</p>
          <p>Try a shorter word, a creator’s name, or a hashtag without the symbol.</p>
        </div>
      ) : (
        <>
          {creators.length ? (
            <section className="result-block">
              <h2 className="result-title">Creators</h2>
              <ul className="creator-list">
                {creators.map((creator, index) => (
                  <li key={creator.id} style={{ '--i': Math.min(index, 6) } as CSSProperties}>
                    <Link to={`/u/${creator.username}`} className="creator-row">
                      <Avatar user={creator} size={42} />
                      <span className="creator-row__text">
                        <strong>{creator.displayName}</strong>
                        <span className="muted">
                          @{creator.username} · {count(creator.followerCount)} followers ·{' '}
                          {count(creator.postCount)} posts
                        </span>
                      </span>
                      <Icon name="chevron-right" size={18} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {posts.length ? (
            <section className="result-block">
              <h2 className="result-title">
                {posts.length} {posts.length === 1 ? 'post' : 'posts'}
              </h2>
              <ul className="post-grid">
                {posts.map((post, index) => (
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
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
