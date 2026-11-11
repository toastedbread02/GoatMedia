import type { CommentDTO } from '../../shared/types.ts';

/**
 * The last stretch of the trail. The code appears on Marlowe's profile if you
 * stay on it long enough, it is also the password to a page that has no design,
 * and behind that page is a way to open the comments on day 10.
 *
 * Everything below the code is local. Nothing is checked by a server, because
 * there is no server for this part of the site.
 */

/** What the profile prints after five minutes, and what the login takes. */
export const ARG_CODE = '194738MARLOWE';
/** The username the login accepts. */
export const ARG_LOGIN_USER = 'pst_1298d00000000009';
/** The colour that makes day 10 answer. */
export const ARG_COLOR = '#3e635a';
/** Day 10 is the only post whose comments can be opened. */
export const ARG_DAY_TEN = 'pst_1298d00000000010';

const KEY = 'gm-arg-deadend';

export function isDayTenOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markDayTenOpen() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    /* the page still shows dead end without storage */
  }
}

const seedAuthor = (username: string, displayName: string): CommentDTO['author'] => ({
  id: `usr_seed_${username}`,
  username,
  displayName,
  avatarUrl: null,
  isModerator: false,
});

let local = 0;

/** A comment written on the page itself; there is nowhere to send it. */
export function localComment(
  body: string,
  parentId: string | null,
  user: { id: string; username: string; displayName: string; avatarUrl?: string | null } | null,
): CommentDTO {
  local += 1;
  const author: CommentDTO['author'] = user
    ? {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
        isModerator: false,
      }
    : seedAuthor('you', 'You');
  return {
    id: `cmt_local_${Date.now()}_${local}`,
    body,
    createdAt: Date.now(),
    parentId,
    likeCount: 0,
    liked: false,
    author,
    canDelete: true,
    pinned: false,
    isPostAuthor: false,
    canPin: false,
  };
}

const FLOOD = ['congrats', 'wow', '9'];
const VOICES: Array<[string, string]> = [
  ['sam_okonkwo', 'Sam Okonkwo'],
  ['priya.builds', 'Priya'],
  ['dannyov', 'danny'],
  ['wildfern', 'wildfern'],
  ['bea_goats', 'Bea'],
  ['tomh4471', 'tom h'],
  ['june_b', 'June'],
  ['ade.rt', 'Ade'],
];

/**
 * What arrives the moment the colour is posted: fifteen replies from the people
 * already in the thread, alternating congrats, wow and the number.
 */
export function floodReplies(parentId: string): CommentDTO[] {
  const now = Date.now();
  return Array.from({ length: 15 }, (_, index) => {
    const [username, displayName] = VOICES[index % VOICES.length];
    return {
      id: `cmt_flood_${now}_${index}`,
      body: FLOOD[index % FLOOD.length],
      createdAt: now + index,
      parentId,
      likeCount: index % 4,
      liked: false,
      author: seedAuthor(username, displayName),
      canDelete: false,
      pinned: false,
      isPostAuthor: username === 'june_b',
      canPin: false,
    };
  });
}
