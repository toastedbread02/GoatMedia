import type { CommentDTO, CreatorSummary, VideoDTO } from '../../shared/types.ts';
import { timeAgo } from './format.ts';

/**
 * One post that only exists in the browser, unlocked by pulling the feed up
 * fifteen times. Nothing about it is served by the API, so it can never appear
 * in a feed request, a search, a sitemap or the moderation queue.
 */

const REFRESH_TARGET = 15;

const DAYS_OLD = 1298;
const CREATOR_ID = 'usr_0000000000000000';

export const EGG_ID = 'pst_1298d00000000000';
const PUBLISHED_AT = Date.now() - DAYS_OLD * 86_400_000;

const creator: CreatorSummary = {
  id: CREATOR_ID,
  username: '?',
  displayName: '?',
  avatarUrl: null,
  isFollowing: false,
  isSelf: false,
  isBlocked: false,
  isModerator: false,
};

const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`;

export const EGG_VIDEO: VideoDTO = {
  id: EGG_ID,
  kind: 'video',
  caption: '?',
  category: '?',
  categoryLabel: '?',
  hashtags: [],
  duration: 16,
  createdAt: PUBLISHED_AT,
  publishedAt: PUBLISHED_AT,
  viewCount: 1983752,
  likeCount: 232,
  commentCount: 232,
  liked: false,
  saved: false,
  status: 'approved',
  rejectReason: null,
  removedReason: null,
  posterUrl: asset('9-poster.jpg'),
  videoUrl: asset('9.mp4'),
  photos: [],
  sound: null,
  width: 1920,
  height: 1080,
  creator,
  reason: null,
  credit: null,
  watchProgress: null,
  notInterested: false,
};

/** The same comment, from the same account, over and over. */
export const EGG_COMMENTS: CommentDTO[] = Array.from({ length: 32 }, (_, index) => ({
  id: `cmt_1298d${String(index).padStart(3, '0')}`,
  body: '?',
  createdAt: PUBLISHED_AT + index * 60_000,
  parentId: null,
  likeCount: 0,
  liked: false,
  author: { id: CREATOR_ID, username: '?', displayName: '?', avatarUrl: null, isModerator: false },
  canDelete: false,
  pinned: false,
  isPostAuthor: false,
  canPin: false,
}));

export function isEgg(id: string | null | undefined): boolean {
  return id === EGG_ID;
}

/**
 * The odd account has no page. Encoding the question mark keeps it a path
 * segment instead of letting the router read it as the start of a query.
 */
export function profilePath(username: string): string {
  return username === '?' ? '/u/%3F' : `/u/${username}`;
}

/** The age is stated, not derived: the rest of the feed reads in weeks. */
export function postAge(video: VideoDTO): string {
  return isEgg(video.id) ? `${DAYS_OLD}d ago` : timeAgo(video.publishedAt ?? video.createdAt);
}

/**
 * Counted in memory and never stored. A reload starts the count over and, more
 * importantly, cannot reveal the post on its own: it only ever arrives from a
 * refresh gesture made in the session that earned it. Navigating to another
 * feed tab mounts a fresh feed, so the post does not tag along there either.
 */
let pulls = 0;

/** Records one refresh gesture; true on the one that unlocks the post. */
export function countRefresh(): boolean {
  pulls += 1;
  if (pulls < REFRESH_TARGET) return false;
  pulls = 0;
  return true;
}
