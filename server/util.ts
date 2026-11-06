import type { Request, Response } from 'express';
import { crossSiteCookies } from './config.ts';

export class HttpError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;

  constructor(status: number, message: string, options?: { code?: string; fields?: Record<string, string> }) {
    super(message);
    this.status = status;
    this.code = options?.code;
    this.fields = options?.fields;
  }
}

export function assert(condition: unknown, status: number, message: string, fields?: Record<string, string>): asserts condition {
  if (!condition) throw new HttpError(status, message, { fields });
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function checkUsername(raw: unknown): { username: string; error?: string } {
  const username = normalizeUsername(raw);
  if (username.length < 3) return { username, error: 'Use at least 3 characters.' };
  if (username.length > 20) return { username, error: 'Use 20 characters or fewer.' };
  if (!USERNAME_RE.test(username)) return { username, error: 'Letters, numbers and underscores only.' };
  if (/^_|_$/.test(username)) return { username, error: 'Cannot start or end with an underscore.' };
  return { username };
}

const RESERVED_USERNAMES = new Set([
  'admin',
  'goatmedia',
  'support',
  'help',
  'settings',
  'upload',
  'search',
  'api',
  'about',
  'u',
  'v',
]);

export function isReservedUsername(username: string) {
  return RESERVED_USERNAMES.has(username);
}

export function checkEmail(raw: unknown): { email: string; error?: string } {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!email) return { email, error: 'Enter your email address.' };
  if (email.length > 254) return { email, error: 'That email address is too long.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { email, error: 'That email address looks incomplete.' };
  return { email };
}

export function checkPassword(raw: unknown): string | null {
  const password = String(raw ?? '');
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 200) return 'Use 200 characters or fewer.';
  return null;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function cleanText(raw: unknown, maxLength: number): string {
  return String(raw ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

export function parseHashtagList(input: unknown, caption = ''): string[] {
  const explicit = Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/);
  const fromCaption = [...caption.matchAll(/#([a-zA-Z0-9_]{2,24})/g)].map((m) => m[1]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...explicit, ...fromCaption]) {
    const tag = String(value).replace(/^#/, '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,24}$/.test(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === 5) break;
  }
  return out;
}

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, times] of buckets) {
    const recent = times.filter((t) => now - t < 60 * 60 * 1000);
    if (recent.length === 0) buckets.delete(key);
    else buckets.set(key, recent);
  }
}, 10 * 60 * 1000).unref();

export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function enforceRate(key: string, limit: number, windowMs: number, message: string) {
  if (!rateLimit(key, limit, windowMs)) {
    throw new HttpError(429, message, { code: 'rate_limited' });
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
}

function cookieAttributes(): string {
  const secure = crossSiteCookies || /^https:/.test(process.env.APP_ORIGIN || '');
  const sameSite = crossSiteCookies ? 'None' : 'Lax';
  return `Path=/; HttpOnly; SameSite=${sameSite}${secure ? '; Secure' : ''}`;
}

export function setCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; ${cookieAttributes()}; Max-Age=${maxAgeSeconds}`);
}

export function clearCookie(res: Response, name: string) {
  res.append('Set-Cookie', `${name}=; ${cookieAttributes()}; Max-Age=0`);
}

/** A tiny seeded PRNG so a user's feed order stays stable between page loads. */
export function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pageParam(raw: unknown): number {
  const page = Number(raw);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(200, Math.floor(page));
}

export function absoluteOrigin(req: Request): string {
  const origin = process.env.APP_ORIGIN;
  if (origin) return origin.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
