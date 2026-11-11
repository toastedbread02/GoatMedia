/**
 * The gap. Every opening of the dump leaves the time behind, and the next one
 * gets back the readings that were taken between them: one every forty-seven
 * minutes, which is nobody's browsing rhythm; a short absence gets one reading from
the middle of it.
 *
 * Nothing here is sent anywhere. It is the page keeping its own log of when it
 * was last looked at, so it can describe the time it spent being looked at by
 * something else.
 */

const KEY = 'gm-arg-d1-gap';
/** Less time than this away and nothing was reading. */
const MIN_GAP = 2 * 60_000;
/** How far apart the readings are. */
const STEP = 47 * 60_000;
/** At most this many come back at once. */
const MAX = 4;

export interface Gap {
  /** Timestamps of the readings taken while the reader was away. */
  rows: number[];
  /** How long the reader was gone, in milliseconds. */
  away: number;
}

export function noteGap(now = Date.now()): Gap {
  let last: number | null = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    last = raw === null ? null : Number(raw);
  } catch {
    last = null;
  }

  let rows: number[] = [];
  let away = 0;
  if (last !== null && Number.isFinite(last) && now > last) {
    away = now - last;
    if (away >= STEP) {
      for (let at = last + STEP; at < now; at += STEP) rows.push(at);
      rows = rows.slice(-MAX);
    } else if (away >= MIN_GAP) {
      // Too short for a rhythm, long enough to have been read once.
      rows.push(last + Math.floor(away / 2));
    }
  }

  try {
    window.localStorage.setItem(KEY, String(now));
  } catch {
    /* the page works without a memory */
  }

  return { rows, away };
}
