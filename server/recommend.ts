import type { FeedResponse } from '../shared/types.ts';
import { all } from './db.ts';
import { VIDEO_SELECT, rowToVideo, parseTags, type VideoRow } from './videoRows.ts';
import { categoryById, feedMix, limits } from './config.ts';
import { seededRandom } from './util.ts';
import { decayedInterest, type InterestEntry } from './interests.ts';

const MAX_CANDIDATES = 500;
const DAY = 86_400_000;

interface TrendingStats {
  uniqueViewers: number;
  recentLikes: number;
  recentComments: number;
  completionRate: number;
  score: number;
}

let trendingCache: { at: number; map: Map<string, TrendingStats> } | null = null;

export function trendingStats(): Map<string, TrendingStats> {
  if (trendingCache && Date.now() - trendingCache.at < 20_000) return trendingCache.map;
  const since = Date.now() - 7 * DAY;
  const map = new Map<string, TrendingStats>();
  const add = (id: string): TrendingStats => {
    let entry = map.get(id);
    if (!entry) {
      entry = { uniqueViewers: 0, recentLikes: 0, recentComments: 0, completionRate: 0, score: 0 };
      map.set(id, entry);
    }
    return entry;
  };

  for (const row of all<{ video_id: string; uv: number; rate: number | null }>(
    `SELECT video_id, COUNT(DISTINCT COALESCE(user_id, viewer_key)) AS uv, AVG(completed) AS rate
     FROM video_views WHERE created_at >= ? GROUP BY video_id`,
    since,
  )) {
    const entry = add(row.video_id);
    entry.uniqueViewers = Number(row.uv) || 0;
    entry.completionRate = Number(row.rate) || 0;
  }
  for (const row of all<{ video_id: string; n: number }>(
    `SELECT video_id, COUNT(*) AS n FROM likes WHERE created_at >= ? GROUP BY video_id`,
    since,
  )) {
    add(row.video_id).recentLikes = Number(row.n) || 0;
  }
  for (const row of all<{ video_id: string; n: number }>(
    `SELECT video_id, COUNT(*) AS n FROM comments WHERE created_at >= ? AND status = 'visible' GROUP BY video_id`,
    since,
  )) {
    add(row.video_id).recentComments = Number(row.n) || 0;
  }

  let max = 1;
  for (const entry of map.values()) {
    entry.score =
      entry.uniqueViewers * 1.5 +
      entry.recentLikes * 3 +
      entry.recentComments * 4 +
      entry.completionRate * 8;
    max = Math.max(max, entry.score);
  }
  for (const entry of map.values()) entry.score = entry.score / max;

  trendingCache = { at: Date.now(), map };
  return map;
}

export function invalidateTrendingCache() {
  trendingCache = null;
}

interface InteractionContext {
  interests: Map<string, InterestEntry>;
  follows: Set<string>;
  followedCreators: Set<string>;
  affinity: Map<string, number>;
  suppressed: Set<string>;
  recentlyWatched: Set<string>;
}

