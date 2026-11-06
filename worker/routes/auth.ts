import { limits } from '../config';
import {
  Env,
  bad,
  hashPassword,
  ip,
  json,
  missing,
  normalizeEmail,
  normalizeUsername,
  now,
  passwordProblem,
  rateLimit,
  randomToken,
  readJson,
  sha256,
  str,
  uid,
  verifyPassword,
} from '../lib';
import {
  createSession,
  currentUser,
  destroySession,
  bearer,
  requireUser,
} from '../session';
import { publicUser, UserRow, USER_SELECT } from '../models';

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function uploadAvatar(req: Request, env: Env, origin: string) {
  const user = await requireUser(req, env);
  const form = await req.formData().catch(() => null);
  if (!form) throw bad('That image could not be read.');
  const file = form.get('avatar');
  if (!(file instanceof File) || file.size === 0) throw bad('Choose a photo first.');
  const type = file.type || 'image/jpeg';
  if (!AVATAR_TYPES.has(type)) throw bad('Profile photos need to be JPEG, PNG or WebP.');
  if (file.size > limits.maxAvatarMb * 1024 * 1024) {
    throw bad(`Keep profile photos under ${Math.round(limits.maxAvatarMb * 1024)} KB.`);
  }
  const bytes = await file.arrayBuffer();
  if (file.size < 24) throw bad('That file looks empty.');
  await env.DB.prepare(
    'UPDATE users SET avatar_bytes = ?, avatar_mime = ?, avatar_version = avatar_version + 1 WHERE id = ?',
  )
    .bind(bytes, type, user.id)
    .run();
  return json({ user: await meFor(env, origin, user.id) });
}

export async function deleteAvatar(req: Request, env: Env, origin: string) {
  const user = await requireUser(req, env);
  await env.DB.prepare(
    'UPDATE users SET avatar_bytes = NULL, avatar_mime = NULL, avatar_version = avatar_version + 1 WHERE id = ?',
  )
    .bind(user.id)
    .run();
  return json({ user: await meFor(env, origin, user.id) });
}

async function meFor(env: Env, origin: string, userId: string) {
  const row = await env.DB.prepare(`${USER_SELECT(userId)} WHERE u.id = ?`)
    .bind(userId, userId, userId)
    .first<UserRow>();
  if (!row) return null;
  const unread = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
  )
    .bind(userId)
    .first<{ n: number }>();
  return {
    ...publicUser(origin, row, userId),
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    unreadNotifications: unread?.n || 0,
    suspendedReason: row.suspended_reason,
  };
}

export async function register(req: Request, env: Env, origin: string) {
  await rateLimit(env, `register:${ip(req)}`, 5, 60 * 60 * 1000, 'Too many sign-ups from here. Try again later.');
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const displayName = str(body.displayName, 'Your name', 40, 1);
  const password = body.password;
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);

  const clash = await env.DB.prepare('SELECT email, username FROM users WHERE email = ? OR username = ?')
    .bind(email, username)
    .first<{ email: string; username: string }>();
  if (clash) {
    throw bad(
      clash.email === email
        ? 'An account with that email already exists.'
        : 'That username is taken. Try another.',
    );
  }

  const id = uid('usr');
  const passwordHash = await hashPassword(env, password as string);
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, display_name, bio, password_hash, created_at)
     VALUES (?, ?, ?, ?, '', ?, ?)`,
  )
    .bind(id, email, username, displayName, passwordHash, now())
    .run();
  await env.DB.prepare('INSERT INTO account_events (id, kind, created_at) VALUES (?, ?, ?)')
    .bind(uid('evt'), 'signup', now())
    .run();

  const session = await createSession(env, id);
  return json({ token: session.token, user: await meFor(env, origin, id) }, 201);
}

export async function login(req: Request, env: Env, origin: string) {
  const body = await readJson(req);
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
  if (!identifier) throw bad('Enter your email or username.');
  await rateLimit(
    env,
    `login:${ip(req)}`,
    12,
    10 * 60 * 1000,
    'Too many sign-in attempts. Wait a few minutes and try again.',
  );

  const row = await env.DB.prepare(
    'SELECT id, password_hash FROM users WHERE email = ? OR username = ?',
  )
    .bind(identifier, identifier)
    .first<{ id: string; password_hash: string }>();
  const password = typeof body.password === 'string' ? body.password : '';
  const ok = row ? await verifyPassword(env, password, row.password_hash) : false;
  if (!row || !ok) throw bad('That email, username or password is not right.');

  const session = await createSession(env, row.id);
  return json({ token: session.token, user: await meFor(env, origin, row.id) });
}

export async function logout(req: Request, env: Env) {
  const token = bearer(req);
  if (token) await destroySession(env, token);
  return json({ ok: true });
}

export async function me(req: Request, env: Env, origin: string) {
  const user = await currentUser(req, env);
  if (!user) return json({ user: null });
  return json({ user: await meFor(env, origin, user.id) });
}

export async function requestReset(req: Request, env: Env, origin: string) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  await rateLimit(
    env,
    `reset:${ip(req)}`,
    5,
    60 * 60 * 1000,
    'Too many reset requests. Try again later.',
  );
  const row = await env.DB.prepare('SELECT id, display_name FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; display_name: string }>();
  // Always answer the same way so the endpoint cannot be used to find accounts.
  if (!row) return json({ ok: true, resetPath: null });

  const token = randomToken(24);
  const createdAt = now();
  await env.DB.prepare(
    'INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(uid('rst'), row.id, await sha256(token), createdAt, createdAt + 30 * 60 * 1000)
    .run();

  // No mail provider is configured for this deployment, so the link is returned
  // to the browser and shown to the person who requested it. It is single use
  // and expires in 30 minutes.
  const site = (req.headers.get('origin') || origin).replace(/\/+$/, '');
  const resetPath = `/reset-password?token=${token}`;
  return json({
    ok: true,
    resetPath,
    resetUrl: `${site}/#${resetPath}`,
    origin,
  });
}

