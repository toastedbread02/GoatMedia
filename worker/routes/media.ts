// Blob delivery. Photos and sounds live in D1, which means every read is also
// the authorization check: pending or removed media never leaves the server
// unless the person asking wrote it (or is the moderator).

import { Env, missing } from '../lib';
import { currentUser } from '../session';
import { VIDEO_CHUNK_BYTES } from '../config';

/**
 * D1 hands BLOBs back as an array of byte values rather than an ArrayBuffer,
 * so they have to be repacked before Response will treat them as binary.
 */
function toBytes(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  return null;
}

function blobResponse(raw: unknown, mime: string, cache: string) {
  const bytes = toBytes(raw);
  if (!bytes) throw missing('That file is gone.');
  return new Response(bytes, {
    headers: {
      'content-type': mime,
      'content-length': String(bytes.byteLength),
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function photo(req: Request, env: Env, id: string) {
  const row = await env.DB.prepare(
    `SELECT ph.bytes, ph.mime, p.status, p.owner_id
       FROM post_photos ph JOIN posts p ON p.id = ph.post_id
      WHERE ph.id = ?`,
  )
    .bind(id)
    .first<{ bytes: unknown; mime: string; status: string; owner_id: string }>();
  if (!row) throw missing();

  if (row.status !== 'approved') {
    const user = await currentUser(req, env);
    if (!user || (user.id !== row.owner_id && user.role !== 'admin')) {
      throw missing();
    }
    return blobResponse(row.bytes, row.mime, 'private, no-store');
  }
  return blobResponse(row.bytes, row.mime, 'public, max-age=31536000, immutable');
}

export async function sound(req: Request, env: Env, id: string) {
  const row = await env.DB.prepare(
    `SELECT s.bytes, s.mime, s.owner_id,
            EXISTS(SELECT 1 FROM posts p WHERE p.sound_id = s.id AND p.status = 'approved') AS live
       FROM sounds s WHERE s.id = ?`,
  )
    .bind(id)
    .first<{ bytes: unknown; mime: string; owner_id: string; live: number }>();
  if (!row) throw missing();

  if (!row.live) {
    const user = await currentUser(req, env);
    if (!user || (user.id !== row.owner_id && user.role !== 'admin')) {
      throw missing();
    }
    return blobResponse(row.bytes, row.mime, 'private, no-store');
  }
  return blobResponse(row.bytes, row.mime, 'public, max-age=604800');
}

interface VideoRow {
  mime: string;
  size: number;
  status: string;
  owner_id: string;
  upload_id: string;
}

async function videoRow(env: Env, postId: string): Promise<VideoRow> {
  const row = await env.DB.prepare(
    `SELECT up.mime, up.size, p.status, p.owner_id, up.id AS upload_id
       FROM posts p JOIN uploads up ON up.id = p.video_upload_id
      WHERE p.id = ? AND p.kind = 'video'`,
  )
    .bind(postId)
    .first<VideoRow>();
  if (!row) throw missing('That video is gone.');
  return row;
}

async function assertMediaVisible(req: Request, env: Env, row: { status: string; owner_id: string }) {
  if (row.status === 'approved') return true;
  const user = await currentUser(req, env);
  if (!user || (user.id !== row.owner_id && user.role !== 'admin')) throw missing();
  return false;
}

/**
 * A D1 blob arrives as one JS number per byte, so holding a whole clip in
 * memory costs roughly eight times its size and blows the Worker's limit on
 * anything over about 12 MB. Chunks are therefore pulled a few at a time and
 * handed straight to the response as a stream.
 */
const CHUNK_BATCH = 4;

/** A missing chunk would silently shorten the file mid-stream, so check first. */
async function assertChunks(env: Env, uploadId: string, first: number, last: number) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM upload_chunks WHERE upload_id = ? AND idx BETWEEN ? AND ?',
  )
    .bind(uploadId, first, last)
    .first<{ n: number }>();
  if ((row?.n ?? 0) < last - first + 1) throw missing('That video is incomplete.');
}

/** Streams just the chunks a byte range touches, trimming the two edges. */
async function streamRange(env: Env, uploadId: string, start: number, end: number) {
  const firstChunk = Math.floor(start / VIDEO_CHUNK_BYTES);
  const lastChunk = Math.floor(end / VIDEO_CHUNK_BYTES);
  await assertChunks(env, uploadId, firstChunk, lastChunk);

  let next = firstChunk;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next > lastChunk) {
        controller.close();
        return;
      }
      const batchEnd = Math.min(lastChunk, next + CHUNK_BATCH - 1);
      const rows = await env.DB.prepare(
        'SELECT idx, bytes FROM upload_chunks WHERE upload_id = ? AND idx BETWEEN ? AND ? ORDER BY idx',
      )
        .bind(uploadId, next, batchEnd)
        .all<{ idx: number; bytes: unknown }>();
      next = batchEnd + 1;

      for (const row of rows.results || []) {
        const bytes = toBytes(row.bytes);
        if (!bytes) continue;
        const chunkStart = row.idx * VIDEO_CHUNK_BYTES;
        const from = Math.max(0, start - chunkStart);
        const to = Math.min(bytes.byteLength, end - chunkStart + 1);
        if (to <= from) continue;
        controller.enqueue(bytes.subarray(from, to));
      }
    },
  });
}

