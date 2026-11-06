import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, transaction } from '../db.ts';
import { requireUser } from '../auth.ts';
import {
  HttpError,
  cleanText,
  enforceRate,
  pageParam,
  param,
  parseCookies,
  parseHashtagList,
  setCookie,
} from '../util.ts';
import { VIDEO_SELECT, rowToVideo, type VideoRow } from '../videoRows.ts';
import { buildFollowingFeed, buildForYouFeed, buildTrendingFeed, invalidateTrendingCache } from '../recommend.ts';
import { categories, categoryById, interactionWeights, limits, MEDIA_DIR, POSTER_DIR, TEMP_DIR } from '../config.ts';
import { makePoster, mediaToolsAvailable, prepareVideo, probeVideo, safeJoin, sendMediaFile } from '../media.ts';
import { applyVideoInterest, recordEvent, undoEvent } from '../interests.ts';
import type { SearchResults } from '../../shared/types.ts';
import { getPublicUser } from '../profile.ts';

export const videosRouter = Router();
export const mediaRouter = Router();

const ALLOWED_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);
const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMP_DIR),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: limits.maxUploadMb * 1024 * 1024, files: 1 },
  // Accept first, then reject with a useful message. A file filter that returns
  // false leaves multer with no file and hides why the upload was refused.
  fileFilter: (_req, _file, cb) => cb(null, true),
});

function videoRow(id: string, viewerId: string | null): VideoRow | undefined {
  const viewer = viewerId ?? '';
  return get<VideoRow>(`${VIDEO_SELECT} WHERE v.id = ?`, viewer, viewer, viewer, id);
}

function canSee(row: VideoRow, viewerId: string | null, isAdmin: boolean) {
  const publiclyVisible = row.status === 'approved' && row.owner_status === 'active';
  return publiclyVisible || (viewerId !== null && (row.owner_id === viewerId || isAdmin));
}

/* ---------------------------------- feeds --------------------------------- */

videosRouter.get('/feed', (req, res) => {
  const tab = String(req.query.tab ?? 'foryou');
  const page = pageParam(req.query.page);
  const userId = req.user?.id ?? null;
  res.setHeader('Cache-Control', 'no-store');

  if (tab === 'trending') return res.json(buildTrendingFeed(userId, page));
  if (tab === 'following') {
    if (!userId) throw new HttpError(401, 'Sign in to see videos from people you follow.');
    return res.json(buildFollowingFeed(userId, page));
  }
  return res.json(buildForYouFeed(userId, page));
});

/* -------------------------------- single video ---------------------------- */

videosRouter.get('/videos/:id', (req, res) => {
  const row = videoRow(param(req, 'id'), req.user?.id ?? null);
  if (!row || !canSee(row, req.user?.id ?? null, req.user?.role === 'admin')) {
    throw new HttpError(404, 'That video is not available.');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ video: rowToVideo(row, req.user?.id ?? null) });
});

/* ---------------------------------- upload -------------------------------- */

