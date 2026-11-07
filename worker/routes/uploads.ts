// Chunked video uploads. Each chunk is its own small request so no single
// invocation has to buffer a whole clip, and the bytes land in D1 rows that stay
// under its 2 MB limit. A post references the upload; deleting the post removes
// the upload and its chunks.

import { Env, bad, denied, json, missing, now, optionalStr, rateLimit, uid } from '../lib';
import { requireActive } from '../session';
import { limits, VIDEO_CHUNK_BYTES } from '../config';
import {
  chunkTable,
  dropShardChunks,
  pickShard,
  shardBinding,
} from '../media-shards';

const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);
const POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_VIDEO_BYTES = limits.maxVideoMb * 1024 * 1024;
const MAX_POSTER_BYTES = 400 * 1024;

function looksLikeVideo(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'video/x-m4v') {
    return ascii(4, 8) === 'ftyp';
  }
  if (mime === 'video/webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}

function looksLikeImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === 'image/webp') {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  }
  return false;
}

export async function startUpload(req: Request, env: Env) {
  const user = await requireActive(req, env);
  await rateLimit(
    env,
    `upload:${user.id}`,
    12,
    60 * 60 * 1000,
    'That is a lot of uploads in an hour. Wait a little and try again.',
  );
  const body = (await req.json().catch(() => ({}))) as {
    mime?: string;
    size?: number;
    durationMs?: number;
  };
  const mime = String(body.mime || '');
  const size = Number(body.size || 0);
  const durationMs = Number(body.durationMs || 0);

  if (!VIDEO_TYPES.has(mime)) throw bad('Videos need to be MP4, M4V, MOV or WebM.');
  if (!Number.isFinite(size) || size < 1024) throw bad('That video file looks empty.');
  if (size > MAX_VIDEO_BYTES) {
    throw bad(`Videos are limited to ${limits.maxVideoMb} MB. Trim the clip and try again.`);
  }
  if (
    !Number.isFinite(durationMs) ||
    durationMs < limits.minDurationSeconds * 1000 - 200 ||
    durationMs > limits.maxDurationSeconds * 1000 + 500
  ) {
    throw bad(`Clips need to run between ${limits.minDurationSeconds} and ${limits.maxDurationSeconds} seconds.`);
  }

  // Opportunistic clean-up of abandoned uploads. An upload a post points at is
  // never abandoned: the foreign key cascades, so removing it would delete the
  // post and its video along with it. Chunks in a shard have no foreign key
  // back to this database, so they are removed first.
  const stale = await env.DB.prepare(
    `SELECT id, shard FROM uploads
      WHERE created_at < ?
        AND id NOT IN (SELECT video_upload_id FROM posts WHERE video_upload_id IS NOT NULL)
      LIMIT 50`,
  )
    .bind(now() - 2 * 60 * 60 * 1000)
    .all<{ id: string; shard: number }>();
  if (stale.results?.length) {
    await dropShardChunks(env, stale.results);
    await env.DB.batch(
      stale.results.map((row) => env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(row.id)),
    );
  }

  const id = uid('upl');
  const shard = await pickShard(env);
  await env.DB.prepare(
    `INSERT INTO uploads (id, user_id, mime, size, duration_ms, chunk_count, created_at, shard)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(id, user.id, mime, Math.round(size), Math.round(durationMs), now(), shard)
    .run();
  return json({ uploadId: id, chunkSize: VIDEO_CHUNK_BYTES }, 201);
}

async function ownedUpload(env: Env, id: string, userId: string) {
  const row = await env.DB.prepare(
    'SELECT id, user_id, mime, size, duration_ms, chunk_count, shard FROM uploads WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: string;
      user_id: string;
      mime: string;
      size: number;
      duration_ms: number;
      chunk_count: number;
      shard: number;
    }>();
  if (!row) throw missing('That upload has expired. Start again.');
  if (row.user_id !== userId) throw denied('That upload is not yours.');
  return row;
}

export async function putChunk(req: Request, env: Env, url: URL, uploadId: string) {
  const user = await requireActive(req, env);
  const upload = await ownedUpload(env, uploadId, user.id);

  const index = Number(url.searchParams.get('index'));
  const expectedChunks = Math.ceil(upload.size / VIDEO_CHUNK_BYTES);
  if (!Number.isInteger(index) || index < 0 || index >= expectedChunks) {
    throw bad('That video chunk is out of range.');
  }

  const form = await req.formData().catch(() => null);
  const chunk = form?.get('chunk');
  if (!(chunk instanceof File) || chunk.size === 0) throw bad('That video chunk was empty.');
  const allowedMax = VIDEO_CHUNK_BYTES + 1024;
  if (chunk.size > allowedMax) throw bad('That video chunk was too large.');

  const bytes = await chunk.arrayBuffer();
  if (index === 0 && !looksLikeVideo(new Uint8Array(bytes.slice(0, 12)), upload.mime)) {
    throw bad('That file does not look like a real video. MP4, MOV and WebM work here.');
  }

  // The bytes go to the upload's shard and the counter stays in the main
  // database, so this cannot be one batch across both.
  const shardDb = shardBinding(env, upload.shard) ?? env.DB;
  const table = chunkTable(upload.shard);
  await shardDb
    .prepare(
      `INSERT INTO ${table} (upload_id, idx, bytes) VALUES (?, ?, ?)
       ON CONFLICT(upload_id, idx) DO UPDATE SET bytes = excluded.bytes`,
    )
    .bind(uploadId, index, bytes)
    .run()
    .catch(async () => {
      await shardDb
        .prepare(`INSERT OR REPLACE INTO ${table} (upload_id, idx, bytes) VALUES (?, ?, ?)`)
        .bind(uploadId, index, bytes)
        .run();
    });
  await env.DB.prepare('UPDATE uploads SET chunk_count = MAX(chunk_count, ?) WHERE id = ?')
    .bind(index + 1, uploadId)
    .run();

  return json({ ok: true, received: index + 1, total: expectedChunks });
}

export async function putPoster(req: Request, env: Env, uploadId: string) {
  const user = await requireActive(req, env);
  await ownedUpload(env, uploadId, user.id);
  const form = await req.formData().catch(() => null);
  const file = form?.get('poster');
  if (!(file instanceof File) || file.size === 0) throw bad('The preview frame was empty.');
  const type = file.type || 'image/jpeg';
  if (!POSTER_TYPES.has(type)) throw bad('The preview frame needs to be a JPEG, PNG or WebP image.');
  if (file.size > MAX_POSTER_BYTES) throw bad('The preview frame was too large.');
  const bytes = await file.arrayBuffer();
  if (!looksLikeImage(new Uint8Array(bytes.slice(0, 12)), type)) {
    throw bad('The preview frame does not look like an image.');
  }
  await env.DB.prepare('UPDATE uploads SET poster_mime = ?, poster_bytes = ? WHERE id = ?')
    .bind(type, bytes, uploadId)
    .run();
  return json({ ok: true });
}

/** Used when a post is created: the upload must hold every chunk it promised. */
export async function completeUpload(env: Env, userId: string, uploadId: string) {
  const upload = await ownedUpload(env, uploadId, userId);
  const expected = Math.ceil(upload.size / VIDEO_CHUNK_BYTES);
  const shardDb = shardBinding(env, upload.shard) ?? env.DB;
  const row = await shardDb
    .prepare(`SELECT COUNT(*) AS n FROM ${chunkTable(upload.shard)} WHERE upload_id = ?`)
    .bind(uploadId)
    .first<{ n: number }>();
  if ((row?.n ?? 0) !== expected) {
    throw bad('That video did not finish uploading. Try sending it again.');
  }
  return upload;
}

export function durationFromForm(form: FormData, fallback: number): number {
  const raw = Number(form.get('durationMs') ?? 0);
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(0, Math.min(limits.maxDurationSeconds * 1000, Math.round(value)));
}

export function dimensionFromForm(form: FormData, key: string): number | null {
  const raw = Number(form.get(key) ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(10000, Math.round(raw));
}

void optionalStr;
