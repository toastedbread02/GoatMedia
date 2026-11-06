import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, notify, transaction } from '../db.ts';
import { requireAdmin } from '../auth.ts';
import { HttpError, cleanText, pageParam, param } from '../util.ts';
import { VIDEO_SELECT, rowToVideo, type VideoRow } from '../videoRows.ts';
import { invalidateTrendingCache } from '../recommend.ts';
import { limits, publicUrl } from '../config.ts';
import type {
  AdminQueueItem,
  AdminUserRow,
  ModerationEventDTO,
  ModerationCounts,
  ReportDTO,
  VideoStatus,
} from '../../shared/types.ts';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

/* --------------------------------- overview -------------------------------- */

adminRouter.get('/admin/counts', (_req, res) => {
  const count = (where: string) => get<{ n: number }>(`SELECT COUNT(*) AS n FROM videos WHERE ${where}`)?.n ?? 0;
  const payload: ModerationCounts = {
    pending: count(`status = 'pending'`),
    approved: count(`status = 'approved'`),
    rejected: count(`status = 'rejected'`),
    removed: count(`status = 'removed'`),
    openReports: get<{ n: number }>(`SELECT COUNT(*) AS n FROM reports WHERE status = 'open'`)?.n ?? 0,
  };
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
});

/* ---------------------------------- videos -------------------------------- */

function historyFor(videoId: string): ModerationEventDTO[] {
  return all<{
    id: string;
    action: ModerationEventDTO['action'];
    reason: string | null;
    created_at: number;
    admin_username: string | null;
  }>(
    `SELECT m.id, m.action, m.reason, m.created_at, u.username AS admin_username
     FROM moderation_events m LEFT JOIN users u ON u.id = m.admin_id
     WHERE m.video_id = ? ORDER BY m.created_at ASC`,
    videoId,
  ).map((row) => ({
    id: row.id,
    action: row.action,
    reason: row.reason,
    createdAt: row.created_at,
    adminUsername: row.admin_username,
  }));
}

function queueItem(row: VideoRow, viewerId: string): AdminQueueItem {
  const owner = get<{ email: string; created_at: number; uploads: number }>(
    `SELECT email, created_at, (SELECT COUNT(*) FROM videos WHERE owner_id = users.id) AS uploads FROM users WHERE id = ?`,
    row.owner_id,
  );
  return {
    ...rowToVideo(row, viewerId),
    creatorEmail: owner?.email ?? '',
    creatorJoinedAt: owner?.created_at ?? row.created_at,
    creatorUploads: owner?.uploads ?? 0,
    moderationHistory: historyFor(row.id),
  };
}