export async function resetPassword(req: Request, env: Env) {
  const body = await readJson(req);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) throw bad('That reset link is incomplete.');
  const problem = passwordProblem(body.password);
  if (problem) throw bad(problem);

  const hash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?',
  )
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
  if (!row || row.used_at || row.expires_at < now()) {
    throw bad('That reset link has expired. Request a fresh one.');
  }
  const passwordHash = await hashPassword(env, body.password as string);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, row.user_id),
    env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').bind(now(), row.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id),
  ]);
  const session = await createSession(env, row.user_id);
  return json({ ok: true, token: session.token, user: await meFor(env, new URL(req.url).origin, row.user_id) });
}

export async function changePassword(req: Request, env: Env) {
  const user = await requireUser(req, env);
  const body = await readJson(req);
  const problem = passwordProblem(body.newPassword);
  if (problem) throw bad(problem);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row) throw missing('That account is gone.');
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!(await verifyPassword(env, current, row.password_hash))) {
    throw bad('That current password is not right.');
  }
  const passwordHash = await hashPassword(env, body.newPassword as string);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, user.id).run();
  return json({ ok: true });
}

export async function usernameAvailable(env: Env, raw: string) {
  const value = raw.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(value)) return json({ available: false, reason: 'Usernames use 3 to 20 lowercase letters, numbers or underscores.' });
  const row = await env.DB.prepare('SELECT 1 AS n FROM users WHERE username = ?').bind(value).first<{ n: number }>();
  return json({ available: !row });
}

export async function updateProfile(req: Request, env: Env, origin: string) {
  const user = await requireUser(req, env);
  const body = await readJson(req);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.displayName !== undefined) {
    updates.push('display_name = ?');
    values.push(str(body.displayName, 'Your name', 40, 1));
  }
  if (body.username !== undefined) {
    const username = normalizeUsername(body.username);
    const clash = await env.DB.prepare('SELECT id FROM users WHERE username = ? AND id <> ?')
      .bind(username, user.id)
      .first<{ id: string }>();
    if (clash) throw bad('That username is taken. Try another.');
    updates.push('username = ?');
    values.push(username);
  }
  if (body.bio !== undefined) {
    updates.push('bio = ?');
    values.push(typeof body.bio === 'string' ? body.bio.trim().slice(0, 200) : '');
  }
  if (!updates.length) throw bad('Nothing to update.');

  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values, user.id)
    .run();
  return json({ user: await meFor(env, origin, user.id) });
}

export async function publicProfile(
  env: Env,
  origin: string,
  username: string,
  viewerId: string | null,
) {
  const row = await env.DB.prepare(`${USER_SELECT(viewerId)} WHERE u.username = ?`)
    .bind(...(viewerId ? [viewerId, viewerId] : []), username)
    .first<UserRow>();
  if (!row) throw missing('No creator with that username.');
  return json({ user: publicUser(origin, row, viewerId) });
}