function loadContext(userId: string | null): InteractionContext {
  const ctx: InteractionContext = {
    interests: new Map(),
    follows: new Set(),
    followedCreators: new Set(),
    affinity: new Map(),
    suppressed: new Set(),
    recentlyWatched: new Set(),
  };
  if (!userId) return ctx;

  for (const row of all<InterestEntry>(
    `SELECT kind, value, weight, updated_at FROM interests WHERE user_id = ?`,
    userId,
  )) {
    ctx.interests.set(`${row.kind}:${row.value}`, row);
  }
  for (const row of all<{ following_id: string; username: string }>(
    `SELECT f.following_id, u.username FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ?`,
    userId,
  )) {
    ctx.follows.add(row.following_id);
    ctx.followedCreators.add(row.username);
  }
  for (const row of all<{ video_id: string }>(
    `SELECT video_id FROM video_events WHERE user_id = ? AND type = 'not_interested'`,
    userId,
  )) {
    ctx.suppressed.add(row.video_id);
  }
  for (const row of all<{ video_id: string }>(
    `SELECT DISTINCT video_id FROM video_views WHERE user_id = ? AND created_at >= ?`,
    userId,
    Date.now() - 7 * DAY,
  )) {
    ctx.recentlyWatched.add(row.video_id);
  }
  for (const row of all<{ owner_id: string; likes: number; comments: number; completions: number }>(
    `SELECT v.owner_id,
       (SELECT COUNT(*) FROM likes l JOIN videos v2 ON v2.id = l.video_id WHERE v2.owner_id = v.owner_id AND l.user_id = ?) AS likes,
       (SELECT COUNT(*) FROM comments c JOIN videos v3 ON v3.id = c.video_id WHERE v3.owner_id = v.owner_id AND c.user_id = ?) AS comments,
       (SELECT COUNT(*) FROM video_views w JOIN videos v4 ON v4.id = w.video_id WHERE v4.owner_id = v.owner_id AND w.user_id = ? AND w.completed = 1) AS completions
     FROM videos v GROUP BY v.owner_id`,
    userId,
    userId,
    userId,
  )) {
    const score = Math.min(1, row.likes * 0.22 + row.comments * 0.22 + row.completions * 0.08);
    ctx.affinity.set(row.owner_id, score);
  }
  return ctx;
}

function interestFor(ctx: InteractionContext, kind: 'category' | 'hashtag', value: string) {
  return decayedInterest(ctx.interests.get(`${kind}:${value}`));
}

function freshness(publishedAt: number | null): number {
  if (!publishedAt) return 0;
  const ageDays = Math.max(0, (Date.now() - publishedAt) / DAY);
  return Math.exp(-ageDays / 9);
}

function quality(row: VideoRow, trend: TrendingStats | undefined): number {
  const likeRate = row.like_count / Math.max(row.view_count, 1);
  return Math.min(1, likeRate * 4) * 0.6 + (trend?.completionRate ?? 0) * 0.4;
}

interface Scored {
  row: VideoRow;
  score: number;
  bucket: 'personalized' | 'discovery' | 'trending';
}

function loadCandidates(userId: string | null): VideoRow[] {
  const viewer = userId ?? '';
  return all<VideoRow>(
    `${VIDEO_SELECT}
     WHERE v.status = 'approved' AND u.status = 'active'
     ORDER BY v.published_at DESC
     LIMIT ?`,
    viewer,
    viewer,
    viewer,
    MAX_CANDIDATES,
  );
}

function blockedIds(userId: string | null): Set<string> {
  if (!userId) return new Set();
  const rows = all<{ id: string }>(
    `SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
     UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?`,
    userId,
    userId,
  );
  return new Set(rows.map((r) => r.id));
}

function quotaFor(total: number) {
  const raw: Array<[Scored['bucket'], number]> = [
    ['personalized', feedMix.personalized * total],
    ['discovery', feedMix.discovery * total],
    ['trending', feedMix.trending * total],
  ];
  const base = raw.map(([bucket, value]) => ({ bucket, count: Math.floor(value), frac: value - Math.floor(value) }));
  let remainder = total - base.reduce((sum, item) => sum + item.count, 0);
  const byFraction = [...base].sort((a, b) => b.frac - a.frac);
  for (const item of byFraction) {
    if (remainder <= 0) break;
    item.count += 1;
    remainder -= 1;
  }
  return Object.fromEntries(base.map((item) => [item.bucket, item.count])) as Record<Scored['bucket'], number>;
}