adminRouter.get('/admin/videos', (req, res) => {
  const status = String(req.query.status ?? 'pending');
  if (!['pending', 'approved', 'rejected', 'removed'].includes(status)) {
    throw new HttpError(400, 'Unknown status filter.');
  }
  const page = pageParam(req.query.page);
  const viewer = req.user!.id;
  const order = status === 'pending' ? 'v.created_at ASC' : 'v.updated_at DESC';
  const rows = all<VideoRow>(
    `${VIDEO_SELECT}
     WHERE v.status = ?
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
    viewer,
    viewer,
    viewer,
    status,
    limits.feedPageSize + 2,
    (page - 1) * (limits.feedPageSize + 2),
  );
  const items = rows.map((row) => queueItem(row, viewer));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items, hasMore: items.length > limits.feedPageSize, page });
});

function videoOr404(id: string) {
  const row = get<{ id: string; owner_id: string; status: string; caption: string }>(
    `SELECT id, owner_id, status, caption FROM videos WHERE id = ?`,
    id,
  );
  if (!row) throw new HttpError(404, 'Video not found.');
  return row;
}

function reloadQueueItem(id: string, viewerId: string): AdminQueueItem {
  const viewer = viewerId;
  const row = get<VideoRow>(`${VIDEO_SELECT} WHERE v.id = ?`, viewer, viewer, viewer, id);
  if (!row) throw new HttpError(404, 'Video not found.');
  return queueItem(row, viewerId);
}

adminRouter.post('/admin/videos/:id/approve', (req, res) => {
  const video = videoOr404(param(req, 'id'));
  if (!['pending', 'rejected'].includes(video.status)) {
    throw new HttpError(409, `This video is already ${video.status}.`);
  }
  transaction(() => {
    run(
      `UPDATE videos SET status = 'approved', reject_reason = NULL, published_at = ?, updated_at = ? WHERE id = ?`,
      Date.now(),
      Date.now(),
      video.id,
    );
    run(
      `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at) VALUES (?, ?, ?, 'approve', NULL, ?)`,
      crypto.randomUUID(),
      video.id,
      req.user!.id,
      Date.now(),
    );
    notify({ userId: video.owner_id, type: 'approved', videoId: video.id, detail: video.caption });
  });
  invalidateTrendingCache();
  res.json({ item: reloadQueueItem(video.id, req.user!.id), message: 'Approved and published.' });
});

adminRouter.post('/admin/videos/:id/reject', (req, res) => {
  const video = videoOr404(param(req, 'id'));
  if (video.status === 'removed') throw new HttpError(409, 'That video was already removed.');
  const reason = cleanText(req.body?.reason, 300);
  if (reason.length < 3) throw new HttpError(400, 'Add a short reason so the creator knows what to fix.', { fields: { reason: 'A reason is required.' } });
  transaction(() => {
    run(
      `UPDATE videos SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`,
      reason,
      Date.now(),
      video.id,
    );
    run(
      `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at) VALUES (?, ?, ?, 'reject', ?, ?)`,
      crypto.randomUUID(),
      video.id,
      req.user!.id,
      reason,
      Date.now(),
    );
    notify({ userId: video.owner_id, type: 'rejected', videoId: video.id, detail: reason });
  });
  invalidateTrendingCache();
  res.json({ item: reloadQueueItem(video.id, req.user!.id), message: 'Rejected. The creator can see your reason.' });
});

adminRouter.post('/admin/videos/:id/remove', (req, res) => {
  const video = videoOr404(param(req, 'id'));
  if (video.status === 'removed') throw new HttpError(409, 'That video is already removed.');
  const reason = cleanText(req.body?.reason, 300) || 'Removed by the moderator';
  transaction(() => {
    run(
      `UPDATE videos SET status = 'removed', removed_reason = ?, updated_at = ? WHERE id = ?`,
      reason,
      Date.now(),
      video.id,
    );
    run(
      `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at) VALUES (?, ?, ?, 'remove', ?, ?)`,
      crypto.randomUUID(),
      video.id,
      req.user!.id,
      reason,
      Date.now(),
    );
    notify({ userId: video.owner_id, type: 'removed', videoId: video.id, detail: reason });
  });
  invalidateTrendingCache();
  res.json({ item: reloadQueueItem(video.id, req.user!.id), message: 'Removed from public view.' });
});

/* --------------------------------- reports -------------------------------- */

interface ReportRow {
  id: string;
  target_type: 'video' | 'comment' | 'user';
  target_id: string;
  reason: string;
  note: string | null;
  created_at: number;
  status: ReportDTO['status'];
  reporter_username: string;
  video_id: string | null;
  video_caption: string | null;
  video_poster: string | null;
  video_status: VideoStatus | null;
  video_owner: string | null;
  comment_body: string | null;
  comment_author: string | null;
  comment_video_id: string | null;
  comment_status: string | null;
}

adminRouter.get('/admin/reports', (req, res) => {
  const status = String(req.query.status ?? 'open');
  const where = status === 'all' ? '' : `WHERE r.status = 'open'`;
  const rows = all<ReportRow>(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at, r.status,
            rep.username AS reporter_username,
            v.id AS video_id, v.caption AS video_caption, v.poster_name AS video_poster, v.status AS video_status,
            owner.username AS video_owner,
            c.body AS comment_body, ca.username AS comment_author, c.video_id AS comment_video_id, c.status AS comment_status
     FROM reports r
     JOIN users rep ON rep.id = r.reporter_id
     LEFT JOIN videos v ON r.target_type = 'video' AND v.id = r.target_id
     LEFT JOIN users owner ON owner.id = v.owner_id
     LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
     LEFT JOIN users ca ON ca.id = c.user_id
     ${where}
     ORDER BY r.created_at ASC
     LIMIT 100`,
  );
  const items: ReportDTO[] = rows.map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at,
    status: row.status,
    reporterUsername: row.reporter_username,
    video: row.video_id
      ? {
          id: row.video_id,
          caption: row.video_caption ?? '',
          posterUrl: row.video_poster ? publicUrl(`/media/posters/${row.video_id}`) : null,
          videoUrl: publicUrl(`/media/videos/${row.video_id}`) ?? '',
          status: row.video_status ?? 'approved',
          creatorUsername: row.video_owner ?? '',
        }
      : null,
    comment: row.comment_body
      ? {
          id: row.target_id,
          body: row.comment_body,
          authorUsername: row.comment_author ?? '',
          videoId: row.comment_video_id ?? '',
          status: row.comment_status ?? 'visible',
        }
      : null,
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items });
});

