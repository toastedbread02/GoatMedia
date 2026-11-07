// Session handling: bearer tokens stored as SHA-256 hashes in D1.

import { Env, denied, now, randomToken, sha256 } from './lib';

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  suspendedReason: string | null;
  deletedAt: number | null;
  avatarVersion: number;
  hasAvatar: boolean;
}

const SESSION_DAYS = 30;

export async function createSession(env: Env, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken(32);
  const createdAt = now();
  const expiresAt = createdAt + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(randomToken(12), userId, await sha256(token), createdAt, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function destroySession(env: Env, token: string) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export function bearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  status: string;
  suspended_reason: string | null;
  deleted_at: number | null;
  avatar_version: number;
  has_avatar: number;
}

export async function currentUser(req: Request, env: Env): Promise<SessionUser | null> {
  const token = bearer(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.status, u.suspended_reason,
            u.deleted_at, u.avatar_version, (u.avatar_bytes IS NOT NULL) AS has_avatar
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<UserRow>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'suspended' ? 'suspended' : 'active',
    suspendedReason: row.suspended_reason,
    deletedAt: row.deleted_at,
    avatarVersion: row.avatar_version,
    hasAvatar: Boolean(row.has_avatar),
  };
}

export async function requireUser(req: Request, env: Env): Promise<SessionUser> {
  const user = await currentUser(req, env);
  if (!user) throw denied();
  return user;
}

export async function requireActive(req: Request, env: Env): Promise<SessionUser> {
  const user = await requireUser(req, env);
  if (user.deletedAt) {
    throw denied('This account was removed. Contact the moderator if you think that is a mistake.');
  }
  if (user.status === 'suspended') {
    throw denied('This account is suspended. Get in touch if you think that is a mistake.');
  }
  return user;
}

// Authorization is checked here, on the server, for every admin route. The
// browser never decides whether someone is a moderator.
export async function requireAdmin(req: Request, env: Env): Promise<SessionUser> {
  const user = await requireUser(req, env);
  if (user.role !== 'admin') throw denied('This area is for the GoatMedia moderator.');
  return user;
}

export async function pruneSessions(env: Env) {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
}
