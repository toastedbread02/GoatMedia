import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { VideoDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { formatDate } from '../lib/format.ts';
import { VideoCard } from '../components/VideoCard.tsx';
import { GridSkeleton } from '../components/Skeleton.tsx';

/**
 * The archive of the moderator's daily pick. Each day keeps its choice, so the
 * page is a short history of what the site was pointing at.
 */
export function DailyPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<VideoDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  useDocumentTitle('Goat of the day');

  useEffect(() => {
    api
      .get<{ items: VideoDTO[] }>('/api/daily')
      .then((data) => setItems(data.items))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="page page--narrow">
        <h1>Goat of the day</h1>
        <p className="muted">That list could not load. Try again in a moment.</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <h1>Goat of the day</h1>
        <p className="muted">
          One clip picked by hand each day. Yesterday's choice stays here after it stops being
          pinned to the top of your feed.
        </p>
        {user?.role === 'admin' ? (
          <Link className="btn btn--quiet btn--sm" to="/admin?tab=daily">
            Choose today’s pick
          </Link>
        ) : null}
      </header>

      {items === null ? (
        <GridSkeleton count={3} label="Loading the picks" />
      ) : items.length === 0 ? (
        <div className="feed-empty">
          <h2>No pick yet</h2>
          <p>The first one appears as soon as a moderator chooses it.</p>
          <Link className="btn btn--quiet" to="/">
            Back to the feed
          </Link>
        </div>
      ) : (
        <ul className="daily-list">
          {items.map((item) => (
            <li key={item.id} className="daily-item">
              <p className="daily-item__day tabular">
                {item.day === today ? 'Today' : item.day ? formatDate(Date.parse(`${item.day}T12:00:00Z`)) : ''}
              </p>
              <VideoCard video={item} showCreator />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
