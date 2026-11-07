import { Env, json, now } from '../lib';
import { requireActive } from '../session';

const DAY = 86_400_000;

interface WindowCounts {
  views: number;
  likes: number;
  comments: number;
  followers: number;
}

/**
 * Everything a creator earned between two moments: views (signed in and
 * signed out), likes, comments and new followers.
 */
async function countsBetween(env: Env, userId: string, from: number, to: number) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM post_events e JOIN posts p ON p.id = e.post_id
         WHERE p.owner_id = ? AND e.kind = 'view' AND e.created_at >= ? AND e.created_at < ?) +
       (SELECT COUNT(*) FROM guest_views g JOIN posts p ON p.id = g.post_id
         WHERE p.owner_id = ? AND g.created_at >= ? AND g.created_at < ?) AS views,
       (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id
         WHERE p.owner_id = ? AND l.created_at >= ? AND l.created_at < ?) AS likes,
       (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id = c.post_id
         WHERE p.owner_id = ? AND c.status = 'visible' AND c.created_at >= ? AND c.created_at < ?) AS comments,
       (SELECT COUNT(*) FROM follows f
         WHERE f.following_id = ? AND f.created_at >= ? AND f.created_at < ?) AS followers`,
  )
    .bind(
      userId, from, to,
      userId, from, to,
      userId, from, to,
      userId, from, to,
      userId, from, to,
    )
    .first<WindowCounts>();

  return {
    views: Number(row?.views ?? 0),
    likes: Number(row?.likes ?? 0),
    comments: Number(row?.comments ?? 0),
    followers: Number(row?.followers ?? 0),
  };
}

/**
 * The creator's own week, next to the week before it. Only approved posts
 * count, so a rejected upload never inflates the numbers.
 */
export async function creatorStats(req: Request, env: Env) {
  const user = await requireActive(req, env);
  const current = now();
  const weekStart = current - 7 * DAY;
  const previousStart = current - 14 * DAY;

  const [week, previous, daily, top, totals] = await Promise.all([
    countsBetween(env, user.id, weekStart, current),
    countsBetween(env, user.id, previousStart, weekStart),
    env.DB.prepare(
      `SELECT CAST((? - e.created_at) / ${DAY} AS INTEGER) AS bucket, COUNT(*) AS n
         FROM post_events e JOIN posts p ON p.id = e.post_id
        WHERE p.owner_id = ? AND e.kind = 'view' AND e.created_at >= ?
        GROUP BY bucket`,
    )
      .bind(current, user.id, weekStart)
      .all<{ bucket: number; n: number }>(),
    env.DB.prepare(
      `SELECT p.id, p.caption, COUNT(e.id) AS views
         FROM post_events e JOIN posts p ON p.id = e.post_id
        WHERE p.owner_id = ? AND e.kind = 'view' AND e.created_at >= ?
        GROUP BY p.id
        ORDER BY views DESC
        LIMIT 1`,
    )
      .bind(user.id, weekStart)
      .first<{ id: string; caption: string; views: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS posts,
              COALESCE(SUM(view_count), 0) AS views,
              COALESCE(SUM(like_count), 0) AS likes
         FROM posts WHERE owner_id = ? AND status = 'approved'`,
    )
      .bind(user.id)
      .first<{ posts: number; views: number; likes: number }>(),
  ]);

  // Bucket 0 is today, so the chart reads oldest to newest.
  const buckets = new Array(7).fill(0) as number[];
  for (const row of daily.results || []) {
    const index = 6 - Number(row.bucket);
    if (index >= 0 && index < 7) buckets[index] += Number(row.n);
  }

  return json({
    week,
    previous,
    daily: buckets,
    topPost: top ? { id: top.id, caption: top.caption, views: Number(top.views) } : null,
    totals: {
      posts: Number(totals?.posts ?? 0),
      views: Number(totals?.views ?? 0),
      likes: Number(totals?.likes ?? 0),
    },
  });
}
