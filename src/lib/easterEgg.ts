import type { CommentDTO, CreatorSummary, VideoDTO } from '../../shared/types.ts';
import { timeAgo } from './format.ts';

/**
 * One post that only exists in the browser, unlocked by pulling the feed up
 * fifteen times. Nothing about it is served by the API, so it can never appear
 * in a feed request, a search, a sitemap or the moderation queue.
 *
 * It is deliberately unremarkable: a normal account, a normal caption, a normal
 * comment thread. Everything odd about it is a thing a reader could also explain
 * away, which is the point.
 */

const REFRESH_TARGET = 15;

const DAYS_OLD = 1298;
const CREATOR_ID = 'usr_0000000000000000';

export const EGG_ID = 'pst_1298d00000000000';
const PUBLISHED_AT = Date.now() - DAYS_OLD * 86_400_000;

const creator: CreatorSummary = {
  id: CREATOR_ID,
  username: 'marlowe_farm',
  displayName: 'Marlowe',
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
  caption: "day 9 of the gate being open. it's shut again by the time i get back with the camera.",
  category: 'farm-life',
  categoryLabel: 'Farm life',
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

interface SeededComment {
  name: string;
  handle: string;
  body: string;
  /** Minutes after the post went up. */
  after: number;
  likes: number;
  creator?: boolean;
  pinned?: boolean;
}

/**
 * The thread is the puzzle. Nothing here says "ARG"; some readers notice the
 * likes and comments line up, or that the account is gone, and argue about it
 * with the ones who think it is just an old repost.
 */
const THREAD: SeededComment[] = [
  {
    name: 'Marlowe',
    handle: 'marlowe_farm',
    body: "it's not on my end.",
    after: 14,
    likes: 3,
    creator: true,
    pinned: true,
  },
  {
    name: 'Sam Okonkwo',
    handle: 'sam_okonkwo',
    body: 'why is this the first thing i see every time i open this app',
    after: 61,
    likes: 48,
  },
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'it is an old repost. the feed drags old stuff up when it runs out. not everything is an arg',
    after: 95,
    likes: 112,
  },
  {
    name: 'danny',
    handle: 'dannyov',
    body: 'ok but the likes and the comments are the exact same number',
    after: 143,
    likes: 67,
  },
  {
    name: 'Bea',
    handle: 'bea_goats',
    body: 'day 9 of what though',
    after: 210,
    likes: 39,
  },
  {
    name: 'tom h',
    handle: 'tomh4471',
    body: 'gate looks shut to me',
    after: 265,
    likes: 14,
  },
  {
    name: 'wildfern',
    handle: 'wildfern',
    body: 'he has not posted since this one, check the profile lol',
    after: 388,
    likes: 22,
  },
  {
    name: 'Ade',
    handle: 'ade.rt',
    body: 'i have reloaded like ten times and it keeps coming back to this one',
    after: 512,
    likes: 9,
  },
  {
    name: 'June',
    handle: 'june_b',
    body: 'sound is dead on mine, is that just me',
    after: 640,
    likes: 6,
  },
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'goats do this. they just stand there. it is fine',
    after: 733,
    likes: 4,
  },
];

export const EGG_COMMENTS: CommentDTO[] = THREAD.map((seed, index) => ({
  id: `cmt_1298d${String(index).padStart(3, '0')}`,
  body: seed.body,
  createdAt: PUBLISHED_AT + seed.after * 60_000,
  parentId: null,
  likeCount: seed.likes,
  liked: false,
  author: {
    id: seed.creator ? CREATOR_ID : `usr_seed_${seed.handle}`,
    username: seed.handle,
    displayName: seed.name,
    avatarUrl: null,
    isModerator: false,
  },
  canDelete: false,
  pinned: Boolean(seed.pinned),
  isPostAuthor: Boolean(seed.creator),
  canPin: false,
}));

export function isEgg(id: string | null | undefined): boolean {
  return id === EGG_ID;
}

/** Every account on the site, ordinary or not, has the same kind of address. */
export function profilePath(username: string): string {
  return `/u/${username}`;
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
