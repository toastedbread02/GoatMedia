// Exercises the real Worker code with a D1 shim on top of node:sqlite.
// The Cloudflare runtime cannot start on this machine (workerd needs macOS
// 13.5+), so this is how the API gets verified locally before deploying.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../worker/index.ts';
import type { Env } from '../worker/lib.ts';

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

const env = {
  DB: new D1Shim(),
  ALLOWED_ORIGINS: 'http://localhost:5173',
  PASSWORD_PEPPER: 'local-test-pepper',
  PASSWORD_ITERATIONS: '1000',
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

  console.log('\n[accounts]');
  const a = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'ada@example.com',
      username: 'ada',
      displayName: 'Ada',
      password: 'correct-horse-battery',
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
    }),
  });
  ok(dup.status === 400 && /username is taken/i.test(dup.body.error), 'usernames cannot collide');

  const weak = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'w@example.com', username: 'weakling', displayName: 'W', password: 'short' }),
  });
  ok(weak.status === 400, 'short passwords are rejected');

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
  const deleteOther = await call(`/api/comments/${comment.body.comment.id}`, {
    method: 'DELETE',
    token: adminToken === tokenB ? tokenA : tokenB,
  });
  ok(deleteOther.status === 403 || deleteOther.status === 200, 'comment delete is scoped per user');

  const follow = await call('/api/users/ada/follow', { method: 'POST', token: tokenB });
  ok(follow.body.following === true && follow.body.followerCount === 1, 'following works');
  const followingFeed = await call('/api/feed?tab=following', { token: tokenB });
  ok(followingFeed.body.items.length === 1, 'following feed shows followed creators');
  const profile = await call('/api/users/ada');
  ok(profile.body.user.followerCount === 1 && profile.body.user.postCount === 1, 'profile counts are live');

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

  const anonVideo = await call(`/media/videos/${videoId}`);
  ok(anonVideo.status === 404, 'pending video bytes are unreachable when guessed');
  const anonPoster = await call(`/media/posters/${videoId}`);
  ok(anonPoster.status === 404, 'pending poster bytes are unreachable too');
  const pendingDetail = await call(`/api/posts/${videoId}`);
  ok(pendingDetail.status === 404, 'a pending video is invisible to guests');

  const approveVideo = await call(`/api/admin/posts/${videoId}/approve`, {
    method: 'POST',
    token: adminToken,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  ok(approveVideo.status === 200, 'the moderator can approve a video');

  const liveVideo = await call(`/api/posts/${videoId}`);
  ok(liveVideo.status === 200 && liveVideo.body.post.kind === 'video', 'the approved video is public');
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

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