videosRouter.post('/videos', requireUser, upload.single('video'), async (req, res) => {
  const user = req.user!;
  enforceRate(`upload:${user.id}`, limits.maxUploadsPerHour, 60 * 60 * 1000, 'That is a lot of uploads. Wait an hour and try again.');
  const file = req.file;
  if (!file) throw new HttpError(400, 'Choose a video file to upload.');

  const cleanup = () => fs.promises.rm(file.path, { force: true }).catch(() => {});
  try {
    if (!ALLOWED_MIME.has(file.mimetype) && !/\.(mp4|mov|webm|m4v)$/i.test(file.originalname)) {
      throw new HttpError(415, 'Use an MP4, MOV, WEBM or M4V file.');
    }
    const category = String(req.body?.category ?? '');
    if (!categoryById.has(category)) throw new HttpError(400, 'Choose a goat category.', { fields: { category: 'Pick a category.' } });
    const caption = cleanText(req.body?.caption, limits.maxCaptionLength);
    if (!caption) throw new HttpError(400, 'Add a caption so people know what they are watching.', { fields: { caption: 'A caption is required.' } });
    const hashtags = parseHashtagList(req.body?.hashtags, caption);
    if (String(req.body?.guidelines ?? '') !== 'accepted') {
      throw new HttpError(400, 'Confirm the upload follows the community guidelines.', {
        fields: { guidelines: 'Please confirm before uploading.' },
      });
    }

    const id = crypto.randomUUID();
    let duration = 0;
    let width: number | null = null;
    let height: number | null = null;
    let mime = 'video/mp4';
    let outputPath = path.join(MEDIA_DIR, `${id}.mp4`);
    let posterPath: string | null = null;

    if (mediaToolsAvailable()) {
      const probe = await probeVideo(file.path);
      if (!probe || !probe.duration) {
        throw new HttpError(422, 'We could not read that video. Try exporting it as an MP4 and uploading again.');
      }
      if (probe.duration < limits.minDurationSeconds) {
        throw new HttpError(422, `Videos need to be at least ${limits.minDurationSeconds} seconds long.`);
      }
      if (probe.duration > limits.maxDurationSeconds) {
        throw new HttpError(422, `Videos can be up to ${Math.floor(limits.maxDurationSeconds / 60)} minutes long. Trim this one and try again.`);
      }
      const prepared = await prepareVideo(file.path, outputPath, probe);
      duration = prepared?.duration || probe.duration;
      width = prepared?.width ?? probe.width;
      height = prepared?.height ?? probe.height;
      const poster = path.join(POSTER_DIR, `${id}.jpg`);
      const made = await makePoster(outputPath, poster, duration);
      posterPath = made ? path.basename(poster) : null;
    } else {
      // Without ffmpeg the original file is kept as-is; the browser-reported
      // duration is used only after basic sanity checks.
      const reported = Number(req.body?.duration);
      if (!Number.isFinite(reported) || reported <= 0) {
        throw new HttpError(422, 'We could not read that video. Export it as an MP4 and try again.');
      }
      if (reported < limits.minDurationSeconds || reported > limits.maxDurationSeconds) {
        throw new HttpError(422, `Videos need to be between ${limits.minDurationSeconds} seconds and ${limits.maxDurationSeconds / 60} minutes long.`);
      }
      duration = reported;
      const ext = EXT_BY_MIME[file.mimetype] ?? 'mp4';
      mime = file.mimetype;
      outputPath = path.join(MEDIA_DIR, `${id}.${ext}`);
      await fs.promises.rename(file.path, outputPath);
    }

    const stat = await fs.promises.stat(outputPath);
    const now = Date.now();
    transaction(() => {
      run(
        `INSERT INTO videos (id, owner_id, caption, category, hashtags, file_name, mime, poster_name, duration, width, height,
           size_bytes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        id,
        user.id,
        caption,
        category,
        JSON.stringify(hashtags),
        path.basename(outputPath),
        mime,
        posterPath,
        duration,
        width,
        height,
        stat.size,
        now,
        now,
      );
      run(
        `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at) VALUES (?, ?, NULL, 'submit', NULL, ?)`,
        crypto.randomUUID(),
        id,
        now,
      );
    });

    res.status(201).json({
      video: rowToVideo(videoRow(id, user.id)!, user.id),
      message: 'Upload received. A human will review it before it appears publicly.',
    });
  } finally {
    await cleanup();
  }
});

/* ------------------------------ edit / remove ----------------------------- */

videosRouter.patch('/videos/:id', requireUser, (req, res) => {
  const user = req.user!;
  const row = get<VideoRow & { status: string }>(`SELECT * FROM videos WHERE id = ?`, param(req, 'id'));
  if (!row) throw new HttpError(404, 'Video not found.');
  if (row.owner_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Only the creator can edit this video.');
  if (row.status === 'removed') throw new HttpError(400, 'Removed videos cannot be edited.');

  const caption = req.body?.caption !== undefined ? cleanText(req.body.caption, limits.maxCaptionLength) : row.caption;
  if (!caption) throw new HttpError(400, 'A caption is required.', { fields: { caption: 'A caption is required.' } });
  const category = req.body?.category !== undefined ? String(req.body.category) : row.category;
  if (!categoryById.has(category)) throw new HttpError(400, 'Choose a goat category.');
  const hashtags =
    req.body?.hashtags !== undefined ? parseHashtagList(req.body.hashtags, caption) : JSON.parse(row.hashtags ?? '[]');

  const changed =
    caption !== row.caption || category !== row.category || JSON.stringify(hashtags) !== row.hashtags;
  const needsReview = row.status === 'approved' && changed;
  const nextStatus = row.status === 'approved' && changed ? 'pending' : changed ? 'pending' : row.status;

  transaction(() => {
    run(
      `UPDATE videos SET caption = ?, category = ?, hashtags = ?, status = ?, updated_at = ?,
        reject_reason = CASE WHEN ? = 'pending' THEN NULL ELSE reject_reason END
       WHERE id = ?`,
      caption,
      category,
      JSON.stringify(hashtags),
      nextStatus,
      Date.now(),
      nextStatus,
      row.id,
    );
    if (changed) {
      run(
        `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at) VALUES (?, ?, NULL, 'resubmit', ?, ?)`,
        crypto.randomUUID(),
        row.id,
        needsReview ? 'Edited by creator after approval' : 'Edited by creator',
        Date.now(),
      );
    }
  });
  invalidateTrendingCache();

  res.json({
    video: rowToVideo(videoRow(row.id, user.id)!, user.id),
    message: nextStatus === 'pending' ? 'Saved. The edited video is back in review.' : 'Saved.',
  });
});

videosRouter.delete('/videos/:id', requireUser, (req, res) => {
  const user = req.user!;
  const row = get<{ owner_id: string; status: string }>(`SELECT owner_id, status FROM videos WHERE id = ?`, param(req, 'id'));
  if (!row) throw new HttpError(404, 'Video not found.');
  if (row.owner_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Only the creator can remove this video.');
  run(
    `UPDATE videos SET status = 'removed', removed_reason = ?, updated_at = ? WHERE id = ?`,
    user.role === 'admin' ? 'Removed by moderator' : 'Removed by creator',
    Date.now(),
    param(req, 'id'),
  );
  invalidateTrendingCache();
  res.json({ ok: true });
});

/* --------------------------------- media ---------------------------------- */

mediaRouter.get('/videos/:id', (req, res) => {
  const row = get<{ owner_id: string; status: string; file_name: string; mime: string; owner_status: string }>(
    `SELECT v.owner_id, v.status, v.file_name, v.mime, u.status AS owner_status
     FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = ?`,
    param(req, 'id'),
  );
  const viewer = req.user;
  const publicView = row?.status === 'approved' && row.owner_status === 'active';
  if (!row || !(publicView || (viewer && (viewer.id === row.owner_id || viewer.role === 'admin')))) {
    throw new HttpError(404, 'That video is not available.');
  }
  const filePath = safeJoin(MEDIA_DIR, row.file_name);
  if (!filePath) throw new HttpError(404, 'That video is not available.');
  sendMediaFile(req, res, filePath, row.mime, row.status === 'approved' ? 'public, max-age=3600' : 'no-store');
});

mediaRouter.get('/posters/:id', (req, res) => {
  const row = get<{ owner_id: string; status: string; poster_name: string | null; owner_status: string }>(
    `SELECT v.owner_id, v.status, v.poster_name, u.status AS owner_status
     FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = ?`,
    param(req, 'id'),
  );
  const viewer = req.user;
  const publicView = row?.status === 'approved' && row.owner_status === 'active';
  if (!row?.poster_name || !(publicView || (viewer && (viewer.id === row.owner_id || viewer.role === 'admin')))) {
    throw new HttpError(404, 'No thumbnail for that video.');
  }
  const filePath = safeJoin(POSTER_DIR, row.poster_name);
  if (!filePath) throw new HttpError(404, 'No thumbnail for that video.');
  sendMediaFile(req, res, filePath, 'image/jpeg', row.status === 'approved' ? 'public, max-age=86400' : 'no-store');
});

/* -------------------------------- engagement ------------------------------ */

videosRouter.post('/videos/:id/like', requireUser, (req, res) => {
  const user = req.user!;
  const row = get<{ id: string; owner_id: string; status: string }>(
    `SELECT id, owner_id, status FROM videos WHERE id = ?`,
    param(req, 'id'),
  );
  if (!row || row.status !== 'approved') throw new HttpError(404, 'Video not found.');

  const existing = get(`SELECT 1 FROM likes WHERE user_id = ? AND video_id = ?`, user.id, row.id);
  transaction(() => {
    if (existing) {
      run(`DELETE FROM likes WHERE user_id = ? AND video_id = ?`, user.id, row.id);
    } else {
      run(`INSERT INTO likes (user_id, video_id, created_at) VALUES (?, ?, ?)`, user.id, row.id, Date.now());
      applyVideoInterest(user.id, row.id, interactionWeights.like);
    }
  });
  invalidateTrendingCache();
  const likeCount = get<{ n: number }>(`SELECT COUNT(*) AS n FROM likes WHERE video_id = ?`, row.id)?.n ?? 0;
  res.json({ liked: !existing, likeCount });
});

videosRouter.post('/videos/:id/events', (req, res) => {
  const user = req.user;
  const video = get<{ id: string; owner_id: string; status: string; duration: number }>(
    `SELECT id, owner_id, status, duration FROM videos WHERE id = ?`,
    param(req, 'id'),
  );
  if (!video || video.status !== 'approved') return res.json({ ok: true });

  const watchSeconds = Math.max(0, Math.min(Number(req.body?.watchSeconds) || 0, video.duration + 5));
  const completed = Boolean(req.body?.completed);
  const rewatched = Boolean(req.body?.rewatched);
  const skipped = Boolean(req.body?.skipped);
  enforceRate(`events:${user?.id ?? req.ip}`, 120, 60 * 1000, 'Slow down a moment.');

  const qualified = completed || watchSeconds >= Math.max(2, video.duration * 0.25);
  if (qualified) {
    // Signed-in viewers are keyed by account. Guests get a random, opaque
    // cookie so a refresh loop cannot inflate a view count for six hours.
    let viewerKey = user?.id ?? parseCookies(req).gm_guest ?? null;
    if (!viewerKey) {
      viewerKey = `guest-${crypto.randomBytes(18).toString('base64url')}`;
      setCookie(res, 'gm_guest', viewerKey, 30 * 86_400);
    }
    const recent = get(
      `SELECT 1 FROM video_views WHERE viewer_key = ? AND video_id = ? AND created_at > ? LIMIT 1`,
      viewerKey,
      video.id,
      Date.now() - 6 * 60 * 60 * 1000,
    );
    if (!recent) {
      run(
        `INSERT INTO video_views (user_id, viewer_key, video_id, watch_seconds, completed, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        user?.id ?? null,
        viewerKey,
        video.id,
        watchSeconds,
        completed ? 1 : 0,
        Date.now(),
      );
      run(`UPDATE videos SET view_count = view_count + 1 WHERE id = ?`, video.id);
      invalidateTrendingCache();
    }
  }

  if (user) {
    if (completed) recordEvent(user.id, video.id, 'complete');
    if (rewatched) recordEvent(user.id, video.id, 'rewatch');
    if (skipped && watchSeconds < 2 && !completed) recordEvent(user.id, video.id, 'skip');
  }
  res.json({ ok: true });
});

