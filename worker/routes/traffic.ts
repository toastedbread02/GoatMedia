// Traffic sources. A visit row keeps the referring host and the landing route
// and nothing else, so the chart can answer "did that post send anyone?" without
// turning into a tracking profile: no IP, no user agent, no full referrer URL,
// and the visitor key is a hash used only to collapse refreshes.

import { Env, ip, json, now, rateLimit, sha256, uid } from '../lib';
import { requireAdmin } from '../session';

/** Hosts that mean "they were already here", not an outside source. */
const SELF_HOSTS = new Set([
  'toastedbread02.github.io',
  'localhost',
  '127.0.0.1',
]);

const DEDUPE_MS = 30 * 60 * 1000;

function hostOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Campaign tags are explicit, so they win over the referrer host. */
function campaign(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(slug)) return null;
  return slug;
}

function landingPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const path = value.split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) return '/';
  return path.slice(0, 80);
}

export async function recordVisit(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as {
    ref?: string;
    path?: string;
    utm?: string;
  };

  const visitorKey = await sha256(`${ip(req)}:${req.headers.get('user-agent') || ''}`);
  try {
    await rateLimit(env, `visit:${ip(req)}`, 120, 60 * 60 * 1000, 'Too many visits from here.');
  } catch {
    // A noisy visitor is not an error worth showing; just stop counting them.
    return json({ ok: true });
  }

  const tagged = campaign(body.utm);
  const host = hostOf(body.ref) ?? hostOf(req.headers.get('referer'));
  const source = tagged ?? (host ? (SELF_HOSTS.has(host) ? 'internal' : host) : 'direct');

  const seen = await env.DB.prepare(
    'SELECT 1 AS n FROM visits WHERE visitor_key = ? AND created_at > ?',
  )
    .bind(visitorKey, now() - DEDUPE_MS)
    .first<{ n: number }>();

  if (!seen) {
    await env.DB.prepare(
      'INSERT INTO visits (id, visitor_key, source, landing, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(uid('vis'), visitorKey, source.slice(0, 80), landingPath(body.path), now())
      .run();
  }

  // The chart only reads a short window, so old rows are dropped by whichever
  // request happens to notice.
  if (Math.random() < 0.02) {
    await env.DB.prepare('DELETE FROM visits WHERE created_at < ?')
      .bind(now() - 120 * 86_400_000)
      .run();
  }

  return json({ ok: true });
}

interface DailyRow {
  day: string;
  n: number;
}

export async function traffic(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const requested = Number(url.searchParams.get('days'));
  const days = Number.isFinite(requested) ? Math.min(60, Math.max(7, Math.round(requested))) : 14;

  const today = new Date();
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const since = startOfToday - (days - 1) * 86_400_000;

  const dayBucket = (column: string) =>
    `strftime('%Y-%m-%d', ${column}/1000, 'unixepoch')`;

  const visits = await env.DB.prepare(
    `SELECT ${dayBucket('created_at')} AS day, COUNT(*) AS n
       FROM visits WHERE created_at >= ? GROUP BY day`,
  )
    .bind(since)
    .all<DailyRow>();

  // Views come from two places: sign-in events and the once-per-visitor guest
  // counter. Both are already written by the feed, so nothing new is tracked.
  const views = await env.DB.prepare(
    `SELECT day, SUM(n) AS n FROM (
       SELECT ${dayBucket('created_at')} AS day, COUNT(*) AS n
         FROM post_events WHERE kind = 'view' AND created_at >= ? GROUP BY day
       UNION ALL
       SELECT ${dayBucket('created_at')} AS day, COUNT(*) AS n
         FROM guest_views WHERE created_at >= ? GROUP BY day
     ) GROUP BY day`,
  )
    .bind(since, since)
    .all<DailyRow>();

  const signups = await env.DB.prepare(
    `SELECT ${dayBucket('created_at')} AS day, COUNT(*) AS n
       FROM users WHERE created_at >= ? GROUP BY day`,
  )
    .bind(since)
    .all<DailyRow>();

  const sources = await env.DB.prepare(
    `SELECT source, COUNT(*) AS n FROM visits
      WHERE created_at >= ? GROUP BY source ORDER BY n DESC LIMIT 8`,
  )
    .bind(since)
    .all<{ source: string; n: number }>();

  const visitors = await env.DB.prepare(
    'SELECT COUNT(DISTINCT visitor_key) AS n FROM visits WHERE created_at >= ?',
  )
    .bind(since)
    .first<{ n: number }>();

  const byDay = (rows: DailyRow[] | undefined) =>
    new Map((rows || []).map((row) => [row.day, Number(row.n)]));
  const visitMap = byDay(visits.results);
  const viewMap = byDay(views.results);
  const signupMap = byDay(signups.results);

  const series = Array.from({ length: days }, (_, index) => {
    const date = new Date(since + index * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      visits: visitMap.get(date) ?? 0,
      views: viewMap.get(date) ?? 0,
      signups: signupMap.get(date) ?? 0,
    };
  });

  const sum = (key: 'visits' | 'views' | 'signups') =>
    series.reduce((total, row) => total + row[key], 0);

  return json({
    days,
    series,
    sources: (sources.results || []).map((row) => ({ source: row.source, visits: Number(row.n) })),
    totals: {
      visits: sum('visits'),
      views: sum('views'),
      signups: sum('signups'),
      visitors: Number(visitors?.n ?? 0),
    },
  });
}
