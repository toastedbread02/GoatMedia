// Exercises the real Worker code with a D1 shim on top of node:sqlite.
// The Cloudflare runtime cannot start on this machine (workerd needs macOS
// 13.5+), so this is how the API gets verified locally before deploying.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../worker/index.ts';
import { sendMail } from '../worker/email.ts';
import type { Env } from '../worker/lib.ts';
import { quotasForPage } from '../worker/recommend.ts';

const DB = new DatabaseSync(':memory:');
const migrationsDir = new URL('../migrations/', import.meta.url);
for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
  DB.exec(readFileSync(new URL(file, migrationsDir), 'utf8'));
}

function normalize(params: unknown[]): unknown[] {
  return params.map((value) => {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value === undefined ? null : value;
  });
}

class Statement {
  sql: string;
  params: unknown[];
  constructor(sql: string, params: unknown[] = []) {
    this.sql = sql;
    this.params = params;
  }
  bind(...params: unknown[]) {
    return new Statement(this.sql, params);
  }
  async first<T>(column?: string): Promise<T | null> {
    const row = DB.prepare(this.sql).get(...(normalize(this.params) as never[])) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T | null;
    return row as T;
  }
  async all<T>() {
    const results = DB.prepare(this.sql).all(...(normalize(this.params) as never[])) as T[];
    return { results, success: true, meta: {} };
  }
  async run() {
    const info = DB.prepare(this.sql).run(...(normalize(this.params) as never[]));
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

class D1Shim {
  prepare(sql: string) {
    return new Statement(sql);
  }
  async batch(statements: Statement[]) {
    const out = [];
    for (const statement of statements) out.push(await statement.run());
    return out;
  }
  async exec(sql: string) {
    DB.exec(sql);
    return { count: 0, duration: 0 };
  }
}

/** What the fake vision model answers with; the tests set this per upload. */
let aiProbability = 0;
const aiCalls: number[] = [];

/** Every message the Worker tried to email, captured instead of sent. */
const outbox: { to: string; subject: string; text: string }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.includes('sendgrid') || url.includes('brevo') || url.includes('mailjet')) {
    const payload = JSON.parse(String(init?.body ?? '{}'));
    const message = payload.Messages?.[0];
    outbox.push({
      to: payload.personalizations?.[0]?.to?.[0]?.email ?? payload.to?.[0]?.email ?? message?.To?.[0]?.Email ?? '',
      subject: payload.subject ?? message?.Subject ?? '',
      text:
        payload.content?.find((part: { type: string }) => part.type === 'text/plain')?.value ??
        payload.textContent ??
        message?.TextPart ??
        '',
    });
    return new Response(url.includes('mailjet') ? JSON.stringify({ Messages: [{ Status: 'success' }] }) : '', { status: 202 });
  }
  return realFetch(input as never, init as never);
}) as typeof fetch;

const env = {
  DB: new D1Shim(),
  ALLOWED_ORIGINS: 'http://localhost:5173',
  PASSWORD_PEPPER: 'local-test-pepper',
  PASSWORD_ITERATIONS: '1000',
  ADMIN_SETUP_TOKEN: 'local-setup-code',
  SENDGRID_API_KEY: 'test-key',
  MAIL_FROM: 'moderator@example.com',
  MAIL_FROM_NAME: 'GoatMedia',
  AI: {
    async run() {
      aiCalls.push(aiProbability);
      return { answers: { gore: { noul: aiProbability } } };
    },
  },
} as unknown as Env;

const ORIGIN = 'http://localhost:8788';
let failures = 0;
let checks = 0;

function ok(condition: unknown, label: string, extra?: unknown) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : extra);
  }
}

async function call(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const request = new Request(`${ORIGIN}${path}`, { ...init, headers });
  const response = await worker.fetch(request, env);
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json')
    ? await response.json()
    : type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')
      ? await response.arrayBuffer()
      : await response.text();
  return { status: response.status, body, headers: response.headers };
}

// Minimal valid 1x1 PNG and JPEG so the magic-byte checks are real.
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function photoForm(
  photos: { bytes: Uint8Array; type: string }[],
  fields: Record<string, string>,
  audio?: { bytes: Uint8Array; type: string; name: string },
) {
  const form = new FormData();
  photos.forEach((photo, index) => {
    form.append('photos', new File([photo.bytes], `photo-${index}.${photo.type.split('/')[1]}`, { type: photo.type }));
  });
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (audio) form.append('audio', new File([audio.bytes], audio.name, { type: audio.type }));
  return form;
}

