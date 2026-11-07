// Appeals: the link a suspended or warned person receives by email, and the
// queue moderators work through in the report center.
//
// The token in the link is the only thing that authorises reading or filing an
// appeal, and only its hash is stored. That keeps the page usable without a
// session, which matters because a suspended account cannot sign in.

import {
  Env,
  bad,
  denied,
  json,
  missing,
  now,
  optionalStr,
  rateLimit,
  readJson,
  sha256,
  str,
} from '../lib';
import { requireAdmin } from '../session';
import { addWarning, notifyModerators, resolveAppeal } from '../safety';
import { safety } from '../config';

interface AppealRow {
  id: string;
  kind: 'ban' | 'warning';
  user_id: string;
  warning_id: string | null;
  reason: string;
  status: string;
  message: string | null;
  created_at: number;
  submitted_at: number | null;
  resolved_at: number | null;
  decision_note: string | null;
}

async function byToken(env: Env, token: string) {
  const cleaned = token.replace(/[^a-zA-Z0-9_-]/g, '');
  if (cleaned.length < 16) throw missing('That appeal link is not valid.');
  return env.DB.prepare(
    `SELECT a.*, u.username, u.status AS user_status
       FROM appeals a JOIN users u ON u.id = a.user_id
      WHERE a.token_hash = ?`,
  )
    .bind(await sha256(cleaned))
    .first<AppealRow & { username: string; user_status: string }>();
}

/** Public: what the link is about, and whether it can still be answered. */
export async function readAppeal(req: Request, env: Env, token: string) {
  const appeal = await byToken(env, token);
  if (!appeal) throw missing('That appeal link is not valid. It may have expired or already been used.');
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM warnings WHERE user_id = ? AND appeal_status <> 'accepted'",
  )
    .bind(appeal.user_id)
    .first<{ n: number }>();
  return json({
    kind: appeal.kind,
    reason: appeal.reason,
    status: appeal.status,
    submittedAt: appeal.submitted_at,
    createdAt: appeal.created_at,
    resolvedAt: appeal.resolved_at,
    decisionNote: appeal.status === 'declined' ? appeal.decision_note : null,
    username: appeal.username,
    warnings: Number(count?.n ?? 0),
    accountStatus: appeal.user_status,
  });
}

