// Watch history and resume positions. Views were already recorded for the
// recommender; this turns them into something the viewer can see and pick up.

import { Env, json, missing, now, pageOf, readJson } from '../lib';
import { requireActive } from '../session';
import { POST_SELECT, PostRow, hydratePosts } from '../models';

/** The most recent watch of each post, newest first. */
export async function watchHistory(
  req: Request,
  env: Env,
  origin: string,
  url: URL,
) {
  const user = await requireActive(req, env);
  const { page, offset } = pageOf(url.searchParams.get('page'), 12);
  const rows = await env.DB.prepare(
    `${POST_SELECT}
       JOIN (SELECT post_id, MAX(created_at) AS seen_at
               FROM post_events
              WHERE user_id = ? AND kind = 'view'
              GROUP BY post_id) h ON h.post_id = p.id
      WHERE p.status = 'approved' AND u.status = 'active'
      ORDER BY h.seen_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(user.id, 13, offset)
    .all<PostRow>();

  const list = rows.results || [];
  const items = await hydratePosts(env, origin, user.id, list.slice(0, 12));
  return json({ items, hasMore: list.length > 12, page });
}

/** Forgets what was watched; likes, follows and saved posts stay. */
export async function clearHistory(req: Request, env: Env) {
  const user = await requireActive(req, env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM post_events WHERE user_id = ? AND kind = 'view'").bind(user.id),
    env.DB.prepare('DELETE FROM post_progress WHERE user_id = ?').bind(user.id),
  ]);
  return json({ ok: true });
}

/**
 * Where playback had got to. Written from the player every few seconds, so it
 * stays cheap: one small upsert, no history row of its own.
 */
export async function saveProgress(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  const body = await readJson<Record<string, unknown>>(req);
  const rawPosition = Number(body.positionMs);
  const rawDuration = Number(body.durationMs);
  if (!Number.isFinite(rawPosition)) throw missing('No position was sent.');
  const positionMs = Math.max(0, Math.min(6 * 60 * 60 * 1000, Math.floor(rawPosition)));
  const durationMs = Number.isFinite(rawDuration)
    ? Math.max(0, Math.min(6 * 60 * 60 * 1000, Math.floor(rawDuration)))
    : 0;

  const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND status = 'approved'")
    .bind(id)
    .first<{ id: string }>();
  if (!post) throw missing('That post is not here.');

  await env.DB.prepare(
    `INSERT INTO post_progress (user_id, post_id, position_ms, duration_ms, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, post_id) DO UPDATE SET
       position_ms = excluded.position_ms,
       duration_ms = excluded.duration_ms,
       updated_at = excluded.updated_at`,
  )
    .bind(user.id, id, positionMs, durationMs, now())
    .run();
  return json({ ok: true, positionMs });
}
