// Video chunks do not fit in one free database, so they are spread across the
// MEDIA_n bindings and every upload remembers which shard holds its bytes.
// The main database keeps the metadata, photos, sounds and avatars; shard 0 is
// the main database itself, where chunks written before sharding still live.

import { Env } from './lib';

/** Shard used by every upload created before chunk sharding existed. */
export const MAIN_SHARD = 0;
const MAX_SHARD = 32;

export function shardBinding(env: Env, shard: number): D1Database | null {
  if (shard === MAIN_SHARD) return env.DB;
  const binding = (env as unknown as Record<string, D1Database | undefined>)[`MEDIA_${shard}`];
  return binding ?? null;
}

/** The main database keeps its original table name. */
export function chunkTable(shard: number): string {
  return shard === MAIN_SHARD ? 'upload_chunks' : 'media_chunks';
}

/** Shards that are actually bound, so a config change cannot orphan a write. */
export function availableShards(env: Env): number[] {
  const shards: number[] = [];
  for (let shard = 1; shard <= MAX_SHARD; shard += 1) {
    if (shardBinding(env, shard)) shards.push(shard);
  }
  return shards;
}

/**
 * Least-full shard, measured from the sizes recorded in the main database. The
 * main database is never chosen, so existing chunks stay put and it stops
 * growing. Without any bound shard this falls back to the old behaviour.
 */
export async function pickShard(env: Env): Promise<number> {
  const shards = availableShards(env);
  if (!shards.length) return MAIN_SHARD;

  const rows = await env.DB.prepare(
    'SELECT shard, COALESCE(SUM(size), 0) AS bytes FROM uploads WHERE shard != 0 GROUP BY shard',
  ).all<{ shard: number; bytes: number }>();
  const used = new Map<number, number>();
  for (const row of rows.results || []) used.set(row.shard, row.bytes);

  let best = shards[0];
  let bestBytes = used.get(best) ?? 0;
  for (const shard of shards.slice(1)) {
    const bytes = used.get(shard) ?? 0;
    if (bytes < bestBytes) {
      best = shard;
      bestBytes = bytes;
    }
  }
  return best;
}

/**
 * Removes chunk rows from the shards that hold them. The main database is
 * skipped because its foreign key already cascades from uploads, and a shard
 * that is no longer bound is reported rather than silently leaking bytes.
 */
export async function dropShardChunks(
  env: Env,
  uploads: { id: string; shard: number }[],
): Promise<number> {
  const byShard = new Map<number, string[]>();
  for (const upload of uploads) {
    if (upload.shard === MAIN_SHARD) continue;
    const list = byShard.get(upload.shard) ?? [];
    list.push(upload.id);
    byShard.set(upload.shard, list);
  }

  let removed = 0;
  for (const [shard, ids] of byShard) {
    const db = shardBinding(env, shard);
    if (!db) continue;
    for (let i = 0; i < ids.length; i += 40) {
      const slice = ids.slice(i, i + 40);
      const result = await db
        .prepare(`DELETE FROM media_chunks WHERE upload_id IN (${slice.map(() => '?').join(',')})`)
        .bind(...slice)
        .run();
      removed += result.meta.changes || 0;
    }
  }
  return removed;
}
