/**
 * Share links carry the channel that sent the visitor. Chat apps and social
 * feeds routinely strip the referrer, so without an explicit tag a Reddit or
 * WhatsApp visitor lands in the traffic panel as "Direct or unknown". The API
 * already prefers an explicit campaign slug over the referring host, and it
 * validates the slug before writing it, so the only job here is to tag the
 * links the app itself hands out.
 */
/**
 * Slugs must be 2–40 lowercase characters: the API's campaign pattern rejects
 * anything shorter, so "x" would be dropped and the visit would fall back to the
 * referrer host. X is tagged as "twitter" for that reason.
 */
export type ShareChannel = 'twitter' | 'whatsapp' | 'reddit' | 'copy' | 'native' | 'profile';

/** Absolute URL for a route, tagged with the channel that shared it. */
export function shareLink(route: string, channel: ShareChannel): string {
  const path = route.replace(/^\/+/, '');
  const url = new URL(`${import.meta.env.BASE_URL}${path}`, window.location.origin);
  url.searchParams.set('utm_source', channel);
  return url.toString();
}

/** How a tagged channel reads in the admin traffic panel. */
export const CHANNEL_LABELS: Record<string, string> = {
  twitter: 'Shared to X',
  whatsapp: 'Shared to WhatsApp',
  reddit: 'Shared to Reddit',
  copy: 'Copied link',
  native: 'Share sheet',
  profile: 'Profile link',
};
