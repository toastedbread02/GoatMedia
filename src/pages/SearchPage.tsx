import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { SearchResults, SearchSort, SearchType } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useCategories } from '../lib/config.tsx';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { GridSkeleton } from '../components/Skeleton.tsx';

const RECENT_KEY = 'goatmedia:recent-searches';

const TABS: { id: SearchType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'videos', label: 'Videos' },
  { id: 'photos', label: 'Photos' },
  { id: 'creators', label: 'People' },
];

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

/** Recent searches are a local convenience, never a server record. */
function remember(value: string): string[] {
  const next = [
    value,
    ...readRecent().filter((item) => item.toLowerCase() !== value.toLowerCase()),
  ].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private browsing */
  }
  return next;
}

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
  const [type, setType] = useState<SearchType>('all');
  const [sort, setSort] = useState<SearchSort>('recent');
  const [recent, setRecent] = useState<string[]>(readRecent);
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
    const key = `${debounced}|${type}|${sort}`;
    if (requested.current === key) return;
    requested.current = key;
    setLoading(true);
    setError(null);
    api
      .get<SearchResults>(
        `/api/search?q=${encodeURIComponent(debounced)}&type=${type}&sort=${sort}`,
      )
      .then((data) => setResults(data))
      .catch((searchError) =>
        setError(searchError instanceof Error ? searchError.message : 'Search failed.'),
      )
      .finally(() => setLoading(false));
  }, [debounced, type, sort]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = input.trim();
    if (query.length < 2) return;
    setRecent(remember(query));
    requested.current = '';
    navigate(`/search?q=${encodeURIComponent(query)}`, { replace: true });
  };

  const posts = results?.videos ?? [];
  const hasResults = Boolean(results && (posts.length || results.creators.length));

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
          {recent.length ? (
            <section aria-labelledby="recent-searches">
              <div className="search-hints__head">
                <h2 className="section-title" id="recent-searches">
                  Recent
                </h2>
                <button
                  type="button"
                  className="textlink"
                  onClick={() => {
                    setRecent([]);
                    try {
                      localStorage.removeItem(RECENT_KEY);
                    } catch {
                      /* private browsing */
                    }
                  }}
                >
                  Clear
                </button>
              </div>
              <div className="search-hint-links">
                {recent.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="search-hint"
                    onClick={() => {
                      setInput(item);
                      requested.current = '';
                    }}
                  >
                    <span>{item}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <section aria-labelledby="search-suggestions">
            <h2 className="section-title" id="search-suggestions">
              Try one of these
            </h2>
            <div className="search-hint-links">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  className="search-hint"
                  to={`/search?q=${encodeURIComponent(category.label)}`}
                >
                  <span>{category.label}</span>
                  <span className="field__hint">{category.blurb}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : loading && !results ? (
        <GridSkeleton count={6} label="Searching" />
      ) : error ? (
        <div className="empty-state">
          <Icon name="alert" size={24} />
          <h2>Search is not working right now</h2>
          <p>{error}</p>
        </div>
      ) : !hasResults ? (
        <div className="empty-state">
          <h2>No goats found for “{debounced}”</h2>
          <p>Try a shorter phrase, a creator’s username, or switch to another kind of result.</p>
          <div className="empty-state__actions">
            <Link className="btn btn--quiet" to="/trending">
              Browse trending
            </Link>
          </div>
        </div>
      ) : (
        <div className="search-body">
          <div className="search-toolbar">
            <div className="search-tabs" role="tablist" aria-label="Result type">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={type === tab.id}
                  className={`search-tab${type === tab.id ? ' is-active' : ''}`}
                  onClick={() => setType(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <label className="search-sort">
              <span className="visually-hidden">Sort results</span>
              <select
                className="select select--sm"
                value={sort}
                onChange={(event) => setSort(event.target.value as SearchSort)}
              >
                <option value="recent">Newest first</option>
                <option value="popular">Most liked</option>
              </select>
            </label>
          </div>

          {results!.hashtag ? (
            <p className="search-hashtag">
              <Link className="taglink" to={`/tag/${results!.hashtag}`}>
                Browse everything tagged #{results!.hashtag}
              </Link>
            </p>
          ) : null}

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

          {posts.length ? (
            <section>
              <h2 className="section-title">
                {results!.hashtag ? `#${results!.hashtag}` : 'Posts'}
              </h2>
              <div className="video-grid">
                {posts.map((video, index) => (
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
