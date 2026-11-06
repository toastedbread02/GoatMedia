import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { get, run } from './db.ts';
import { HttpError, clearCookie, parseCookies, setCookie } from './util.ts';

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE = 'gm_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function createSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  run(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    userId,
    sha256(token),
    now,
    now + SESSION_DAYS * 86_400_000,
  );
  setCookie(res, SESSION_COOKIE, token, SESSION_DAYS * 86_400);
}

export function destroySession(req: Request, res: Response) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) run(`DELETE FROM sessions WHERE token_hash = ?`, sha256(token));
  clearCookie(res, SESSION_COOKIE);
}

interface SessionRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const row = get<SessionRow>(
      `SELECT u.id, u.email, u.username, u.display_name, u.avatar_url, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
      sha256(token),
      Date.now(),
    );
    if (row && row.status === 'active') {
      req.user = {
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        role: row.role,
        status: row.status,
      };
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sign in to do that.'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sign in to do that.'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'This area is for the GoatMedia moderator.'));
  next();
}

export function sessionCountFor(userId: string): number {
  return get<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`, userId)?.n ?? 0;
}