async function run() {
  console.log('\n[config]');
  const config = await call('/api/config');
  ok(config.status === 200 && config.body.limits.maxPhotos === 6, 'config is served');
  ok(config.body.categories.length === 6, 'six categories');
  ok(config.body.limits.maxVideoMb === 25, 'config advertises the video limit');
  ok(config.body.limits.maxDurationSeconds === 180, 'videos are limited to three minutes');
  ok(config.body.limits.warningLimit === 3, 'the warning limit is served to the app');
  ok(config.body.adminClaimable === true, 'a fresh server reports the moderator role as claimable');

  console.log('\n[accounts]');
  const a = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'ada@example.com',
      username: 'ada',
      displayName: 'Ada',
      password: 'correct-horse-battery',
      birthDate: '1994-04-12',
    }),
  });
  ok(a.status === 201 && a.body.token, 'first account registers', a.body);
  const tokenA = a.body.token;

  const b = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'bo@example.com',
      username: 'boaz',
      displayName: 'Boaz',
      password: 'correct-horse-battery',
      birthDate: '1990-09-03',
    }),
  });
  const tokenB = b.body.token;
  ok(b.status === 201, 'second account registers', b.body);

  const dup = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'other@example.com',
      username: 'ada',
      displayName: 'Ada Again',
      password: 'correct-horse-battery',
      birthDate: '1994-04-12',
    }),
  });
  ok(dup.status === 400 && /username is taken/i.test(dup.body.error), 'usernames cannot collide');

  const weak = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'w@example.com',
      username: 'weakling',
      displayName: 'W',
      password: 'short',
      birthDate: '1994-04-12',
    }),
  });
  ok(weak.status === 400, 'short passwords are rejected');

  const recent = new Date();
  recent.setUTCFullYear(recent.getUTCFullYear() - 9);
  const underage = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'kid@example.com',
      username: 'kid',
      displayName: 'Kid',
      password: 'correct-horse-battery',
      birthDate: recent.toISOString().slice(0, 10),
    }),
  });
  ok(underage.status === 400 && /at least 13/i.test(underage.body.error || ''), 'underage sign-ups are refused');

  const noBirthDate = await call('/api/auth/register', {
    method: 'POST',
    // A separate test IP: sign-ups are deliberately rate limited to five an hour.
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify({
      email: 'nodob@example.com',
      username: 'nodob',
      displayName: 'No Dob',
      password: 'correct-horse-battery',
    }),
  });
  ok(noBirthDate.status === 400, 'a date of birth is required');

  const badLogin = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'ada', password: 'wrong-password' }),
  });
  ok(badLogin.status === 400, 'wrong password is refused');

  const login = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'ada@example.com', password: 'correct-horse-battery' }),
  });
  ok(login.status === 200 && login.body.token, 'sign in works');

  const me = await call('/api/auth/me', { token: tokenA });
  ok(me.body.user?.username === 'ada' && me.body.user.role === 'user', 'me returns the account');

  console.log('\n[moderator claim]');
  const wrongClaim = await call('/api/admin/claim', {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'not-the-code' }),
  });
  ok(wrongClaim.status === 400, 'a wrong setup code cannot claim the role');
  const anonClaim = await call('/api/admin/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'local-setup-code' }),
  });
  ok(anonClaim.status === 401, 'claiming needs a signed-in account');
  const claim = await call('/api/admin/claim', {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'local-setup-code' }),
  });
  ok(claim.status === 200, 'the setup code grants the moderator role', claim.body);
  const claimedMe = await call('/api/auth/me', { token: tokenA });
  ok(claimedMe.body.user?.role === 'admin', 'the claimed account is now the moderator');
  const afterClaim = await call('/api/config');
  ok(afterClaim.body.adminClaimable === false, 'the role cannot be claimed twice');

  console.log('\n[pending uploads are private]');
  const created = await call('/api/posts', {
    method: 'POST',
    token: tokenA,
    body: photoForm(
      [
        { bytes: PNG, type: 'image/png' },
        { bytes: JPEG, type: 'image/jpeg' },
        { bytes: PNG, type: 'image/png' },
      ],
      {
        caption: 'Three kids on the log #babygoats #parkour',
        category: 'baby-goats',
        soundMode: 'none',
      },
    ),
  });
  ok(created.status === 201, 'post is accepted', created.body);
  const postId = created.body.post.id;
  ok(created.body.post.status === 'pending', 'new post is pending');
  ok(created.body.post.photos.length === 3, 'all three photos are stored');
  ok(created.body.post.hashtags.includes('babygoats'), 'hashtags are parsed from the caption');

  const anonDetail = await call(`/api/posts/${postId}`);
  ok(anonDetail.status === 404, 'pending post is invisible to guests');
  const otherDetail = await call(`/api/posts/${postId}`, { token: tokenB });
  ok(otherDetail.status === 404, 'pending post is invisible to other users');
  const ownerDetail = await call(`/api/posts/${postId}`, { token: tokenA });
  ok(ownerDetail.status === 200, 'owner can still see it');

  const photoId = created.body.post.photos[0].id;
  const anonPhoto = await call(`/media/photos/${photoId}`);
  ok(anonPhoto.status === 404, 'pending photo bytes are unreachable when guessed');
  const ownerPhoto = await call(`/media/photos/${photoId}`, { token: tokenA });
  ok(ownerPhoto.status === 200 && ownerPhoto.headers.get('cache-control')?.includes('no-store'), 'owner can preview their own pending photo');

  const anonFeed = await call('/api/feed?tab=foryou');
  ok(anonFeed.body.items.length === 0, 'pending posts never enter the feed');


  console.log('\n[moderation]');
  DB.prepare("UPDATE users SET role = 'admin' WHERE username = 'ada'").run();
  const adminLogin = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'ada', password: 'correct-horse-battery' }),
  });
  const adminToken = adminLogin.body.token;

  const bAdmin = await call('/api/admin/queue?status=pending', { token: tokenB });
  ok(bAdmin.status === 401, 'ordinary users cannot open the moderation queue');
  const bCounts = await call('/api/admin/counts');
  ok(bCounts.status === 401, 'admin counts need a session');

  const queue = await call('/api/admin/queue?status=pending', { token: adminToken });
  ok(queue.status === 200 && queue.body.items.length === 1, 'moderator sees the pending post');
  ok(queue.body.items[0].creatorEmail === 'ada@example.com', 'queue includes creator info');

  const approve = await call(`/api/admin/posts/${postId}/approve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  ok(approve.status === 200 && approve.body.status === 'approved', 'approve works');

  const liveFeed = await call('/api/feed?tab=foryou');
  ok(liveFeed.body.items.length === 1 && liveFeed.body.items[0].id === postId, 'approved post appears in the feed');
  const livePhoto = await call(`/media/photos/${photoId}`);
  ok(livePhoto.status === 200 && livePhoto.headers.get('content-type') === 'image/png', 'approved photos stream publicly');
  const guestView = await call(`/api/posts/${postId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'view' }),
  });
  ok(guestView.status === 200, 'signed-out view tracking does not fail');
  const served = new Uint8Array(livePhoto.body as ArrayBuffer);
  ok(
    served.length === PNG.length && served[0] === 0x89 && served[1] === 0x50,
    'served photo bytes are real image bytes, not a stringified blob',
    served.slice(0, 12),
  );

  const history = await call(`/api/admin/posts/${postId}`, { token: adminToken });
  ok(history.body.history.length === 2, 'moderation history records submit and approve');
  ok(history.body.history[0].action === 'approve', 'history is newest first');

  console.log('\n[daily pick]');
  const searched = await call('/api/admin/posts?status=approved&q=kids', { token: adminToken });
  ok(
    searched.status === 200 && searched.body.items.some((item: { id: string }) => item.id === postId),
    'the approved-post search finds a post by its caption',
  );
  const noMatch = await call('/api/admin/posts?status=approved&q=nanny', { token: adminToken });
  ok(noMatch.status === 200 && noMatch.body.items.length === 0, 'an unmatched search returns nothing');
  const setDaily = await call('/api/admin/daily', {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postId }),
  });
  ok(setDaily.status === 200, 'a photo album can be made goat of the day');
  const pinnedFeed = await call('/api/feed?tab=foryou');
  ok(
    pinnedFeed.body.items[0]?.id === postId && pinnedFeed.body.items[0]?.goatOfDay === true,
    'the pick is pinned at the top of For You',
  );
  const clearDaily = await call('/api/admin/daily', {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear: true }),
  });
  ok(clearDaily.status === 200, 'the pick can be cleared');

  console.log('\n[social]');
  const like = await call(`/api/posts/${postId}/like`, { method: 'POST', token: tokenB });
  ok(like.body.liked === true && like.body.likeCount === 1, 'liking works');
  const unlike = await call(`/api/posts/${postId}/like`, { method: 'POST', token: tokenB });
  ok(unlike.body.liked === false && unlike.body.likeCount === 0, 'unliking works');
  await call(`/api/posts/${postId}/like`, { method: 'POST', token: tokenB });

  const comment = await call(`/api/posts/${postId}/comments`, {
    method: 'POST',
    token: tokenB,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'The middle one is plotting something' }),
  });
  ok(comment.status === 201, 'comments can be posted');
  const commentList = await call(`/api/posts/${postId}/comments`);
  ok(commentList.body.comments.length === 1, 'comments are listed');
  ok(Array.isArray(commentList.body.items) && commentList.body.items.length === 1, 'comments are listed in the shape the app reads');
  ok(commentList.body.total === 1, 'comment list reports a total');
  ok(comment.body.total === 1, 'posting a comment returns the new total');

  const commentId = comment.body.comment.id;
  const guestCommentLike = await call(`/api/comments/${commentId}/like`, { method: 'POST' });
  ok(guestCommentLike.status === 401, 'comment likes need a session');
  const commentLike = await call(`/api/comments/${commentId}/like`, { method: 'POST', token: tokenA });
  ok(commentLike.body.liked === true && commentLike.body.likeCount === 1, 'comments can be liked');
  const commentLikeAgain = await call(`/api/comments/${commentId}/like`, { method: 'POST', token: tokenA });
  ok(commentLikeAgain.body.likeCount === 1, 'liking twice does not double count');
  const commentUnlike = await call(`/api/comments/${commentId}/like`, { method: 'DELETE', token: tokenA });
  ok(commentUnlike.body.liked === false && commentUnlike.body.likeCount === 0, 'comment likes can be undone');

  const reply = await call(`/api/posts/${postId}/comments`, {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'That is a very good goat', parentId: commentId }),
  });
  ok(
    reply.status === 201 && reply.body.comment.parentId === commentId,
    'replies attach to the comment they answer',
    reply.body,
  );
  ok(reply.body.total === 2, 'replies count toward the comment total');
  const replyNotices = await call('/api/me/notifications', { token: tokenB });
  const replyNotice = replyNotices.body.notifications.find(
    (notice: any) => notice.videoId === postId && notice.isReply === true,
  );
  ok(replyNotice?.actorUsername === 'ada', 'a reply notifies the comment author', replyNotice);
  ok(replyNotice?.detail === 'That is a very good goat', 'the reply notification carries the reply text');
  const replyToReply = await call(`/api/posts/${postId}/comments`, {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Still the same thread', parentId: reply.body.comment.id }),
  });
  ok(
    replyToReply.body.comment.parentId === commentId,
    'replying to a reply stays in the same thread',
  );
  const thread = await call(`/api/posts/${postId}/comments`);
  ok(
    thread.body.items.filter((item: any) => item.parentId === commentId).length === 2,
    'replies travel with their thread in the list',
  );
  ok(thread.body.total === 3, 'the comment total includes replies');

  const modComment = await call(`/api/posts/${postId}/comments`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Moderator here, all goats accounted for' }),
  });
  ok(
    modComment.body.comment.author.isModerator === true,
    'the moderator shield travels with comments',
  );
  const ownerReply = await call(`/api/posts/${postId}/comments`, {
    method: 'POST',
    token: tokenB,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'The moderator approves', parentId: modComment.body.comment.id }),
  });
  const ownerNotices = await call('/api/me/notifications', { token: adminToken });
  const ownerReplyNotices = ownerNotices.body.notifications.filter(
    (notice: any) => notice.detail === ownerReply.body.comment.body,
  );
  ok(
    ownerReplyNotices.length === 1 && ownerReplyNotices[0].isReply === true,
    'a reply to the post owner sends one notification, worded as a reply',
    ownerReplyNotices,
  );

  const deleteThread = await call(`/api/comments/${commentId}`, { method: 'DELETE', token: adminToken });
  ok(deleteThread.body.removed === 3, 'deleting a thread removes its replies', deleteThread.body);
  const afterThreadDelete = await call(`/api/posts/${postId}/comments`);
  ok(
    afterThreadDelete.body.items.every((item: any) => item.id !== commentId && item.parentId !== commentId),
    'removed threads leave no replies behind',
  );

  const deleteOther = await call(`/api/comments/${modComment.body.comment.id}`, {
    method: 'DELETE',
    token: adminToken === tokenB ? tokenA : tokenB,
  });
  ok(
    deleteOther.status === 401 || deleteOther.status === 403,
    'comment delete is scoped per user',
    { status: deleteOther.status, body: deleteOther.body },
  );
  const deleteOwn = await call(`/api/comments/${modComment.body.comment.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  ok(deleteOwn.status === 200, 'a comment author can delete their own comment');

  const follow = await call('/api/users/ada/follow', { method: 'POST', token: tokenB });
  ok(follow.body.following === true && follow.body.followerCount === 1, 'following works');
  const followingFeed = await call('/api/feed?tab=following', { token: tokenB });
  ok(followingFeed.body.items.length === 1, 'following feed shows followed creators');
  const profile = await call('/api/users/ada');
  ok(profile.body.user.followerCount === 1 && profile.body.user.postCount === 1, 'profile counts are live');

  const followers = await call('/api/users/ada/followers');
  ok(followers.status === 200 && followers.body.users.length === 1, 'followers list shows who follows an account');
  ok(followers.body.users[0].username === 'boaz', 'the follower list names the account');
  ok(followers.body.users[0].bio !== undefined && !('email' in followers.body.users[0]), 'follower entries carry no private fields');
  const selfFollowById = await call(`/api/users/${profile.body.user.id}/follow`, { method: 'POST', token: tokenA });
  ok(/yourself/i.test(selfFollowById.body.error || ''), 'follow resolves an account id as well as a handle');
  const selfBlockById = await call(`/api/users/${profile.body.user.id}/block`, { method: 'POST', token: tokenA });
  ok(/yourself/i.test(selfBlockById.body.error || ''), 'block resolves an account id as well as a handle');
  const followingList = await call('/api/users/boaz/following');
  ok(
    followingList.body.users.some((person: any) => person.username === 'ada'),
    'following list shows who an account follows',
  );
  const missingFollowers = await call('/api/users/nobody-here/followers');
  ok(missingFollowers.status === 404, 'a follower list needs a real account');

  const privateLists = await call('/api/me', {
    method: 'PATCH',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hideFollows: true }),
  });
  ok(privateLists.status === 200 && privateLists.body.user.hideFollows === true, 'follower lists can be made private');
  const hiddenFollowers = await call('/api/users/ada/followers');
  ok(hiddenFollowers.status === 403, 'a private follower list is refused to visitors');
  const ownerFollowers = await call('/api/users/ada/followers', { token: tokenA });
  ok(ownerFollowers.status === 200 && ownerFollowers.body.users.length === 1, 'the owner still sees their own list');
  const privateProfile = await call('/api/users/ada');
  ok(
    privateProfile.body.user.followsPrivate === true && privateProfile.body.user.followerCount === 0,
    'a private profile does not publish follower counts',
  );
  await call('/api/me', {
    method: 'PATCH',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hideFollows: false }),
  });

  const hiddenSearch = await call('/api/me', {
    method: 'PATCH',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ searchable: false }),
  });
  ok(hiddenSearch.status === 200 && hiddenSearch.body.user.searchable === false, 'people search can be turned off');
  const searchWithout = await call('/api/search?q=ada');
  ok(
    !searchWithout.body.creators.some((person: any) => person.username === 'ada'),
    'an unsearchable profile stays out of people search',
  );
  await call('/api/me', {
    method: 'PATCH',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ searchable: true }),
  });

  console.log('\n[recommendations]');
  const interests = await call('/api/me/interests', { token: tokenB });
  ok(interests.body.interests.some((i: any) => i.kind === 'category' && i.value === 'baby-goats'), 'likes and comments move the interest model');
  await call(`/api/posts/${postId}/events`, {
    method: 'POST',
    token: tokenB,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'complete' }),
  });
  const notInterested = await call(`/api/posts/${postId}/not-interested`, { method: 'POST', token: tokenB });
  ok(notInterested.body.hidden === true, 'not interested is recorded');
  const filtered = await call('/api/feed?tab=foryou', { token: tokenB });
  ok(filtered.body.items.length === 0, 'not interested removes the post from For You');
  const hidden = await call('/api/me/hidden', { token: tokenB });
  ok(hidden.body.items.length === 1, 'hidden posts can be reviewed and undone');
  await call(`/api/posts/${postId}/not-interested`, { method: 'DELETE', token: tokenB });
  const reset = await call('/api/me/interests/reset', { method: 'POST', token: tokenB });
  ok(reset.status === 200, 'interests can be reset');

  // A 5% share of a six-post page is 0.3, so the mix has to be rounded over
  // pages; taking the floor every page would drop trending forever.
  const totals = { personalized: 0, discovery: 0, trending: 0 };
  let firstTrendingPage = 0;
  for (let page = 1; page <= 12; page += 1) {
    const { quota } = quotasForPage(6, page);
    totals.personalized += quota.personalized;
    totals.discovery += quota.discovery;
    totals.trending += quota.trending;
    if (!firstTrendingPage && quota.trending > 0) firstTrendingPage = page;
  }
  ok(totals.trending >= 3, 'trending earns slots across the feed', totals);
  ok(firstTrendingPage > 0 && firstTrendingPage <= 3, 'trending shows up within the first pages', {
    firstTrendingPage,
    totals,
  });
  ok(
    Math.abs(totals.personalized / 72 - 0.8) < 0.05 && Math.abs(totals.discovery / 72 - 0.15) < 0.05,
    'page quotas stay close to the configured mix',
    totals,
  );
  const trendingFeed = await call('/api/feed?tab=foryou');
  ok(
    trendingFeed.body.items.some((item: any) => /popular/i.test(item.reason || '')),
    'the first For You page carries a trending post',
    trendingFeed.body.items.map((item: any) => item.reason),
  );

  console.log('\n[sounds]');
  const withSound = await call('/api/posts', {
    method: 'POST',
    token: tokenB,
    body: photoForm(
      [{ bytes: JPEG, type: 'image/jpeg' }],
      { caption: 'Listen to this one', category: 'goat-sounds', soundMode: 'upload', soundTitle: 'Evening bleat', audioDurationMs: '4200' },
      { bytes: MP3, type: 'audio/mpeg', name: 'bleat.mp3' },
    ),
  });
  ok(withSound.status === 201 && withSound.body.post.sound, 'audio upload creates a sound');
  const soundId = withSound.body.post.sound.id;
  await call(`/api/admin/posts/${withSound.body.post.id}/approve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  const library = await call('/api/sounds', { token: tokenA });
  ok(library.body.sounds.some((s: any) => s.id === soundId), 'approved sounds appear in the library');

  const publicAlbum = await call(`/api/posts/${withSound.body.post.id}`);
  ok(publicAlbum.body.post?.sound?.id === soundId, 'an approved album keeps its sound for the public page');
  ok(publicAlbum.body.post?.sound?.owner?.username?.length > 0, 'the public album sound names its creator');
  const publicSound = await call(`/media/sounds/${soundId}`);
  ok(
    publicSound.status === 200 && (publicSound.headers.get('content-type') || '').startsWith('audio/'),
    'approved album sounds stream without a session',
  );
  const reuse = await call('/api/posts', {
    method: 'POST',
    token: tokenA,
    body: photoForm(
      [{ bytes: PNG, type: 'image/png' }],
      { caption: 'Borrowed the bleat', category: 'goat-sounds', soundMode: 'library', soundId },
    ),
  });
  ok(reuse.status === 201 && reuse.body.post.sound.id === soundId, 'another creator can reuse a sound');
  ok(reuse.body.post.photos.length === 1, 'a single-photo post stores one photo');

  const soundQueue = await call('/api/admin/queue?status=pending', { token: adminToken });
  const queuedAlbum = soundQueue.body.items.find((post: any) => post.id === reuse.body.post.id);
  ok(queuedAlbum?.kind === 'photos', 'moderation queue marks a photo album as photos');
  ok(queuedAlbum?.sound?.id === soundId, 'moderation queue carries the sound for review');
  ok(
    typeof queuedAlbum?.sound?.url === 'string' && queuedAlbum.sound.url.includes(`/media/sounds/${soundId}`),
    'the queued sound has a URL the reviewer can play',
  );

  const plainPost = await call('/api/posts', {
    method: 'POST',
    token: tokenB,
    body: photoForm([{ bytes: PNG, type: 'image/png' }], {
      caption: 'Bo is not a moderator',
      category: 'parkour',
      soundMode: 'none',
    }),
  });
  ok(plainPost.body.post?.creator.isModerator === false, 'ordinary creators are not marked as moderators');
  await call(`/api/posts/${plainPost.body.post.id}`, { method: 'DELETE', token: tokenB });

  console.log('\n[rejection]');
  const rejected = await call(`/api/admin/posts/${reuse.body.post.id}/reject`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Photos belong to someone else' }),
  });
  ok(rejected.body.status === 'rejected', 'reject works');
  const rejectedDetail = await call(`/api/posts/${reuse.body.post.id}`, { token: tokenA });
  ok(rejectedDetail.body.post.rejectReason === 'Photos belong to someone else', 'creator sees the rejection reason');
  const rejectedFeed = await call('/api/feed?tab=trending');
  ok(rejectedFeed.body.items.every((p: any) => p.id !== reuse.body.post.id), 'rejected posts stay out of feeds');
  const notifications = await call('/api/me/notifications', { token: tokenA });
  ok(notifications.body.notifications.some((n: any) => n.type === 'rejected'), 'creator is notified');

  console.log('\n[editing an approved post]');
  const edit = await call(`/api/posts/${postId}`, {
    method: 'PATCH',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caption: 'Rewritten caption' }),
  });
  ok(edit.body.needsReview === true && edit.body.post.status === 'pending', 'editing a live post sends it back for review');
  const gone = await call('/api/feed?tab=foryou');
  ok(gone.body.items.every((p: any) => p.id !== postId), 'it leaves the feed while it waits');

  console.log('\n[reports and suspension]');
  const report = await call(`/api/posts/${withSound.body.post.id}/report`, {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Not actually a goat', note: 'Looks like a sheep' }),
  });
  ok(report.status === 201, 'reports are accepted');
  const reportList = await call('/api/admin/reports?status=open', { token: adminToken });
  ok(reportList.body.reports.length === 1, 'moderator sees the report');
  const resolve = await call(`/api/admin/reports/${reportList.body.reports[0].id}/resolve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'dismiss' }),
  });
  ok(resolve.status === 200, 'reports can be resolved');

  const removalReport = await call(`/api/posts/${withSound.body.post.id}/report`, {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Animal mistreatment', note: 'This needs to come down.' }),
  });
  const removalList = await call('/api/admin/reports?status=open', { token: adminToken });
  const removalTarget = removalList.body.reports.find((item: any) => item.id === removalReport.body.report?.id) ??
    removalList.body.reports[0];
  const removedContent = await call(`/api/admin/reports/${removalTarget.id}/resolve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'remove_content' }),
  });
  ok(removedContent.status === 200, 'a report can take its content down', removedContent.body);
  const removedByReport = await call(`/api/posts/${withSound.body.post.id}`, { token: tokenA });
  ok(removedByReport.body.post?.status === 'removed', 'the reported post is actually removed');
  const publicRemoved = await call(`/api/posts/${withSound.body.post.id}`);
  ok(publicRemoved.status === 404, 'removed content disappears from the public site');

  const suspend = await call(`/api/admin/users/${b.body.user.id}/suspend`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Repeatedly uploading sheep' }),
  });
  ok(suspend.status === 200, 'accounts can be suspended');
  const suspendedMe = await call('/api/auth/me', { token: tokenB });
  ok(suspendedMe.body.user === null, 'suspending kills existing sessions');
  const suspendedLogin = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'boaz', password: 'correct-horse-battery' }),
  });
  ok(suspendedLogin.status === 200, 'suspended accounts can still sign in to see why');
  const suspendedFeed = await call('/api/feed?tab=foryou', { token: suspendedLogin.body.token });
  ok(suspendedFeed.body.suspended === true, 'suspended accounts are told to hold off');

  console.log('\n[search, avatars, cors]');
  const search = await call('/api/search?q=ada');
  ok(search.body.creators.some((c: any) => c.username === 'ada'), 'search finds creators');
  ok(search.body.posts.length === 0, 'search only returns approved posts');
  const avatarForm = new FormData();
  avatarForm.append('avatar', new File([PNG], 'me.png', { type: 'image/png' }));
  const avatarUpload = await call('/api/me/avatar', { method: 'POST', token: adminToken, body: avatarForm });
  ok(avatarUpload.status === 200 && avatarUpload.body.user.avatarUrl, 'avatars upload');
  const avatarFetch = await call(`/media/avatars/${a.body.user.id}`);
  ok(avatarFetch.status === 200, 'avatars are served');

  const preflight = await call('/api/feed', {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:5173' },
  });
  ok(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'CORS allows the site origin');
  const blockedOrigin = await call('/api/feed', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example' },
  });
  ok(blockedOrigin.status === 403, 'CORS refuses unknown origins');

  console.log('\n[video posts]');
  // A tiny MP4 header is enough for the magic-byte check; the bytes still
  // travel through the real chunk pipeline and back out of the Range reader.
  const MP4 = new Uint8Array(4096);
  MP4.set([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 4); // "ftypisom"

  const badUpload = await call('/api/uploads', {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mime: 'video/avi', size: 4096, durationMs: 6000 }),
  });
  ok(badUpload.status === 400, 'unsupported video types are refused', badUpload.body);

  const longUpload = await call('/api/uploads', {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mime: 'video/mp4', size: 4096, durationMs: 181000 }),
  });
  ok(longUpload.status === 400, 'clips longer than three minutes are refused', longUpload.body);

  const started = await call('/api/uploads', {
    method: 'POST',
    token: tokenA,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mime: 'video/mp4', size: MP4.byteLength, durationMs: 6000 }),
  });
  ok(started.status === 201 && started.body.uploadId, 'a video upload starts', started.body);
  const uploadId = started.body.uploadId;

  const chunkForm = new FormData();
  chunkForm.append('chunk', new File([MP4], 'clip.mp4', { type: 'video/mp4' }));
  const chunk = await call(`/api/uploads/${uploadId}/chunks?index=0`, {
    method: 'POST',
    token: tokenA,
    body: chunkForm,
  });
  ok(chunk.status === 200, 'the video chunk is stored', chunk.body);

  const posterForm = new FormData();
  posterForm.append('poster', new File([JPEG], 'poster.jpg', { type: 'image/jpeg' }));
  const poster = await call(`/api/uploads/${uploadId}/poster`, {
    method: 'POST',
    token: tokenA,
    body: posterForm,
  });
  ok(poster.status === 200, 'the preview frame is stored');

  const videoForm = new FormData();
  videoForm.append('kind', 'video');
  videoForm.append('uploadId', uploadId);
  videoForm.append('caption', 'First clip up the hill #babygoats');
  videoForm.append('category', 'baby-goats');
  videoForm.append('durationMs', '6000');
  videoForm.append('width', '1280');
  videoForm.append('height', '720');
  const videoPost = await call('/api/posts', { method: 'POST', token: tokenA, body: videoForm });
  ok(videoPost.status === 201 && videoPost.body.post.kind === 'video', 'a video post is created', videoPost.body);
  const videoId = videoPost.body.post?.id;
  ok(videoPost.body.post?.status === 'pending', 'a video post starts pending');
  ok(typeof videoPost.body.post?.videoUrl === 'string', 'the video has a stream url');
  ok(videoPost.body.post?.posterUrl?.includes('/media/posters/'), 'the video has a poster');
  ok(videoPost.body.post?.creator.isModerator === true, 'the moderator badge travels with their posts');

  const anonVideo = await call(`/media/videos/${videoId}`);
  ok(anonVideo.status === 404, 'pending video bytes are unreachable when guessed');
  const anonPoster = await call(`/media/posters/${videoId}`);
  ok(anonPoster.status === 404, 'pending poster bytes are unreachable too');
  const pendingDetail = await call(`/api/posts/${videoId}`);
  ok(pendingDetail.status === 404, 'a pending video is invisible to guests');
  const pendingVideoDetail = await call(`/api/videos/${videoId}`, { token: tokenA });
  ok(
    pendingVideoDetail.status === 200 && pendingVideoDetail.body.video?.id === videoId,
    'post detail still returns a video alias',
    pendingVideoDetail.body,
  );
  const moderatorStream = await call(`/media/videos/${videoId}`, {
    token: adminToken,
    headers: { range: 'bytes=0-9' },
  });
  ok(moderatorStream.status === 206, 'the moderator can watch a pending video', moderatorStream.status);

  const pendingQueue = await call('/api/admin/queue?status=pending', { token: adminToken });
  const queuedVideo = pendingQueue.body.items.find((item: any) => item.id === videoId);
  ok(queuedVideo?.kind === 'video', 'the moderation queue reports the media kind', queuedVideo?.kind);
  ok(typeof queuedVideo?.videoUrl === 'string', 'the moderation queue sends a playable video url');
  ok(queuedVideo?.creatorEmail === 'ada@example.com', 'the moderation queue keeps creator info');

  const approveVideo = await call(`/api/admin/posts/${videoId}/approve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  ok(approveVideo.status === 200, 'the moderator can approve a video');

  const liveVideo = await call(`/api/posts/${videoId}`);
  ok(liveVideo.status === 200 && liveVideo.body.post.kind === 'video', 'the approved video is public');
  const ownFeed = await call('/api/feed?tab=foryou&page=1', { token: tokenA });
  ok(
    ownFeed.body.items.some((item: any) => item.id === videoId),
    'creators can see their own approved posts in For You',
    ownFeed.body.items.map((item: any) => item.id),
  );
  const stream = await call(`/media/videos/${videoId}`, { headers: { range: 'bytes=0-99' } });
  ok(stream.status === 206, 'video streaming answers a range request', stream.status);
  ok(stream.headers.get('content-range') === `bytes 0-99/${MP4.byteLength}`, 'the range header describes the clip');
  const streamBytes = new Uint8Array(stream.body as ArrayBuffer);
  ok(streamBytes.byteLength === 100, 'the range returns exactly the requested bytes');
  ok(String.fromCharCode(...streamBytes.slice(4, 8)) === 'ftyp', 'the streamed bytes are the uploaded video');
  const wholeVideo = await call(`/media/videos/${videoId}`);
  ok(wholeVideo.status === 200 && (wholeVideo.body as ArrayBuffer).byteLength === MP4.byteLength, 'the full video streams');
  const livePoster = await call(`/media/posters/${videoId}`);
  ok(livePoster.status === 200 && livePoster.headers.get('content-type') === 'image/jpeg', 'the approved poster is public');

  // The caption edit earlier sent the photo album back to the queue, so put it
  // live again before checking that one feed can serve both kinds.
  await call(`/api/admin/posts/${postId}/approve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const mixedFeed = await call('/api/feed?tab=foryou&page=1');
  ok(
    mixedFeed.body.items.some((item: any) => item.kind === 'video') &&
      mixedFeed.body.items.some((item: any) => item.kind === 'photos'),
    'the feed carries both videos and photo albums',
    mixedFeed.body.items.map((item: any) => item.kind),
  );

  console.log('\n[contact and moderation centers]');
  const noDevice = await call('/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.61' },
    body: JSON.stringify({
      category: 'account',
      email: 'boaz@example.com',
      body: 'I cannot sign in after replacing my phone.',
      device: '',
    }),
  });
  ok(noDevice.status === 400, 'contact messages need device details', noDevice.body);

  const noTarget = await call('/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.62' },
    body: JSON.stringify({
      category: 'person',
      email: 'boaz@example.com',
      body: 'This account keeps posting things that are not goats.',
      device: 'Firefox on Windows · desktop · 1366×768',
    }),
  });
  ok(noTarget.status === 400, 'reporting a person needs their username');

  const ticket = await call('/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.63' },
    body: JSON.stringify({
      category: 'account',
      targetUsername: 'boaz',
      email: 'boaz@example.com',
      body: 'I cannot sign in after replacing my phone. Please help me get the account back.',
      device: 'Chrome on macOS · desktop · 1512×982',
      pageUrl: 'https://toastedbread02.github.io/GoatMedia/contact',
    }),
  });
  ok(ticket.status === 201 && ticket.body.id, 'a guest can open a support request', ticket.body);

  const ticketId = ticket.body.id;
  const supportCounts = await call('/api/admin/counts', { token: adminToken });
  ok(supportCounts.body.openTickets >= 1, 'open support requests are counted for the dashboard');
  const adminNotices = await call('/api/me/notifications', { token: adminToken });
  const supportNotice = adminNotices.body.notifications.find((notice: any) => notice.ticketId === ticketId);
  ok(supportNotice?.type === 'support', 'the moderator is notified about a support request', supportNotice);
  ok(supportNotice?.detail?.includes('Recover an account'), 'the notification names the request type');

  const guestInbox = await call('/api/admin/tickets');
  ok(guestInbox.status === 401, 'the support inbox is moderator-only');
  const nonAdminInbox = await call('/api/admin/tickets', { token: tokenB });
  ok(nonAdminInbox.status === 401, 'ordinary accounts cannot read support requests');

  const inbox = await call('/api/admin/tickets?status=open', { token: adminToken });
  const queuedTicket = inbox.body.items.find((item: any) => item.id === ticketId);
  ok(queuedTicket?.category === 'account', 'the report center lists the support request');
  ok(queuedTicket?.device.includes('Chrome on macOS'), 'the report center keeps the device details');
  ok(queuedTicket?.targetUsername === 'boaz', 'the report center keeps the account being reported');

  const reviewing = await call(`/api/admin/tickets/${ticketId}/resolve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'reviewing' }),
  });
  ok(reviewing.body.status === 'reviewing', 'a support request can be marked as reviewing');
  const closed = await call(`/api/admin/tickets/${ticketId}/resolve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'closed', note: 'Checked the account with the reported owner.' }),
  });
  ok(closed.body.status === 'closed', 'a support request can be closed');
  const afterClose = await call('/api/admin/tickets?status=open', { token: adminToken });
  ok(
    afterClose.body.items.every((item: any) => item.id !== ticketId),
    'closed requests leave the open inbox',
  );

  console.log('\n[account control center]');
  const nonAdminRemove = await call(`/api/admin/users/${b.body.user.id}/remove`, {
    method: 'POST',
    token: tokenB,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Not the moderator' }),
  });
  ok(nonAdminRemove.status === 401, 'ordinary accounts cannot remove people');

  const removed = await call(`/api/admin/users/${b.body.user.id}/remove`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Repeated guideline problems' }),
  });
  ok(removed.status === 200, 'the moderator can remove an account', removed.body);
  const removedProfile = await call('/api/users/boaz');
  ok(removedProfile.status === 404, 'a removed account has no public profile');
  const removedLogin = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'boaz', password: 'correct-horse-battery' }),
  });
  ok(removedLogin.status === 400 && /removed/i.test(removedLogin.body.error), 'a removed account cannot sign in');

  const accountList = await call('/api/admin/users?q=boaz', { token: adminToken });
  const removedAccount = accountList.body.items.find((item: any) => item.id === b.body.user.id);
  ok(removedAccount?.status === 'deleted', 'the control center marks the account as removed');
  ok(removedAccount?.deletedReason === 'Repeated guideline problems', 'the removal reason is kept');

  const restored = await call(`/api/admin/users/${b.body.user.id}/restore`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  ok(restored.status === 200, 'the moderator can restore an account');
  const restoredProfile = await call('/api/users/boaz');
  ok(restoredProfile.status === 200, 'a restored account has a profile again');
  const restoredLogin = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'boaz', password: 'correct-horse-battery' }),
  });
  ok(restoredLogin.status === 200 && restoredLogin.body.token, 'a restored account can sign in again');

  console.log('\n[shared moderation]');
  const boId = b.body.user.id;
  const outsiderPromotion = await call(`/api/admin/users/${boId}/moderator`, {
    method: 'POST',
    token: restoredLogin.body.token,
  });
  ok(outsiderPromotion.status === 401, 'members cannot promote themselves');
  const selfDemotion = await call(`/api/admin/users/${a.body.user.id}/moderator`, {
    method: 'DELETE',
    token: adminToken,
  });
  ok(selfDemotion.status === 400, 'a moderator cannot remove their own access');

  const promote = await call(`/api/admin/users/${boId}/moderator`, {
    method: 'POST',
    token: adminToken,
  });
  ok(promote.status === 200, 'the moderator can share the role', promote.body);
  const boSession = await call('/api/auth/me', { token: restoredLogin.body.token });
  ok(boSession.body.user?.role === 'admin', 'the promoted account is a moderator right away');
  const boQueue = await call('/api/admin/queue?status=pending', { token: restoredLogin.body.token });
  ok(boQueue.status === 200, 'a promoted moderator can open the review queue');
  const boInbox = await call('/api/admin/tickets?status=open', { token: restoredLogin.body.token });
  ok(boInbox.status === 200, 'a promoted moderator can open the report center');
  const boAccounts = await call('/api/admin/users?q=boaz', { token: restoredLogin.body.token });
  ok(
    boAccounts.body.items.find((item: any) => item.id === boId)?.role === 'admin',
    'the control center marks shared moderators',
  );

  const duplicatePromote = await call(`/api/admin/users/${boId}/moderator`, {
    method: 'POST',
    token: adminToken,
  });
  ok(duplicatePromote.status === 400, 'promoting an existing moderator is refused');
  const demote = await call(`/api/admin/users/${boId}/moderator`, {
    method: 'DELETE',
    token: adminToken,
  });
  ok(demote.status === 200, 'moderator access can be taken back');
  const boAfter = await call('/api/admin/counts', { token: restoredLogin.body.token });
  ok(boAfter.status === 401, 'removed access stops working on the next request');

  console.log('\n[traffic]');
  const visit = await call('/api/visits', {
    method: 'POST',
    headers: { 'user-agent': 'traffic-check-referrer' },
    body: JSON.stringify({ ref: 'https://www.reddit.com/r/goats/comments/x', path: '/v/abc' }),
  });
  ok(visit.status === 200, 'a signed-out visit is accepted', visit.body);

  const tagged = await call('/api/visits', {
    method: 'POST',
    headers: { 'user-agent': 'traffic-check-campaign' },
    body: JSON.stringify({ ref: '', path: '/', utm: 'reddit-launch' }),
  });
  ok(tagged.status === 200, 'a campaign-tagged visit is accepted', tagged.body);

  const repeat = await call('/api/visits', {
    method: 'POST',
    headers: { 'user-agent': 'traffic-check-referrer' },
    body: JSON.stringify({ ref: 'https://www.reddit.com/r/goats/comments/x', path: '/v/abc' }),
  });
  ok(repeat.status === 200, 'a repeat visit does not error');

  const anonymousTraffic = await call('/api/admin/traffic');
  ok(anonymousTraffic.status === 401, 'traffic needs a signed-in moderator');

  // The account above had its moderator access taken away, so it is a plain
  // member again and must stay out of the traffic numbers.
  const memberTraffic = await call('/api/admin/traffic', { token: restoredLogin.body.token });
  ok(memberTraffic.status === 401, 'an ordinary member cannot read traffic');

  const stats = await call('/api/admin/traffic?days=7', { token: adminToken });
  ok(stats.status === 200, 'the moderator can read traffic', stats.body);
  const sources: string[] = (stats.body.sources || []).map((row: { source: string }) => row.source);
  ok(sources.includes('reddit.com'), 'the referring host is kept without the path', sources);
  ok(sources.includes('reddit-launch'), 'an explicit campaign tag wins over the referrer', sources);
  ok(
    (stats.body.totals?.visits ?? 0) === 2,
    'the refresh did not inflate the visit count',
    stats.body.totals,
  );
  ok(Array.isArray(stats.body.series) && stats.body.series.length === 7, 'the series covers the window');
  ok(
    stats.body.series.every((day: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(day.date)),
    'each day is labelled with a date',
  );

  console.log('\n[automatic gore filter]');
  const cass = await call('/api/auth/register', {
    method: 'POST',
    // Sign-ups are limited to five an hour per address, and the accounts above
    // have used that up. A different test IP keeps this check independent.
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.77' },
    body: JSON.stringify({
      email: 'cass@example.com',
      username: 'cass',
      displayName: 'Cass',
      password: 'correct-horse-battery',
      birthDate: '1992-02-02',
    }),
  });
  ok(cass.status === 201, 'a third account registers for the filter tests', cass.body);
  const tokenC = cass.body.token;
  const cassId = cass.body.user.id;

  // The model says 0.94: this upload should be rejected, not queued.
  aiProbability = 0.94;
  const flagged = await call('/api/posts', {
    method: 'POST',
    token: tokenC,
    body: photoForm([{ bytes: PNG, type: 'image/png' }], {
      caption: 'Something the filter will flag',
      category: 'farm-life',
      kind: 'photos',
    }),
  });
  ok(flagged.status === 201, 'a flagged upload is still accepted so it can be reviewed', flagged.body);
  ok(flagged.body.post?.status === 'rejected', 'a flagged upload goes to the rejected pile', flagged.body.post?.status);
  ok(flagged.body.filtered === true, 'the response says the filter held it back');
  ok(flagged.body.warning?.count === 1, 'the first flag records warning one', flagged.body.warning);
  ok(aiCalls.length > 0, 'the vision model was actually asked');

  const firstMail = outbox.find((mail) => mail.subject.includes('warning'));
  ok(Boolean(firstMail), 'the warning was emailed');
  ok(Boolean(firstMail && /\/appeal\/[A-Za-z0-9_-]{16,}/.test(firstMail.text)), 'the warning email carries an appeal link');

  const override = await call(`/api/admin/posts/${flagged.body.post.id}/approve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  ok(override.status === 200 && override.body.status === 'approved', 'a moderator can still approve a flagged post');

  const missingReason = await call(`/api/admin/users/${cassId}/suspend`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  ok(missingReason.status === 400, 'a suspension is refused without a reason', missingReason.body);

  aiProbability = 0.88;
  const flaggedAgain = await call('/api/posts', {
    method: 'POST',
    token: tokenC,
    body: photoForm([{ bytes: PNG, type: 'image/png' }], {
      caption: 'Trying the filter again',
      category: 'farm-life',
      kind: 'photos',
    }),
  });
  ok(flaggedAgain.body.warning?.count === 2, 'a second flag records warning two', flaggedAgain.body.warning);
  ok(flaggedAgain.body.warning?.banned === false, 'two warnings do not suspend the account');

  aiProbability = 0.97;
  const third = await call('/api/posts', {
    method: 'POST',
    token: tokenC,
    body: photoForm([{ bytes: PNG, type: 'image/png' }], {
      caption: 'A third attempt at the same thing',
      category: 'farm-life',
      kind: 'photos',
    }),
  });
  ok(third.body.warning?.count === 3, 'the third flag reaches the warning limit', third.body.warning);
  ok(third.body.warning?.banned === true, 'the third warning suspends the account automatically');

  const banMail = [...outbox].reverse().find((mail) => mail.subject.includes('suspended'));
  ok(Boolean(banMail), 'the suspension was emailed');
  ok(
    Boolean(banMail && /warning limit reached \(3 warnings on record\)/i.test(banMail.text)),
    'the email states the reason',
    banMail?.text,
  );
  const appealToken = banMail?.text.match(/\/appeal\/([A-Za-z0-9_-]{16,})/)?.[1] ?? '';
  ok(Boolean(appealToken), 'the suspension email carries an appeal token');

  const blockedLogin = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'cass', password: 'correct-horse-battery' }),
  });
  ok(
    blockedLogin.body.user?.status === 'suspended' && blockedLogin.body.user?.suspendedReason,
    'the suspended account shows its reason on sign-in',
    blockedLogin.body.user?.status,
  );

  console.log('\n[appeals]');
  const appealRead = await call(`/api/appeals/${appealToken}`);
  ok(appealRead.status === 200 && appealRead.body.kind === 'ban', 'the emailed link opens without a session');
  ok(/warning limit reached/i.test(appealRead.body.reason), 'the appeal page shows the reason', appealRead.body.reason);

  const tooShort = await call(`/api/appeals/${appealToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'no' }),
  });
  ok(tooShort.status === 400, 'a one-word appeal is refused');

  const filed = await call(`/api/appeals/${appealToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'It was a goat standing in a red barn. Nothing in the clip is gore.',
      context: 'Filmed on a phone, no edits.',
    }),
  });
  ok(filed.status === 200, 'the appeal is accepted', filed.body);

  const replay = await call(`/api/appeals/${appealToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Trying to send this appeal twice in a row.' }),
  });
  ok(replay.status === 400, 'the same appeal cannot be filed twice');

  const appealQueue = await call('/api/admin/appeals?status=open', { token: adminToken });
  ok(appealQueue.status === 200 && appealQueue.body.items.length >= 1, 'the moderator sees the appeal', appealQueue.body);
  const queued = appealQueue.body.items.find((item: { kind: string }) => item.kind === 'ban');
  ok(queued?.username === 'cass', 'the appeal names the account');
  ok(queued?.mailStatus === 'sent', 'the queue shows the notice was delivered');

  const notMine = await call(`/api/admin/appeals/${queued?.id}/resolve`, {
    method: 'POST',
    token: tokenC,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accept' }),
  });
  ok(notMine.status === 401, 'an ordinary account cannot decide appeals');

  const accepted = await call(`/api/admin/appeals/${queued?.id}/resolve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accept', note: 'Watched it: a goat, as described. Sorry about that.' }),
  });
  ok(accepted.status === 200, 'the moderator can accept the appeal', accepted.body);

  const backAgain = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'cass', password: 'correct-horse-battery' }),
  });
  ok(backAgain.body.user?.status === 'active', 'accepting the appeal reinstates the account');
  ok(Boolean(outbox.find((mail) => mail.subject.includes('reversed'))), 'the decision is emailed');

  const decided = await call(`/api/appeals/${appealToken}`);
  ok(decided.body.status === 'accepted', 'the appeal page shows the decision');

  console.log('\n[moderator warnings]');
  // A second account, so this warning does not push cass back over the limit
  // the accepted appeal just cleared the suspension from.
  const manual = await call(`/api/admin/users/${b.body.user.id}/warn`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Posting the same clip six times in one afternoon.' }),
  });
  ok(manual.status === 200 && manual.body.count === 1, 'a moderator can warn an account by hand', manual.body);
  ok(manual.body.banned === false, 'one manual warning does not suspend the account', manual.body);
  const manualMail = [...outbox].reverse().find((mail) => mail.subject.includes('warning'));
  ok(Boolean(manualMail && manualMail.text.includes('six times')), 'the manual warning is emailed with its reason');

  const warnedProfile = await call('/api/users/boaz');
  ok(warnedProfile.status === 200, 'a warned account stays public');
  const notWarned = await call(`/api/admin/users/${b.body.user.id}/warn`, {
    method: 'POST',
    token: tokenB,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Not the moderator' }),
  });
  ok(notWarned.status === 401, 'ordinary accounts cannot warn people');

  // Mailjet is picked when it is the only provider configured, and a refusal
  // that Mailjet reports inside a 200 response is still logged as failed.
  const mailjetEnv = {
    ...(env as unknown as Record<string, unknown>),
    SENDGRID_API_KEY: undefined,
    BREVO_API_KEY: undefined,
    MAILJET_API_KEY: 'mailjet-public',
    MAILJET_SECRET_KEY: 'mailjet-private',
  } as unknown as Env;
  const before = outbox.length;
  const mailjetStatus = await sendMail(mailjetEnv, {
    to: 'boaz@example.com',
    subject: 'Mailjet routing probe',
    text: 'probe',
    html: '<p>probe</p>',
    kind: 'warning',
  });
  ok(mailjetStatus === 'sent', 'Mailjet is used when it is the only provider configured', mailjetStatus);
  ok(outbox.length === before + 1 && outbox[outbox.length - 1].subject === 'Mailjet routing probe', 'the Mailjet payload carries the message');

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
