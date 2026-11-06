import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, transaction, notify, usernameTaken } from '../db.ts';
import { requireUser } from '../auth.ts';
import {
  HttpError,
  checkUsername,
  cleanText,
  enforceRate,
  isReservedUsername,
  normalizeUsername,
  param,
} from '../util.ts';
import { VIDEO_SELECT, rowToVideo, type VideoRow } from '../videoRows.ts';
import { getMe, getPublicUser } from '../profile.ts';
import { AVATAR_DIR, categoryById, interactionWeights, limits } from '../config.ts';
import { applyVideoInterest } from '../interests.ts';
import { mediaToolsAvailable, prepareAvatar } from '../media.ts';
import type { InterestView, VideoStatus } from '../../shared/types.ts';

export const usersRouter = Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: limits.maxAvatarMb * 1024 * 1024, files: 1 },
});

/* -------------------------------- profiles -------------------------------- */

usersRouter.get('/users/:username', (req, res) => {
  const viewer = req.user?.id ?? null;
  const user = getPublicUser(param(req, 'username'), viewer);
  if (!user) throw new HttpError(404, 'No goat person by that name.');
  if (user.status === 'suspended' && !user.isSelf && req.user?.role !== 'admin') {
    throw new HttpError(404, 'That profile is unavailable.');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user });
});

const TAB_STATUS: Record<string, VideoStatus> = {
  published: 'approved',
  pending: 'pending',
  rejected: 'rejected',
  removed: 'removed',
};

usersRouter.get('/users/:username/videos', (req, res) => {
  const viewer = req.user?.id ?? null;
  const tab = String(req.query.tab ?? 'published');
  const status = TAB_STATUS[tab];
  if (!status) throw new HttpError(400, 'Unknown video tab.');

  const owner = get<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE lower(username) = lower(?)`,
    param(req, 'username'),
  );
  if (!owner) throw new HttpError(404, 'No goat person by that name.');
  const isSelf = viewer === owner.id;
  const isAdmin = req.user?.role === 'admin';
  if (tab !== 'published' && !isSelf && !isAdmin) {
    throw new HttpError(403, 'Only you can see your unreviewed uploads.');
  }
  if (owner.status === 'suspended' && !isSelf && !isAdmin) {
    throw new HttpError(404, 'That profile is unavailable.');
  }

  const rows = all<VideoRow>(
    `${VIDEO_SELECT}
     WHERE v.owner_id = ? AND v.status = ?
     ORDER BY ${status === 'approved' ? 'v.published_at DESC' : 'v.updated_at DESC'}
     LIMIT 60`,
    viewer ?? '',
    viewer ?? '',
    viewer ?? '',
    owner.id,
    status,
  );

  const counts = isSelf
    ? Object.fromEntries(
        (['approved', 'pending', 'rejected', 'removed'] as VideoStatus[]).map((s) => [
          s,
          get<{ n: number }>(`SELECT COUNT(*) AS n FROM videos WHERE owner_id = ? AND status = ?`, owner.id, s)?.n ?? 0,
        ]),
      )
    : null;

  res.setHeader('Cache-Control', 'no-store');
  res.json({ items: rows.map((row) => rowToVideo(row, viewer)), counts });
});

/* --------------------------------- follow --------------------------------- */

usersRouter.post('/users/:id/follow', requireUser, (req, res) => {
  const follower = req.user!;
  const target = get<{ id: string; status: string }>(`SELECT id, status FROM users WHERE id = ?`, param(req, 'id'));
  if (!target || target.status !== 'active') throw new HttpError(404, 'That account is unavailable.');
  if (target.id === follower.id) throw new HttpError(400, 'You already follow your own work.');
  const blocked = get(
    `SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    follower.id,
    target.id,
    target.id,
    follower.id,
  );
  if (blocked) throw new HttpError(403, 'Unblock this account before following it.');

  if (!get(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?`, follower.id, target.id)) {
    transaction(() => {
      run(`INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)`, follower.id, target.id, Date.now());
      notify({ userId: target.id, type: 'follow', actorId: follower.id });
    });
    const fromVideoId = typeof req.body?.fromVideoId === 'string' ? req.body.fromVideoId : null;
    if (fromVideoId) applyVideoInterest(follower.id, fromVideoId, interactionWeights.follow);
  }
  res.json({ following: true });
});

usersRouter.delete('/users/:id/follow', requireUser, (req, res) => {
  run(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`, req.user!.id, param(req, 'id'));
  res.json({ following: false });
});

usersRouter.post('/users/:id/block', requireUser, (req, res) => {
  if (param(req, 'id') === req.user!.id) throw new HttpError(400, 'You cannot block yourself.');
  if (!get(`SELECT 1 FROM users WHERE id = ?`, param(req, 'id'))) throw new HttpError(404, 'Account not found.');
  transaction(() => {
    run(
      `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`,
      req.user!.id,
      param(req, 'id'),
      Date.now(),
    );
    run(
      `DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)`,
      req.user!.id,
      param(req, 'id'),
      param(req, 'id'),
      req.user!.id,
    );
  });
  res.json({ blocked: true });
});

usersRouter.delete('/users/:id/block', requireUser, (req, res) => {
  run(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, req.user!.id, param(req, 'id'));
  res.json({ blocked: false });
});

