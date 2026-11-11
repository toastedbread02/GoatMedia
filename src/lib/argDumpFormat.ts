/**
 * Column helpers for the dump pages. A database client pads by column, so these
 * do the same: pads to a width, right-aligns numbers, and shortens a user-agent
 * string to something that looks like a stored hash.
 */

export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const pad = (value: string | number, width: number) => String(value).padEnd(width);
export const num = (value: string | number, width: number) => String(value).padStart(width);
