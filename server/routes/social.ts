import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, notify, transaction } from '../db.ts';
import { requireUser } from '../auth.ts';
import { HttpError, cleanText, enforceRate, pageParam, param } from '../util.ts';
import { applyVideoInterest } from '../interests.ts';
import { publicUrl } from '../config.ts';
import { interactionWeights, limits } from '../config.ts';
import { invalidateTrendingCache } from '../recommend.ts';
import type { CommentDTO, NotificationDTO } from '../../shared/types.ts';

export const socialRouter = Router();

const COMMENT_REPORT_REASONS = ['Spam', 'Harassment', 'Hate speech', 'Something else'];

function videoIsPublic(videoId: string) {
  return get<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM videos WHERE id = ? AND status = 'approved'`,
    videoId,
  );
}

function blockedPair(viewerId: string, otherId: string) {
  return Boolean(
    get(
      `SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
      viewerId,
      otherId,
      otherId,
      viewerId,
    ),
  );
}

interface CommentRow {
  id: string;
  video_id: string;
  user_id: string;
  body: string;
  created_at: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

function toComment(row: CommentRow, viewerId: string | null, isAdmin: boolean): CommentDTO {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: publicUrl(row.avatar_url),
    },
    canDelete: viewerId === row.user_id || isAdmin,
  };
}

socialRouter.get('/videos/:id/comments', (req, res) => {
  const viewer = req.user;
  const video = get<{ id: string; owner_id: string; status: string }>(
    `SELECT id, owner_id, status FROM videos WHERE id = ?`,
    param(req, 'id'),
  );
  if (!video) throw new HttpError(404, 'Video not found.');
  if (video.status !== 'approved' && viewer?.id !== video.owner_id && viewer?.role !== 'admin') {
    throw new HttpError(404, 'Video not found.');
  }
  const page = pageParam(req.query.page);
  const offset = (page - 1) * limits.commentsPageSize;
  const viewerId = viewer?.id ?? null;
  const blockClause = viewerId
    ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = c.user_id) OR (b.blocked_id = ? AND b.blocker_id = c.user_id))`
    : '';
  const params = viewerId ? [video.id, viewerId, viewerId] : [video.id];
  const rows = all<CommentRow>(
    `SELECT c.*, u.username, u.display_name, u.avatar_url
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.video_id = ? AND c.status = 'visible' AND u.status = 'active' ${blockClause}
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
    limits.commentsPageSize + 1,
    offset,
  );
  const total = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.video_id = ? AND c.status = 'visible' AND u.status = 'active' ${blockClause}`,
    ...params,
  );
  const items = rows.slice(0, limits.commentsPageSize).map((row) => toComment(row, viewerId, viewer?.role === 'admin'));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items, hasMore: rows.length > limits.commentsPageSize, total: total?.n ?? items.length, page });
});

socialRouter.post('/videos/:id/comments', requireUser, (req, res) => {
  const user = req.user!;
  enforceRate(
    `comment:${user.id}`,
    limits.maxCommentsPerMinute,
    60 * 1000,
    'You are commenting quickly. Give the goats a moment and try again.',
  );
  const video = videoIsPublic(param(req, 'id'));
  if (!video) throw new HttpError(404, 'Video not found.');
  if (blockedPair(user.id, video.owner_id)) throw new HttpError(403, 'You cannot comment on this video.');
  const body = cleanText(req.body?.body, 500);
  if (!body) throw new HttpError(400, 'Write something first.', { fields: { body: 'Write something first.' } });
  if ((body.match(/https?:\/\//gi) ?? []).length > 1) {
    throw new HttpError(400, 'Keep links out of comments, please.');
  }
  const duplicate = get<{ id: string }>(
    `SELECT id FROM comments WHERE video_id = ? AND user_id = ? AND body = ? AND created_at > ?`,
    video.id,
    user.id,
    body,
    Date.now() - 60_000,
  );
  if (duplicate) throw new HttpError(409, 'You just posted that comment.');

  const id = crypto.randomUUID();
  const firstComment = !get(`SELECT 1 FROM comments WHERE video_id = ? AND user_id = ?`, video.id, user.id);
  transaction(() => {
    run(
      `INSERT INTO comments (id, video_id, user_id, body, status, created_at) VALUES (?, ?, ?, ?, 'visible', ?)`,
      id,
      video.id,
      user.id,
      body,
      Date.now(),
    );
    notify({ userId: video.owner_id, type: 'comment', videoId: video.id, actorId: user.id, detail: body.slice(0, 90) });
    if (firstComment) applyVideoInterest(user.id, video.id, interactionWeights.comment);
  });
  invalidateTrendingCache();

  const row = get<CommentRow>(
    `SELECT c.*, u.username, u.display_name, u.avatar_url FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    id,
  );
  const total = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM comments WHERE video_id = ? AND status = 'visible'`,
    video.id,
  );
  res.status(201).json({ comment: row ? toComment(row, user.id, user.role === 'admin') : null, total: total?.n ?? 0 });
});

socialRouter.delete('/comments/:id', requireUser, (req, res) => {
  const user = req.user!;
  const row = get<{ id: string; video_id: string; user_id: string }>(
    `SELECT id, video_id, user_id FROM comments WHERE id = ?`,
    param(req, 'id'),
  );
  if (!row) throw new HttpError(404, 'Comment not found.');
  if (row.user_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'You can only delete your own comment.');
  run(`UPDATE comments SET status = 'removed' WHERE id = ?`, row.id);
  invalidateTrendingCache();
  res.json({ ok: true });
});

socialRouter.post('/comments/:id/report', requireUser, (req, res) => {
  enforceRate(`report:${req.user!.id}`, 8, 60 * 60 * 1000, 'You have sent several reports. Our moderator will catch up.');
  const comment = get<{ id: string }>(`SELECT id FROM comments WHERE id = ? AND status = 'visible'`, param(req, 'id'));
  if (!comment) throw new HttpError(404, 'Comment not found.');
  const reason = String(req.body?.reason ?? '');
  if (!COMMENT_REPORT_REASONS.includes(reason)) throw new HttpError(400, 'Choose a reason.');
  const duplicate = get(
    `SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = 'comment' AND target_id = ? AND status = 'open'`,
    req.user!.id,
    comment.id,
  );
  if (duplicate) throw new HttpError(409, 'You already reported this comment.');
  run(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, note, status, created_at)
     VALUES (?, ?, 'comment', ?, ?, ?, 'open', ?)`,
    crypto.randomUUID(),
    req.user!.id,
    comment.id,
    reason,
    cleanText(req.body?.note, 500) || null,
    Date.now(),
  );
  res.status(201).json({ ok: true, message: 'Report sent to the moderator.' });
});

