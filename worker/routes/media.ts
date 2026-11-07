// Blob delivery. Photos and sounds live in D1, which means every read is also
// the authorization check: pending or removed media never leaves the server
// unless the person asking wrote it (or is the moderator).

import { Env, missing } from '../lib';
import { currentUser } from '../session';
import { VIDEO_CHUNK_BYTES } from '../config';
import { chunkTable, shardBinding } from '../media-shards';

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
  shard: number;
}

async function videoRow(env: Env, postId: string): Promise<VideoRow> {
  const row = await env.DB.prepare(
    `SELECT up.mime, up.size, p.status, p.owner_id, up.id AS upload_id, up.shard
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
/**
 * How many bytes one response carries. A D1 blob row reaches the Worker as an
 * array of numbers, so turning it into bytes costs CPU in proportion to its
 * size, and pulling a whole clip in one invocation both burns that budget and
 * trips D1's resource limit for a ten-second window. Bounded slices keep every
 * invocation small: the browser asks for the next range as it plays, and a busy
 * database delays one slice instead of truncating the stream.
 */
const SLICE_BYTES = 512 * 1024;

/** Waits between retries of a read that failed for a reason that may pass. */
const READ_RETRY_MS = [120, 350, 800];

function transient(err: unknown): boolean {
  const message = String((err as Error)?.message ?? err);
  return /overload|too many resources|network connection lost|internal error|timed out/i.test(
    message,
  );
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= READ_RETRY_MS.length || !transient(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS[attempt]));
    }
  }
}

/** Reads only the bytes being sent, straight out of SQLite. */
async function readSlice(
  env: Env,
  uploadId: string,
  shard: number,
  idx: number,
  from: number,
  to: number,
): Promise<Uint8Array | null> {
  const db = shardBinding(env, shard) ?? env.DB;
  const row = await withRetry(() =>
    db
      .prepare(
        `SELECT substr(bytes, ?, ?) AS bytes FROM ${chunkTable(shard)}
          WHERE upload_id = ? AND idx = ?`,
      )
      .bind(from + 1, to - from, uploadId, idx)
      .first<{ bytes: unknown }>(),
  );
  return row ? toBytes(row.bytes) : null;
}

/** Streams just the bytes a range touches, one chunk at a time. */
async function streamRange(env: Env, uploadId: string, shard: number, start: number, end: number) {
  const firstChunk = Math.floor(start / VIDEO_CHUNK_BYTES);
  const lastChunk = Math.floor(end / VIDEO_CHUNK_BYTES);

  let next = firstChunk;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next > lastChunk) {
        controller.close();
        return;
      }
      const idx = next;
      next += 1;
      const chunkStart = idx * VIDEO_CHUNK_BYTES;
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(VIDEO_CHUNK_BYTES, end - chunkStart + 1);
      const bytes = await readSlice(env, uploadId, shard, idx, from, to);
      // A short answer would end the body early and stall the player, so treat
      // it the same as a missing chunk: the browser retries the range.
      if (!bytes || bytes.byteLength !== to - from) {
        controller.error(new Error('That video could not be read in full.'));
        return;
      }
      controller.enqueue(bytes);
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
    // One bounded slice per response; the player asks for the rest as it goes.
    if (end - start + 1 > SLICE_BYTES) end = start + SLICE_BYTES - 1;
    const body = await streamRange(env, row.upload_id, row.shard, start, end);
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${row.size}`,
        'content-length': String(end - start + 1),
      },
    });
  }

  const body = await streamRange(env, row.upload_id, row.shard, 0, row.size - 1);
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
