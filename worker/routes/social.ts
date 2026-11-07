import { Env, bad, json, missing, now, rateLimit, uid } from '../lib';
import { currentUser, requireActive } from '../session';
import { hydratePosts, PostRow, POST_SELECT, publicUser, USER_SELECT, UserRow } from '../models';
import { applySignal } from '../interests';

export async function follow(req: Request, env: Env, username: string, on: boolean) {
  const user = await requireActive(req, env);
  // Clients may address an account by handle or id; both are stable to us.
  const target = await env.DB.prepare('SELECT id, status FROM users WHERE username = ? OR id = ?')
    .bind(username, username)
    .first<{ id: string; status: string }>();
  if (!target) throw missing('No creator with that username.');
  if (target.id === user.id) throw bad('You cannot follow yourself.');
  if (target.status !== 'active') throw bad('That account is not available.');

  const blocked = await env.DB.prepare(
    `SELECT 1 AS n FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
  )
    .bind(user.id, target.id, target.id, user.id)
    .first<{ n: number }>();
  if (blocked) throw bad('You cannot follow this account.');

  if (on) {
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)',
    )
      .bind(user.id, target.id, now())
      .run();
    if (result.meta.changes) {
      await env.DB.prepare(
        `INSERT INTO notifications (id, user_id, type, actor_id, created_at)
         VALUES (?, ?, 'follow', ?, ?)`,
      )
        .bind(uid('ntf'), target.id, user.id, now())
        .run();
      const recent = await env.DB.prepare(
        `SELECT id FROM posts WHERE owner_id = ? AND status = 'approved' ORDER BY published_at DESC LIMIT 3`,
      )
        .bind(target.id)
        .all<{ id: string }>();
      for (const post of recent.results || []) {
        await applySignal(env, user.id, post.id, 'follow');
      }
    }
  } else {
    await env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
      .bind(user.id, target.id)
      .run();
  }

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?')
    .bind(target.id)
    .first<{ n: number }>();
  return json({ following: on, followerCount: count?.n ?? 0 });
}

/**
 * Who follows this account, or who it follows. Both directions are public,
 * ordered newest first, and page the same way the feeds do.
 */
export async function followList(
  req: Request,
  env: Env,
  origin: string,
  username: string,
  kind: 'followers' | 'following',
  url: URL,
) {
  const viewer = await currentUser(req, env);
  const viewerId = viewer?.id ?? null;
  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>();
  if (!target) throw missing('No creator with that username.');

  const page = Math.max(1, Math.min(200, Number(url.searchParams.get('page') || 1) || 1));
  const size = 20;
  const offset = (page - 1) * size;
  const join =
    kind === 'followers'
      ? `JOIN follows f ON f.follower_id = u.id WHERE f.following_id = ? AND u.status = 'active'`
      : `JOIN follows f ON f.following_id = u.id WHERE f.follower_id = ? AND u.status = 'active'`;
  const countSql =
    kind === 'followers'
      ? `SELECT COUNT(*) AS n FROM follows f JOIN users u ON u.id = f.follower_id
          WHERE f.following_id = ? AND u.status = 'active'`
      : `SELECT COUNT(*) AS n FROM follows f JOIN users u ON u.id = f.following_id
          WHERE f.follower_id = ? AND u.status = 'active'`;

  const [rows, total] = await Promise.all([
    env.DB.prepare(
      `${USER_SELECT(viewerId)} ${join} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...(viewerId ? [viewerId, viewerId] : []), target.id, size, offset)
      .all<UserRow>(),
    env.DB.prepare(countSql).bind(target.id).first<{ n: number }>(),
  ]);

  const users = (rows.results || []).map((row) => publicUser(origin, row, viewerId));
  const totalCount = total?.n ?? 0;
  return json({
    users,
    items: users,
    total: totalCount,
    page,
    hasMore: offset + users.length < totalCount,
  });
}

export async function block(req: Request, env: Env, username: string, on: boolean) {
  const user = await requireActive(req, env);
  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ? OR id = ?')
    .bind(username, username)
    .first<{ id: string }>();
  if (!target) throw missing('No creator with that username.');
  if (target.id === user.id) throw bad('You cannot block yourself.');

  if (on) {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
      ).bind(user.id, target.id, now()),
      env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(
        user.id,
        target.id,
      ),
      env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(
        target.id,
        user.id,
      ),
    ]);
  } else {
    await env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .bind(user.id, target.id)
      .run();
  }
  return json({ blocked: on });
}

