// Small HTTP + crypto + validation helpers shared by every Worker route.

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  PASSWORD_PEPPER?: string;
  PASSWORD_ITERATIONS?: string;
  ADMIN_SETUP_TOKEN?: string;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (message: string) => new HttpError(400, message);
export const denied = (message = 'You need to sign in for that.') => new HttpError(401, message);
export const missing = (message = 'Not found.') => new HttpError(404, message);
export const tooMany = (message: string) => new HttpError(429, message);

export const now = () => Date.now();
export const uid = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function text(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};
  const list = allowedOrigins(env);
  if (!list.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function preflight(req: Request, env: Env) {
  const headers = corsHeaders(req, env);
  if (!Object.keys(headers).length) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers });
}

export function ip(req: Request): string {
  return req.headers.get('cf-connecting-ip') || 'unknown';
}

// ---------------------------------------------------------------------------
// Passwords
//
// PBKDF2 with a server-side pepper. Iterations are deliberately low: the free
// Workers plan allows 10 ms of CPU per request and hashing competes with it.
// The pepper (PASSWORD_PEPPER secret) is what stops an offline attacker who
// only has a copy of the database, and sign-in is rate limited per IP.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toB64(new Uint8Array(digest));
}

function iterations(env: Env): number {
  const raw = Number(env.PASSWORD_ITERATIONS || 6000);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 200000 ? Math.floor(raw) : 6000;
}

export async function hashPassword(env: Env, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const rounds = iterations(env);
  const material = `${password}\u0000${env.PASSWORD_PEPPER || 'goatmedia-dev-pepper'}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(material), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2$${rounds}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

export async function verifyPassword(env: Env, password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const rounds = Number(parts[1]);
  if (!Number.isFinite(rounds) || rounds < 1) return false;
  const salt = fromB64(parts[2]);
  const expected = parts[3];
  const material = `${password}\u0000${env.PASSWORD_PEPPER || 'goatmedia-dev-pepper'}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(material), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' },
    key,
    256,
  );
  const actual = toB64(new Uint8Array(bits));
  // Constant-time-ish comparison.
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Rate limiting
//
// A single row per bucket in D1 keeps limits shared across Worker isolates.
// Each hit bumps the in-memory bucket and cheaply persists it; we accept a
// small race over adding a Durable Object to a free deployment.
// ---------------------------------------------------------------------------

export async function rateLimit(
  env: Env,
  bucket: string,
  limit: number,
  windowMs: number,
  message: string,
) {
  const bucketId = await sha256(`${bucket}:${Math.floor(now() / windowMs)}`);
  const row = await env.DB.prepare('SELECT hits FROM rate_limits WHERE id = ?')
    .bind(bucketId)
    .first<{ hits: number }>();
  const hits = (row?.hits || 0) + 1;
  if (hits > limit) {
    throw tooMany(message);
  }
  const expires = (Math.floor(now() / windowMs) + 1) * windowMs;
  await env.DB.prepare(
    `INSERT INTO rate_limits (id, hits, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET hits = hits + 1`,
  )
    .bind(bucketId, hits, expires)
    .run();
  if (Math.random() < 0.02) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now()).run();
  }
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

export function str(value: unknown, field: string, max: number, min = 0): string {
  if (typeof value !== 'string') throw bad(`${field} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw bad(min === 1 ? `${field} is required.` : `${field} needs at least ${min} characters.`);
  }
  if (trimmed.length > max) throw bad(`${field} is limited to ${max} characters.`);
  return trimmed;
}

export function optionalStr(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function normalizeUsername(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{3,20}$/.test(value)) {
    throw bad('Usernames use 3 to 20 lowercase letters, numbers or underscores.');
  }
  if (['goatmedia', 'admin', 'support', 'moderator', 'root'].includes(value)) {
    throw bad('That username is reserved.');
  }
  return value;
}

export function normalizeEmail(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    throw bad('That email address does not look right.');
  }
  return value;
}

export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length < 10) {
    return 'Passwords need at least 10 characters.';
  }
  if (raw.length > 200) return 'Passwords are limited to 200 characters.';
  return null;
}

export function pageOf(raw: string | null, pageSize: number): { page: number; offset: number } {
  const parsed = Number(raw || '1');
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  return { page, offset: Math.min((page - 1) * pageSize, 5000) };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw bad('That request body could not be read.');
  }
}
