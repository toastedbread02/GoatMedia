/**
 * End-to-end API checks against a temporary database and a freshly started
 * server. It never touches .data and never approves anything automatically.
 *
 *   npm run smoke
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(root, '.data-smoke-'));
const port = 4400 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const adminEmail = 'moderator@smoke.test';
const adminPassword = 'correct-horse-goat-battery';
const runtime: { server: ChildProcess | null } = { server: null };

process.env.DATA_DIR = tempRoot;
process.env.PORT = String(port);
process.env.APP_ORIGIN = origin;
process.env.DEV_EXPOSE_RESET_LINK = '1';
process.env.NODE_ENV = 'development';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

interface Reply<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

class Client {
  cookies = new Map<string, string>();

  async request<T = any>(
    method: string,
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply<T>> {
    const init: RequestInit = { method, headers: { ...headers } };
    if (this.cookies.size) {
      init.headers = {
        ...(init.headers as Record<string, string>),
        cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      };
    }
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(origin + route, init);
    this.captureCookies(response);
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  async upload(route: string, form: FormData): Promise<Reply<any>> {
    const headers: Record<string, string> = {};
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const response = await fetch(origin + route, { method: 'POST', body: form, headers });
    this.captureCookies(response);
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  async raw(route: string, headers: Record<string, string> = {}) {
    const response = await fetch(origin + route, {
      headers: {
        ...headers,
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
          : {}),
      },
    });
    return response;
  }

  private captureCookies(response: Response) {
    const list = response.headers.getSetCookie?.() ?? [];
    for (const cookie of list) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(250);
  }
  throw new Error('The smoke server did not become healthy.');
}

async function makeVideo(file: string) {
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=480x270:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    file,
  ];
  const child = spawn('ffmpeg', args, { stdio: 'ignore' });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  if (code !== 0) throw new Error('Could not generate a test video with ffmpeg.');
}

function uploadForm(file: Buffer, caption: string, category = 'baby-goats', hashtags = 'smoketest, goats') {
  const form = new FormData();
  form.append('video', new Blob([new Uint8Array(file)], { type: 'video/mp4' }), 'goat-smoke.mp4');
  form.append('caption', caption);
  form.append('category', category);
  form.append('hashtags', hashtags);
  form.append('guidelines', 'accepted');
  return form;
}

async function main() {
  fs.mkdirSync(tempRoot, { recursive: true });
  const { run } = await import('../server/db.ts');
  const { hashPassword } = await import('../server/auth.ts');

  run(
    `INSERT INTO users (id, email, username, display_name, bio, password_hash, role, status, created_at)
     VALUES (?, ?, 'keeper', 'Smoke Moderator', '', ?, 'admin', 'active', ?)`,
    crypto.randomUUID(),
    adminEmail,
    await hashPassword(adminPassword),
    Date.now(),
  );

  const videoFile = path.join(tempRoot, 'source.mp4');
  await makeVideo(videoFile);
  const videoBytes = await fs.promises.readFile(videoFile);
  const log = fs.openSync(path.join(tempRoot, 'server.log'), 'a');

  runtime.server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    stdio: ['ignore', log, log],
    env: { ...process.env, DATA_DIR: tempRoot, PORT: String(port), APP_ORIGIN: origin },
  });

  await waitForHealth();
  console.log(`\nGoatMedia smoke test on ${origin}\n`);

  const anonymous = new Client();
  const creator = new Client();
  const viewer = new Client();
  const admin = new Client();

  // ---------------------------------------------------------------- accounts
  let reply = await creator.request('POST', '/api/auth/register', {
    email: 'creator@smoke.test',
    username: 'goatcreator',
    displayName: 'Smoke Creator',
    password: 'clover-patch-1',
  });
  check('register a creator', reply.status === 201 && reply.body.user.username === 'goatcreator', reply.body);
  const creatorId = reply.body.user?.id as string;

  reply = await creator.request('GET', '/api/auth/me');
  check('session cookie restores the account', reply.status === 200 && reply.body.user?.id === creatorId);

  const duplicate = new Client();
  reply = await duplicate.request('POST', '/api/auth/register', {
    email: 'other@smoke.test',
    username: 'GOATCREATOR',
    displayName: 'Duplicate',
    password: 'clover-patch-1',
  });
  check('usernames are unique ignoring case', reply.status === 409, reply.body);

  reply = await anonymous.request('POST', '/api/auth/login', {
    identifier: 'goatcreator',
    password: 'wrong-password',
  });
  check('wrong password is rejected', reply.status === 401);

  reply = await viewer.request('POST', '/api/auth/register', {
    email: 'viewer@smoke.test',
    username: 'goatviewer',
    displayName: 'Smoke Viewer',
    password: 'clover-patch-2',
  });
  check('register a second account', reply.status === 201);
  const viewerId = reply.body.user?.id as string;

  reply = await admin.request('POST', '/api/auth/login', {
    identifier: adminEmail,
    password: adminPassword,
  });
  check('moderator can sign in', reply.status === 200 && reply.body.user.role === 'admin', reply.body);

  reply = await anonymous.request('POST', '/api/auth/register', {
    email: 'bad-email',
    username: 'nope',
    password: 'short',
  });
  check('invalid registration is rejected with field errors', reply.status === 400 && Boolean(reply.body.fields), reply.body);

  // ----------------------------------------------------------------- uploads
  reply = await creator.upload('/api/videos', uploadForm(videoBytes, 'Smoke test goat clip', 'not-a-category'));
  check('unknown category is rejected', reply.status === 400, reply.body);

  const badForm = uploadForm(videoBytes, 'Not a video');
  badForm.set('video', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  reply = await creator.upload('/api/videos', badForm);
  check('unsupported file type is rejected', reply.status === 415, reply.body);

  reply = await creator.upload('/api/videos', uploadForm(videoBytes, 'Smoke test goat clip'));
  check('upload becomes pending, never public', reply.status === 201 && reply.body.video.status === 'pending', reply.body);
  const firstVideo = reply.body.video?.id as string;

  reply = await anonymous.request('GET', `/api/videos/${firstVideo}`);
  check('anonymous cannot fetch a pending video', reply.status === 404);
  reply = await anonymous.raw(`/media/videos/${firstVideo}`);
  check('anonymous cannot stream pending media by guessed URL', reply.status === 404);

  reply = await viewer.request('GET', `/api/videos/${firstVideo}`);
  check('another user cannot fetch a pending video', reply.status === 404);
  reply = await creator.request('GET', `/api/videos/${firstVideo}`);
  check('the owner can fetch their pending video', reply.status === 200 && reply.body.video.status === 'pending');

  reply = await viewer.request('PATCH', `/api/videos/${firstVideo}`, { caption: 'stolen' });
  check('another user cannot edit the video', reply.status === 403);

  reply = await viewer.request('GET', '/api/admin/counts');
  check('ordinary users are blocked from the moderation API', reply.status === 403);
  reply = await anonymous.request('GET', '/api/admin/counts');
  check('anonymous users are blocked from the moderation API', reply.status === 401);
  reply = await viewer.request('POST', `/api/admin/videos/${firstVideo}/approve`);
  check('ordinary users cannot approve videos', reply.status === 403);

  reply = await admin.request('GET', '/api/admin/videos?status=pending');
  check(
    'pending upload appears in the moderator queue',
    reply.status === 200 && reply.body.items.some((item: any) => item.id === firstVideo),
    reply.body,
  );

  reply = await creator.request('GET', '/api/feed');
  check('pending video never enters the public feed', !reply.body.items.some((item: any) => item.id === firstVideo));

  reply = await admin.request('POST', `/api/admin/videos/${firstVideo}/approve`);
  check('moderator approves the video', reply.status === 200 && reply.body.item.status === 'approved', reply.body);

  reply = await anonymous.request('GET', '/api/feed');
  check('approved video enters the public feed', reply.body.items.some((item: any) => item.id === firstVideo));

  let media = await anonymous.raw(`/media/videos/${firstVideo}`);
  check('approved media is public', media.status === 200 && media.headers.get('content-type') === 'video/mp4');
  await media.body?.cancel();

  media = await anonymous.raw(`/media/videos/${firstVideo}`, { range: 'bytes=0-99' });
  check('approved media supports range requests', media.status === 206 && media.headers.get('content-range'), media.status);
  await media.body?.cancel();

  reply = await creator.request('GET', '/api/notifications');
  check('creator is told the video was approved', reply.body.items.some((item: any) => item.type === 'approved'));

  // --------------------------------------------------------------- social
  reply = await viewer.request('POST', `/api/videos/${firstVideo}/like`);
  check('a signed-in user can like a video', reply.status === 200 && reply.body.liked === true, reply.body);
  reply = await viewer.request('POST', `/api/videos/${firstVideo}/like`);
  check('liking again unlikes it', reply.body.liked === false);
  reply = await viewer.request('POST', `/api/videos/${firstVideo}/like`);

  reply = await viewer.request('POST', `/api/videos/${firstVideo}/comments`, { body: 'Excellent goat.' });
  check('a comment is stored and returned', reply.status === 201 && reply.body.comment.body === 'Excellent goat.', reply.body);
  reply = await anonymous.request('GET', `/api/videos/${firstVideo}/comments`);
  check('comments are readable by anyone', reply.body.items?.length === 1 && reply.body.total === 1, reply.body);

  reply = await viewer.request('POST', `/api/users/${creatorId}/follow`);
  check('following a creator works', reply.status === 200 && reply.body.following === true);
  reply = await viewer.request('GET', '/api/feed?tab=following');
  check('following feed contains the creator’s approved video', reply.body.items.some((item: any) => item.id === firstVideo));

  reply = await viewer.request('POST', `/api/videos/${firstVideo}/events`, {
    watchSeconds: 2.8,
    completed: true,
    rewatched: true,
  });
  check('watch events are accepted', reply.status === 200);
  reply = await viewer.request('GET', '/api/me/interests');
  check('watching feeds the interest model', reply.body.items.length > 0, reply.body);

  reply = await viewer.request('POST', `/api/videos/${firstVideo}/not-interested`);
  check('not interested is recorded', reply.status === 200);
  reply = await viewer.request('GET', '/api/feed');
  check('not interested removes the video from that feed', !reply.body.items.some((item: any) => item.id === firstVideo));
  reply = await viewer.request('DELETE', `/api/videos/${firstVideo}/not-interested`);
  check('not interested can be undone', reply.status === 200);

  reply = await anonymous.request('GET', '/api/search?q=smoke');
  check('search finds approved videos', reply.body.videos?.some((item: any) => item.id === firstVideo), reply.body);

  // ------------------------------------------------------ edit -> re-review
  reply = await creator.request('PATCH', `/api/videos/${firstVideo}`, {
    caption: 'Smoke test goat clip, edited',
    category: 'baby-goats',
    hashtags: 'smoketest',
  });
  check('editing a published video returns it to review', reply.body.video?.status === 'pending', reply.body);
  reply = await anonymous.request('GET', '/api/feed');
  check('edited video leaves the public feed until re-approved', !reply.body.items.some((item: any) => item.id === firstVideo));
  reply = await admin.request('POST', `/api/admin/videos/${firstVideo}/approve`);
  check('moderator can re-approve an edited video', reply.status === 200 && reply.body.item.status === 'approved');

  // ------------------------------------------------------------- rejection
  reply = await creator.upload('/api/videos', uploadForm(videoBytes, 'Second smoke goat clip'));
  const secondVideo = reply.body.video?.id as string;
  reply = await admin.request('POST', `/api/admin/videos/${secondVideo}/reject`, { reason: 'Caption or tags need work' });
  check('moderator rejects with a reason', reply.status === 200 && reply.body.item.status === 'rejected', reply.body);
  reply = await creator.request('GET', `/api/videos/${secondVideo}`);
  check('creator sees why it was rejected', reply.body.video.rejectReason === 'Caption or tags need work', reply.body);
  reply = await anonymous.request('GET', `/api/videos/${secondVideo}`);
  check('rejected videos stay private', reply.status === 404);
  reply = await anonymous.request('GET', '/api/feed');
  check('rejected videos never enter the feed', !reply.body.items.some((item: any) => item.id === secondVideo));
  reply = await admin.request('POST', `/api/admin/videos/${secondVideo}/approve`);
  check('moderator can approve a rejected video later', reply.status === 200);

  // ---------------------------------------------------------- remove/report
  reply = await viewer.request('POST', `/api/videos/${firstVideo}/report`, {
    reason: 'Not actually a goat',
    note: 'Smoke test report',
  });
  check('a video can be reported', reply.status === 201, reply.body);
  reply = await admin.request('GET', '/api/admin/reports?status=open');
  const report = reply.body.items?.find((item: any) => item.targetId === firstVideo);
  check('report appears in the moderator queue', Boolean(report));

  reply = await admin.request('POST', `/api/admin/reports/${report?.id}/resolve`, { action: 'remove_content' });
  check('resolving a report can remove the video', reply.status === 200);
  reply = await anonymous.request('GET', '/api/feed');
  check('reported video is gone from the public feed', !reply.body.items.some((item: any) => item.id === firstVideo));
  media = await anonymous.raw(`/media/videos/${firstVideo}`);
  check('reported video media is no longer public', media.status === 404);

  reply = await admin.request('POST', `/api/admin/videos/${secondVideo}/remove`, { reason: 'Smoke removal' });
  check('moderator can remove a published video', reply.status === 200 && reply.body.item.status === 'removed');

  // --------------------------------------------------------------- account
  reply = await admin.request('POST', `/api/admin/users/${creatorId}/suspend`, { reason: 'Smoke test suspension' });
  check('moderator can suspend an account', reply.status === 200);
  reply = await anonymous.request('GET', '/api/users/goatcreator');
  check('suspended profile is hidden', reply.status === 404);
  reply = await creator.request('GET', '/api/auth/me');
  check('suspension invalidates the account session', reply.body.user === null, reply.body);
  reply = await creator.request('POST', '/api/auth/login', { identifier: 'goatcreator', password: 'clover-patch-1' });
  check('suspended account cannot sign in', reply.status === 403);

  // --------------------------------------------------------------- recovery
  reply = await anonymous.request('POST', '/api/auth/password/request', { email: 'viewer@smoke.test' });
  const resetUrl = reply.body.resetUrl as string | undefined;
  check('password reset link is issued in development', Boolean(resetUrl));
  const token = resetUrl ? new URL(resetUrl).searchParams.get('token') : null;
  reply = await anonymous.request('POST', '/api/auth/password/reset', { token, password: 'new-clover-3' });
  check('password reset signs the user in', reply.status === 200 && reply.body.user?.id === viewerId, reply.body);
  reply = await anonymous.request('POST', '/api/auth/login', { identifier: 'goatviewer', password: 'new-clover-3' });
  check('new password works', reply.status === 200);

  // -------------------------------------------------------------- hardening
  reply = await anonymous.request('GET', '/api/config');
  check('public config never exposes a moderation bypass', reply.body.moderation === 'manual');

  const forged = await anonymous.request(
    'POST',
    '/api/auth/login',
    { identifier: 'goatviewer', password: 'new-clover-3' },
    { origin: 'http://evil.example' },
  );
  check('cross-origin state changes are blocked', forged.status === 403);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(`Failures:\n${failures.map((name) => `  - ${name}`).join('\n')}`);
  }
}

try {
  await main();
} catch (error) {
  failures.push('unexpected exception');
  console.error('\nSmoke test stopped:', error);
} finally {
  if (runtime.server) {
    runtime.server.kill('SIGTERM');
    await wait(700);
    runtime.server.kill('SIGKILL');
  }
  if (process.exitCode === undefined) {
    process.exitCode = failures.length ? 1 : 0;
  }
  if (failures.length) {
    const logPath = path.join(tempRoot, 'server.log');
    if (fs.existsSync(logPath)) {
      console.error(`\nServer log: ${logPath}`);
    }
    console.error('Temporary data kept for inspection.');
  } else {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('Temporary data removed.');
  }
}
