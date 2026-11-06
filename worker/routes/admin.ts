import { Env, bad, json, missing, now, optionalStr, pageOf, readJson, uid } from '../lib';
import { requireAdmin, requireUser } from '../session';
import { hydratePosts, PostRow, POST_SELECT } from '../models';
import { rejectionReasons } from '../config';
import { invalidateTrending } from '../recommend';

/**
 * One-time promotion of the first moderator. The token is a Worker secret, so
 * nothing privileged ships in the Pages build, and the endpoint refuses to run
 * once any administrator exists.
 */
export async function claimAdmin(req: Request, env: Env) {
  const user = await requireUser(req, env);
  const body = await readJson(req);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const expected = env.ADMIN_SETUP_TOKEN;
  if (!expected) throw bad('Admin setup is not configured on this server.');
  if (!token || token !== expected) throw bad('That setup token is not right.');
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{
    n: number;
  }>();
  if ((existing?.n ?? 0) > 0) throw bad('This server already has a moderator.');
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
  return json({ ok: true });
}

const STATUSES = ['pending', 'approved', 'rejected', 'removed'] as const;

function statusOf(raw: string | null): (typeof STATUSES)[number] {
  return STATUSES.includes(raw as never) ? (raw as (typeof STATUSES)[number]) : 'pending';
}

