// How full the database is. Video bytes dominate and would otherwise mean
// pulling every blob through the Worker on each dashboard visit, so they are
// counted from stored chunk count instead: the answer is within one chunk of
// the truth and costs a handful of rows to read.

import { Env, json } from '../lib';
import { requireAdmin } from '../session';
import { VIDEO_CHUNK_BYTES, storageBudget } from '../config';

interface MediaCounts {
  chunks: number;
  videos: number;
  photo_bytes: number;
  photos: number;
  sound_bytes: number;
  sounds: number;
  avatar_bytes: number;
  avatars: number;
  poster_bytes: number;
}

export async function usage(req: Request, env: Env) {
  await requireAdmin(req, env);

  const row = await env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(chunk_count), 0) FROM uploads) AS chunks,
       (SELECT COUNT(*) FROM uploads WHERE chunk_count > 0) AS videos,
       (SELECT COALESCE(SUM(size), 0) FROM post_photos) AS photo_bytes,
       (SELECT COUNT(*) FROM post_photos) AS photos,
       (SELECT COALESCE(SUM(size), 0) FROM sounds) AS sound_bytes,
       (SELECT COUNT(*) FROM sounds) AS sounds,
       (SELECT COALESCE(SUM(LENGTH(avatar_bytes)), 0) FROM users WHERE avatar_bytes IS NOT NULL) AS avatar_bytes,
       (SELECT COUNT(*) FROM users WHERE avatar_bytes IS NOT NULL) AS avatars,
       (SELECT COALESCE(SUM(LENGTH(poster_bytes)), 0) FROM uploads WHERE poster_bytes IS NOT NULL) AS poster_bytes`,
  ).first<MediaCounts>();

  const counts = row || {
    chunks: 0,
    videos: 0,
    photo_bytes: 0,
    photos: 0,
    sound_bytes: 0,
    sounds: 0,
    avatar_bytes: 0,
    avatars: 0,
    poster_bytes: 0,
  };

  // A full chunk for every chunk written, which rounds up by at most one chunk
  // per clip. Erring high keeps the meter honest about how close the wall is.
  const videoBytes = counts.chunks * VIDEO_CHUNK_BYTES;
  const breakdown = [
    { kind: 'videos', bytes: videoBytes, count: counts.videos },
    { kind: 'photos', bytes: counts.photo_bytes, count: counts.photos },
    { kind: 'sounds', bytes: counts.sound_bytes, count: counts.sounds },
    { kind: 'avatars', bytes: counts.avatar_bytes, count: counts.avatars },
    { kind: 'posters', bytes: counts.poster_bytes, count: counts.videos },
  ];
  const usedBytes = breakdown.reduce((total, row) => total + row.bytes, 0);

  return json({
    limitBytes: storageBudget.databaseLimitBytes,
    usedBytes,
    percent: Math.min(100, Math.round((usedBytes / storageBudget.databaseLimitBytes) * 1000) / 10),
    warnAt: storageBudget.warnAt,
    averageVideoBytes: counts.videos ? Math.round(videoBytes / counts.videos) : 0,
    breakdown,
  });
}
