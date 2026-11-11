/**
 * The trail the reader actually walked, kept in this browser only. The dump
 * uses it to show previous visits, so the table fills with the pages they were
 * on rather than with the one page that writes to it.
 */

const KEY = 'gm-arg-trail';
const MAX = 12;

export interface TrailEntry {
  path: string;
  at: number;
}

export function readTrail(): TrailEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is TrailEntry =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as TrailEntry).path === 'string' &&
          typeof (item as TrailEntry).at === 'number',
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Called on every route change; consecutive hits on one path collapse. */
export function recordTrail(path: string) {
  const trail = readTrail();
  const latest = trail[0];
  if (latest && latest.path === path && Date.now() - latest.at < 1500) return;
  const next = [{ path, at: Date.now() }, ...trail].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private browsing: the dump still shows this visit while it is open */
  }
}
