// The For You feed: an explainable scoring model, no machine learning.
//
// Every post gets a personalized score, a discovery score and a trending
// score; the page is then assembled from configurable quotas (80/15/5) with a
// two-per-creator cap so the feed does not turn into one farm's photo album.

import { Env, now } from './lib';
import { categoryById, feedMix, limits } from './config';
import { decayedInterest, InterestEntry, interestRules } from './interests';
import { PostRow, POST_SELECT } from './models';

const MAX_CANDIDATES = 400;
const DAY = 86_400_000;

export interface TrendingStats {
  uniqueViewers: number;
  recentLikes: number;
  recentComments: number;
  score: number;
}

let trendingCache: { at: number; map: Map<string, TrendingStats> } | null = null;

export async function trendingStats(env: Env): Promise<Map<string, TrendingStats>> {
  if (trendingCache && now() - trendingCache.at < 20_000) return trendingCache.map;
  const since = now() - 7 * DAY;
  const map = new Map<string, TrendingStats>();
  const add = (id: string) => {
    let entry = map.get(id);
    if (!entry) {
      entry = { uniqueViewers: 0, recentLikes: 0, recentComments: 0, score: 0 };
      map.set(id, entry);
    }
    return entry;
  };

  const [views, likes, comments] = await Promise.all([
    env.DB.prepare(
      `SELECT post_id, SUM(n) AS uv FROM (
         SELECT post_id, COUNT(DISTINCT user_id) AS n FROM post_events
          WHERE kind = 'view' AND created_at >= ? GROUP BY post_id
         UNION ALL
         SELECT post_id, COUNT(DISTINCT visitor_key) AS n FROM guest_views
          WHERE created_at >= ? GROUP BY post_id
       ) GROUP BY post_id`,
    )
      .bind(since, since)
      .all<{ post_id: string; uv: number }>(),
    env.DB.prepare(
      'SELECT post_id, COUNT(*) AS n FROM likes WHERE created_at >= ? GROUP BY post_id',
    )
      .bind(since)
      .all<{ post_id: string; n: number }>(),
    env.DB.prepare(
      `SELECT post_id, COUNT(*) AS n FROM comments WHERE created_at >= ? AND status = 'visible' GROUP BY post_id`,
    )
      .bind(since)
      .all<{ post_id: string; n: number }>(),
  ]);

  for (const row of views.results || []) add(row.post_id).uniqueViewers = Number(row.uv) || 0;
  for (const row of likes.results || []) add(row.post_id).recentLikes = Number(row.n) || 0;
  for (const row of comments.results || []) add(row.post_id).recentComments = Number(row.n) || 0;

  let max = 1;
  for (const entry of map.values()) {
    entry.score =
      entry.uniqueViewers * 1.6 + entry.recentLikes * 3 + entry.recentComments * 4;
    max = Math.max(max, entry.score);
  }
  for (const entry of map.values()) entry.score = entry.score / max;

  trendingCache = { at: now(), map };
  return map;
}

export function invalidateTrending() {
  trendingCache = null;
}

interface Context {
  interests: Map<string, InterestEntry>;
  follows: Set<string>;
  affinity: Map<string, number>;
  suppressed: Set<string>;
  recentViews: Map<string, number>;
}

async function loadContext(env: Env, userId: string | null): Promise<Context> {
  const ctx: Context = {
    interests: new Map(),
    follows: new Set(),
    affinity: new Map(),
    suppressed: new Set(),
    recentViews: new Map(),
  };
  if (!userId) return ctx;

  const [interests, follows, blocked, hidden, viewed, affinity] = await Promise.all([
    env.DB.prepare('SELECT kind, value, weight, updated_at FROM interests WHERE user_id = ?')
      .bind(userId)
      .all<InterestEntry>(),
    env.DB.prepare('SELECT following_id FROM follows WHERE follower_id = ?')
      .bind(userId)
      .all<{ following_id: string }>(),
    env.DB.prepare(
      'SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?',
    )
      .bind(userId, userId)
      .all<{ id: string }>(),
    env.DB.prepare('SELECT post_id FROM hidden_posts WHERE user_id = ?')
      .bind(userId)
      .all<{ post_id: string }>(),
    env.DB.prepare(
      `SELECT post_id, COUNT(*) AS n FROM post_events
        WHERE user_id = ? AND kind = 'view' AND created_at >= ?
        GROUP BY post_id`,
    )
      .bind(userId, now() - interestRules.recencyWindowDays * DAY)
      .all<{ post_id: string; n: number }>(),
    env.DB.prepare(
      `SELECT p.owner_id,
              (SELECT COUNT(*) FROM likes l JOIN posts p2 ON p2.id = l.post_id WHERE p2.owner_id = p.owner_id AND l.user_id = ?) AS likes,
              (SELECT COUNT(*) FROM comments c JOIN posts p3 ON p3.id = c.post_id WHERE p3.owner_id = p.owner_id AND c.user_id = ? AND c.status = 'visible') AS comments
         FROM posts p WHERE p.status = 'approved' GROUP BY p.owner_id`,
    )
      .bind(userId, userId)
      .all<{ owner_id: string; likes: number; comments: number }>(),
  ]);

  for (const row of interests.results || []) {
    ctx.interests.set(`${row.kind}:${row.value}`, row);
  }
  for (const row of follows.results || []) ctx.follows.add(row.following_id);
  for (const row of blocked.results || []) ctx.suppressed.add(`user:${row.id}`);
  for (const row of hidden.results || []) ctx.suppressed.add(row.post_id);
  for (const row of viewed.results || []) ctx.recentViews.set(row.post_id, Number(row.n) || 0);
  for (const row of affinity.results || []) {
    ctx.affinity.set(
      row.owner_id,
      Math.min(1, Number(row.likes) * 0.24 + Number(row.comments) * 0.2),
    );
  }
  return ctx;
}