export async function counts(req: Request, env: Env) {
  await requireAdmin(req, env);
  const rows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM posts GROUP BY status`,
  ).all<{ status: string; n: number }>();
  const openReports = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE status = 'open'",
  ).first<{ n: number }>();
  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM users WHERE created_at > ?',
  )
    .bind(now() - 7 * 86_400_000)
    .first<{ n: number }>();

  const map = new Map((rows.results || []).map((row) => [row.status, Number(row.n)]));
  return json({
    pending: map.get('pending') ?? 0,
    approved: map.get('approved') ?? 0,
    rejected: map.get('rejected') ?? 0,
    removed: map.get('removed') ?? 0,
    openReports: openReports?.n ?? 0,
    users: users?.n ?? 0,
    newUsersThisWeek: recent?.n ?? 0,
  });
}

export async function queue(req: Request, env: Env, origin: string, url: URL) {
  await requireAdmin(req, env);
  const status = statusOf(url.searchParams.get('status'));
  const { offset, page } = pageOf(url.searchParams.get('page'), 12);

  const rows = await env.DB.prepare(
    `SELECT p.id, p.owner_id, p.caption, p.category, p.hashtags, p.sound_id, p.status,
            p.reject_reason, p.removed_reason, p.created_at, p.updated_at, p.published_at,
            p.view_count, p.like_count, p.comment_count,
            u.username, u.display_name, u.avatar_version, u.status AS owner_status,
            u.email AS creator_email, u.created_at AS creator_joined_at,
            (SELECT COUNT(*) FROM posts p2 WHERE p2.owner_id = u.id) AS creator_posts
       FROM posts p JOIN users u ON u.id = p.owner_id
      WHERE p.status = ?
      ORDER BY ${status === 'pending' ? 'p.created_at ASC' : 'p.updated_at DESC'}
      LIMIT ? OFFSET ?`,
  )
    .bind(status, 13, offset)
    .all<PostRow & { creator_email: string; creator_joined_at: number; creator_posts: number }>();

  const list = rows.results || [];
  const items = await hydratePosts(env, origin, null, list.slice(0, 12), { showStatus: true });
  return json({
    items: items.map((item, index) => ({
      ...item,
      creatorEmail: list[index].creator_email,
      creatorJoinedAt: list[index].creator_joined_at,
      creatorPostCount: list[index].creator_posts,
    })),
    hasMore: list.length > 12,
    page,
    status,
  });
}

export async function detail(req: Request, env: Env, origin: string, id: string) {
  await requireAdmin(req, env);
  const row = await env.DB.prepare(
    `${POST_SELECT.replace('u.status AS owner_status', 'u.status AS owner_status, u.email AS creator_email, u.created_at AS creator_joined_at')}
      WHERE p.id = ?`,
  )
    .bind(id)
    .first<PostRow & { creator_email: string; creator_joined_at: number }>();
  if (!row) throw missing('That post is gone.');

  const [post] = await hydratePosts(env, origin, null, [row], { showStatus: true });
  const history = await env.DB.prepare(
    `SELECT m.id, m.action, m.reason, m.created_at, a.username
       FROM moderation_events m LEFT JOIN users a ON a.id = m.admin_id
      WHERE m.post_id = ? ORDER BY m.created_at DESC LIMIT 12`,
  )
    .bind(id)
    .all<{ id: string; action: string; reason: string | null; created_at: number; username: string | null }>();

  const reports = await env.DB.prepare(
    `SELECT r.id, r.reason, r.note, r.created_at, r.status, u.username
       FROM reports r JOIN users u ON u.id = r.reporter_id
      WHERE r.target_type = 'post' AND r.target_id = ? ORDER BY r.created_at DESC`,
  )
    .bind(id)
    .all<{
      id: string;
      reason: string;
      note: string | null;
      created_at: number;
      status: string;
      username: string;
    }>();

  return json({
    post: {
      ...post,
      creatorEmail: row.creator_email,
      creatorJoinedAt: row.creator_joined_at,
    },
    history: (history.results || []).map((item) => ({
      id: item.id,
      action: item.action,
      reason: item.reason,
      createdAt: item.created_at,
      adminUsername: item.username,
    })),
    reports: (reports.results || []).map((item) => ({
      id: item.id,
      reason: item.reason,
      note: item.note,
      createdAt: item.created_at,
      status: item.status,
      reporterUsername: item.username,
    })),
    rejectionReasons,
  });
}

export async function decide(
  req: Request,
  env: Env,
  id: string,
  action: 'approve' | 'reject' | 'remove',
) {
  const admin = await requireAdmin(req, env);
  const body = action === 'approve' ? {} : await readJson(req);
  const reason = optionalStr((body as { reason?: string }).reason, 200);

  const post = await env.DB.prepare('SELECT id, owner_id, status, published_at, sound_id FROM posts WHERE id = ?')
    .bind(id)
    .first<{ id: string; owner_id: string; status: string; published_at: number | null; sound_id: string | null }>();
  if (!post) throw missing('That post is gone.');
  if (action === 'reject' && !reason) throw bad('A rejection needs a reason the creator can read.');
  if (action === 'remove' && !reason) throw bad('Say why the post is being removed.');
  if (action === 'approve' && post.status === 'approved') throw bad('That post is already live.');

  const createdAt = now();
  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'removed';

  const statements = [
    env.DB.prepare(
      `UPDATE posts SET status = ?, reject_reason = ?, removed_reason = ?,
         published_at = COALESCE(published_at, ?), updated_at = ?
       WHERE id = ?`,
    ).bind(
      status,
      action === 'reject' ? reason : null,
      action === 'remove' ? reason : null,
      action === 'approve' ? createdAt : null,
      createdAt,
      id,
    ),
    env.DB.prepare(
      `INSERT INTO moderation_events (id, post_id, admin_id, action, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(uid('mod'), id, admin.id, action, reason, createdAt),
    env.DB.prepare(
      `INSERT INTO notifications (id, user_id, type, post_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      uid('ntf'),
      post.owner_id,
      action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'removed',
      id,
      reason,
      createdAt,
    ),
  ];

  if (action === 'approve' && post.sound_id) {
    statements.push(
      env.DB.prepare('UPDATE sounds SET use_count = use_count + 1 WHERE id = ?').bind(post.sound_id),
    );
  }

  await env.DB.batch(statements);
  invalidateTrending();
  return json({ ok: true, status });
}

export async function reports(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const status = url.searchParams.get('status') || 'open';
  const rows = await env.DB.prepare(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at, r.status,
            u.username AS reporter,
            (SELECT id FROM posts p WHERE p.id = r.target_id) AS post_id,
            (SELECT caption FROM posts p WHERE p.id = r.target_id) AS post_caption,
            (SELECT status FROM posts p WHERE p.id = r.target_id) AS post_status,
            (SELECT username FROM users u2 JOIN posts p ON p.owner_id = u2.id WHERE p.id = r.target_id) AS post_owner,
            (SELECT body FROM comments c WHERE c.id = r.target_id) AS comment_body,
            (SELECT c.post_id FROM comments c WHERE c.id = r.target_id) AS comment_post,
            (SELECT username FROM users u3 JOIN comments c ON c.user_id = u3.id WHERE c.id = r.target_id) AS comment_author,
            (SELECT username FROM users u4 WHERE u4.id = r.target_id AND r.target_type = 'user') AS user_target
       FROM reports r JOIN users u ON u.id = r.reporter_id
      WHERE (? = 'all' OR r.status = ?)
      ORDER BY r.created_at DESC LIMIT 60`,
  )
    .bind(status, status)
    .all<Record<string, unknown>>();

  return json({
    reports: (rows.results || []).map((row) => ({
      id: String(row.id),
      targetType: String(row.target_type),
      targetId: String(row.target_id),
      reason: String(row.reason),
      note: (row.note as string | null) ?? null,
      createdAt: Number(row.created_at),
      status: String(row.status),
      reporterUsername: String(row.reporter),
      post:
        row.post_id != null
          ? {
              id: String(row.post_id),
              caption: String(row.post_caption ?? ''),
              status: String(row.post_status ?? ''),
              creatorUsername: String(row.post_owner ?? ''),
            }
          : null,
      comment:
        row.comment_body != null
          ? {
              body: String(row.comment_body),
              postId: String(row.comment_post ?? ''),
              authorUsername: String(row.comment_author ?? ''),
            }
          : null,
      userTarget: (row.user_target as string | null) ?? null,
    })),
  });
}

export async function resolveReport(req: Request, env: Env, id: string) {
  await requireAdmin(req, env);
  const body = await readJson(req);
  const action = String(body.action || '');
  if (!['dismiss', 'action'].includes(action)) throw bad('Unknown report action.');
  await env.DB.prepare('UPDATE reports SET status = ?, resolved_at = ? WHERE id = ?')
    .bind(action === 'dismiss' ? 'dismissed' : 'actioned', now(), id)
    .run();
  return json({ ok: true });
}

export async function users(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const like = `%${q}%`;
  const rows = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.email, u.role, u.status, u.suspended_reason, u.created_at,
            (SELECT COUNT(*) FROM posts p WHERE p.owner_id = u.id) AS post_count,
            (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count
       FROM users u
      WHERE (? = '' OR LOWER(u.username) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.display_name) LIKE ?)
      ORDER BY u.created_at DESC LIMIT 50`,
  )
    .bind(q, like, like, like)
    .all<Record<string, unknown>>();

  return json({
    users: (rows.results || []).map((row) => ({
      id: String(row.id),
      username: String(row.username),
      displayName: String(row.display_name),
      email: String(row.email),
      role: String(row.role),
      status: String(row.status),
      suspendedReason: (row.suspended_reason as string | null) ?? null,
      createdAt: Number(row.created_at),
      postCount: Number(row.post_count),
      followerCount: Number(row.follower_count),
    })),
  });
}

export async function suspendUser(req: Request, env: Env, id: string, on: boolean) {
  const admin = await requireAdmin(req, env);
  if (id === admin.id) throw bad('You cannot suspend your own account.');
  const body = on ? await readJson(req) : {};
  const reason = optionalStr((body as { reason?: string }).reason, 200);
  if (on && !reason) throw bad('Give a reason so the account can be told why.');

  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string; role: string }>();
  if (!target) throw missing('No such account.');
  if (target.role === 'admin') throw bad('Moderator accounts cannot be suspended here.');

  const statements = [
    env.DB.prepare('UPDATE users SET status = ?, suspended_reason = ? WHERE id = ?').bind(
      on ? 'suspended' : 'active',
      on ? reason : null,
      id,
    ),
  ];
  if (on) {
    statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    statements.push(
      env.DB.prepare("UPDATE posts SET status = 'removed', removed_reason = ? WHERE owner_id = ? AND status = 'approved'")
        .bind('Creator account suspended', id),
    );
  }
  await env.DB.batch(statements);
  invalidateTrending();
  return json({ ok: true, suspended: on });
}

export async function adminSounds(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const origin = new URL(req.url).origin;
  const rows = await env.DB.prepare(
    `SELECT s.id, s.title, s.size, s.duration_ms, s.use_count, s.created_at,
            u.username,
            (SELECT COUNT(*) FROM posts p WHERE p.sound_id = s.id) AS posts
       FROM sounds s JOIN users u ON u.id = s.owner_id
      ORDER BY s.created_at DESC LIMIT 40`,
  ).all<{
    id: string;
    title: string;
    size: number;
    duration_ms: number;
    use_count: number;
    created_at: number;
    username: string;
    posts: number;
  }>();
  return json({
    sounds: (rows.results || []).map((row) => ({
      id: row.id,
      title: row.title,
      url: `${origin}/media/sounds/${row.id}`,
      size: row.size,
      durationMs: row.duration_ms,
      useCount: row.use_count,
      createdAt: row.created_at,
      ownerUsername: row.username,
      postCount: row.posts,
    })),
  });
}
