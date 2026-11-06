import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { get, run, usernameTaken, emailTaken } from '../db.ts';
import {
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  verifyPassword,
} from '../auth.ts';
import { HttpError, absoluteOrigin, checkEmail, checkPassword, checkUsername, cleanText, enforceRate, isReservedUsername } from '../util.ts';
import { getMe } from '../profile.ts';
import { IS_PRODUCTION, categories, limits, moderation, resetLinkExposed } from '../config.ts';
import { emailDeliveryConfigured, sendPasswordResetEmail } from '../email.ts';
import type { AppConfigDTO } from '../../shared/types.ts';
import {
  COMMENT_REPORT_REASONS,
  GUIDELINES_SUMMARY,
  REJECTION_REASONS,
  VIDEO_REPORT_REASONS,
} from '../../shared/policy.ts';

export const authRouter = Router();

authRouter.get('/config', (_req, res) => {
  const payload: AppConfigDTO = {
    limits: {
      maxUploadMb: limits.maxUploadMb,
      maxDurationSeconds: limits.maxDurationSeconds,
      minDurationSeconds: limits.minDurationSeconds,
      maxAvatarMb: limits.maxAvatarMb,
      maxCaptionLength: limits.maxCaptionLength,
      maxCommentsPerMinute: limits.maxCommentsPerMinute,
    },
    categories,
    moderation: moderation.mode,
    resetLinkExposed,
    reportReasons: { video: VIDEO_REPORT_REASONS, comment: COMMENT_REPORT_REASONS },
    rejectReasons: REJECTION_REASONS,
    guidelines: GUIDELINES_SUMMARY,
  };
  res.json(payload);
});

authRouter.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user: getMe(req.user.id) });
});

