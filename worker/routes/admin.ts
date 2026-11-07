import { Env, bad, json, missing, now, optionalStr, pageOf, readJson, str, uid } from '../lib';
import { requireAdmin, requireUser } from '../session';
import { hydratePosts, PostRow, POST_SELECT } from '../models';
import { rejectionReasons } from '../config';
import { invalidateTrending } from '../recommend';
import { banAccount, unbanAccount } from '../safety';

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
  const openTickets = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM support_tickets WHERE status <> 'closed'",
  ).first<{ n: number }>();
  const openAppeals = await env.DB.prepare("SELECT COUNT(*) AS n FROM appeals WHERE status = 'open'").first<{
    n: number;
  }>();
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
    openTickets: openTickets?.n ?? 0,
    openAppeals: openAppeals?.n ?? 0,
    users: users?.n ?? 0,
    newUsersThisWeek: recent?.n ?? 0,
  });
}

export async function queue(req: Request, env: Env, origin: string, url: URL) {
  await requireAdmin(req, env);
  const status = statusOf(url.searchParams.get('status'));
  const { offset, page } = pageOf(url.searchParams.get('page'), 12);
  // Choosing the daily pick needs to find one old post among hundreds, so the
  // queue takes a search term. It matches the caption or the creator. Wildcards
  // are stripped from the term rather than escaped, which keeps the SQL plain.
  const term = (url.searchParams.get('q') || '').trim().slice(0, 60).replace(/[%_]/g, ' ');
  const like = term ? `%${term}%` : null;
  const search = like ? 'AND (p.caption LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)' : '';
  const bindings = like ? [status, like, like, like, 13, offset] : [status, 13, offset];

  // The queue has to carry the same columns as every other feed, otherwise a
  // video arrives as a photo album with no photos and the review pane is blank.
  const queueSelect = POST_SELECT.replace(
    'u.status AS owner_status',
    `u.status AS owner_status, u.email AS creator_email, u.created_at AS creator_joined_at,
     (SELECT COUNT(*) FROM posts p2 WHERE p2.owner_id = u.id) AS creator_posts`,
  );
  const rows = await env.DB.prepare(
    `${queueSelect}
      WHERE p.status = ? ${search}
      ORDER BY ${status === 'pending' ? 'p.created_at ASC' : 'p.updated_at DESC'}
      LIMIT ? OFFSET ?`,
  )
    .bind(...bindings)
    .all<PostRow & { creator_email: string; creator_joined_at: number; creator_posts: number }>();

  const list = rows.results || [];
  const items = await hydratePosts(env, origin, null, list.slice(0, 12), { showStatus: true });
  const ids = list.slice(0, 12).map((row) => row.id);
  const historyByPost = new Map<string, unknown[]>();
  if (ids.length) {
    const historyRows = await env.DB.prepare(
      `SELECT m.id, m.post_id, m.action, m.reason, m.created_at, a.username
         FROM moderation_events m LEFT JOIN users a ON a.id = m.admin_id
        WHERE m.post_id IN (${ids.map(() => '?').join(',')})
        ORDER BY m.created_at DESC`,
    )
      .bind(...ids)
      .all<{
        id: string;
        post_id: string;
        action: string;
        reason: string | null;
        created_at: number;
        username: string | null;
      }>();
    for (const event of historyRows.results || []) {
      const bucket = historyByPost.get(event.post_id) || [];
      bucket.push({
        id: event.id,
        action: event.action,
        reason: event.reason,
        createdAt: event.created_at,
        adminUsername: event.username,
      });
      historyByPost.set(event.post_id, bucket);
    }
  }
  return json({
    items: items.map((item, index) => ({
      ...item,
      creatorEmail: list[index].creator_email,
      creatorJoinedAt: list[index].creator_joined_at,
      creatorUploads: list[index].creator_posts,
      creatorPostCount: list[index].creator_posts,
      moderationHistory: historyByPost.get(item.id) || [],
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

  // Approving is the moment a post becomes public, so it is also the moment
  // followers hear about it. A post that is removed and later approved again
  // does not ping the same people twice.
  if (action === 'approve') {
    const already = await env.DB.prepare(
      "SELECT 1 AS n FROM notifications WHERE post_id = ? AND type = 'new_post' LIMIT 1",
    )
      .bind(id)
      .first<{ n: number }>();
    if (!already) {
      const caption = await env.DB.prepare('SELECT caption FROM posts WHERE id = ?')
        .bind(id)
        .first<{ caption: string }>();
      const detail = (caption?.caption || '').slice(0, 80) || null;
      await env.DB.prepare(
        `INSERT INTO notifications (id, user_id, type, post_id, actor_id, detail, created_at)
         SELECT 'ntf_' || lower(hex(randomblob(12))), f.follower_id, 'new_post', ?, ?, ?, ?
           FROM follows f JOIN users u ON u.id = f.follower_id
          WHERE f.following_id = ?
            AND u.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM blocks b
               WHERE (b.blocker_id = f.follower_id AND b.blocked_id = ?)
                  OR (b.blocker_id = ? AND b.blocked_id = f.follower_id)
            )`,
      )
        .bind(id, post.owner_id, detail, createdAt, post.owner_id, post.owner_id, post.owner_id)
        .run();
    }
  }

  return json({
    ok: true,
    status,
    message:
      action === 'approve'
        ? 'Approved. It is live in the feed now.'
        : action === 'reject'
          ? 'Rejected. The creator can read your reason.'
          : 'Removed from public view.',
  });
}

export async function reports(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const status = url.searchParams.get('status') || 'open';
  const rows = await env.DB.prepare(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at, r.status,
            u.username AS reporter,
            (SELECT id FROM posts p WHERE p.id = r.target_id) AS post_id,
            (SELECT caption FROM posts p WHERE p.id = r.target_id) AS post_caption,
            (SELECT kind FROM posts p WHERE p.id = r.target_id) AS post_kind,
            (SELECT '/media/posters/' || p.id FROM posts p WHERE p.id = r.target_id AND p.kind = 'video') AS post_poster,
            (SELECT '/media/photos/' || ph.id FROM post_photos ph WHERE ph.post_id = r.target_id ORDER BY ph.position LIMIT 1) AS post_photo,
            (SELECT status FROM posts p WHERE p.id = r.target_id) AS post_status,
            (SELECT username FROM users u2 JOIN posts p ON p.owner_id = u2.id WHERE p.id = r.target_id) AS post_owner,
            (SELECT body FROM comments c WHERE c.id = r.target_id) AS comment_body,
            (SELECT id FROM comments c WHERE c.id = r.target_id) AS comment_id,
            (SELECT status FROM comments c WHERE c.id = r.target_id) AS comment_status,
            (SELECT c.post_id FROM comments c WHERE c.id = r.target_id) AS comment_post,
            (SELECT username FROM users u3 JOIN comments c ON c.user_id = u3.id WHERE c.id = r.target_id) AS comment_author,
            (SELECT username FROM users u4 WHERE u4.id = r.target_id AND r.target_type = 'user') AS user_target
       FROM reports r JOIN users u ON u.id = r.reporter_id
      WHERE (? = 'all' OR r.status = ?)
      ORDER BY r.created_at DESC LIMIT 60`,
  )
    .bind(status, status)
    .all<Record<string, unknown>>();

  const items = (rows.results || []).map((row) => {
    const targetType = String(row.target_type);
    return {
      id: String(row.id),
      targetType: targetType === 'post' ? 'video' : targetType,
      rawTargetType: targetType,
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
      video:
        row.post_id != null
          ? {
              id: String(row.post_id),
              caption: String(row.post_caption ?? ''),
              kind: String(row.post_kind ?? 'photos'),
              posterUrl: row.post_poster || row.post_photo
                ? `${new URL(req.url).origin}${String(row.post_poster || row.post_photo)}`
                : null,
              videoUrl: row.post_kind === 'video' ? `${new URL(req.url).origin}/media/videos/${row.post_id}` : null,
              status: String(row.post_status ?? ''),
              creatorUsername: String(row.post_owner ?? ''),
            }
          : null,
      comment:
        row.comment_body != null
          ? {
              id: String(row.comment_id ?? ''),
              body: String(row.comment_body),
              postId: String(row.comment_post ?? ''),
              authorUsername: String(row.comment_author ?? ''),
              status: String(row.comment_status ?? 'visible'),
              videoId: String(row.comment_post ?? ''),
            }
          : null,
      userTarget: (row.user_target as string | null) ?? null,
    };
  });
  return json({ reports: items, items });
}

export async function resolveReport(req: Request, env: Env, id: string) {
  const admin = await requireAdmin(req, env);
  const body = await readJson(req);
  const action = String(body.action || '');
  if (!['dismiss', 'action', 'remove_content'].includes(action)) throw bad('Unknown report action.');

  const report = await env.DB.prepare(
    'SELECT target_type, target_id, reason FROM reports WHERE id = ?',
  )
    .bind(id)
    .first<{ target_type: string; target_id: string; reason: string }>();
  if (!report) throw missing('That report is gone.');

  if (action === 'remove_content') {
    const removalReason = `Removed after a report: ${report.reason}`.slice(0, 200);
    if (report.target_type === 'user') {
      throw bad('Use the control center to act on an account.');
    }
    if (report.target_type === 'comment') {
      const comment = await env.DB.prepare(
        "SELECT user_id, post_id FROM comments WHERE id = ? AND status = 'visible'",
      )
        .bind(report.target_id)
        .first<{ user_id: string; post_id: string }>();
      if (comment) {
        await env.DB.batch([
          env.DB.prepare("UPDATE comments SET status = 'removed' WHERE id = ? OR parent_id = ?").bind(
            report.target_id,
            report.target_id,
          ),
          env.DB.prepare(
            `UPDATE posts SET comment_count = (
               SELECT COUNT(*) FROM comments c WHERE c.post_id = posts.id AND c.status = 'visible'
             ) WHERE id = ?`,
          ).bind(comment.post_id),
        ]);
      }
    } else {
      const post = await env.DB.prepare('SELECT owner_id, status FROM posts WHERE id = ?')
        .bind(report.target_id)
        .first<{ owner_id: string; status: string }>();
      if (post && post.status !== 'removed') {
        const changedAt = now();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE posts SET status = 'removed', removed_reason = ?, updated_at = ? WHERE id = ?",
          ).bind(removalReason, changedAt, report.target_id),
          env.DB.prepare(
            `INSERT INTO moderation_events (id, post_id, admin_id, action, reason, created_at)
             VALUES (?, ?, ?, 'remove', ?, ?)`,
          ).bind(uid('mod'), report.target_id, admin.id, removalReason, changedAt),
          env.DB.prepare(
            `INSERT INTO notifications (id, user_id, type, post_id, detail, created_at)
             VALUES (?, ?, 'removed', ?, ?, ?)`,
          ).bind(uid('ntf'), post.owner_id, report.target_id, removalReason, changedAt),
        ]);
      }
    }
    invalidateTrending();
  }

  await env.DB.prepare('UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
    .bind(action === 'dismiss' ? 'dismissed' : 'actioned', now(), admin.id, id)
    .run();
  return json({ ok: true });
}

export async function users(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const like = `%${q}%`;
  const rows = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.email, u.role, u.status, u.suspended_reason,
            u.deleted_at, u.deleted_reason, u.created_at,
            (SELECT COUNT(*) FROM posts p WHERE p.owner_id = u.id) AS post_count,
            (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
            (SELECT COUNT(*) FROM warnings w WHERE w.user_id = u.id AND w.appeal_status <> 'accepted') AS warning_count
       FROM users u
      WHERE (? = '' OR LOWER(u.username) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.display_name) LIKE ?)
      ORDER BY (u.role = 'admin') DESC, u.created_at DESC LIMIT 50`,
  )
    .bind(q, like, like, like)
    .all<Record<string, unknown>>();

  const items = (rows.results || []).map((row) => ({
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    email: String(row.email),
    role: String(row.role),
    status: row.deleted_at ? 'deleted' : String(row.status),
    suspendedReason: (row.suspended_reason as string | null) ?? null,
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    deletedReason: (row.deleted_reason as string | null) ?? null,
    createdAt: Number(row.created_at),
    postCount: Number(row.post_count),
    videoCount: Number(row.post_count),
    followerCount: Number(row.follower_count),
    warningCount: Number(row.warning_count ?? 0),
  }));
  return json({ users: items, items });
}

export async function suspendUser(req: Request, env: Env, id: string, on: boolean) {
  const admin = await requireAdmin(req, env);
  if (id === admin.id) throw bad('You cannot suspend your own account.');

  const target = await env.DB.prepare('SELECT id, role, deleted_at FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string; role: string; deleted_at: number | null }>();
  if (!target) throw missing('No such account.');
  if (target.role === 'admin') throw bad('Moderator accounts cannot be suspended here.');
  if (target.deleted_at) throw bad('Restore this account before suspending it.');

  if (!on) {
    await unbanAccount(env, id);
    // A suspension that is lifted by hand answers any appeal still waiting.
    await env.DB.prepare(
      `UPDATE appeals SET status = 'accepted', resolved_at = ?, resolved_by = ?,
         decision_note = COALESCE(decision_note, 'Lifted by a moderator.')
        WHERE user_id = ? AND kind = 'ban' AND status = 'open'`,
    )
      .bind(now(), admin.id, id)
      .run();
    invalidateTrending();
    return json({ ok: true, suspended: false, message: 'Account reinstated and its posts are back.' });
  }

  // A ban is a serious action, so the reason is required rather than optional:
  // it is shown to the person and it is what they appeal against.
  const body = await readJson(req);
  const reason = str(body.reason, 'Reason for the suspension', 300, 6);

  const result = await banAccount(env, { userId: id, reason, adminId: admin.id });
  invalidateTrending();
  return json({
    ok: true,
    suspended: true,
    email: result.mailStatus,
    message:
      result.mailStatus === 'sent'
        ? 'Account suspended. The reason and an appeal link have been emailed to them.'
        : result.mailStatus === 'failed'
          ? 'Account suspended, but the notice email failed to send. The reason is on the account.'
          : 'Account suspended. No email provider is configured, so the appeal link was only recorded.',
  });
}

/** Soft-delete: the row stays so the moderator can restore the account. */
export async function removeUser(req: Request, env: Env, id: string) {
  const admin = await requireAdmin(req, env);
  if (id === admin.id) throw bad('You cannot remove your own account.');
  const body = await readJson(req);
  const reason = str(body.reason, 'Reason for removal', 300, 3);

  const target = await env.DB.prepare('SELECT id, role, deleted_at FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string; role: string; deleted_at: number | null }>();
  if (!target) throw missing('No such account.');
  if (target.role === 'admin') throw bad('Moderator accounts cannot be removed here.');
  if (target.deleted_at) throw bad('That account is already removed.');

  const removedAt = now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_reason = ?, deleted_at = ?, deleted_reason = ?
        WHERE id = ?`,
    ).bind(reason, removedAt, reason, id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare(
      "UPDATE posts SET status = 'removed', removed_reason = 'Creator account removed' WHERE owner_id = ? AND status <> 'removed'",
    ).bind(id),
    env.DB.prepare("UPDATE comments SET status = 'removed' WHERE user_id = ? AND status = 'visible'").bind(id),
    env.DB.prepare(
      `UPDATE posts SET comment_count = (
         SELECT COUNT(*) FROM comments c WHERE c.post_id = posts.id AND c.status = 'visible'
       )
       WHERE id IN (SELECT post_id FROM comments WHERE user_id = ?)`,
    ).bind(id),
  ]);
  invalidateTrending();
  return json({
    ok: true,
    removed: true,
    message: 'Account removed. Their posts and comments are now hidden.',
  });
}

export async function restoreUser(req: Request, env: Env, id: string) {
  const admin = await requireAdmin(req, env);
  if (id === admin.id) throw bad('Your account is not removed.');
  const target = await env.DB.prepare('SELECT id, deleted_at FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string; deleted_at: number | null }>();
  if (!target) throw missing('No such account.');
  if (!target.deleted_at) throw bad('That account is not removed.');

  await env.DB.prepare(
    `UPDATE users SET status = 'active', suspended_reason = NULL, deleted_at = NULL, deleted_reason = NULL
      WHERE id = ?`,
  )
    .bind(id)
    .run();
  return json({
    ok: true,
    message: 'Account restored. Removed posts stay down unless you approve them again.',
  });
}

/**
 * Share moderation. Any moderator can hand the role to an active account, or
 * take it back; the role is checked against D1 on every privileged request, so
 * a change applies on the very next call. Nobody can edit their own access and
 * at least one moderator always remains.
 */
export async function setModerator(req: Request, env: Env, id: string, on: boolean) {
  const admin = await requireAdmin(req, env);
  if (id === admin.id) throw bad('You cannot change your own moderator access.');

  const target = await env.DB.prepare(
    'SELECT id, username, role, status, deleted_at FROM users WHERE id = ?',
  )
    .bind(id)
    .first<{ id: string; username: string; role: string; status: string; deleted_at: number | null }>();
  if (!target) throw missing('No such account.');

  if (on) {
    if (target.role === 'admin') throw bad('That account is already a moderator.');
    if (target.deleted_at) throw bad('Restore this account before making it a moderator.');
    if (target.status !== 'active') throw bad('Reinstate this account before making it a moderator.');
  } else {
    if (target.role !== 'admin') throw bad('That account is not a moderator.');
    const others = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id <> ?",
    )
      .bind(target.id)
      .first<{ n: number }>();
    if ((others?.n ?? 0) === 0) throw bad('There has to be at least one moderator.');
  }

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?')
    .bind(on ? 'admin' : 'user', target.id)
    .run();

  return json({
    ok: true,
    role: on ? 'admin' : 'user',
    message: on
      ? `@${target.username} can now review posts and open the control center.`
      : `@${target.username} is back to a member account.`,
  });
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
