// Goat of the day. One clip chosen by a person, pinned above the For You feed
// until midnight, and kept afterwards so the archive still shows yesterday's
// pick once a new one takes its place.

import { Env, bad, json, missing, now } from '../lib';
import { currentUser, requireAdmin } from '../session';
import { POST_SELECT, PostRow, hydratePosts } from '../models';

const DAY = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 21;

/** UTC day, so the pick turns over at the same moment for everyone. */
export function dayKey(at = now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Today's pick, but only while it is still an approved post. */
export async function todaysPick(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT d.post_id FROM daily_goats d JOIN posts p ON p.id = d.post_id
      WHERE d.day = ? AND p.status = 'approved'`,
  )
    .bind(dayKey())
    .first<{ post_id: string }>();
  return row?.post_id ?? null;
}

export async function daily(req: Request, env: Env, origin: string) {
  const viewer = await currentUser(req, env);
  const picks = await env.DB.prepare(
    `SELECT d.day, d.post_id FROM daily_goats d
       JOIN posts p ON p.id = d.post_id
      WHERE p.status = 'approved'
      ORDER BY d.day DESC LIMIT ?`,
  )
    .bind(HISTORY_DAYS)
    .all<{ day: string; post_id: string }>();

  const rows = picks.results || [];
  if (!rows.length) return json({ today: null, items: [] });

  const selected = await env.DB.prepare(
    `${POST_SELECT} WHERE p.id IN (${rows.map(() => '?').join(',')})`,
  )
    .bind(...rows.map((row) => row.post_id))
    .all<PostRow>();

  const byId = new Map((selected.results || []).map((row) => [row.id, row]));
  const ordered = rows
    .map((row) => byId.get(row.post_id))
    .filter((row): row is PostRow => Boolean(row));
  const posts = await hydratePosts(env, origin, viewer?.id ?? null, ordered);

  const today = dayKey();
  const items = posts.map((post, index) => ({
    ...post,
    goatOfDay: rows.find((row) => row.post_id === post.id)?.day === today,
    day: rows.find((row) => row.post_id === post.id)?.day ?? null,
    position: index,
  }));
  return json({
    today: items.find((item) => item.goatOfDay) ?? null,
    items,
  });
}

/** Sets one clip as today's pick, replacing any earlier choice today. */
export async function setDaily(req: Request, env: Env) {
  const admin = await requireAdmin(req, env);
  const body = (await req.json().catch(() => ({}))) as { postId?: string; clear?: boolean };
  const day = dayKey();

  if (body.clear) {
    await env.DB.prepare('DELETE FROM daily_goats WHERE day = ?').bind(day).run();
    return json({ ok: true, today: null, message: 'Today has no pick now.' });
  }

  const postId = String(body.postId || '');
  if (!postId) throw bad('Pick a post first.');
  const post = await env.DB.prepare("SELECT id, status FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ id: string; status: string }>();
  if (!post) throw missing('That post is gone.');
  if (post.status !== 'approved') throw bad('Only an approved post can be Goat of the day.');

  await env.DB.prepare(
    `INSERT INTO daily_goats (day, post_id, admin_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET post_id = excluded.post_id,
       admin_id = excluded.admin_id, created_at = excluded.created_at`,
  )
    .bind(day, postId, admin.id, now())
    .run();
  return json({
    ok: true,
    day,
    postId,
    message: 'Pinned as Goat of the day. It sits above For You until midnight.',
  });
}

/**
 * The closing card of a finished feed: a few recent clips that did well, and,
 * for someone who keeps commenting but has never posted, a nudge to upload.
 */
export async function highlights(req: Request, env: Env, origin: string, url: URL) {
  const viewer = await currentUser(req, env);
  const exclude = (url.searchParams.get('exclude') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 40);
  const since = now() - 7 * DAY;

  const rows = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.status = 'approved' AND u.status = 'active'
        AND COALESCE(p.published_at, p.created_at) >= ?
        ${exclude.length ? `AND p.id NOT IN (${exclude.map(() => '?').join(',')})` : ''}
      ORDER BY (p.like_count * 3 + p.comment_count * 2 + p.view_count) DESC
      LIMIT 3`,
  )
    .bind(since, ...exclude)
    .all<PostRow>();

  const items = await hydratePosts(env, origin, viewer?.id ?? null, rows.results || []);

  let invite = null;
  if (viewer) {
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM comments WHERE user_id = ?) AS comments,
              (SELECT COUNT(*) FROM posts WHERE owner_id = ?) AS posts`,
    )
      .bind(viewer.id, viewer.id)
      .first<{ comments: number; posts: number }>();
    const comments = Number(counts?.comments ?? 0);
    const posts = Number(counts?.posts ?? 0);
    // Commenting a few times is the clearest sign someone has their own footage
    // to share, and asking then is not a cold prompt.
    if (posts === 0 && comments >= 3) invite = { comments, posts };
  }

  return json({ items, invite });
}