authRouter.post('/auth/register', async (req, res) => {
  enforceRate(`register:${req.ip}`, 8, 60 * 60 * 1000, 'Too many accounts created from this connection. Try again later.');
  const email = checkEmail(req.body?.email);
  if (email.error) throw new HttpError(400, email.error, { fields: { email: email.error } });
  const username = checkUsername(req.body?.username);
  if (username.error) throw new HttpError(400, username.error, { fields: { username: username.error } });
  const passwordError = checkPassword(req.body?.password);
  if (passwordError) throw new HttpError(400, passwordError, { fields: { password: passwordError } });
  const displayName = cleanText(req.body?.displayName, 40) || username.username;

  if (isReservedUsername(username.username)) {
    throw new HttpError(409, 'That username is reserved.', { fields: { username: 'That username is reserved.' } });
  }
  if (usernameTaken(username.username)) {
    throw new HttpError(409, 'That username is taken.', { fields: { username: 'Try another username.' } });
  }
  if (emailTaken(email.email)) {
    throw new HttpError(409, 'An account already uses that email address.', {
      fields: { email: 'An account already uses this email.' },
    });
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(String(req.body.password));
  try {
    run(
      `INSERT INTO users (id, email, username, display_name, bio, password_hash, role, status, created_at)
       VALUES (?, ?, ?, ?, '', ?, 'user', 'active', ?)`,
      id,
      email.email,
      username.username,
      displayName,
      passwordHash,
      Date.now(),
    );
  } catch {
    throw new HttpError(409, 'That account could not be created. Try a different username or email.');
  }
  createSession(res, id);
  res.status(201).json({ user: getMe(id) });
});

authRouter.post('/auth/login', async (req, res) => {
  enforceRate(`login:${req.ip}`, 12, 10 * 60 * 1000, 'Too many sign-in attempts. Wait a few minutes and try again.');
  const identifier = String(req.body?.identifier ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!identifier || !password) throw new HttpError(400, 'Enter your email or username and password.');

  const row = get<{ id: string; password_hash: string; status: string }>(
    `SELECT id, password_hash, status FROM users WHERE lower(email) = ? OR lower(username) = ?`,
    identifier,
    identifier,
  );
  const ok = row ? await verifyPassword(password, row.password_hash) : false;
  if (!row || !ok) throw new HttpError(401, 'Those details do not match an account.');
  if (row.status === 'suspended') {
    throw new HttpError(403, 'This account is suspended. Contact the moderator if you think that is a mistake.');
  }
  createSession(res, row.id);
  res.json({ user: getMe(row.id) });
});

authRouter.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

authRouter.post('/auth/password/request', async (req, res) => {
  enforceRate(`reset:${req.ip}`, 6, 60 * 60 * 1000, 'Too many reset requests. Try again in an hour.');
  const email = checkEmail(req.body?.email);
  if (email.error) throw new HttpError(400, email.error);
  const user = get<{ id: string }>(`SELECT id FROM users WHERE lower(email) = ?`, email.email);

  // Always answer the same way so the endpoint cannot be used to discover accounts.
  const response: { ok: true; resetUrl?: string } = { ok: true };
  if (user) {
    const token = randomBytes(32).toString('base64url');
    run(
      `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      user.id,
      sha256(token),
      Date.now(),
      Date.now() + 60 * 60 * 1000,
    );
    const url = `${absoluteOrigin(req)}/reset-password?token=${encodeURIComponent(token)}`;
    if (!IS_PRODUCTION) {
      console.log(`[GoatMedia] Password reset link for ${email.email}: ${url}`);
    }
    if (emailDeliveryConfigured()) {
      const account = get<{ username: string }>(`SELECT username FROM users WHERE id = ?`, user.id);
      await sendPasswordResetEmail({
        to: email.email,
        username: account?.username ?? 'there',
        resetUrl: url,
      });
    } else if (IS_PRODUCTION && !resetLinkExposed) {
      console.warn(
        `[GoatMedia] Password reset requested for ${email.email}, but no email delivery is configured. ` +
          'Set EMAIL_API_KEY and EMAIL_FROM before opening the site to the public.',
      );
    }
    if (resetLinkExposed) response.resetUrl = url;
  } else {
    // Keep timing roughly comparable for unknown addresses.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  res.json(response);
});

authRouter.post('/auth/password/reset', async (req, res) => {
  enforceRate(`reset-confirm:${req.ip}`, 10, 60 * 60 * 1000, 'Too many attempts. Try again later.');
  const token = String(req.body?.token ?? '');
  const passwordError = checkPassword(req.body?.password);
  if (passwordError) throw new HttpError(400, passwordError, { fields: { password: passwordError } });
  if (!token) throw new HttpError(400, 'That reset link is incomplete.');

  const row = get<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    sha256(token),
    Date.now(),
  );
  if (!row) throw new HttpError(400, 'That reset link has expired. Request a new one.');
  const passwordHash = await hashPassword(String(req.body.password));
  run(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, row.user_id);
  run(`UPDATE password_resets SET used_at = ? WHERE id = ?`, Date.now(), row.id);
  run(`DELETE FROM sessions WHERE user_id = ?`, row.user_id);
  createSession(res, row.user_id);
  res.json({ user: getMe(row.user_id) });
});

authRouter.post('/auth/password/change', requireUser, async (req, res) => {
  const user = get<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, req.user!.id);
  if (!user) throw new HttpError(404, 'Account not found.');
  const ok = await verifyPassword(String(req.body?.currentPassword ?? ''), user.password_hash);
  if (!ok) throw new HttpError(400, 'Your current password is not correct.', { fields: { currentPassword: 'Incorrect password.' } });
  const error = checkPassword(req.body?.newPassword);
  if (error) throw new HttpError(400, error, { fields: { newPassword: error } });
  const hash = await hashPassword(String(req.body.newPassword));
  run(`UPDATE users SET password_hash = ? WHERE id = ?`, hash, req.user!.id);
  run(`DELETE FROM sessions WHERE user_id = ?`, req.user!.id);
  createSession(res, req.user!.id);
  res.json({ ok: true });
});

authRouter.get('/categories', (_req, res) => {
  res.json({
    categories: categories.map((category) => ({
      ...category,
      count:
        get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM videos WHERE status = 'approved' AND category = ?`,
          category.id,
        )?.n ?? 0,
    })),
  });
});

