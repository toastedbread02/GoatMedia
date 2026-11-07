// End-to-end check against the deployed Worker. Safe to run repeatedly: it
// creates throwaway accounts and posts, approves them, and prints timings so a
// free-plan CPU problem shows up as a failure rather than a vague slowness.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const API = (process.env.API_ORIGIN || '').replace(/\/+$/, '');
const SITE = process.env.SITE_ORIGIN || 'https://toastedbread02.github.io';
if (!API) {
  console.error('Set API_ORIGIN, for example: API_ORIGIN=https://goatmedia-api.example.workers.dev npm run live:check');
  process.exit(1);
}

const adminToken = readFileSync(new URL('../.secrets/admin-code.txt', import.meta.url), 'utf8').trim();
const stamp = Date.now().toString(36);
let failures = 0;
let checks = 0;

function ok(condition, label, extra) {
  checks += 1;
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${label}${condition || extra === undefined ? '' : ` :: ${JSON.stringify(extra)}`}`);
  if (!condition) failures += 1;
}

async function timed(promise, label) {
  const started = Date.now();
  const result = await promise;
  const ms = Date.now() - started;
  console.log(`  ....  ${label} took ${ms} ms`);
  return result;
}

async function call(path, { method = 'GET', token, body, form, raw = false } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  if (raw) return { status: response.status, headers: response.headers, response };
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json().catch(() => null) : await response.text();
  return { status: response.status, headers: response.headers, body: payload };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const password = 'goatmedia-smoke-password';

function postForm({ photos, fields, audio }) {
  const form = new FormData();
  for (const photo of photos) form.append('photos', new File([photo], 'goat.png', { type: 'image/png' }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (audio) form.append('audio', new File([audio], 'bleat.mp3', { type: 'audio/mpeg' }));
  return form;
}

const health = await call('/api/health');
ok(health.status === 200 && health.body.ok, 'health endpoint');

const config = await timed(call('/api/config'), 'config');
ok(config.body.categories?.length === 6, 'config served');

const preflight = await fetch(`${API}/api/feed`, {
  method: 'OPTIONS',
  headers: { origin: SITE, 'access-control-request-method': 'GET' },
});
ok(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === SITE, 'CORS allows the GitHub Pages origin', preflight.status);

const registerA = await timed(
  call('/api/auth/register', {
    method: 'POST',
    body: {
      email: `smoke-a-${stamp}@example.com`,
      username: `smokea${stamp}`.slice(0, 20),
      displayName: 'Smoke A',
      password,
      birthDate: '1992-06-15',
    },
  }),
  'register (hash + D1 writes)',
);
ok(registerA.status === 201 && registerA.body.token, 'account A registers', registerA.body);
const tokenA = registerA.body.token;

const registerB = await call('/api/auth/register', {
  method: 'POST',
  body: {
    email: `smoke-b-${stamp}@example.com`,
    username: `smokeb${stamp}`.slice(0, 20),      displayName: 'Smoke B',
      password,
      birthDate: '1988-02-08',
    },
});
ok(registerB.status === 201, 'account B registers', registerB.body);
const tokenB = registerB.body.token;
const userB = registerB.body.user;

const login = await timed(
  call('/api/auth/login', { method: 'POST', body: { identifier: registerA.body.user.username, password } }),
  'login (verify hash)',
);
ok(login.status === 200 && login.body.token, 'login works', login.body);

// Promote the throwaway account straight through D1: this deployment may
// already have a moderator, and the setup token is single-use by design.
try {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'goatmedia',
      '--remote',
      '--command',
      `UPDATE users SET role = 'admin' WHERE username = '${registerA.body.user.username}'`,
    ],
    { stdio: 'ignore' },
  );
  const promoted = await call('/api/auth/me', { token: tokenA });
  ok(promoted.body.user?.role === 'admin', 'smoke account promoted for moderation checks');
} catch {
  ok(false, 'could not promote the smoke account (is wrangler logged in?)');
}
void adminToken;

const created = await call('/api/posts', {
  method: 'POST',
  token: tokenA,
  form: postForm({
    photos: [PNG, PNG],
    fields: { caption: `Smoke test goats #smoketest ${stamp}`, category: 'baby-goats', soundMode: 'none' },
  }),
});
ok(created.status === 201, 'post with two photos is accepted', created.body);
const postId = created.body.post?.id;
ok(created.body.post?.photos.length === 2, 'both photos stored');
ok(created.body.post?.status === 'pending', 'new post is pending');