/* -------------------------------- settings -------------------------------- */

usersRouter.patch('/me', requireUser, (req, res) => {
  const user = req.user!;
  const body = req.body ?? {};
  const displayName = body.displayName !== undefined ? cleanText(body.displayName, 40) : user.displayName;
  if (!displayName) throw new HttpError(400, 'Add a display name.', { fields: { displayName: 'Add a display name.' } });
  const bio = body.bio !== undefined ? cleanText(body.bio, limits.maxBioLength) : get<{ bio: string }>(`SELECT bio FROM users WHERE id = ?`, user.id)?.bio ?? '';

  let username = user.username;
  if (body.username !== undefined) {
    const checked = checkUsername(body.username);
    if (checked.error) throw new HttpError(400, checked.error, { fields: { username: checked.error } });
    if (isReservedUsername(checked.username)) {
      throw new HttpError(409, 'That username is reserved.', { fields: { username: 'Choose a different username.' } });
    }
    if (checked.username !== user.username && usernameTaken(checked.username)) {
      throw new HttpError(409, 'That username is taken.', { fields: { username: 'That username is taken.' } });
    }
    username = checked.username;
  }

  run(`UPDATE users SET display_name = ?, bio = ?, username = ? WHERE id = ?`, displayName, bio, username, user.id);
  res.json({ user: getMe(user.id), message: 'Profile updated.' });
});

usersRouter.post('/me/avatar', requireUser, avatarUpload.single('avatar'), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Choose an image first.');
  if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
    throw new HttpError(415, 'Use a JPEG, PNG or WEBP image.');
  }
  const user = req.user!;
  const tempPath = path.join(AVATAR_DIR, `${crypto.randomUUID()}.tmp`);
  const extension = mediaToolsAvailable() ? 'jpg' : file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const finalName = `${user.id}-${Date.now().toString(36)}.${extension}`;
  const finalPath = path.join(AVATAR_DIR, finalName);
  await fs.promises.writeFile(tempPath, file.buffer);
  try {
    await prepareAvatar(tempPath, finalPath);
  } finally {
    await fs.promises.rm(tempPath, { force: true });
  }
  const previous = get<{ avatar_url: string | null }>(`SELECT avatar_url FROM users WHERE id = ?`, user.id)?.avatar_url;
  run(`UPDATE users SET avatar_url = ? WHERE id = ?`, `/avatars/${finalName}`, user.id);
  if (previous?.startsWith('/avatars/')) {
    await fs.promises.rm(path.join(AVATAR_DIR, path.basename(previous)), { force: true }).catch(() => {});
  }
  res.json({ user: getMe(user.id), message: 'New photo saved.' });
});

usersRouter.get('/me/interests', requireUser, (req, res) => {
  const rows = all<{ kind: 'category' | 'hashtag'; value: string; weight: number; updated_at: number }>(
    `SELECT kind, value, weight, updated_at FROM interests WHERE user_id = ? ORDER BY abs(weight) DESC LIMIT 12`,
    req.user!.id,
  );
  const items: InterestView[] = rows
    .filter((row) => Math.abs(row.weight) >= 1)
    .map((row) => ({
      kind: row.kind,
      value: row.kind === 'category' ? categoryById.get(row.value)?.label ?? row.value : `#${row.value}`,
      weight: Math.round(row.weight * 10) / 10,
      updatedAt: row.updated_at,
    }));
  res.json({ items });
});

usersRouter.post('/me/reset-interests', requireUser, (req, res) => {
  transaction(() => {
    run(`DELETE FROM interests WHERE user_id = ?`, req.user!.id);
    run(
      `DELETE FROM video_events WHERE user_id = ? AND type IN ('complete', 'rewatch', 'skip')`,
      req.user!.id,
    );
  });
  res.json({ ok: true, message: 'Recommendations reset. Your hidden videos are still hidden.' });
});

usersRouter.get('/me/blocked', requireUser, (req, res) => {
  const rows = all<{ username: string }>(
    `SELECT u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
    req.user!.id,
  );
  res.json({
    items: rows
      .map((row) => getPublicUser(row.username, req.user!.id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  });
});

usersRouter.delete('/me/avatar', requireUser, (req, res) => {
  const previous = get<{ avatar_url: string | null }>(`SELECT avatar_url FROM users WHERE id = ?`, req.user!.id)?.avatar_url;
  run(`UPDATE users SET avatar_url = NULL WHERE id = ?`, req.user!.id);
  if (previous?.startsWith('/avatars/')) {
    fs.promises.rm(path.join(AVATAR_DIR, path.basename(previous)), { force: true }).catch(() => {});
  }
  res.json({ user: getMe(req.user!.id), message: 'Photo removed.' });
});

usersRouter.get('/usernames/:username/available', (req, res) => {
  enforceRate(`username-check:${req.ip}`, 60, 60 * 1000, 'Slow down a moment.');
  const normalized = normalizeUsername(param(req, 'username'));
  if (!/^[a-z0-9_]{3,20}$/.test(normalized)) return res.json({ available: false, reason: 'invalid' });
  res.json({ available: !usernameTaken(normalized) && !isReservedUsername(normalized), reason: null });
});
