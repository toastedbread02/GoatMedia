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
  /** Trail posts bring their own file; the feed post uses the one it always had. */
  videoFile?: string;
  posterFile?: string;
  duration?: number;
}): VideoDTO {
  return {
    id: entry.id,
    kind: 'video',
    caption: entry.caption,
    category: 'farm-life',
    categoryLabel: 'Farm life',
    hashtags: [],
    duration: entry.duration ?? 16,
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
    posterUrl: asset(entry.posterFile ?? '9-poster.jpg'),
    videoUrl: asset(entry.videoFile ?? '9.mp4'),
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

/** A photo post: the slide order is the only order it has. */
function buildPhotos(entry: {
  id: string;
  caption: string;
  creator: CreatorSummary;
  createdAt: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  files: string[];
}): VideoDTO {
  const photos = entry.files.map((file, index) => ({
    id: `${entry.id}_ph${index}`,
    url: asset(file),
    width: null,
    height: null,
  }));
  return {
    ...buildVideo(entry),
    kind: 'photos',
    photos,
    posterUrl: photos[0]?.url ?? null,
    videoUrl: null,
    duration: 0,
    width: null,
    height: null,
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
    name: 'June',
    handle: 'june_b',
    body: 'i have this on my phone too',
    after: 120,
    likes: 4,
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
  {
    name: 'Marlowe',
    handle: MARLOWE,
    body: 'you were there.',
    after: 150,
    likes: 5,
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
  /** Paths this post quietly points at, present in the page but invisible. */
  ghosts?: string[];
  /** What the browser tab calls the page, when it disagrees with the caption. */
  tabTitle?: string;
  /**
   * When set, the page only exists for a visitor who arrives carrying
   * ?t=<key>. Without it the id is just another post the API has never heard of.
   */
  key?: string;
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

const DAY_TEN = buildVideo({
  id: 'pst_1298d00000000010',
  caption: 'day 10. i checked the card. it is empty until tomorrow.',
  creator: marlowe,
  createdAt: PUBLISHED_AT + DAY_MS,
  // Fewer views than comments. Nobody has watched it and three people have
  // written under it, which is the kind of thing that only lands later.
  viewCount: 2,
  likeCount: 0,
  commentCount: 3,
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

const DAY_TEN_THREAD: SeedComment[] = [
  {
    name: 'June',
    handle: 'june_b',
    body: 'that is my phone',
    after: 22,
    likes: 0,
  },
  {
    name: 'Marlowe',
    handle: MARLOWE,
    body: 'i know.',
    after: 25,
    likes: 0,
    creator: true,
    replyTo: 0,
  },
  {
    name: 'm.',
    handle: MARLOWE,
    body: 'you found it',
    after: 26,
    likes: 0,
  },
];

const CARD_THREAD: SeedComment[] = [
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'these are keying plates. nobody is filming a farm',
    after: 40,
    likes: 14,
  },
  {
    name: 'June',
    handle: 'june_b',
    body: 'the green one is the colour of the top field',
    after: 62,
    likes: 6,
  },
  {
    name: 'Marlowe',
    handle: MARLOWE,
    body: 'no.',
    after: 70,
    likes: 1,
    creator: true,
    replyTo: 1,
  },
  {
    name: 'danny',
    handle: 'dannyov',
    body: 'why are there no goats on a goat app',
    after: 90,
    likes: 3,
  },
];

const SEVENTH_THREAD: SeedComment[] = [
  {
    name: 'June',
    handle: 'june_b',
    body: 'there is no picture',
    after: 18,
    likes: 2,
  },
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'it is sensor noise. this is what a camera does in the dark',
    after: 35,
    likes: 9,
  },
  {
    name: 'Marlowe',
    handle: MARLOWE,
    body: 'it is the gate',
    after: 40,
    likes: 0,
    creator: true,
    replyTo: 1,
  },
];

const CARD = buildPhotos({
  id: 'pst_1298d00000000012',
  caption: 'day 11. the card was not empty. five files, in this order.',
  creator: marlowe,
  createdAt: PUBLISHED_AT + 2 * DAY_MS,
  viewCount: 6,
  likeCount: 3,
  commentCount: 4,
  files: [
    'arg/1000017640.jpg',
    'arg/1000017642.jpg',
    'arg/1000017643.jpg',
    'arg/1000017644.jpg',
    'arg/1000017645.jpg',
  ],
});

const SEVENTH = buildVideo({
  id: 'pst_1298d00000000014',
  caption: 'the seventh file. the camera stopped by itself. i did not delete it.',
  creator: marlowe,
  createdAt: PUBLISHED_AT - 2 * DAY_MS,
  viewCount: 41,
  likeCount: 0,
  commentCount: 3,
  videoFile: 'arg/1000017641.mp4',
  posterFile: 'arg/1000017640.jpg',
  duration: 8.66,
});

const EXPORT_THREAD: SeedComment[] = [
  {
    name: 'June',
    handle: 'june_b',
    body: 'the edge is showing',
    after: 20,
    likes: 5,
  },
  {
    name: 'Priya',
    handle: 'priya.builds',
    body: 'this is a render test. every editor does this',
    after: 44,
    likes: 11,
  },
  {
    name: 'Marlowe',
    handle: MARLOWE,
    body: 'i know',
    after: 52,
    likes: 2,
    creator: true,
    replyTo: 1,
  },
  {
    name: 'danny',
    handle: 'dannyov',
    body: 'so the field is a plate',
    after: 70,
    likes: 7,
  },
];

const EXPORT = buildVideo({
  id: 'pst_1298d00000000015',
  caption: 'the export. i turned the key off so you can see where the clip ends.',
  creator: marlowe,
  createdAt: PUBLISHED_AT + 3 * DAY_MS,
  viewCount: 12,
  likeCount: 1,
  commentCount: 4,
  videoFile: 'arg/export_09.mp4',
  posterFile: 'arg/export_09_poster.jpg',
  duration: 12,
});

export const EGG_POSTS: Record<string, ArgEntry> = {
  [DAY_NINE.id]: {
    video: DAY_NINE,
    comments: buildThread('1298d', DAY_NINE.createdAt, DAY_NINE_THREAD),
    trace: { label: 'day 9', note: 'the gate is open in the morning' },
    ghosts: [`/v/${DAY_EIGHT.id}`],
  },
  [DAY_EIGHT.id]: {
    video: DAY_EIGHT,
    comments: buildThread('1298e', DAY_EIGHT.createdAt, DAY_EIGHT_THREAD),
    // The clock is the only key on the trail, and it is stated here instead of
    // on the page it opens.
    trace: { label: 'day 8', note: 'camera clock is 35 minutes behind · 06:40' },
    ghosts: ['/v/pst_1298d00000000007', `/v/${DAY_TEN.id}?t=0640`],
  },
  [DAY_TEN.id]: {
    video: DAY_TEN,
    comments: buildThread('129a0', DAY_TEN.createdAt, DAY_TEN_THREAD),
    trace: { label: 'day 10', note: 'the file is dated tomorrow' },
    ghosts: [`/u/${MARLOWE}`, `/v/${CARD.id}`],
    key: '0640',
    tabTitle: '9',
  },
  [CARD.id]: {
    video: CARD,
    comments: buildThread('129b0', CARD.createdAt, CARD_THREAD),
    trace: { label: 'day 11', note: 'five plates, no goats' },
    ghosts: [`/v/${SEVENTH.id}`, `/v/${EXPORT.id}`],
  },
  [SEVENTH.id]: {
    video: SEVENTH,
    comments: buildThread('129c0', SEVENTH.createdAt, SEVENTH_THREAD),
    trace: { label: 'day 7', note: 'the file, not the post' },
    ghosts: [`/u/${MARLOWE}`],
  },
  [EXPORT.id]: {
    video: EXPORT,
    comments: buildThread('129d0', EXPORT.createdAt, EXPORT_THREAD),
    trace: { label: 'export', note: 'the edge is at 0:11' },
    ghosts: [`/v/${DAY_NINE.id}`],
  },
  [CAMERA_ROLL.id]: {
    video: CAMERA_ROLL,
    comments: buildThread('1298f', CAMERA_ROLL.createdAt, CAMERA_ROLL_THREAD),
    trace: { label: 'day 9', note: 'the file name is 9' },
    ghosts: [`/u/${MARLOWE}`],
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
    postIds: [DAY_NINE.id, DAY_EIGHT.id, CARD.id, SEVENTH.id, EXPORT.id],
    trace: { label: 'marlowe', note: '46 posts, five visible' },
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

/** With no search, a keyed page does not exist at all. */
export function argPost(id: string | null | undefined, search = ''): ArgEntry | null {
  const entry = id ? EGG_POSTS[id] ?? null : null;
  if (!entry) return null;
  if (!entry.key) return entry;
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  return params.get('t') === entry.key ? entry : null;
}

export function argComments(id: string): CommentDTO[] {
  return EGG_POSTS[id]?.comments ?? [];
}

export function argTrace(id: string | null | undefined): ArgTrace | null {
  return id ? EGG_POSTS[id]?.trace ?? null : null;
}

export function argGhosts(id: string | null | undefined): string[] {
  return id ? EGG_POSTS[id]?.ghosts ?? [] : [];
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
