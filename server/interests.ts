import { get, run } from './db.ts';
import { interactionWeights, interestRules } from './config.ts';
import { parseTags } from './videoRows.ts';

type EventType = 'complete' | 'rewatch' | 'skip' | 'not_interested';

const eventWeight: Record<EventType, number> = {
  complete: interactionWeights.complete,
  rewatch: interactionWeights.rewatch,
  skip: interactionWeights.skip,
  not_interested: interactionWeights.notInterested,
};

/**
 * Interests are stored per category and hashtag. We clamp each entry so a
 * single binge cannot permanently flatten the feed, and decay is applied when
 * scoring rather than by rewriting rows.
 */
function bumpInterest(userId: string, kind: 'category' | 'hashtag', value: string, delta: number) {
  const existing = get<{ weight: number }>(
    `SELECT weight FROM interests WHERE user_id = ? AND kind = ? AND value = ?`,
    userId,
    kind,
    value,
  );
  const next = Math.max(
    -interestRules.maxAbsWeight,
    Math.min(interestRules.maxAbsWeight, (existing?.weight ?? 0) + delta),
  );
  if (next === 0 && !existing) return;
  run(
    `INSERT INTO interests (user_id, kind, value, weight, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind, value) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
    userId,
    kind,
    value,
    next,
    Date.now(),
  );
}

export function applyVideoInterest(userId: string, videoId: string, weight: number) {
  const video = get<{ category: string; hashtags: string }>(
    `SELECT category, hashtags FROM videos WHERE id = ?`,
    videoId,
  );
  if (!video) return;
  bumpInterest(userId, 'category', video.category, weight * interestRules.categoryMultiplier);
  for (const tag of parseTags(video.hashtags)) {
    bumpInterest(userId, 'hashtag', tag, weight * interestRules.hashtagMultiplier);
  }
}

/**
 * Records a signal at most once per (user, video, type) — the unique index in
 * the database is what keeps repeated taps or reloads from inflating a score.
 */
export function recordEvent(userId: string, videoId: string, type: EventType): boolean {
  const result = run(
    `INSERT OR IGNORE INTO video_events (user_id, video_id, type, created_at) VALUES (?, ?, ?, ?)`,
    userId,
    videoId,
    type,
    Date.now(),
  );
  if (!result.changes) return false;
  applyVideoInterest(userId, videoId, eventWeight[type]);
  return true;
}

export function undoEvent(userId: string, videoId: string, type: EventType): boolean {
  const result = run(
    `DELETE FROM video_events WHERE user_id = ? AND video_id = ? AND type = ?`,
    userId,
    videoId,
    type,
  );
  if (!result.changes) return false;
  applyVideoInterest(userId, videoId, -eventWeight[type]);
  return true;
}

export interface InterestEntry {
  kind: 'category' | 'hashtag';
  value: string;
  weight: number;
  updated_at: number;
}

/** Decayed, normalized interest used by the scorer. */
export function decayedInterest(entry: InterestEntry | undefined): number {
  if (!entry) return 0;
  const ageDays = Math.max(0, (Date.now() - entry.updated_at) / 86_400_000);
  const decay = Math.pow(0.5, ageDays / interestRules.decayHalfLifeDays);
  const normalized = entry.weight / (1 + Math.abs(entry.weight) / 25);
  return Math.max(-1.6, Math.min(1.6, normalized * decay));
}