function interestFor(ctx: Context, kind: 'category' | 'hashtag', value: string) {
  return decayedInterest(ctx.interests.get(`${kind}:${value}`));
}

function freshness(publishedAt: number | null) {
  if (!publishedAt) return 0;
  const ageDays = Math.max(0, (now() - publishedAt) / DAY);
  return Math.exp(-ageDays / 12);
}

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function quality(row: PostRow, trend: TrendingStats | undefined) {
  const likeRate = row.like_count / Math.max(row.view_count, 1);
  return Math.min(1, likeRate * 4) * 0.7 + (trend?.score ?? 0) * 0.3;
}

interface Scored {
  row: PostRow;
  score: number;
  bucket: 'personalized' | 'discovery' | 'trending';
}

function quotaFor(total: number) {
  const raw: Array<[Scored['bucket'], number]> = [
    ['personalized', feedMix.personalized * total],
    ['discovery', feedMix.discovery * total],
    ['trending', feedMix.trending * total],
  ];
  const base = raw.map(([bucket, value]) => ({
    bucket,
    count: Math.floor(value),
    frac: value - Math.floor(value),
  }));
  let remainder = total - base.reduce((sum, item) => sum + item.count, 0);
  for (const item of [...base].sort((a, b) => b.frac - a.frac)) {
    if (remainder <= 0) break;
    item.count += 1;
    remainder -= 1;
  }
  return Object.fromEntries(base.map((item) => [item.bucket, item.count])) as Record<
    Scored['bucket'],
    number
  >;
}

async function candidates(env: Env, userId: string | null): Promise<PostRow[]> {
  const result = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.status = 'approved' AND u.status = 'active'
      ORDER BY p.published_at DESC
      LIMIT ?`,
  )
    .bind(MAX_CANDIDATES)
    .all<PostRow>();
  return result.results || [];
}

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function reasonFor(item: Scored, ctx: Context): string | null {
  if (item.bucket === 'trending') return 'Popular with goat people this week';
  if (item.bucket === 'discovery') return 'A creator you have not met yet';
  if (ctx.follows.has(item.row.owner_id)) return `New from @${item.row.username}, who you follow`;
  const category = interestFor(ctx, 'category', item.row.category);
  if (category > 0.3) {
    const label = categoryById.get(item.row.category)?.label.toLowerCase();
    return label ? `Because you keep looking at ${label}` : null;
  }
  for (const tag of parseTags(item.row.hashtags)) {
    if (interestFor(ctx, 'hashtag', tag) > 0.35) return `Because you like #${tag}`;
  }
  return null;
}

export interface FeedPage {
  rows: PostRow[];
  reasons: Map<string, string>;
  hasMore: boolean;
  page: number;
}

