import { useEffect, useState } from 'react';
import type { TrafficDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { compactNumber } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { Skeleton } from './Skeleton.tsx';
import { CHANNEL_LABELS } from '../lib/share.ts';

const WINDOWS = [7, 14, 30];

function dayDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

function readableSource(source: string) {
  if (source === 'direct') return 'Direct or unknown';
  if (source === 'internal') return 'Already on the site';
  return CHANNEL_LABELS[source] ?? source;
}

/**
 * Visits, post views and sign-ups per day, plus where the visits came from.
 * Bars are plain CSS: no chart library, no gradients, and the same information
 * is available to a screen reader through the summary label.
 */
export function TrafficPanel() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<TrafficDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<TrafficDTO>(`/api/admin/traffic?days=${days}`)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Traffic could not load.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const series = data?.series ?? [];
  const peak = Math.max(1, ...series.map((day) => Math.max(day.visits, day.views, day.signups)));
  const first = series[0] ? dayDate(series[0].date) : null;
  const last = series.length ? dayDate(series[series.length - 1].date) : null;
  const range =
    first && last
      ? `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : '';

  const totals = data?.totals ?? {
    visits: 0,
    views: 0,
    signups: 0,
    visitors: 0,
    weekVisitors: 0,
    returning: 0,
  };
  const returnShare = totals.weekVisitors
    ? Math.round((totals.returning / totals.weekVisitors) * 100)
    : 0;
  const empty = totals.visits === 0 && totals.views === 0;

  return (
    <section className="traffic" aria-labelledby="traffic-heading">
      <div className="traffic__head">
        <div>
          <h2 id="traffic-heading">Traffic</h2>
          <p>Where visits came from and what they did once they arrived.</p>
        </div>
        <div className="traffic__window" role="group" aria-label="Time range">
          {WINDOWS.map((value) => (
            <button
              key={value}
              type="button"
              className={`btn btn--quiet btn--sm${value === days ? ' is-active' : ''}`}
              aria-pressed={value === days}
              onClick={() => setDays(value)}
            >
              {value} days
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="notice notice--error">
          <Icon name="alert" size={18} />
          <p>{error}</p>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="traffic__loading">
          <Skeleton className="traffic__skeleton" />
          <Skeleton className="traffic__skeleton traffic__skeleton--short" />
        </div>
      ) : (
        <>
          <dl className="traffic__totals">
            <div>
              <dt>Visits</dt>
              <dd>{compactNumber(totals.visits)}</dd>
            </div>
            <div>
              <dt>Post views</dt>
              <dd>{compactNumber(totals.views)}</dd>
            </div>
            <div>
              <dt>New accounts</dt>
              <dd>{compactNumber(totals.signups)}</dd>
            </div>
            <div>
              <dt>Unique visitors</dt>
              <dd>{compactNumber(totals.visitors)}</dd>
            </div>
            <div>
              <dt>Came back this week</dt>
              <dd>
                {compactNumber(totals.returning)}
                <span className="traffic__sub">
                  {totals.weekVisitors ? `${returnShare}% of ${compactNumber(totals.weekVisitors)}` : 'no visitors yet'}
                </span>
              </dd>
            </div>
          </dl>

          <p className="traffic__note">
            {range ? `${range}. ` : ''}
            A visit is one browser arriving; a view is one post watched long enough to count.
          </p>

          {empty ? (
            <div className="traffic__empty">
              <Icon name="chart" size={22} />
              <p>
                Nothing recorded yet. Visits start counting the next time someone opens the site
                from outside it.
              </p>
            </div>
          ) : (
            <>
              <div
                className="traffic__chart"
                role="img"
                aria-label={`Bar chart of visits, post views and new accounts per day for the last ${data?.days ?? days} days. Peak day ${peak}.`}
              >
                <div className="traffic__grid" aria-hidden="true">
                  <span>{peak}</span>
                  <span>0</span>
                </div>
                <div className="traffic__days">
                  {series.map((day) => {
                    const date = dayDate(day.date);
                    const label = date.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    });
                    return (
                      <div
                        className="traffic__day"
                        key={day.date}
                        title={`${label}: ${day.visits} visits, ${day.views} views, ${day.signups} new accounts`}
                      >
                        <div className="traffic__bars">
                          <span
                            className="traffic__bar traffic__bar--views"
                            style={{ height: `${(day.views / peak) * 100}%` }}
                          />
                          <span
                            className="traffic__bar traffic__bar--visits"
                            style={{ height: `${(day.visits / peak) * 100}%` }}
                          />
                          <span
                            className="traffic__bar traffic__bar--signups"
                            style={{ height: `${(day.signups / peak) * 100}%` }}
                          />
                        </div>
                        <span className="traffic__day-label">{date.getUTCDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <ul className="traffic__legend">
                <li>
                  <span className="traffic__swatch traffic__swatch--views" /> Post views
                </li>
                <li>
                  <span className="traffic__swatch traffic__swatch--visits" /> Visits
                </li>
                <li>
                  <span className="traffic__swatch traffic__swatch--signups" /> New accounts
                </li>
              </ul>

              <div className="traffic__sources">
                <h3>Where visits came from</h3>
                {data && data.sources.length ? (
                  <ul>
                    {data.sources.map((row) => {
                      const share = totals.visits
                        ? Math.round((row.visits / totals.visits) * 100)
                        : 0;
                      return (
                        <li key={row.source}>
                          <span className="traffic__source-name">{readableSource(row.source)}</span>
                          <span className="traffic__source-meter" aria-hidden="true">
                            <span style={{ width: `${share}%` }} />
                          </span>
                          <span className="traffic__source-count">
                            {compactNumber(row.visits)}
                            <span className="traffic__source-share"> {share}%</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="traffic__note">
                    No outside referrers yet. Links shared from the site arrive tagged with
                    the channel that sent them; other traffic appears by referring host.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