export async function search(req: Request, env: Env, origin: string, url: URL) {
  const viewer = await currentUser(req, env);
  const raw = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const q = raw.toLowerCase();
  const tag = q.startsWith('#') ? q.slice(1) : null;
  if (!q) return json({ posts: [], creators: [], hashtag: null, query: '' });

  const like = `%${q}%`;
  const [postRows, userRows] = await Promise.all([
    env.DB.prepare(
      `${POST_SELECT}
        LEFT JOIN sounds s ON s.id = p.sound_id
        WHERE p.status = 'approved' AND u.status = 'active'
          AND (
            LOWER(p.caption) LIKE ?
            OR LOWER(p.hashtags) LIKE ?
            OR LOWER(s.title) LIKE ?
            ${tag ? "OR LOWER(p.hashtags) LIKE ?" : ''}
          )
        ORDER BY p.published_at DESC
        LIMIT 30`,
    )
      .bind(...(tag ? [like, `%${tag}%`, like, `%"${tag}"%`] : [like, like, like]))
      .all<PostRow>(),
    env.DB.prepare(
      `${USER_SELECT(viewer?.id ?? null)}
        WHERE u.status = 'active' AND (LOWER(u.username) LIKE ? OR LOWER(u.display_name) LIKE ?)
        ORDER BY follower_count DESC
        LIMIT 8`,
    )
      .bind(...(viewer ? [viewer.id, viewer.id] : []), like, like)
      .all<UserRow>(),
  ]);

  const posts = await hydratePosts(env, origin, viewer?.id ?? null, postRows.results || []);
  const creators = (userRows.results || []).map((row) => publicUser(origin, row, viewer?.id ?? null));
  return json({
    posts,
    creators,
    videos: posts,
    people: creators,
    hashtag: tag,
    query: raw,
  });
}

export async function notifications(req: Request, env: Env, url: URL) {
  const user = await requireActive(req, env);
  const rows = await env.DB.prepare(
    `SELECT n.id, n.type, n.post_id, n.detail, n.created_at, n.read_at,
            p.caption AS post_caption,
            a.username AS actor_username, a.display_name AS actor_display_name
       FROM notifications n
       LEFT JOIN posts p ON p.id = n.post_id
       LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 40`,
  )
    .bind(user.id)
    .all<{
      id: string;
      type: string;
      post_id: string | null;
      detail: string | null;
      created_at: number;
      read_at: number | null;
      post_caption: string | null;
      actor_username: string | null;
      actor_display_name: string | null;
    }>();

  if (url.searchParams.get('markRead') === '1') {
    await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .bind(now(), user.id)
      .run();
  }

  const items = (rows.results || []).map((row) => ({
    id: row.id,
    type: row.type,
    postId: row.post_id,
    postCaption: row.post_caption,
    videoId: row.post_id,
    videoCaption: row.post_caption,
    actorUsername: row.actor_username,
    actorDisplayName: row.actor_display_name,
    detail: row.detail,
    createdAt: row.created_at,
    read: Boolean(row.read_at),
  }));
  return json({
    notifications: items,
    items,
    unread: items.filter((item) => !item.read).length,
  });
}

export async function markNotificationsRead(req: Request, env: Env) {
  const user = await requireActive(req, env);
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (body.id) {
    await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?')
      .bind(now(), body.id, user.id)
      .run();
    return json({ ok: true });
  }
  await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .bind(now(), user.id)
    .run();
  return json({ ok: true });
}

export async function interests(req: Request, env: Env) {
  const user = await requireActive(req, env);
  const rows = await env.DB.prepare(
    `SELECT kind, value, weight, updated_at FROM interests
      WHERE user_id = ? AND ABS(weight) >= 0.5 ORDER BY ABS(weight) DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<{ kind: 'category' | 'hashtag'; value: string; weight: number; updated_at: number }>();
  const items = (rows.results || []).map((row) => ({
    kind: row.kind,
    value: row.value,
    weight: Math.round(row.weight * 10) / 10,
    updatedAt: row.updated_at,
  }));
  return json({ interests: items, items });
}

export async function resetInterests(req: Request, env: Env) {
  const user = await requireActive(req, env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM interests WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM hidden_posts WHERE user_id = ?').bind(user.id),
  ]);
  return json({ ok: true });
}

export async function hiddenPosts(req: Request, env: Env, origin: string) {
  const user = await requireActive(req, env);
  const rows = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.id IN (SELECT post_id FROM hidden_posts WHERE user_id = ?)
      ORDER BY p.created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<PostRow>();
  const items = await hydratePosts(env, origin, user.id, rows.results || []);
  return json({ items });
}

export async function blockedUsers(req: Request, env: Env, origin: string) {
  const user = await requireActive(req, env);
  const rows = await env.DB.prepare(
    `${USER_SELECT(user.id)}
      WHERE u.id IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?) ORDER BY u.username`,
  )
    .bind(user.id, user.id, user.id)
    .all<UserRow>();
  const items = (rows.results || []).map((row) => publicUser(origin, row, user.id));
  return json({ users: items, items });
}

export async function reportUser(req: Request, env: Env, username: string) {
  const user = await requireActive(req, env);
  await rateLimit(env, `report:${user.id}`, 10, 60 * 60 * 1000, 'You have reported a lot recently.');
  const body = (await req.json().catch(() => ({}))) as { reason?: string; note?: string };
  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>();
  if (!target) throw missing('No creator with that username.');
  await env.DB.prepare(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, note, created_at)
     VALUES (?, ?, 'user', ?, ?, ?, ?)`,
  )
    .bind(
      uid('rep'),
      user.id,
      target.id,
      (body.reason || 'Something else').slice(0, 60),
      (body.note || '').slice(0, 400) || null,
      now(),
    )
    .run();
  return json({ ok: true }, 201);
}
