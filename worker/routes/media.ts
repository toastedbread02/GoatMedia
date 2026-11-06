// Blob delivery. Photos and sounds live in D1, which means every read is also
// the authorization check: pending or removed media never leaves the server
// unless the person asking wrote it (or is the moderator).

import { Env, missing } from '../lib';
import { currentUser } from '../session';

function blobResponse(bytes: ArrayBuffer | null, mime: string, cache: string) {
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
    .first<{ bytes: ArrayBuffer | null; mime: string; status: string; owner_id: string }>();
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
    .first<{ bytes: ArrayBuffer | null; mime: string; owner_id: string; live: number }>();
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

export async function avatar(req: Request, env: Env, userId: string) {
  const row = await env.DB.prepare(
    'SELECT avatar_bytes, avatar_mime, status FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{ avatar_bytes: ArrayBuffer | null; avatar_mime: string | null; status: string }>();
  if (!row || !row.avatar_bytes) throw missing('No photo for this creator.');
  return blobResponse(
    row.avatar_bytes,
    row.avatar_mime || 'image/jpeg',
    row.status === 'active' ? 'public, max-age=604800' : 'private, no-store',
  );
}
