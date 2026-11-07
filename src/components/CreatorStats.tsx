import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CreatorStatsDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { compactNumber, plural } from '../lib/format.ts';

const METRICS = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'followers', label: 'New followers' },
] as const;

function deltaText(value: number, before: number) {
  if (value === 0 && before === 0) return 'Nothing yet';
  if (before === 0) return 'First this week';
  const change = value - before;
  if (change === 0) return 'Same as last week';
  return `${change > 0 ? '+' : '−'}${Math.abs(change)} vs last week`;
}

/**
 * The creator's own week: what their posts earned, next to the week before,
 * and which post did best. Numbers only ever come from real events, so a
 * quiet week honestly reads as quiet.
 */
export function CreatorStats() {
  const [stats, setStats] = useState<CreatorStatsDTO | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CreatorStatsDTO>('/api/me/stats')
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  const week = stats?.week;
  const before = stats?.previous;
  const daily = stats?.daily ?? [];
  const peak = Math.max(1, ...daily);
  const weekTotal = daily.reduce((sum, value) => sum + value, 0);

  return (
    <section className="creator-stats" aria-labelledby="creator-stats-title">
      <div className="creator-stats__head">
        <h2 id="creator-stats-title">Your week</h2>
        <span className="creator-stats__note">Last 7 days</span>
      </div>

      <div className="stats__grid">
        {METRICS.map((metric) => (
          <div key={metric.key} className="stats__metric">
            <p className="stats__value">
              {week ? compactNumber(week[metric.key]) : '—'}
            </p>
            <p className="stats__label">{metric.label}</p>
            <p className="stats__delta">
              {week && before ? deltaText(week[metric.key], before[metric.key]) : ''}
            </p>
          </div>
        ))}
      </div>

      {stats && stats.totals.posts === 0 ? (
        <p className="stats__empty">
          Nothing published yet, so there is nothing to measure.{' '}
          <Link to="/upload">Upload a post</Link> and this fills in once the moderator approves it.
        </p>
      ) : (
        <>
          <div
            className="stats__chart"
            role="img"
            aria-label={`Views per day for the last seven days: ${daily.join(', ')}`}
          >
            {daily.map((value, index) => (
              <span
                key={index}
                className={`stats__bar${index === daily.length - 1 ? ' is-today' : ''}`}
                style={{ height: `${Math.max(4, (value / peak) * 100)}%` }}
              />
            ))}
          </div>
          <p className="stats__chart-label">{weekTotal ? `${weekTotal} views this week` : 'No views yet this week'}</p>
        </>
      )}

      {stats?.topPost ? (
        <p className="stats__foot">
          <span>Most watched this week</span>
          <Link to={`/v/${stats.topPost.id}`} className="stats__top">
            {stats.topPost.caption || 'Untitled goat post'}
          </Link>
          <span>{compactNumber(stats.topPost.views)} views</span>
        </p>
      ) : null}

      {stats && stats.totals.posts > 0 ? (
        <p className="stats__foot stats__foot--muted">
          {plural(stats.totals.posts, 'post')} · {compactNumber(stats.totals.views)} views ·{' '}
          {compactNumber(stats.totals.likes)} likes all time
        </p>
      ) : null}
    </section>
  );
}
