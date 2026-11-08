// How full the database is. Video bytes dominate and would otherwise mean
// pulling every blob through the Worker on each dashboard visit, so they are
// read from the size each upload recorded instead: exact to the byte, and a
// handful of rows rather than every chunk.

import { Env, json } from '../lib';
import { requireAdmin } from '../session';
import { storageBudget } from '../config';
import { invalidateTrending } from '../recommend';
import { availableShards, dropShardChunks, pickShard } from '../media-shards';

const DORMANT = "p.status IN ('rejected', 'removed')";
/** Same condition for statements that cannot take a table alias. */
const DORMANT_PLAIN = "status IN ('rejected', 'removed')";

interface MediaCounts {
  video_bytes: number;
  videos: number;
  photo_bytes: number;
  photos: number;
  sound_bytes: number;
  sounds: number;
  avatar_bytes: number;
  avatars: number;
  poster_bytes: number;
  frame_bytes: number;
  frames: number;
  dormant_posts: number;
  dormant_videos: number;
  dormant_video_bytes: number;
  dormant_photo_bytes: number;
  dormant_frame_bytes: number;
}

export async function usage(req: Request, env: Env) {
  await requireAdmin(req, env);

  const row = await env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(size), 0) FROM uploads) AS video_bytes,
       (SELECT COUNT(*) FROM uploads WHERE chunk_count > 0) AS videos,
       (SELECT COALESCE(SUM(size), 0) FROM post_photos) AS photo_bytes,
       (SELECT COUNT(*) FROM post_photos) AS photos,
       (SELECT COALESCE(SUM(size), 0) FROM sounds) AS sound_bytes,
       (SELECT COUNT(*) FROM sounds) AS sounds,
       (SELECT COALESCE(SUM(LENGTH(avatar_bytes)), 0) FROM users WHERE avatar_bytes IS NOT NULL) AS avatar_bytes,
       (SELECT COUNT(*) FROM users WHERE avatar_bytes IS NOT NULL) AS avatars,
       (SELECT COALESCE(SUM(LENGTH(poster_bytes)), 0) FROM uploads WHERE poster_bytes IS NOT NULL) AS poster_bytes,
       (SELECT COALESCE(SUM(size), 0) FROM upload_frames) AS frame_bytes,
       (SELECT COUNT(*) FROM upload_frames) AS frames,
       (SELECT COUNT(*) FROM posts p WHERE ${DORMANT}) AS dormant_posts,
       (SELECT COUNT(*) FROM posts p WHERE ${DORMANT} AND p.video_upload_id IS NOT NULL) AS dormant_videos,
       (SELECT COALESCE(SUM(size), 0) FROM uploads
         WHERE id IN (SELECT p.video_upload_id FROM posts p
                       WHERE ${DORMANT} AND p.video_upload_id IS NOT NULL)) AS dormant_video_bytes,
       (SELECT COALESCE(SUM(size), 0) FROM post_photos ph
         WHERE ph.bytes IS NOT NULL
           AND ph.post_id IN (SELECT p.id FROM posts p WHERE ${DORMANT})) AS dormant_photo_bytes,
       (SELECT COALESCE(SUM(size), 0) FROM upload_frames f
         WHERE f.upload_id IN (SELECT p.video_upload_id FROM posts p
                                WHERE ${DORMANT} AND p.video_upload_id IS NOT NULL)) AS dormant_frame_bytes`,
  ).first<MediaCounts>();

  const counts: MediaCounts = row || {
    video_bytes: 0,
    videos: 0,
    photo_bytes: 0,
    photos: 0,
    sound_bytes: 0,
    sounds: 0,
    avatar_bytes: 0,
    avatars: 0,
    poster_bytes: 0,
    frame_bytes: 0,
    frames: 0,
    dormant_posts: 0,
    dormant_videos: 0,
    dormant_video_bytes: 0,
    dormant_photo_bytes: 0,
    dormant_frame_bytes: 0,
  };

  // The exact size recorded when the upload finished, rather than a chunk count
  // multiplied by the chunk size, which rounded every clip up to the next slot.
  const videoBytes = counts.video_bytes;
  const breakdown = [
    { kind: 'videos', bytes: videoBytes, count: counts.videos },
    { kind: 'photos', bytes: counts.photo_bytes, count: counts.photos },
    { kind: 'sounds', bytes: counts.sound_bytes, count: counts.sounds },
    { kind: 'avatars', bytes: counts.avatar_bytes, count: counts.avatars },
    { kind: 'posters', bytes: counts.poster_bytes, count: counts.videos },
    { kind: 'frames', bytes: counts.frame_bytes, count: counts.frames },
  ];
  const usedBytes = breakdown.reduce((total, item) => total + item.bytes, 0);

  // Video chunks fill their shards; everything else shares the main database.
  // The fuller of the two pools decides the percentage, so a video-heavy site
  // does not look emptier than it is.
  const perDatabase = storageBudget.databaseLimitBytes;
  const shards = availableShards(env).length;
  const limitBytes = perDatabase * (1 + shards);
  const ratio =
    shards === 0
      ? usedBytes / perDatabase
      : Math.max(videoBytes / (perDatabase * shards), (usedBytes - videoBytes) / perDatabase);

  // Where the bytes actually sit, one row per database, plus which shard the
  // next upload will land in so the list answers "what is this one for".
  const perShard = await env.DB.prepare(
    'SELECT shard, COALESCE(SUM(size), 0) AS bytes FROM uploads GROUP BY shard',
  ).all<{ shard: number; bytes: number }>();
  const shardBytes = new Map<number, number>();
  for (const row of perShard.results || []) shardBytes.set(row.shard, row.bytes);

  const shardList = availableShards(env);
  const activeShard = shardList.length ? await pickShard(env) : 0;
  const mainBytes = usedBytes - videoBytes + (shardBytes.get(0) ?? 0);
  const databaseList = [
    {
      id: 'main',
      label: 'Main',
      detail: 'Captions, photos, audio',
      usedBytes: mainBytes,
      limitBytes: perDatabase,
      active: shardList.length === 0,
    },
    ...shardList.map((shard) => ({
      id: `media-${shard}`,
      label: `Videos ${shard}`,
      detail: 'Video chunks',
      usedBytes: shardBytes.get(shard) ?? 0,
      limitBytes: perDatabase,
      active: shard === activeShard,
    })),
  ];
  const leftBytes = databaseList.reduce(
    (total, database) => total + Math.max(0, database.limitBytes - database.usedBytes),
    0,
  );

  return json({
    limitBytes,
    usedBytes,
    leftBytes,
    inUse: databaseList.filter((database) => database.usedBytes > 0).length,
    databaseList,
    percent: Math.min(100, Math.round(ratio * 1000) / 10),
    warnAt: storageBudget.warnAt,
    averageVideoBytes: counts.videos ? Math.round(videoBytes / counts.videos) : 0,
    breakdown,
    reclaimable: {
      posts: counts.dormant_posts,
      videos: counts.dormant_videos,
      bytes: counts.dormant_video_bytes + counts.dormant_photo_bytes + counts.dormant_frame_bytes,
    },
  });
}

/**
 * Permanently deletes posts that were rejected or removed, which is the only
 * thing on the site that frees stored bytes. Uploads are removed explicitly
 * because the foreign key points the other way: deleting a post leaves its
 * upload behind for the hourly sweep instead of removing it.
 */
export async function purge(req: Request, env: Env) {
  await requireAdmin(req, env);

  const before = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM posts p WHERE ${DORMANT}) AS posts,
       (SELECT COUNT(*) FROM posts p WHERE ${DORMANT} AND p.video_upload_id IS NOT NULL) AS videos,
       (SELECT COALESCE(SUM(size), 0) FROM uploads
         WHERE id IN (SELECT p.video_upload_id FROM posts p
                       WHERE ${DORMANT} AND p.video_upload_id IS NOT NULL)) AS video_bytes,
       (SELECT COALESCE(SUM(size), 0) FROM post_photos ph
         WHERE ph.bytes IS NOT NULL
           AND ph.post_id IN (SELECT p.id FROM posts p WHERE ${DORMANT})) AS photo_bytes,
       (SELECT COALESCE(SUM(size), 0) FROM upload_frames f
         WHERE f.upload_id IN (SELECT p.video_upload_id FROM posts p
                                WHERE ${DORMANT} AND p.video_upload_id IS NOT NULL)) AS frame_bytes`,
  ).first<{ posts: number; videos: number; video_bytes: number; photo_bytes: number; frame_bytes: number }>();

  const counts = before || { posts: 0, videos: 0, video_bytes: 0, photo_bytes: 0, frame_bytes: 0 };
  const uploads = await env.DB.prepare(
    `SELECT p.video_upload_id AS id, up.shard AS shard FROM posts p
       JOIN uploads up ON up.id = p.video_upload_id
      WHERE ${DORMANT} AND p.video_upload_id IS NOT NULL
      GROUP BY p.video_upload_id`,
  ).all<{ id: string; shard: number }>();
  const rows = uploads.results || [];
  const ids = rows.map((row) => row.id);

  // Nothing to do is a normal answer, not an error: the moderator may click
  // twice or the queue may already be clear.
  if (counts.posts === 0 && ids.length === 0) {
    return json({ posts: 0, videos: 0, freedBytes: 0 });
  }

  // Shard chunks first: they have no foreign key back to this database, so
  // nothing else would ever clean them up.
  await dropShardChunks(env, rows);

  const postsFirst = env.DB.prepare(`DELETE FROM posts WHERE ${DORMANT_PLAIN}`);
  const statements = [postsFirst];
  for (let i = 0; i < ids.length; i += 40) {
    const slice = ids.slice(i, i + 40);
    statements.push(
      env.DB.prepare(`DELETE FROM upload_frames WHERE upload_id IN (${slice.map(() => '?').join(',')})`).bind(
        ...slice,
      ),
    );
  }
  for (let i = 0; i < ids.length; i += 40) {
    const slice = ids.slice(i, i + 40);
    statements.push(
      env.DB.prepare(`DELETE FROM uploads WHERE id IN (${slice.map(() => '?').join(',')})`).bind(
        ...slice,
      ),
    );
  }
  await env.DB.batch(statements);
  invalidateTrending();

  return json({
    posts: counts.posts,
    videos: counts.videos,
    freedBytes: counts.video_bytes + counts.photo_bytes + counts.frame_bytes,
  });
}
