import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { SearchResults } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useCategories } from '../lib/config.tsx';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';
import { VideoCard } from '../components/VideoCard.tsx';

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const categories = useCategories();
  const initial = params.get('q') ?? '';
  const [input, setInput] = useState(initial);
  const debounced = useDebouncedValue(input.trim(), 300);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef('');

  useDocumentTitle(initial ? `Search: ${initial}` : 'Search');

  useEffect(() => {
    setInput(params.get('q') ?? '');
  }, [params]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    if (requested.current === debounced) return;
    requested.current = debounced;
    setLoading(true);
    setError(null);
    api
      .get<SearchResults>(`/api/search?q=${encodeURIComponent(debounced)}`)
      .then((data) => setResults(data))
      .catch((searchError) => setError(searchError instanceof Error ? searchError.message : 'Search failed.'))
      .finally(() => setLoading(false));
  }, [debounced]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = input.trim();
    if (query.length < 2) return;
    navigate(`/search?q=${encodeURIComponent(query)}`, { replace: true });
  };

  const hasResults = Boolean(results && (results.videos.length || results.creators.length));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="page-sub">Find a goat, a creator or a hashtag.</p>
        </div>
      </div>

      <form className="searchbox searchbox--page" role="search" onSubmit={submit}>
        <Icon name="search" size={18} />
        <input
          className="input"
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search goats, people, #hashtags"
          aria-label="Search GoatMedia"
          autoFocus
        />
        <button type="submit" className="btn btn--primary btn--sm">
          Search
        </button>
      </form>

      {debounced.length < 2 ? (
        <div className="search-hints">
          <h2 className="section-title">Try one of these</h2>
          <div className="search-hint-links">
            {categories.map((category) => (
              <Link key={category.id} className="search-hint" to={`/search?q=${encodeURIComponent(category.label)}`}>
                <span>{category.label}</span>
                <span className="field__hint">{category.blurb}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : loading && !results ? (
        <div className="search-results" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div className="video-skeleton" key={index} />
          ))}
        </div>
      ) : error ? (
        <div className="empty-state">
          <Icon name="alert" size={24} />
          <h2>Search is not working right now</h2>
          <p>{error}</p>
        </div>
      ) : !hasResults ? (
        <div className="empty-state">
          <h2>No goats found for “{debounced}”</h2>
          <p>Try a shorter phrase, a creator’s username, or a hashtag like #goatkids.</p>
          <div className="empty-state__actions">
            <Link className="btn btn--quiet" to="/trending">
              Browse trending
            </Link>
          </div>
        </div>
      ) : (
        <div className="search-body">
          {results!.creators.length ? (
            <section className="search-creators">
              <h2 className="section-title">People</h2>
              <ul className="creator-results">
                {results!.creators.map((person) => (
                  <li key={person.id}>
                    <Link className="creator-result" to={`/u/${person.username}`}>
                      <Avatar
                        displayName={person.displayName}
                        username={person.username}
                        avatarUrl={person.avatarUrl}
                        size={42}
                      />
                      <span className="creator-result__text">
                        <span className="creator-result__name">{person.displayName}</span>
                        <span className="creator-result__handle">
                          @{person.username}
                          {person.bio ? ` · ${person.bio}` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results!.videos.length ? (
            <section>
              <h2 className="section-title">
                {results!.hashtag ? `#${results!.hashtag}` : 'Videos'}
              </h2>
              <div className="video-grid">
                {results!.videos.map((video, index) => (
                  <VideoCard key={video.id} video={video} showCreator index={index} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
