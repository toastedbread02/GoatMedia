import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env is optional.
}

const int = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const trimOrigin = (value: string) => value.trim().replace(/\/+$/, '');

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const PORT = int(process.env.PORT, 3001);
/** Where the website lives. Used for reset links and the cross-site allowlist. */
export const APP_ORIGIN = trimOrigin(process.env.APP_ORIGIN || 'http://localhost:5173');
/**
 * Public base URL of this API when the site is hosted somewhere else (GitHub
 * Pages, for example). Empty means the API and the site share an origin.
 */
export const API_ORIGIN = trimOrigin(process.env.API_ORIGIN || '');
/**
 * Cross-site cookies are only needed when the site and the API are on different
 * registrable domains. They are SameSite=None; Secure, which Safari's tracking
 * protection blocks — prefer serving the site from the API origin.
 */
export const crossSiteCookies = process.env.CROSS_SITE_COOKIES === '1';

export const allowedOrigins = new Set<string>([
  APP_ORIGIN,
  ...trimOrigin(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(trimOrigin)
    .filter(Boolean),
]);

/** Turns a stored `/media/...` or `/avatars/...` path into a URL the browser can load. */
export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  return API_ORIGIN ? `${API_ORIGIN}${path}` : path;
}
export const ROOT_DIR = ROOT;
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || '.data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const TEMP_DIR = path.join(DATA_DIR, 'tmp');
export const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
export const POSTER_DIR = path.join(DATA_DIR, 'posters');
export const DB_PATH = path.join(DATA_DIR, 'goatmedia.db');
export const DIST_DIR = path.join(ROOT, 'dist');

export const limits = {
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 200),
  maxDurationSeconds: int(process.env.MAX_DURATION_SECONDS, 180),
  minDurationSeconds: int(process.env.MIN_DURATION_SECONDS, 2),
  maxAvatarMb: int(process.env.MAX_AVATAR_MB, 4),
  maxCaptionLength: 300,
  maxBioLength: 200,
  maxCommentsPerMinute: 12,
  maxUploadsPerHour: 10,
  feedPageSize: 8,
  commentsPageSize: 20,
};

export const categories = [
  { id: 'baby-goats', label: 'Baby goats', blurb: 'Kids finding their legs' },
  { id: 'parkour', label: 'Goat parkour', blurb: 'Climbing, leaping, standing on things' },
  { id: 'farm-life', label: 'Farm life', blurb: 'Daily routines and barnyard characters' },
  { id: 'mountain-goats', label: 'Mountain goats', blurb: 'Wild herds, cliffs and altitude' },
  { id: 'goat-sounds', label: 'Goat sounds', blurb: 'Bleats, trills and other opinions' },
  { id: 'rescue-care', label: 'Rescue & care', blurb: 'Rehomed goats and good husbandry' },
];

export const categoryById = new Map(categories.map((c) => [c.id, c]));

/**
 * Starting weights for the interest model. Tune these as real usage data
 * arrives — they are intentionally plain numbers, not a trained model.
 */
export const interactionWeights = {
  complete: 5,
  rewatch: 6,
  like: 3,
  comment: 2,
  follow: 4,
  skip: -4,
  notInterested: -15,
} as const;

/**
 * Starting composition of the For You feed. Percentages must add up to 1.
 */
export const feedMix = {
  personalized: 0.8,
  discovery: 0.15,
  trending: 0.05,
} as const;

export const interestRules = {
  maxAbsWeight: 70,
  categoryMultiplier: 1,
  hashtagMultiplier: 0.7,
  decayHalfLifeDays: 30,
  recencyWindowDays: 7,
};

export const moderation = {
  // Manual review is the product rule, not a setting. Every upload waits for a human.
  mode: 'manual' as const,
};

export const resetLinkExposed =
  process.env.DEV_EXPOSE_RESET_LINK === '1' || (!IS_PRODUCTION && process.env.DEV_EXPOSE_RESET_LINK !== '0');

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, MEDIA_DIR, TEMP_DIR, AVATAR_DIR, POSTER_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
