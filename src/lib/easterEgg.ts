import type { CommentDTO, CreatorSummary, VideoDTO } from '../../shared/types.ts';
import { timeAgo } from './format.ts';

/**
 * One post that only exists in the browser, unlocked by pulling the feed up
 * fifteen times. Nothing about it is served by the API, so it can never appear
 * in a feed request, a search, a sitemap or the moderation queue.
 *
 * Nothing here announces itself. The caption is a man talking about a gate, the
 * thread is half people debunking it, and the wrongness is in small things that
 * do not line up: a reply about yesterday, a timestamp nobody can find, the same
 * handle wearing a different name, an account that is not there when you look.
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
  caption:
    "day 9. gate is open every morning. it's shut by the time i get back with the camera. i'm not walking back for it any more.",
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
  /** Written by the account that posted the video. */
  creator?: boolean;
  pinned?: boolean;
  /** Index of the comment this one answers. */
  replyTo?: number;
}

const commentId = (index: number) => `cmt_1298d${String(index).padStart(3, '0')}`;

/**
 * The thread is where it gets uncomfortable. The sceptics are reasonable and
 * loud; the things that do not add up are small enough to argue away, and every
 * one of them is answered by somebody who has a perfectly normal explanation.
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
    body: 'then why is the account gone',
    after: 120,
    likes: 31,
    replyTo: 2,
  },
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'accounts get deleted. people stop keeping goats. it is not a mystery',
    after: 128,
    likes: 44,
    replyTo: 2,
  },
  {
    name: 'danny',
    handle: 'dannyov',
    body: 'ok but the likes and the comments are the exact same number',
    after: 143,
    likes: 67,
  },
  {
    name: 'Marlowe',
    handle: 'marlowe_farm',
    body: 'they were not yesterday.',
    after: 149,
    likes: 18,
    creator: true,
    replyTo: 5,
  },
  {
    name: 'Ade',
    handle: 'ade.rt',
    body: 'same. it was the first video the first time too',
    after: 150,
    likes: 12,
    replyTo: 1,
  },
  {
    name: 'Bea',
    handle: 'bea_goats',
    body: 'day 9 of what though',
    after: 210,
    likes: 39,
  },
  {
    name: 'Marlowe',
    handle: 'marlowe_farm',
    body: 'of the gate.',
    after: 214,
    likes: 9,
    creator: true,
    replyTo: 8,
  },
  {
    name: 'Bea',
    handle: 'bea_goats',
    body: 'you said that the last time',
    after: 240,
    likes: 57,
    replyTo: 8,
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
    name: 'danny',
    handle: 'dannyov',
    body: 'that is what i mean',
    after: 395,
    likes: 8,
    replyTo: 12,
  },
  {
    name: 'June',
    handle: 'june_b',
    body: 'what is the shape in the doorway at 0:11',
    after: 430,
    likes: 26,
  },
  {
    name: 'Marlowe',
    handle: 'marlowe_farm',
    body: 'which one',
    after: 436,
    likes: 41,
    creator: true,
    replyTo: 14,
  },
  {
    name: 'June',
    handle: 'june_b',
    body: 'there is only one doorway',
    after: 452,
    likes: 19,
    replyTo: 14,
  },
  {
    name: 'm.',
    handle: 'marlowe_farm',
    body: 'please stop posting this',
    after: 475,
    likes: 2,
  },
  {
    name: 'June',
    handle: 'june_b',
    body: 'sound is dead on mine, is that just me',
    after: 640,
    likes: 6,
  },
  {
    name: 'Marlowe',
    handle: 'marlowe_farm',
    body: 'no.',
    after: 644,
    likes: 11,
    creator: true,
    replyTo: 18,
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
  id: commentId(index),
  body: seed.body,
  createdAt: PUBLISHED_AT + seed.after * 60_000,
  parentId: seed.replyTo === undefined ? null : commentId(seed.replyTo),
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
