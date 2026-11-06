// Interest model. Weights are plain, clamped numbers per category/hashtag and
// decay when they are read, so the feed drifts back to neutral if you stop
// watching something.

import { Env, now, uid } from './lib';
import { interactionWeights } from './config';

export type EventType = 'complete' | 'rewatch' | 'skip' | 'not_interested';

const eventWeight: Record<EventType, number> = {
  complete: interactionWeights.complete,
  rewatch: interactionWeights.rewatch,
  skip: interactionWeights.skip,
  not_interested: interactionWeights.notInterested,
};

export const interestRules = {
  maxAbsWeight: 70,
  categoryMultiplier: 1,
  hashtagMultiplier: 0.7,
  decayHalfLifeDays: 30,
  recencyWindowDays: 7,
};

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

async function bumpInterest(
  env: Env,
  userId: string,
  kind: 'category' | 'hashtag',
  value: string,
  delta: number,
) {
  const existing = await env.DB.prepare(
    'SELECT weight FROM interests WHERE user_id = ? AND kind = ? AND value = ?',
  )
    .bind(userId, kind, value)
    .first<{ weight: number }>();
  const next = Math.max(
    -interestRules.maxAbsWeight,
    Math.min(interestRules.maxAbsWeight, (existing?.weight ?? 0) + delta),
  );
  if (next === 0 && !existing) return;
  await env.DB.prepare(
    `INSERT INTO interests (user_id, kind, value, weight, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind, value) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
  )
    .bind(userId, kind, value, next, now())
    .run();
}

export type Signal = 'complete' | 'rewatch' | 'like' | 'comment' | 'follow' | 'skip' | 'not_interested';

const signalWeight: Record<Signal, number> = {
  complete: interactionWeights.complete,
  rewatch: interactionWeights.rewatch,
  like: interactionWeights.like,
  comment: interactionWeights.comment,
  follow: interactionWeights.follow,
  skip: interactionWeights.skip,
  not_interested: interactionWeights.notInterested,
};

/** Applies a one-off signal (a like, a comment, a follow) to the interest model. */
export async function applySignal(
  env: Env,
  userId: string,
  postId: string,
  signal: Signal,
  direction: 1 | -1 = 1,
) {
  await applyPostInterest(env, userId, postId, signalWeight[signal] * direction);
}

export async function applyPostInterest(
  env: Env,
  userId: string,
  postId: string,
  weight: number,
) {
  const post = await env.DB.prepare('SELECT category, hashtags FROM posts WHERE id = ?')
    .bind(postId)
    .first<{ category: string; hashtags: string }>();
  if (!post) return;
  await bumpInterest(env, userId, 'category', post.category, weight * interestRules.categoryMultiplier);
  for (const tag of parseTags(post.hashtags)) {
    await bumpInterest(env, userId, 'hashtag', tag, weight * interestRules.hashtagMultiplier);
  }
}

/**
 * Records one signal per (user, post, kind) per session window. The unique
 * insert is what stops repeated taps, reloads or a double-fired event from
 * inflating a score.
 */
export async function recordEvent(
  env: Env,
  userId: string,
  postId: string,
  type: EventType,
  value = 0,
): Promise<boolean> {
  const since = now() - 6 * 60 * 60 * 1000;
  const existing = await env.DB.prepare(
    'SELECT 1 AS n FROM post_events WHERE user_id = ? AND post_id = ? AND kind = ? AND created_at > ?',
  )
    .bind(userId, postId, type, since)
    .first<{ n: number }>();
  if (existing) return false;
  await env.DB.prepare(
    `INSERT INTO post_events (id, post_id, user_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(uid('ev'), postId, userId, type, value, now())
    .run();
  await applyPostInterest(env, userId, postId, eventWeight[type]);
  return true;
}

export async function undoEvent(env: Env, userId: string, postId: string, type: EventType) {
  const result = await env.DB.prepare(
    'DELETE FROM post_events WHERE user_id = ? AND post_id = ? AND kind = ?',
  )
    .bind(userId, postId, type)
    .run();
  if (!result.meta.changes) return false;
  await applyPostInterest(env, userId, postId, -eventWeight[type]);
  return true;
}

export interface InterestEntry {
  kind: 'category' | 'hashtag';
  value: string;
  weight: number;
  updated_at: number;
}

export function decayedInterest(entry: InterestEntry | undefined): number {
  if (!entry) return 0;
  const ageDays = Math.max(0, (now() - entry.updated_at) / 86_400_000);
  const decay = Math.pow(0.5, ageDays / interestRules.decayHalfLifeDays);
  const normalized = entry.weight / (1 + Math.abs(entry.weight) / 25);
  return Math.max(-1.6, Math.min(1.6, normalized * decay));
}
