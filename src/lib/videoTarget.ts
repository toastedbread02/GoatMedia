// The one place that decides what "small enough to keep" means for a clip.
// It lives in its own module so the upload form can apply the rule without
// pulling the codec library into the page load.

/** Short edge of every encoded clip: 720×1280 portrait, 1280×720 landscape. */
export const ENCODE_SHORT_EDGE = 720;

/**
 * True when a source is worth re-encoding: either it is over the server's byte
 * limit, or it carries more pixels than the 720p target. The few pixels of
 * slack absorbs cameras that report odd sizes like 721.
 */
export function shouldReencode(
  width: number,
  height: number,
  bytes: number,
  maxBytes: number,
): boolean {
  if (bytes > maxBytes) return true;
  const shortEdge = Math.min(width || 0, height || 0);
  return shortEdge > ENCODE_SHORT_EDGE + 8;
}