/* ------------------------------ notifications ----------------------------- */

interface NotificationRow {
  id: string;
  type: NotificationDTO['type'];
  created_at: number;
  read_at: number | null;
  video_id: string | null;
  video_caption: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  detail: string | null;
}

socialRouter.get('/notifications', requireUser, (req, res) => {
  const rows = all<NotificationRow>(
    `SELECT n.id, n.type, n.created_at, n.read_at, n.video_id, v.caption AS video_caption,
            a.username AS actor_username, a.display_name AS actor_display_name, n.detail
     FROM notifications n
     LEFT JOIN videos v ON v.id = n.video_id
     LEFT JOIN users a ON a.id = n.actor_id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC
     LIMIT 20`,
    req.user!.id,
  );
  const unread = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    req.user!.id,
  );
  const items: NotificationDTO[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    read: row.read_at !== null,
    videoId: row.video_id,
    videoCaption: row.video_caption,
    actorUsername: row.actor_username,
    actorDisplayName: row.actor_display_name,
    detail: row.detail,
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items, unread: unread?.n ?? 0 });
});

socialRouter.post('/notifications/read', requireUser, (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id : null;
  if (id) {
    run(
      `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`,
      Date.now(),
      id,
      req.user!.id,
    );
  } else {
    run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, Date.now(), req.user!.id);
  }
  res.json({ ok: true });
});