videosRouter.post('/videos/:id/not-interested', requireUser, (req, res) => {
  const video = get<{ id: string }>(`SELECT id FROM videos WHERE id = ? AND status = 'approved'`, param(req, 'id'));
  if (!video) throw new HttpError(404, 'Video not found.');
  recordEvent(req.user!.id, video.id, 'not_interested');
  res.json({ ok: true, message: 'Hidden. We will show fewer videos like this.' });
});

videosRouter.delete('/videos/:id/not-interested', requireUser, (req, res) => {
  undoEvent(req.user!.id, param(req, 'id'), 'not_interested');
  res.json({ ok: true });
});

/* --------------------------------- reports -------------------------------- */

export const VIDEO_REPORT_REASONS = [
  'Not actually a goat',
  'Animal mistreatment',
  'Spam or misleading',
  'Harassment or hate',
  'Something else',
];

videosRouter.post('/videos/:id/report', requireUser, (req, res) => {
  enforceRate(`report:${req.user!.id}`, 8, 60 * 60 * 1000, 'You have sent several reports. Our moderator will catch up.');
  const video = get<{ id: string }>(`SELECT id FROM videos WHERE id = ? AND status = 'approved'`, param(req, 'id'));
  if (!video) throw new HttpError(404, 'Video not found.');
  const reason = String(req.body?.reason ?? '');
  if (!VIDEO_REPORT_REASONS.includes(reason)) throw new HttpError(400, 'Choose a reason for the report.');
  const note = cleanText(req.body?.note, 500) || null;
  const duplicate = get(
    `SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = 'video' AND target_id = ? AND status = 'open'`,
    req.user!.id,
    video.id,
  );
  if (duplicate) throw new HttpError(409, 'You already reported this video. The moderator will see it.');
  run(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, note, status, created_at)
     VALUES (?, ?, 'video', ?, ?, ?, 'open', ?)`,
    crypto.randomUUID(),
    req.user!.id,
    video.id,
    reason,
    note,
    Date.now(),
  );
  res.status(201).json({ ok: true, message: 'Report sent to the moderator.' });
});

/* --------------------------------- search --------------------------------- */

function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

videosRouter.get('/search', (req, res) => {
  const raw = String(req.query.q ?? '').trim().slice(0, 80);
  res.setHeader('Cache-Control', 'no-store');
  if (raw.length < 2) {
    return res.json({ videos: [], creators: [], hashtag: null } satisfies SearchResults);
  }
  const viewer = req.user?.id ?? null;
  const params = [viewer ?? '', viewer ?? '', viewer ?? ''];
  const hashtag = raw.startsWith('#') ? raw.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '') : null;
  const pattern = likePattern(hashtag || raw);
  const categoryMatch =
    categories.find(
      (category) =>
        category.label.toLowerCase() === raw.toLowerCase() || category.id === raw.toLowerCase(),
    )?.id ?? null;

  const rows = hashtag
    ? all<VideoRow>(
        `${VIDEO_SELECT}
         WHERE v.status = 'approved' AND u.status = 'active'
           AND EXISTS (SELECT 1 FROM json_each(v.hashtags) WHERE json_each.value = ?)
         ORDER BY v.published_at DESC LIMIT 24`,
        ...params,
        hashtag,
      )
    : all<VideoRow>(
        `${VIDEO_SELECT}
         WHERE v.status = 'approved' AND u.status = 'active'
           AND (v.caption LIKE ? ESCAPE '\\' OR v.hashtags LIKE ? ESCAPE '\\' OR v.category LIKE ? ESCAPE '\\'
             ${categoryMatch ? 'OR v.category = ?' : ''})
         ORDER BY v.published_at DESC LIMIT 24`,
        ...params,
        pattern,
        pattern,
        pattern,
        ...(categoryMatch ? [categoryMatch] : []),
      );

  const creators = all<{ username: string }>(
    `SELECT username FROM users
     WHERE status = 'active' AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
     ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.following_id = users.id) DESC, created_at ASC
     LIMIT 6`,
    pattern,
    pattern,
  )
    .map((row) => getPublicUser(row.username, viewer))
    .filter((user): user is NonNullable<typeof user> => Boolean(user));

  const results: SearchResults = {
    videos: rows.map((row) => rowToVideo(row, viewer)),
    creators,
    hashtag,
  };
  res.json(results);
});

videosRouter.get('/me/hidden', requireUser, (req, res) => {
  const viewer = req.user!.id;
  const rows = all<VideoRow>(
    `${VIDEO_SELECT}
     WHERE v.id IN (SELECT video_id FROM video_events WHERE user_id = ? AND type = 'not_interested')
     ORDER BY v.published_at DESC`,
    viewer,
    viewer,
    viewer,
    viewer,
  );
  res.json({ items: rows.map((row) => rowToVideo(row, viewer)) });
});

videosRouter.delete('/me/hidden/:id', requireUser, (req, res) => {
  undoEvent(req.user!.id, param(req, 'id'), 'not_interested');
  res.json({ ok: true });
});