adminRouter.post('/admin/reports/:id/resolve', (req, res) => {
  const report = get<{ id: string; target_type: string; target_id: string; status: string }>(
    `SELECT id, target_type, target_id, status FROM reports WHERE id = ?`,
    param(req, 'id'),
  );
  if (!report) throw new HttpError(404, 'Report not found.');
  if (report.status !== 'open') throw new HttpError(409, 'That report was already handled.');
  const action = String(req.body?.action ?? '');
  if (!['dismiss', 'remove_content'].includes(action)) throw new HttpError(400, 'Unknown resolution.');

  transaction(() => {
    if (action === 'remove_content') {
      if (report.target_type === 'video') {
        run(
          `UPDATE videos SET status = 'removed', removed_reason = ?, updated_at = ? WHERE id = ?`,
          'Removed after a report',
          Date.now(),
          report.target_id,
        );
        run(
          `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at) VALUES (?, ?, ?, 'remove', ?, ?)`,
          crypto.randomUUID(),
          report.target_id,
          req.user!.id,
          'Removed after a report',
          Date.now(),
        );
        const video = get<{ owner_id: string; caption: string }>(`SELECT owner_id, caption FROM videos WHERE id = ?`, report.target_id);
        if (video) notify({ userId: video.owner_id, type: 'removed', videoId: report.target_id, detail: 'Removed after a report' });
      } else if (report.target_type === 'comment') {
        run(`UPDATE comments SET status = 'removed' WHERE id = ?`, report.target_id);
      }
      run(`UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? WHERE target_type = ? AND target_id = ? AND status = 'open'`, Date.now(), req.user!.id, report.target_type, report.target_id);
    } else {
      run(`UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE id = ?`, Date.now(), req.user!.id, report.id);
    }
  });
  invalidateTrendingCache();
  res.json({ ok: true, message: action === 'dismiss' ? 'Report dismissed.' : 'Content removed.' });
});

/* ---------------------------------- users --------------------------------- */

adminRouter.get('/admin/users', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = all<{
    id: string;
    username: string;
    display_name: string;
    email: string;
    role: string;
    status: 'active' | 'suspended';
    suspended_reason: string | null;
    created_at: number;
    video_count: number;
    follower_count: number;
  }>(
    `SELECT u.id, u.username, u.display_name, u.email, u.role, u.status, u.suspended_reason, u.created_at,
       (SELECT COUNT(*) FROM videos v WHERE v.owner_id = u.id) AS video_count,
       (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count
     FROM users u
     ${q ? `WHERE u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'` : ''}
     ORDER BY u.created_at DESC
     LIMIT 60`,
    ...(q ? [pattern, pattern, pattern] : []),
  );
  const items: AdminUserRow[] = rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status,
    suspendedReason: row.suspended_reason,
    createdAt: row.created_at,
    videoCount: row.video_count,
    followerCount: row.follower_count,
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items });
});

adminRouter.post('/admin/users/:id/suspend', (req, res) => {
  const user = get<{ id: string; role: string; status: string }>(`SELECT id, role, status FROM users WHERE id = ?`, param(req, 'id'));
  if (!user) throw new HttpError(404, 'Account not found.');
  if (user.role === 'admin') throw new HttpError(400, 'Moderator accounts cannot be suspended here.');
  const reason = cleanText(req.body?.reason, 300);
  if (reason.length < 3) throw new HttpError(400, 'Add a short reason.', { fields: { reason: 'A reason is required.' } });
  transaction(() => {
    run(`UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?`, reason, user.id);
    run(`DELETE FROM sessions WHERE user_id = ?`, user.id);
  });
  res.json({ ok: true, message: 'Account suspended. Their videos and comments are hidden.' });
});

adminRouter.post('/admin/users/:id/unsuspend', (req, res) => {
  const user = get<{ id: string }>(`SELECT id FROM users WHERE id = ?`, param(req, 'id'));
  if (!user) throw new HttpError(404, 'Account not found.');
  run(`UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = ?`, user.id);
  res.json({ ok: true, message: 'Account reinstated.' });
});