/** Public: file the appeal. One answer per link. */
export async function submitAppeal(req: Request, env: Env, token: string) {
  const appeal = await byToken(env, token);
  if (!appeal) throw missing('That appeal link is not valid.');
  if (appeal.status === 'open') throw bad('This appeal is already waiting for a moderator.');
  if (appeal.status === 'accepted' || appeal.status === 'declined') {
    throw bad('This appeal has already been decided.');
  }

  await rateLimit(env, `appeal:${appeal.id}`, 5, 60 * 60 * 1000, 'That is enough attempts. Try again later.');
  const body = await readJson(req);
  const message = str(body.message, 'Tell the moderator what happened', 2000, 10);
  const context = optionalStr(body.context, 400) ?? null;

  await env.DB.prepare(
    "UPDATE appeals SET status = 'open', message = ?, submitted_at = ? WHERE id = ?",
  )
    .bind(context ? `${message}\n\n---\n${context}` : message, now(), appeal.id)
    .run();

  await notifyModerators(
    env,
    `Appeal from @${appeal.username}: the ${appeal.kind === 'ban' ? 'suspension' : 'warning'} was "${appeal.reason}".`,
  );

  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, type, detail, created_at)
     VALUES (?, ?, 'appeal', ?, ?)`,
  )
    .bind(`ntf_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`, appeal.user_id, 'Your appeal is with a moderator.', now())
    .run();

  return json({ ok: true, message: 'Thank you. A moderator reads every appeal, usually within a few days.' });
}

interface AdminAppealRow {
  id: string;
  kind: 'ban' | 'warning';
  reason: string;
  status: string;
  message: string | null;
  created_at: number;
  submitted_at: number | null;
  username: string;
  display_name: string;
  email: string;
  account_status: string;
  warning_count: number;
  mail_status: string | null;
}

export async function adminAppeals(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const status = url.searchParams.get('status') === 'resolved' ? 'resolved' : 'open';
  const rows = await env.DB.prepare(
    `SELECT a.id, a.kind, a.reason, a.status, a.message, a.created_at, a.submitted_at,
            u.username, u.display_name, u.email, u.status AS account_status,
            (SELECT COUNT(*) FROM warnings w WHERE w.user_id = u.id AND w.appeal_status <> 'accepted') AS warning_count,
            (SELECT e.status FROM emails e WHERE e.appeal_id = a.id ORDER BY e.created_at DESC LIMIT 1) AS mail_status
       FROM appeals a JOIN users u ON u.id = a.user_id
      WHERE a.status ${status === 'open' ? "= 'open'" : "IN ('accepted', 'declined')"}
      ORDER BY ${status === 'open' ? 'a.submitted_at ASC' : 'a.resolved_at DESC'}
      LIMIT 50`,
  ).all<AdminAppealRow>();
  return json({
    items: (rows.results || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      reason: row.reason,
      status: row.status,
      message: row.message,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      accountStatus: row.account_status,
      warningCount: Number(row.warning_count),
      mailStatus: row.mail_status,
    })),
    open: status === 'open',
  });
}

export async function decideAppeal(req: Request, env: Env, id: string) {
  const admin = await requireAdmin(req, env);
  const body = await readJson(req);
  const accepted = body.action === 'accept';
  if (!accepted && body.action !== 'decline') throw bad('Choose accept or decline.');
  const note = optionalStr(body.note, 400) ?? null;

  const appeal = await env.DB.prepare('SELECT id, kind, user_id, warning_id, status FROM appeals WHERE id = ?')
    .bind(id)
    .first<{ id: string; kind: 'ban' | 'warning'; user_id: string; warning_id: string | null; status: string }>();
  if (!appeal) throw missing('No such appeal.');
  if (appeal.status !== 'open') throw bad('That appeal has already been decided.');

  await resolveAppeal(env, {
    appeal: { id: appeal.id, kind: appeal.kind, user_id: appeal.user_id, warning_id: appeal.warning_id },
    accepted,
    note,
    moderatorId: admin.id,
  });

  return json({
    ok: true,
    message: accepted
      ? appeal.kind === 'ban'
        ? 'Appeal accepted. The account is active again and its posts are back.'
        : 'Appeal accepted. That warning no longer counts.'
      : 'Appeal declined. The account has been told why.',
  });
}

/** A warning written by a moderator, which can be appealed like any other. */
export async function warnUser(req: Request, env: Env, id: string) {
  const admin = await requireAdmin(req, env);
  if (id === admin.id) throw bad('You cannot warn your own account.');
  const body = await readJson(req);
  const reason = str(body.reason, 'Reason for the warning', 300, 6);

  const target = await env.DB.prepare('SELECT id, role, deleted_at FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string; role: string; deleted_at: number | null }>();
  if (!target) throw missing('No such account.');
  if (target.deleted_at) throw bad('That account is removed.');
  if (target.role === 'admin') throw denied('Moderators are not warned from here.');

  const result = await addWarning(env, {
    userId: id,
    kind: 'manual',
    reason,
    source: 'moderator',
    adminId: admin.id,
  });

  return json({
    ok: true,
    count: result.count,
    banned: result.banned,
    email: result.mailStatus,
    message: result.banned
      ? `That was warning ${safety.warningLimit} of ${safety.warningLimit}, so the account is suspended and the appeal link has been emailed.`
      : `Warning ${result.count} of ${safety.warningLimit} recorded${result.mailStatus === 'sent' ? ' and emailed' : ''}.`,
  });
}
