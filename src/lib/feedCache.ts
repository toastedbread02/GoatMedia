import type { VideoDTO } from '../../shared/types.ts';

export interface CachedFeed {
  items: VideoDTO[];
  page: number;
  hasMore: boolean;
  activeIndex: number;
  scrollTop: number;
}

const cache = new Map<string, CachedFeed>();

export function getCachedFeed(key: string): CachedFeed | undefined {
  return cache.get(key);
}

export function setCachedFeed(key: string, value: CachedFeed) {
  cache.set(key, value);
}

export function patchCachedFeed(key: string, patch: Partial<CachedFeed>) {
  const existing = cache.get(key);
  if (existing) cache.set(key, { ...existing, ...patch });
}

export function removeVideoFromCaches(videoId: string) {
  for (const [key, value] of cache) {
    const items = value.items.filter((item) => item.id !== videoId);
    if (items.length !== value.items.length) {
      cache.set(key, { ...value, items, activeIndex: Math.min(value.activeIndex, Math.max(0, items.length - 1)) });
    }
  }
}

export function clearFeedCache() {
  cache.clear();
}
