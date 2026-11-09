// The two browse surfaces a post can point at: its hashtag and its sound.
// Both keep the shape of a paged grid so the browser can reuse its cards.

import { Env, json, missing, pageOf } from '../lib';
import { currentUser } from '../session';
import { POST_SELECT, PostRow, hydratePosts } from '../models';

const TAG_SHAPE = /^[a-z0-9_]{2,24}$/;

/** Every approved post that carries this hashtag, newest first. */
export async function tagPage(
  req: Request,
  env: Env,
  origin: string,
  url: URL,
  raw: string,
) {
  const tag = decodeURIComponent(raw).replace(/^#/, '').trim().toLowerCase();
  if (!TAG_SHAPE.test(tag)) throw missing('That hashtag is not here.');
  const viewer = await currentUser(req, env);
  const { page, offset } = pageOf(url.searchParams.get('page'), 12);

  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `${POST_SELECT}
        WHERE p.status = 'approved' AND u.status = 'active'
          AND EXISTS (SELECT 1 FROM json_each(p.hashtags) WHERE LOWER(json_each.value) = ?)
        ORDER BY p.published_at DESC
        LIMIT ? OFFSET ?`,
    )
      .bind(tag, 13, offset)
      .all<PostRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM posts p
        WHERE p.status = 'approved'
          AND EXISTS (SELECT 1 FROM json_each(p.hashtags) WHERE LOWER(json_each.value) = ?)`,
    )
      .bind(tag)
      .first<{ n: number }>(),
  ]);

  const list = rows.results || [];
  const items = await hydratePosts(env, origin, viewer?.id ?? null, list.slice(0, 12));
  return json({
    tag,
    items,
    hasMore: list.length > 12,
    page,
    total: Number(count?.n ?? items.length),
  });
}

interface SoundRow {
  id: string;
  owner_id: string;
  title: string;
  duration_ms: number;
  use_count: number;
  post_count: number;
  username: string;
  display_name: string;
}

/**
 * One sound and the posts that borrowed it. A sound stays private until a
 * post using it is approved, so a stranger cannot listen to a rejected upload.
 */
export async function soundPage(
  req: Request,
  env: Env,
  origin: string,
  url: URL,
  id: string,
) {
  const viewer = await currentUser(req, env);
  const sound = await env.DB.prepare(
    `SELECT s.id, s.owner_id, s.title, s.duration_ms, s.use_count,
            (SELECT COUNT(*) FROM posts p2 WHERE p2.sound_id = s.id AND p2.status = 'approved') AS post_count,
            u.username, u.display_name
       FROM sounds s JOIN users u ON u.id = s.owner_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<SoundRow>();
  if (!sound) throw missing('That sound is not here.');
  if (!sound.post_count && sound.owner_id !== viewer?.id) {
    throw missing('That sound is not here.');
  }

  const { page, offset } = pageOf(url.searchParams.get('page'), 12);
  const rows = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.sound_id = ? AND p.status = 'approved' AND u.status = 'active'
      ORDER BY p.published_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(id, 13, offset)
    .all<PostRow>();

  const list = rows.results || [];
  const items = await hydratePosts(env, origin, viewer?.id ?? null, list.slice(0, 12));
  return json({
    sound: {
      id: sound.id,
      title: sound.title,
      url: `${origin}/media/sounds/${sound.id}`,
      durationMs: sound.duration_ms,
      useCount: sound.use_count,
      postCount: Number(sound.post_count),
      owner: {
        id: sound.owner_id,
        username: sound.username,
        displayName: sound.display_name,
      },
    },
    items,
    hasMore: list.length > 12,
    page,
  });
}