export async function video(req: Request, env: Env, postId: string) {
  const row = await videoRow(env, postId);
  const isPublic = await assertMediaVisible(req, env, row);
  const cache = isPublic ? 'public, max-age=604800' : 'private, no-store';
  const headers: Record<string, string> = {
    'content-type': row.mime,
    'accept-ranges': 'bytes',
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  };

  const range = req.headers.get('range');
  if (req.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...headers, 'content-length': String(row.size) },
    });
  }

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) throw missing('That range cannot be read.');
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : row.size - 1;
    if (!match[1] && match[2]) {
      // Suffix range: the last N bytes of the file.
      start = Math.max(0, row.size - Number(match[2]));
      end = row.size - 1;
    }
    end = Math.min(end, row.size - 1);
    if (!Number.isFinite(start) || start > end || start >= row.size) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${row.size}` },
      });
    }
    const body = await streamRange(env, row.upload_id, start, end);
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${row.size}`,
        'content-length': String(end - start + 1),
      },
    });
  }

  const body = await streamRange(env, row.upload_id, 0, row.size - 1);
  return new Response(body, {
    status: 200,
    headers: { ...headers, 'content-length': String(row.size) },
  });
}

export async function poster(req: Request, env: Env, postId: string) {
  const row = await env.DB.prepare(
    `SELECT up.poster_bytes, up.poster_mime, p.status, p.owner_id
       FROM posts p JOIN uploads up ON up.id = p.video_upload_id
      WHERE p.id = ? AND p.kind = 'video'`,
  )
    .bind(postId)
    .first<{ poster_bytes: unknown; poster_mime: string | null; status: string; owner_id: string }>();
  if (!row || !row.poster_bytes) throw missing('No preview frame for this post.');
  const isPublic = await assertMediaVisible(req, env, row);
  return blobResponse(
    row.poster_bytes,
    row.poster_mime || 'image/jpeg',
    isPublic ? 'public, max-age=604800' : 'private, no-store',
  );
}

export async function avatar(req: Request, env: Env, userId: string) {
  const row = await env.DB.prepare(
    'SELECT avatar_bytes, avatar_mime, status FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{ avatar_bytes: unknown; avatar_mime: string | null; status: string }>();
  if (!row || !row.avatar_bytes) throw missing('No photo for this creator.');
  return blobResponse(
    row.avatar_bytes,
    row.avatar_mime || 'image/jpeg',
    row.status === 'active' ? 'public, max-age=604800' : 'private, no-store',
  );
}