function reasonFor(scored: Scored, ctx: InteractionContext): string | null {
  if (scored.bucket === 'trending') return 'Trending on GoatMedia this week';
  if (scored.bucket === 'discovery') return 'A creator you have not met yet';
  if (ctx.follows.has(scored.row.owner_id)) return `New from @${scored.row.owner_username}, who you follow`;
  const category = interestFor(ctx, 'category', scored.row.category);
  if (category > 0.3) {
    const label = categoryById.get(scored.row.category)?.label.toLowerCase();
    return label ? `Because you watch ${label}` : null;
  }
  for (const tag of parseTags(scored.row.hashtags)) {
    if (interestFor(ctx, 'hashtag', tag) > 0.35) return `Because you like #${tag}`;
  }
  return null;
}

function buildPage(
  picked: Scored[],
  ctx: InteractionContext,
  page: number,
  hasMore: boolean,
  viewerId: string | null,
): FeedResponse {
  // Place discovery and trending items into the page instead of always at the end.
  const extras = picked.filter((item) => item.bucket !== 'personalized');
  const main = picked.filter((item) => item.bucket === 'personalized');
  const total = picked.length;
  const slots = new Map<number, Scored>();
  const preferred = page % 2 === 1 ? [2, 6] : [4, 3];
  extras.forEach((item, index) => {
    let slot = Math.min(preferred[index] ?? total - 1, total - 1);
    while (slots.has(slot) && slot < total - 1) slot += 1;
    while (slots.has(slot) && slot > 0) slot -= 1;
    slots.set(slot, item);
  });

  const ordered: Scored[] = [];
  for (let i = 0; i < total; i++) {
    const extra = slots.get(i);
    if (extra) ordered.push(extra);
    else if (main.length) ordered.push(main.shift()!);
  }
  ordered.push(...main);

  return {
    items: ordered.map((item) => rowToVideo(item.row, viewerId, reasonFor(item, ctx))),
    hasMore,
    page,
  };
}

function pickPage(
  ranked: { personalized: Scored[]; discovery: Scored[]; trending: Scored[] },
  page: number,
  pageSize: number,
): { picked: Scored[]; hasMore: boolean } {
  const quota = quotaFor(pageSize);
  const picked: Scored[] = [];
  const seen = new Set<string>();
  const perCreator = new Map<string, number>();

  const take = (list: Scored[], count: number, bucket: Scored['bucket']) => {
    let taken = 0;
    for (const item of list) {
      if (taken >= count || picked.length >= pageSize) break;
      if (seen.has(item.row.id)) continue;
      const creatorCount = perCreator.get(item.row.owner_id) ?? 0;
      if (creatorCount >= 2) continue;
      picked.push({ ...item, bucket });
      seen.add(item.row.id);
      perCreator.set(item.row.owner_id, creatorCount + 1);
      taken += 1;
    }
  };

  const offset = (page - 1) * quota.personalized;
  take(ranked.personalized.slice(offset), quota.personalized, 'personalized');
  take(ranked.trending.slice((page - 1) * quota.trending), quota.trending, 'trending');
  take(ranked.discovery.slice((page - 1) * quota.discovery), quota.discovery, 'discovery');

  if (picked.length < pageSize) {
    for (const list of [ranked.personalized, ranked.discovery, ranked.trending]) {
      for (const item of list) {
        if (picked.length >= pageSize) break;
        if (seen.has(item.row.id)) continue;
        picked.push(item);
        seen.add(item.row.id);
      }
      if (picked.length >= pageSize) break;
    }
  }

  const hasMore =
    picked.length === pageSize &&
    ranked.personalized.length + ranked.discovery.length + ranked.trending.length > page * pageSize;

  return { picked, hasMore };
}