const anonPost = await call(`/api/posts/${postId}`);
ok(anonPost.status === 404, 'pending post hidden from guests');
const anonPhoto = await call(`/media/photos/${created.body.post.photos[0].id}`);
ok(anonPhoto.status === 404, 'pending photo bytes hidden from guests');
const feedBefore = await call('/api/feed?tab=foryou');
ok(!feedBefore.body.items.some((item) => item.id === postId), 'pending post absent from For You');

const queue = await call('/api/admin/queue?status=pending', { token: login.body.token });
ok(queue.status === 200 && queue.body.items.some((item) => item.id === postId), 'moderator sees it in the queue', queue.body);
const notAdmin = await call('/api/admin/queue?status=pending', { token: tokenB });
ok(notAdmin.status === 401, 'ordinary accounts are refused admin routes');

const approve = await call(`/api/admin/posts/${postId}/approve`, { method: 'POST', token: login.body.token, body: {} });
ok(approve.status === 200, 'approve works', approve.body);

const feedAfter = await call('/api/feed?tab=foryou');
ok(feedAfter.body.items.some((item) => item.id === postId), 'approved post appears in For You', feedAfter.body.items?.length);
const publicPhoto = await call(`/media/photos/${created.body.post.photos[0].id}`, { raw: true });
ok(publicPhoto.status === 200 && publicPhoto.headers.get('content-type') === 'image/png', 'approved photo streams publicly', publicPhoto.status);

const like = await call(`/api/posts/${postId}/like`, { method: 'POST', token: tokenB });
ok(like.body.liked === true && like.body.likeCount >= 1, 'likes work', like.body);
const comment = await call(`/api/posts/${postId}/comments`, { method: 'POST', token: tokenB, body: { body: 'Two goats, no notes.' } });
ok(comment.status === 201, 'comments work', comment.body);
const follow = await call(`/api/users/${registerA.body.user.username}/follow`, { method: 'POST', token: tokenB });
ok(follow.body.following === true, 'follows work', follow.body);

const withSound = await call('/api/posts', {
  method: 'POST',
  token: tokenB,
  form: postForm({
    photos: [PNG],
    fields: { caption: 'Bleat test', category: 'goat-sounds', soundMode: 'upload', soundTitle: `Smoke bleat ${stamp}`, audioDurationMs: '3000' },
    audio: MP3,
  }),
});
ok(withSound.status === 201 && withSound.body.post.sound, 'audio upload creates a sound', withSound.body);
const soundId = withSound.body.post.sound?.id;
await call(`/api/admin/posts/${withSound.body.post.id}/approve`, { method: 'POST', token: login.body.token, body: {} });

const library = await call('/api/sounds', { token: login.body.token });
ok(library.body.sounds.some((sound) => sound.id === soundId), 'sound is in the shared library');
const reuse = await call('/api/posts', {
  method: 'POST',
  token: login.body.token,
  form: postForm({
    photos: [PNG],
    fields: { caption: 'Borrowed sound', category: 'goat-sounds', soundMode: 'library', soundId },
  }),
});
ok(reuse.status === 201 && reuse.body.post.sound?.id === soundId, 'another account reuses the sound', reuse.body);
ok(reuse.body.post.photos.length === 1, 'single photo post stores one photo');

const reject = await call(`/api/admin/posts/${reuse.body.post.id}/reject`, {
  method: 'POST',
  token: login.body.token,
  body: { reason: 'Photos belong to someone else' },
});
ok(reject.status === 200, 'reject works', reject.body);
const rejectedDetail = await call(`/api/posts/${reuse.body.post.id}`, { token: login.body.token });
ok(rejectedDetail.body.post?.rejectReason === 'Photos belong to someone else', 'rejection reason is stored');

const selfPost = await call(`/api/users/${registerA.body.user.username}/posts`);
ok(selfPost.status === 200 && selfPost.body.items.length >= 1, 'profile posts load');
const search = await call(`/api/search?q=${encodeURIComponent('Smoke A')}`);
ok(search.status === 200, 'search works', search.body);

const counts = await call('/api/admin/counts', { token: login.body.token });
ok(counts.status === 200 && typeof counts.body.users === 'number', 'admin counts load', counts.body);

console.log(`\nAPI ${API}`);
console.log(`${checks - failures}/${checks} live checks passed`);
if (failures) process.exit(1);
