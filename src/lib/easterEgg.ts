import type { CommentDTO, CreatorSummary, PublicUser, VideoDTO } from '../../shared/types.ts';
import { timeAgo } from './format.ts';

/**
 * One post that only exists in the browser, unlocked by pulling the feed up
 * fifteen times. Nothing here is served by the API, so none of it can appear in
 * a feed request, a search, a sitemap or the moderation queue.
 *
 * It is one thread of a longer trail: the feed post, a post behind it that is
 * only reachable by path, a profile that lists the same clip twice, and a day
 * that does not exist. The surface stays quiet; the connections are for whoever
 * opens the elements panel or reads the thread closely.
 */

const REFRESH_TARGET = 15;
const DAY_MS = 86_400_000;
const CREATOR_ID = 'usr_0000000000000000';
const MARLOWE = 'marlowe_farm';

const PUBLISHED_AT = Date.now() - 1298 * DAY_MS;

const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`;

const creatorSummary = (username: string, displayName: string): CreatorSummary => ({
  id: `usr_seed_${username}`,
  username,
  displayName,
  avatarUrl: null,
  isFollowing: false,
  isSelf: false,
  isBlocked: false,
  isModerator: false,
});

const marlowe = creatorSummary(MARLOWE, 'Marlowe');
const june = creatorSummary('june_b', 'June');

interface SeedComment {
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

const commentId = (prefix: string, index: number) => `cmt_${prefix}${String(index).padStart(3, '0')}`;

function buildThread(prefix: string, publishedAt: number, seeds: SeedComment[]): CommentDTO[] {
  return seeds.map((seed, index) => ({
    id: commentId(prefix, index),
    body: seed.body,
    createdAt: publishedAt + seed.after * 60_000,
    parentId: seed.replyTo === undefined ? null : commentId(prefix, seed.replyTo),
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
}

function buildVideo(entry: {
  id: string;
  caption: string;
  creator: CreatorSummary;
  createdAt: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}): VideoDTO {
  return {
    id: entry.id,
    kind: 'video',
    caption: entry.caption,
    category: 'farm-life',
    categoryLabel: 'Farm life',
    hashtags: [],
    duration: 16,
    createdAt: entry.createdAt,
    publishedAt: entry.createdAt,
    viewCount: entry.viewCount,
    likeCount: entry.likeCount,
    commentCount: entry.commentCount,
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
    creator: entry.creator,
    reason: null,
    credit: null,
    watchProgress: null,
    notInterested: false,
  };
}

/**
 * The thread is where it gets uncomfortable. The sceptics are reasonable and
 * loud; the things that do not add up are small enough to argue away, and every
 * one of them is answered by somebody who has a perfectly normal explanation.
 */
const DAY_NINE_THREAD: SeedComment[] = [
  {
    name: 'Marlowe',
    handle: MARLOWE,
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
    handle: MARLOWE,
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
    handle: MARLOWE,
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
    handle: MARLOWE,
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
    handle: MARLOWE,
    body: 'please stop posting this',
    after: 468,
    likes: 2,
  },
  {
    name: 'm.',
    handle: MARLOWE,
    body: 'the other one is still up. /v/pst_1298d00000000008',
    after: 470,
    likes: 1,
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
    handle: MARLOWE,
    body: 'no.',
    after: 644,
    likes: 11,
    creator: true,
    replyTo: 19,
  },
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'goats do this. they just stand there. it is fine',
    after: 733,
    likes: 4,
  },
];

const DAY_EIGHT_THREAD: SeedComment[] = [
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'this is the same clip as the other one lol',
    after: 30,
    likes: 21,
  },
  {
    name: 'danny',
    handle: 'dannyov',
    body: 'it is literally the same file',
    after: 90,
    likes: 9,
  },
  {
    name: 'Marlowe',
    handle: MARLOWE,
    body: 'no.',
    after: 96,
    likes: 3,
    creator: true,
    replyTo: 1,
  },
  {
    name: 'wildfern',
    handle: 'wildfern',
    body: 'where is day 7',
    after: 300,
    likes: 12,
  },
];

const CAMERA_ROLL_THREAD: SeedComment[] = [
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'you should delete this',
    after: 40,
    likes: 18,
  },
  {
    name: 'June',
    handle: 'june_b',
    body: 'i tried',
    after: 52,
    likes: 7,
    creator: true,
    replyTo: 0,
  },
  {
    name: 'danny',
    handle: 'dannyov',
    body: 'what farm is that',
    after: 140,
    likes: 3,
  },
];

export interface ArgTrace {
  /** What the page calls itself in the elements panel. */
  label: string;
  /** The line that sits next to it, in the console and in the markup. */
  note: string;
}

export interface ArgEntry {
  video: VideoDTO;
  comments: CommentDTO[];
  trace: ArgTrace;
  /** A path this post quietly points at, present in the page but invisible. */
  ghost?: string;
}

const DAY_NINE = buildVideo({
  id: 'pst_1298d00000000009',
  caption:
    "day 9. gate is open every morning. it's shut by the time i get back with the camera. i'm not walking back for it any more.",
  creator: marlowe,
  createdAt: PUBLISHED_AT,
  viewCount: 1983752,
  likeCount: 232,
  commentCount: 232,
});

const DAY_EIGHT = buildVideo({
  id: 'pst_1298d00000000008',
  caption: 'day 8. camera says 6:40. it is not 6:40.',
  creator: marlowe,
  createdAt: PUBLISHED_AT - DAY_MS,
  viewCount: 8407,
  likeCount: 96,
  commentCount: 96,
});

const CAMERA_ROLL = buildVideo({
  id: 'pst_1298d00000000011',
  caption: 'this was in my camera roll this morning. i have never been to this farm.',
  creator: june,
  createdAt: PUBLISHED_AT + 1295 * DAY_MS,
  viewCount: 312,
  likeCount: 23,
  commentCount: 23,
});

export const EGG_POSTS: Record<string, ArgEntry> = {
  [DAY_NINE.id]: {
    video: DAY_NINE,
    comments: buildThread('1298d', DAY_NINE.createdAt, DAY_NINE_THREAD),
    trace: { label: 'day 9', note: 'the gate is open in the morning' },
    ghost: `/v/${DAY_EIGHT.id}`,
  },
  [DAY_EIGHT.id]: {
    video: DAY_EIGHT,
    comments: buildThread('1298e', DAY_EIGHT.createdAt, DAY_EIGHT_THREAD),
    trace: { label: 'day 8', note: 'camera clock is 35 minutes behind' },
    ghost: '/v/pst_1298d00000000007',
  },
  [CAMERA_ROLL.id]: {
    video: CAMERA_ROLL,
    comments: buildThread('1298f', CAMERA_ROLL.createdAt, CAMERA_ROLL_THREAD),
    trace: { label: 'day 9', note: 'the file name is 9' },
    ghost: `/u/${MARLOWE}`,
  },
};

export interface ArgProfile {
  user: PublicUser;
  postIds: string[];
  trace: ArgTrace;
}

const profile = (entry: {
  username: string;
  displayName: string;
  bio: string;
  joined: string;
  followers: number;
  following: number;
  videoCount: number;
  postIds: string[];
  trace: ArgTrace;
}): ArgProfile => ({
  user: {
    id: `usr_seed_${entry.username}`,
    username: entry.username,
    displayName: entry.displayName,
    bio: entry.bio,
    avatarUrl: null,
    createdAt: new Date(entry.joined).getTime(),
    followerCount: entry.followers,
    followingCount: entry.following,
    videoCount: entry.videoCount,
    isFollowing: false,
    isSelf: false,
    isBlocked: false,
    status: 'active',
  },
  postIds: entry.postIds,
  trace: entry.trace,
});

export const EGG_PROFILES: Record<string, ArgProfile> = {
  [MARLOWE]: profile({
    username: MARLOWE,
    displayName: 'Marlowe',
    bio: 'goats. gate. the usual.',
    joined: '2019-03-04',
    followers: 118,
    following: 41,
    videoCount: 46,
    postIds: [DAY_NINE.id, DAY_EIGHT.id],
    trace: { label: 'marlowe', note: '46 posts, two visible' },
  }),
  june_b: profile({
    username: 'june_b',
    displayName: 'June',
    bio: 'not looking for anything',
    joined: '2023-08-19',
    followers: 4,
    following: 12,
    videoCount: 3,
    postIds: [CAMERA_ROLL.id],
    trace: { label: 'june', note: 'she tried' },
  }),
  'priya.builds': profile({
    username: 'priya.builds',
    displayName: 'Priya',
    bio: 'not an arg. i just like goats.',
    joined: '2021-11-02',
    followers: 902,
    following: 63,
    videoCount: 0,
    postIds: [],
    trace: { label: 'priya', note: 'not an arg' },
  }),
};

/** The post that opens the feed, and the thread underneath it. */
export const EGG_VIDEO = DAY_NINE;
export const EGG_COMMENTS = EGG_POSTS[DAY_NINE.id].comments;

export function argPost(id: string | null | undefined): ArgEntry | null {
  return id ? EGG_POSTS[id] ?? null : null;
}

export function argComments(id: string): CommentDTO[] {
  return EGG_POSTS[id]?.comments ?? [];
}

export function argTrace(id: string | null | undefined): ArgTrace | null {
  return id ? EGG_POSTS[id]?.trace ?? null : null;
}

export function argGhost(id: string | null | undefined): string | null {
  return id ? EGG_POSTS[id]?.ghost ?? null : null;
}

export function argProfile(username: string | null | undefined): ArgProfile | null {
  return username ? EGG_PROFILES[username] ?? null : null;
}

/** True for every post on this trail, not just the one the feed opens with. */
export function isEgg(id: string | null | undefined): boolean {
  return Boolean(id && EGG_POSTS[id]);
}

/** Every account on the site, ordinary or not, has the same kind of address. */
export function profilePath(username: string): string {
  return `/u/${username}`;
}

/**
 * The age is stated in days rather than derived into weeks: it is the only place
 * the feed counts days, and this post is older than anything else in it.
 */
export function postAge(video: VideoDTO): string {
  if (!isEgg(video.id)) return timeAgo(video.publishedAt ?? video.createdAt);
  return `${Math.round((Date.now() - video.createdAt) / DAY_MS)}d ago`;
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
