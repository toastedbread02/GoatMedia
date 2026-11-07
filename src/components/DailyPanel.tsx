import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminQueueItem, VideoDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useDebouncedValue } from '../lib/hooks.ts';
import { useToast } from '../lib/toast.tsx';
import { compactNumber, formatDate, timeAgo } from '../lib/format.ts';
import { clearFeedCache } from '../lib/feedCache.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';
import { Player } from '../components/Player.tsx';
import { PhotoAlbum } from '../components/PhotoAlbum.tsx';
import { SoundStrip } from '../components/SoundStrip.tsx';
import { RowSkeleton } from '../components/Skeleton.tsx';

/**
 * Choosing the clip that sits above For You for the rest of the day. The
 * moderation tabs are built around a queue, which is the wrong shape for this
 * job: the pick is usually an old post you liked, not the newest thing waiting
 * for approval, so this exists with its own search.
 */
export function DailyPanel() {
  const { notify } = useToast();
  const [today, setToday] = useState<VideoDTO | null>(null);
  const [items, setItems] = useState<AdminQueueItem[]>([]);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 280);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadToday = async () => {
    try {
      const data = await api.get<{ today: VideoDTO | null }>('/api/daily');
      setToday(data.today);
    } catch {
      /* the picker still works without the current pick shown */
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await api.get<{ items: AdminQueueItem[]; hasMore: boolean }>(
          `/api/admin/posts?status=approved&page=1&q=${encodeURIComponent(debouncedQuery)}`,
        );
        if (cancelled) return;
        setItems(data.items);
        setHasMore(data.hasMore);
        setPage(1);
        setSelectedId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Approved posts could not load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    void loadToday();
  }, []);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const isPick = Boolean(today && selected && today.id === selected.id);

  const loadMore = async () => {
    try {
      const data = await api.get<{ items: AdminQueueItem[]; hasMore: boolean }>(
        `/api/admin/posts?status=approved&page=${page + 1}&q=${encodeURIComponent(debouncedQuery)}`,
      );
      setItems((current) => [...current, ...data.items]);
      setHasMore(data.hasMore);
      setPage((current) => current + 1);
    } catch {
      notify('Could not load more posts.', { tone: 'error' });
    }
  };

  const run = async (body: { postId?: string; clear?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ message?: string }>('/api/admin/daily', body);
      notify(result.message ?? 'Saved.');
      clearFeedCache();
      await loadToday();
      if (body.postId) setSelectedId(body.postId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'That did not go through.';
      setError(message);
      notify(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="daily-today">
        <span className="daily-today__thumb">
          {today ? (
            <img src={today.posterUrl ?? today.photos[0]?.url ?? ''} alt="" loading="lazy" />
          ) : (
            <Icon name="spark" size={20} />
          )}
        </span>
        <div className="daily-today__text">
          {today ? (
            <>
              <strong>{today.caption || 'Untitled goat post'}</strong>
              <span>
                Today’s pick · @{today.creator.username} · pinned above For You until midnight UTC
              </span>
            </>
          ) : (
            <>
              <strong>No pick set for today</strong>
              <span>For You opens on the recommendations until you choose one below.</span>
            </>
          )}
        </div>
        <div className="daily-today__actions">
          {today ? (
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              disabled={busy}
              onClick={() => run({ clear: true })}
            >
              Clear
            </button>
          ) : null}
          <Link className="btn btn--quiet btn--sm" to="/daily">
            Archive
          </Link>
        </div>
      </div>

      <div className="admin-layout">
        <div className="admin-list">
          <p className="admin-list__note">
            Photos and videos can both be the pick. Choosing a different post replaces today’s choice; the previous
            days stay in the archive.
          </p>
          <div className="admin-list__search">
            <div className="searchbox">
              <Icon name="search" size={17} />
              <input
                className="input"
                type="search"
                placeholder="Search approved posts"
                aria-label="Search approved posts"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          {loading ? (
            <RowSkeleton count={4} label="Loading approved posts" />
          ) : items.length === 0 ? (
            <div className="admin-loading">
              {query.trim() ? 'No approved post matches that search.' : 'Nothing approved yet.'}
            </div>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`queue-row${selectedId === item.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                    aria-current={selectedId === item.id}
                  >
                    <span className="queue-row__thumb">
                      {item.posterUrl ? (
                        <img src={item.posterUrl} alt="" loading="lazy" />
                      ) : (
                        <Icon name="image" size={16} />
                      )}
                    </span>
                    <span className="queue-row__body">
                      <span className="queue-row__title">{item.caption || 'Untitled goat post'}</span>
                      <span className="queue-row__meta">
                        {today?.id === item.id ? 'Today’s pick · ' : ''}@{item.creator.username} ·{' '}
                        {item.kind === 'photos' ? `${item.photos.length} photos` : 'Video'} ·{' '}
                        {timeAgo(item.publishedAt ?? item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore ? (
            <div className="admin-list__more">
              <button type="button" className="btn btn--quiet btn--sm" onClick={loadMore}>
                Load more
              </button>
            </div>
          ) : null}
        </div>

        <div className="admin-detail">
          {!selected ? (
            <div className="admin-empty">
              {loading ? 'Loading approved posts.' : 'Pick an approved post to preview it.'}
            </div>
          ) : (
            <>
              <div className="admin-detail__player">
                {selected.kind === 'video' && selected.videoUrl ? (
                  <Player
                    key={selected.id}
                    src={selected.videoUrl}
                    poster={selected.posterUrl}
                    active
                  />
                ) : (
                  <PhotoAlbum
                    key={selected.id}
                    photos={selected.photos}
                    caption={selected.caption}
                    eager
                  />
                )}
              </div>

              {selected.kind === 'photos' && selected.sound ? (
                <SoundStrip key={selected.sound.id} sound={selected.sound} />
              ) : null}

              <div className="admin-detail__head">
                <div>
                  <p className="admin-detail__kind">{selected.categoryLabel}</p>
                  <h2>{selected.caption || 'Untitled goat post'}</h2>
                  <p className="section-note">
                    Published {formatDate(selected.publishedAt ?? selected.createdAt)} ·{' '}
                    {compactNumber(selected.viewCount)} views · {compactNumber(selected.likeCount)} likes
                  </p>
                </div>
                {isPick ? <span className="daily-flag">Today’s pick</span> : null}
              </div>

              <div className="admin-creator">
                <Avatar
                  displayName={selected.creator.displayName}
                  username={selected.creator.username}
                  avatarUrl={selected.creator.avatarUrl}
                  size={38}
                />
                <div className="admin-creator__text">
                  <Link className="creator__name" to={`/u/${selected.creator.username}`}>
                    {selected.creator.displayName}
                  </Link>
                  <span className="creator__handle">@{selected.creator.username}</span>
                </div>
              </div>

              {error ? (
                <p className="field__error" role="alert">
                  {error}
                </p>
              ) : null}

              {isPick ? (
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={busy}
                    onClick={() => run({ clear: true })}
                  >
                    {busy ? <span className="btn__spinner" /> : null}
                    Clear today’s pick
                  </button>
                  <Link className="btn btn--quiet" to={`/v/${selected.id}`}>
                    Open post
                  </Link>
                </div>
              ) : (
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--lg"
                    disabled={busy}
                    onClick={() => run({ postId: selected.id })}
                  >
                    {busy ? <span className="btn__spinner" /> : <Icon name="spark" size={18} />}
                    Make Goat of the day
                  </button>
                  <Link className="btn btn--quiet" to={`/v/${selected.id}`}>
                    Open post
                  </Link>
                </div>
              )}

              <p className="admin-hint">
                The pick sits at the top of For You for everyone until midnight UTC, then moves to the archive.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
