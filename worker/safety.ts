// Automatic safety screening and the consequences of failing it.
//
// Every upload is looked at before a person sees it: a vision model on Workers
// AI answers a yes/no question about gore, and a high enough probability sends
// the post straight to the rejected pile instead of the queue. Nothing is
// deleted and nothing is decided for good — a moderator can still approve a
// post the filter got wrong, which is why the score is written on the row.
//
// Repeated flags become warnings, whether they are accidents or someone
// testing the filter. The third warning suspends the account. Both warnings and
// suspensions carry an emailed appeal link.

import { Env, now, randomToken, sha256, uid } from './lib';
import { safety } from './config';
import { appealUrl, banEmail, decisionEmail, mailSite, sendMail, warningEmail } from './email';

export interface ScreenImage {
  bytes: ArrayBuffer | Uint8Array;
  mime: string;
}

export interface ScreenResult {
  /** True when at least one image was over the threshold. */
  flagged: boolean;
  /** Highest gore probability seen, 0 when nothing could be checked. */
  score: number;
  /** How many images were actually checked. */
  checked: number;
  /** 'ai' when the model ran, 'none' when it is not configured or failed. */
  method: 'ai' | 'none';
}

const AI_MODEL = '@cf/cloudflare/clef-flash';
const MAX_IMAGES = 3;
const AI_TIMEOUT_MS = 9000;

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < view.length; index += chunk) {
    binary += String.fromCharCode(...view.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Pulls the gore probability out of whichever shape the model returned. */
function readProbability(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const answers = record.answers;
  if (answers && typeof answers === 'object') {
    const gore = (answers as Record<string, unknown>).gore;
    if (typeof gore === 'number') return gore;
    if (gore && typeof gore === 'object') {
      const value = (gore as Record<string, unknown>).noul ?? (gore as Record<string, unknown>).true;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return null;
}

async function askModel(env: Env, image: ScreenImage): Promise<number | null> {
  if (!env.AI) return null;
  const call = env.AI.run(AI_MODEL, {
    model: 'clef-flash',
    state: 'You are screening uploads for a video site about goats. The site does not allow graphic gore.',
    questions: {
      gore: {
        type: 'noul',
        instructions:
          'Does this image show graphic gore: visible blood, open wounds, internal tissue, a dead or badly injured animal?',
        criteria: {
          true: 'Blood, wounds, exposed tissue or a badly injured or dead animal are clearly visible.',
          false: 'No blood, wounds or visible injury. Dirt, mud, straw, red buckets and butcher-shop signs do not count.',
        },
      },
    },
    images: [{ content_type: image.mime, base64: toBase64(image.bytes) }],
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS));
  const result = await Promise.race([call, timeout]);
  return readProbability(result);
}

/**
 * Screens up to three images (the poster frame of a video, or the first photos)
 * and returns the highest probability. Any failure means "not screened": the
 * post still goes to manual review, so a broken model never publishes anything.
 */
export async function screenImages(env: Env, images: ScreenImage[]): Promise<ScreenResult> {
  const usable = images.filter((image) => image.bytes.byteLength > 0).slice(0, MAX_IMAGES);
  if (!env.AI || !usable.length) return { flagged: false, score: 0, checked: 0, method: 'none' };

  try {
    const scores = await Promise.all(usable.map((image) => askModel(env, image)));
    const known = scores.filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
    if (!known.length) return { flagged: false, score: 0, checked: 0, method: 'none' };
    const score = Math.max(...known);
    return {
      flagged: score >= safety.goreThreshold,
      score: Number(score.toFixed(3)),
      checked: known.length,
      method: 'ai',
    };
  } catch {
    return { flagged: false, score: 0, checked: 0, method: 'none' };
  }
}

export interface WarningResult {
  warningId: string;
  count: number;
  banned: boolean;
  mailStatus: 'sent' | 'failed' | 'skipped';
}

/** Warnings that still count: an accepted appeal removes one from the tally. */
export async function activeWarningCount(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM warnings WHERE user_id = ? AND appeal_status <> 'accepted'",
  )
    .bind(userId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function createAppealRecord(
  env: Env,
  options: { kind: 'ban' | 'warning'; userId: string; warningId?: string | null; reason: string },
): Promise<{ id: string; token: string }> {
  const token = randomToken(24);
  const id = uid('apl');
  await env.DB.prepare(
    `INSERT INTO appeals (id, token_hash, kind, user_id, warning_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'sent', ?)`,
  )
    .bind(id, await sha256(token), options.kind, options.userId, options.warningId ?? null, options.reason, now())
    .run();
  return { id, token };
}

async function notifyModerators(env: Env, text: string) {
  const admins = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL")
    .all<{ id: string }>();
  const rows = admins.results || [];
  if (!rows.length) return;
  const createdAt = now();
  await env.DB.batch(
    rows.map((admin) =>
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, detail, created_at) VALUES (?, ?, 'appeal', ?, ?)",
      ).bind(uid('ntf'), admin.id, text, createdAt),
    ),
  );
}

export async function notifyUser(env: Env, userId: string, type: 'warning' | 'ban', detail: string) {
  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(uid('ntf'), userId, type, detail, now())
    .run();
}

async function accountEmail(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  return row?.email ?? null;
}

/**
 * Suspends an account, keeps the reason on the row, emails the appeal link and
 * leaves one appeal record. Used by both the moderator action and the third
 * automatic strike, so the two cannot drift apart.
 */
export async function banAccount(
  env: Env,
  options: { userId: string; reason: string; adminId?: string | null },
): Promise<{ appealId: string; appealToken: string; mailStatus: 'sent' | 'failed' | 'skipped' }> {
  const bannedAt = now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET status = 'suspended', suspended_reason = ?, suspended_at = ?, suspended_by = ? WHERE id = ?",
    ).bind(options.reason, bannedAt, options.adminId ?? null, options.userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(options.userId),
    env.DB.prepare(
      "UPDATE posts SET status = 'removed', removed_reason = 'Account suspended' WHERE owner_id = ? AND status = 'approved'",
    ).bind(options.userId),
  ]);

  const appeal = await createAppealRecord(env, {
    kind: 'ban',
    userId: options.userId,
    reason: options.reason,
  });

  const email = await accountEmail(env, options.userId);
  let mailStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
  if (email) {
    const content = banEmail({ reason: options.reason, appealUrl: appealUrl(env, appeal.token), site: mailSite(env) });
    mailStatus = await sendMail(env, {
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      kind: 'ban',
      userId: options.userId,
      appealId: appeal.id,
    });
  }

  await notifyUser(env, options.userId, 'ban', `Account suspended: ${options.reason}`);
  return { appealId: appeal.id, appealToken: appeal.token, mailStatus };
}

/**
 * Records a warning and escalates to a suspension at the limit. The third
 * warning bans automatically, so nobody needs to be watching the queue for a
 * script that keeps retrying the same upload.
 */
export async function addWarning(
  env: Env,
  options: {
    userId: string;
    postId?: string | null;
    kind: 'gore' | 'manual';
    reason: string;
    source: 'auto' | 'moderator';
    adminId?: string | null;
  },
): Promise<WarningResult> {
  const warningId = uid('wrn');
  const createdAt = now();
  await env.DB.prepare(
    `INSERT INTO warnings (id, user_id, post_id, kind, reason, source, admin_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(warningId, options.userId, options.postId ?? null, options.kind, options.reason, options.source, options.adminId ?? null, createdAt)
    .run();

  const count = await activeWarningCount(env, options.userId);
  const limit = safety.warningLimit;

  if (count >= limit) {
    const banned = await banAccount(env, {
      userId: options.userId,
      reason: `Warning limit reached (${limit} warnings on record). Latest: ${options.reason}`,
      adminId: options.adminId ?? null,
    });
    await env.DB.prepare("UPDATE warnings SET appeal_status = 'declined' WHERE id = ?").bind(warningId).run();
    return { warningId, count, banned: true, mailStatus: banned.mailStatus };
  }

  const appeal = await createAppealRecord(env, {
    kind: 'warning',
    userId: options.userId,
    warningId,
    reason: options.reason,
  });

  const email = await accountEmail(env, options.userId);
  let mailStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
  if (email) {
    const content = warningEmail({
      reason: options.reason,
      count,
      limit,
      appealUrl: appealUrl(env, appeal.token),
      site: mailSite(env),
    });
    mailStatus = await sendMail(env, {
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      kind: 'warning',
      userId: options.userId,
      appealId: appeal.id,
    });
  }

  await notifyUser(
    env,
    options.userId,
    'warning',
    `Warning ${count} of ${limit}: ${options.reason}`,
  );
  return { warningId, count, banned: false, mailStatus };
}

/** Lifts a suspension and puts back the posts that were hidden with it. */
export async function unbanAccount(env: Env, userId: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET status = 'active', suspended_reason = NULL, suspended_at = NULL, suspended_by = NULL WHERE id = ?",
    ).bind(userId),
    env.DB.prepare(
      "UPDATE posts SET status = 'approved', removed_reason = NULL, published_at = COALESCE(published_at, ?) WHERE owner_id = ? AND status = 'removed' AND removed_reason = 'Account suspended'",
    ).bind(now(), userId),
  ]);
}

/** Sends the outcome of an appeal and marks it resolved. */
export async function resolveAppeal(
  env: Env,
  options: {
    appeal: { id: string; kind: 'ban' | 'warning'; user_id: string; warning_id: string | null };
    accepted: boolean;
    note?: string | null;
    moderatorId: string;
  },
) {
  const resolvedAt = now();
  await env.DB.prepare(
    "UPDATE appeals SET status = ?, resolved_at = ?, resolved_by = ?, decision_note = ? WHERE id = ?",
  )
    .bind(options.accepted ? 'accepted' : 'declined', resolvedAt, options.moderatorId, options.note ?? null, options.appeal.id)
    .run();

  if (options.accepted) {
    if (options.appeal.kind === 'ban') {
      await unbanAccount(env, options.appeal.user_id);
    } else if (options.appeal.warning_id) {
      await env.DB.prepare("UPDATE warnings SET appeal_status = 'accepted' WHERE id = ?")
        .bind(options.appeal.warning_id)
        .run();
    }
  } else if (options.appeal.warning_id) {
    await env.DB.prepare("UPDATE warnings SET appeal_status = 'declined' WHERE id = ?")
      .bind(options.appeal.warning_id)
      .run();
  }

  const email = await accountEmail(env, options.appeal.user_id);
  if (email) {
    const content = decisionEmail({
      kind: options.appeal.kind,
      accepted: options.accepted,
      note: options.note,
      site: mailSite(env),
    });
    await sendMail(env, {
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      kind: 'appeal-decision',
      userId: options.appeal.user_id,
      appealId: options.appeal.id,
    });
  }

  await notifyUser(
    env,
    options.appeal.user_id,
    options.appeal.kind === 'ban' ? 'ban' : 'warning',
    options.accepted
      ? `Your ${options.appeal.kind === 'ban' ? 'suspension' : 'warning'} was reversed.`
      : `Your appeal against the ${options.appeal.kind === 'ban' ? 'suspension' : 'warning'} was declined.`,
  );
}

export { notifyModerators };