export async function forYouFeed(
  env: Env,
  userId: string | null,
  page: number,
  pageSize = limits.feedPageSize,
): Promise<FeedPage> {
  const rankRandom = seededRandom(`${userId ?? 'guest'}:${new Date().toISOString().slice(0, 10)}`);
  const ctx = await loadContext(env, userId);
  const trend = await trendingStats(env);
  const blockedUsers = new Set(
    [...ctx.suppressed].filter((v) => v.startsWith('user:')).map((v) => v.slice(5)),
  );

  const rows = (await candidates(env, userId)).filter((row) => {
    if (userId && row.owner_id === userId) return false;
    if (blockedUsers.has(row.owner_id)) return false;
    if (ctx.suppressed.has(row.id)) return false;
    if (ctx.recentViews.has(row.id)) return false;
    return true;
  });

  const personalized: Scored[] = [];
  const discovery: Scored[] = [];
  const trending: Scored[] = [];

  for (const row of rows) {
    const stats = trend.get(row.id);
    const categoryInterest = interestFor(ctx, 'category', row.category);
    const tags = parseTags(row.hashtags);
    const tagInterest = tags.length
      ? tags.reduce((sum, tag) => sum + interestFor(ctx, 'hashtag', tag), 0) / tags.length
      : 0;
    const affinity = ctx.affinity.get(row.owner_id) ?? 0;
    const followed = ctx.follows.has(row.owner_id);
    const trendScore = stats?.score ?? 0;
    const exposure = ctx.recentViews.get(row.id) ?? 0;
    const jitter = rankRandom();

    personalized.push({
      row,
      bucket: 'personalized',
      score:
        categoryInterest * 3.0 +
        tagInterest * 1.2 +
        affinity * 2.0 +
        quality(row, stats) * 1.2 +
        freshness(row.published_at) * 1.6 +
        trendScore * 1.4 +
        (followed ? 0.9 : 0) -
        exposure * 0.5 +
        jitter * 0.6,
    });
    if (!followed && categoryInterest < 0.12) {
      discovery.push({
        row,
        bucket: 'discovery',
        score: quality(row, stats) * 0.9 + freshness(row.published_at) * 0.8 + jitter * 1.2,
      });
    }
    if (trendScore > 0.02) {
      trending.push({
        row,
        bucket: 'trending',
        score: trendScore + freshness(row.published_at) * 0.15,
      });
    }
  }

  personalized.sort((a, b) => b.score - a.score);
  discovery.sort((a, b) => b.score - a.score);
  trending.sort((a, b) => b.score - a.score);

  const quota = quotaFor(pageSize);
  const picked: Scored[] = [];
  const seen = new Set<string>();
  const perCreator = new Map<string, number>();

  const take = (list: Scored[], count: number, bucket: Scored['bucket']) => {
    let taken = 0;
    for (const item of list) {
      if (taken >= count || picked.length >= pageSize) break;
      if (seen.has(item.row.id)) continue;
      const used = perCreator.get(item.row.owner_id) ?? 0;
      if (used >= 2) continue;
      picked.push({ ...item, bucket });
      seen.add(item.row.id);
      perCreator.set(item.row.owner_id, used + 1);
      taken += 1;
    }
  };

  const offsetFor = (bucket: Scored['bucket']) => (page - 1) * (quota[bucket] || 1);
  take(personalized.slice(offsetFor('personalized')), quota.personalized, 'personalized');
  take(trending.slice(offsetFor('trending')), quota.trending, 'trending');
  take(discovery.slice(offsetFor('discovery')), quota.discovery, 'discovery');

  if (picked.length < pageSize) {
    for (const list of [personalized, discovery, trending]) {
      for (const item of list) {
        if (picked.length >= pageSize) break;
        if (!seen.has(item.row.id)) {
          picked.push(item);
          seen.add(item.row.id);
        }
      }
      if (picked.length >= pageSize) break;
    }
  }

  // Interleave extras so discovery is not always the last card on the page.
  const extras = picked.filter((item) => item.bucket !== 'personalized');
  const main = picked.filter((item) => item.bucket === 'personalized');
  const slots = new Set<number>([2, page % 2 === 1 ? 4 : 3]);
  const ordered: Scored[] = [];
  let extraIndex = 0;
  for (let i = 0; i < picked.length; i++) {
    if (slots.has(i) && extraIndex < extras.length) {
      ordered.push(extras[extraIndex++]);
    } else if (main.length) {
      ordered.push(main.shift()!);
    } else if (extraIndex < extras.length) {
      ordered.push(extras[extraIndex++]);
    }
  }

  const total =
    personalized.length + discovery.length + trending.length;
  return {
    rows: ordered.map((item) => item.row),
    reasons: new Map(ordered.map((item) => [item.row.id, reasonFor(item, ctx) ?? ''])),
    hasMore: picked.length === pageSize && total > page * Math.max(1, pageSize - 2),
    page,
  };
}

export async function trendingFeed(
  env: Env,
  userId: string | null,
  page: number,
  pageSize = limits.feedPageSize,
): Promise<FeedPage> {
  const trend = await trendingStats(env);
  const rankRandom = seededRandom(`trending:${userId ?? 'guest'}`);
  const ctx = await loadContext(env, userId);
  const blockedUsers = new Set(
    [...ctx.suppressed].filter((v) => v.startsWith('user:')).map((v) => v.slice(5)),
  );
  const rows = (await candidates(env, userId)).filter(
    (row) => !blockedUsers.has(row.owner_id) && !(userId && row.owner_id === userId),
  );
  const ranked = rows
    .map((row) => ({
      row,
      score: (trend.get(row.id)?.score ?? 0) * 3 + freshness(row.published_at) * 0.8 + rankRandom() * 0.12,
    }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.row.published_at ?? 0) - (a.row.published_at ?? 0),
    );

  const offset = (page - 1) * pageSize;
  const slice = ranked.slice(offset, offset + pageSize);
  return {
    rows: slice.map((item) => item.row),
    reasons: new Map(slice.map((item) => [item.row.id, 'Popular with goat people this week'])),
    hasMore: offset + slice.length < ranked.length,
    page,
  };
}

export async function followingFeed(
  env: Env,
  userId: string,
  page: number,
  pageSize = limits.feedPageSize,
): Promise<FeedPage> {
  const offset = (page - 1) * pageSize;
  const result = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.status = 'approved' AND u.status = 'active'
        AND p.owner_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
      ORDER BY p.published_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(userId, pageSize + 1, offset)
    .all<PostRow>();
  const rows = result.results || [];
  const hasMore = rows.length > pageSize;
  const slice = rows.slice(0, pageSize);
  return {
    rows: slice,
    reasons: new Map(),
    hasMore,
    page,
  };
}
