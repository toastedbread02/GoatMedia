// Milestones and the weekly note. Both are written with a dedupe key so the
// same message reaches someone exactly once, however often the trigger fires.

import { Env, now, uid } from './lib';

const DAY = 24 * 60 * 60 * 1000;

interface Milestone {
  /** Stable key: the unique index on (user_id, dedupe) does the de-duplicating. */
  key: string;
  text: string;
  postId?: string | null;
}

async function write(env: Env, userId: string, type: 'milestone' | 'weekly', items: Milestone[]) {
  if (!items.length) return;
  const createdAt = now();
  await env.DB.batch(
    items.map((item) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, type, post_id, detail, created_at, dedupe)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid('ntf'), userId, type, item.postId ?? null, item.text, createdAt, item.key),
    ),
  );
}

export async function likeMilestone(env: Env, postId: string, ownerId: string) {
  const row = await env.DB.prepare('SELECT like_count FROM posts WHERE id = ?')
    .bind(postId)
    .first<{ like_count: number }>();
  if (!row || row.like_count !== 10) return;
  await write(env, ownerId, 'milestone', [
    { key: `likes10:${postId}`, text: 'Your goat reached 10 likes.', postId },
  ]);
}

export async function firstCommentMilestone(env: Env, postId: string, ownerId: string) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND user_id != ?',
  )
    .bind(postId, ownerId)
    .first<{ n: number }>();
  if (!row || Number(row.n) !== 1) return;
  await write(env, ownerId, 'milestone', [
    { key: `comment1:${postId}`, text: 'Someone left the first comment on your goat.', postId },
  ]);
}

export async function firstFollowerMilestone(env: Env, userId: string) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  if (!row || Number(row.n) !== 1) return;
  await write(env, userId, 'milestone', [
    { key: 'follow1', text: 'You have your first follower.' },
  ]);
}

function plural(count: number, one: string, many = `${one}s`) {
  return count === 1 ? one : many;
}

/**
 * One short note a week for anyone with a live post, so a quiet creator sees
 * that their clips are still being watched. Silence is the alternative, and
 * silence is what makes people stop posting.
 */
export async function weeklyDigest(env: Env) {
  const since = now() - 7 * DAY;
  const week = new Date(now()).toISOString().slice(0, 10);

  const rows = await env.DB.prepare(
    `SELECT u.id,
            (SELECT COUNT(*) FROM post_events e JOIN posts p ON p.id = e.post_id
              WHERE p.owner_id = u.id AND e.kind = 'view' AND e.created_at >= ?) AS views,
            (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id
              WHERE p.owner_id = u.id AND l.created_at >= ?) AS likes,
            (SELECT COUNT(*) FROM follows f
              WHERE f.following_id = u.id AND f.created_at >= ?) AS followers
       FROM users u
      WHERE u.status = 'active'
        AND EXISTS (SELECT 1 FROM posts p WHERE p.owner_id = u.id AND p.status = 'approved')
      LIMIT 500`,
  )
    .bind(since, since, since)
    .all<{ id: string; views: number; likes: number; followers: number }>();

  const createdAt = now();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results || []) {
    const views = Number(row.views);
    const likes = Number(row.likes);
    const followers = Number(row.followers);
    if (views + likes + followers === 0) continue;
    const parts = [
      `${views} ${plural(views, 'view')}`,
      `${likes} new ${plural(likes, 'like')}`,
    ];
    if (followers) parts.push(`${followers} new ${plural(followers, 'follower')}`);
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, type, detail, created_at, dedupe)
         VALUES (?, ?, 'weekly', ?, ?, ?)`,
      ).bind(
        uid('ntf'),
        row.id,
        `Your goats got ${parts.join(', ')} this week.`,
        createdAt,
        `weekly:${week}`,
      ),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return statements.length;
}