export function buildForYouFeed(userId: string | null, page: number): FeedResponse {
  const rankRandom = seededRandom(`${userId ?? 'guest'}:${new Date().toISOString().slice(0, 10)}`);
  const ctx = loadContext(userId);
  const blocked = blockedIds(userId);
  const trend = trendingStats();
  const rows = loadCandidates(userId).filter((row) => {
    if (userId && row.owner_id === userId) return false;
    if (blocked.has(row.owner_id)) return false;
    if (ctx.suppressed.has(row.id)) return false;
    if (ctx.recentlyWatched.has(row.id)) return false;
    return true;
  });

  const personalized: Scored[] = [];
  const discovery: Scored[] = [];
  const trending: Scored[] = [];

  for (const row of rows) {
    const stats = trend.get(row.id);
    const categoryInterest = interestFor(ctx, 'category', row.category);
    const tagInterests = parseTags(row.hashtags).map((tag) => interestFor(ctx, 'hashtag', tag));
    const tagInterest = tagInterests.length
      ? tagInterests.reduce((sum, value) => sum + value, 0) / tagInterests.length
      : 0;
    const creatorAffinity = ctx.affinity.get(row.owner_id) ?? 0;
    const followed = ctx.follows.has(row.owner_id);
    const trendScore = stats?.score ?? 0;
    const jitter = rankRandom();

    const personalScore =
      categoryInterest * 3.0 +
      tagInterest * 1.2 +
      creatorAffinity * 2.0 +
      quality(row, stats) * 1.2 +
      freshness(row.published_at) * 1.6 +
      trendScore * 1.4 +
      (followed ? 0.9 : 0) +
      jitter * 0.6;

    const discoveryScore =
      quality(row, stats) * 0.9 + freshness(row.published_at) * 0.8 + trendScore * 0.6 + jitter * 1.2;

    personalized.push({ row, score: personalScore, bucket: 'personalized' });
    if (!followed && categoryInterest < 0.12) {
      discovery.push({ row, score: discoveryScore, bucket: 'discovery' });
    }
    if (trendScore > 0.02) {
      trending.push({ row, score: trendScore + freshness(row.published_at) * 0.15, bucket: 'trending' });
    }
  }

  personalized.sort((a, b) => b.score - a.score);
  discovery.sort((a, b) => b.score - a.score);
  trending.sort((a, b) => b.score - a.score);

  const { picked, hasMore } = pickPage({ personalized, discovery, trending }, page, limits.feedPageSize);
  return buildPage(picked, ctx, page, hasMore, userId);
}

export function buildTrendingFeed(userId: string | null, page: number): FeedResponse {
  const blocked = blockedIds(userId);
  const trend = trendingStats();
  const rankRandom = seededRandom(`trending:${userId ?? 'guest'}`);
  const rows = loadCandidates(userId).filter(
    (row) => !blocked.has(row.owner_id) && !(userId && row.owner_id === userId),
  );
  const ranked: Scored[] = rows.map((row) => {
    const stats = trend.get(row.id);
    return {
      row,
      bucket: 'trending' as const,
      score: (stats?.score ?? 0) * 3 + freshness(row.published_at) * 0.8 + rankRandom() * 0.12,
    };
  });
  ranked.sort((a, b) => b.score - a.score || (b.row.published_at ?? 0) - (a.row.published_at ?? 0));

  const offset = (page - 1) * limits.feedPageSize;
  const slice = ranked.slice(offset, offset + limits.feedPageSize);
  return {
    items: slice.map((item) => rowToVideo(item.row, userId, 'Popular with goat people this week')),
    hasMore: offset + slice.length < ranked.length,
    page,
  };
}

export function buildFollowingFeed(userId: string, page: number): FeedResponse {
  const offset = (page - 1) * limits.feedPageSize;
  const rows = all<VideoRow>(
    `${VIDEO_SELECT}
     WHERE v.status = 'approved' AND u.status = 'active'
       AND v.owner_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
     ORDER BY v.published_at DESC
     LIMIT ? OFFSET ?`,
    userId,
    userId,
    userId,
    userId,
    limits.feedPageSize + 1,
    offset,
  );
  const hasMore = rows.length > limits.feedPageSize;
  return {
    items: rows.slice(0, limits.feedPageSize).map((row) => rowToVideo(row, userId, null)),
    hasMore,
    page,
  };
}
