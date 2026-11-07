import {
  Env,
  bad,
  ip,
  json,
  missing,
  normalizeEmail,
  now,
  optionalStr,
  rateLimit,
  readJson,
  str,
  uid,
} from '../lib';
import { currentUser, requireAdmin } from '../session';
import { contactCategory, CONTACT_CATEGORIES } from '../../shared/policy';

interface TicketRow {
  id: string;
  category: string;
  email: string;
  target_username: string | null;
  target_user_id: string | null;
  body: string;
  device: string;
  page_url: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
  resolution_note: string | null;
  reporter_id: string | null;
  reporter_username: string | null;
  reporter_display_name: string | null;
  target_id: string | null;
  target_name: string | null;
  target_display_name: string | null;
  target_status: string | null;
  target_deleted_at: number | null;
}

const TICKET_SELECT = `
  SELECT t.id, t.category, t.email, t.target_username, t.target_user_id, t.body, t.device,
         t.page_url, t.status, t.created_at, t.resolved_at, t.resolution_note,
         ru.id AS reporter_id, ru.username AS reporter_username, ru.display_name AS reporter_display_name,
         tu.id AS target_id, tu.username AS target_name, tu.display_name AS target_display_name,
         tu.status AS target_status, tu.deleted_at AS target_deleted_at
    FROM support_tickets t
    LEFT JOIN users ru ON ru.id = t.user_id
    LEFT JOIN users tu ON tu.id = t.target_user_id`;

function ticketItem(row: TicketRow) {
  const category = contactCategory(row.category) ?? CONTACT_CATEGORIES[3];
  return {
    id: row.id,
    category: category.id,
    categoryLabel: category.label,
    email: row.email,
    targetUsername: row.target_username,
    body: row.body,
    device: row.device,
    pageUrl: row.page_url,
    status: row.status === 'reviewing' ? 'reviewing' : row.status === 'closed' ? 'closed' : 'open',
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    reporter:
      row.reporter_id && row.reporter_username
        ? {
            id: row.reporter_id,
            username: row.reporter_username,
            displayName: row.reporter_display_name || row.reporter_username,
          }
        : null,
    targetAccount:
      row.target_id && row.target_name
        ? {
            id: row.target_id,
            username: row.target_name,
            displayName: row.target_display_name || row.target_name,
            status: row.target_deleted_at
              ? 'deleted'
              : row.target_status === 'suspended'
                ? 'suspended'
                : 'active',
          }
        : null,
  };
}

/**
 * Public contact form. Guests can use it (that is the point of account
 * recovery), so it is rate limited by IP and asks for a reply address.
 */
export async function createTicket(req: Request, env: Env) {
  await rateLimit(
    env,
    `contact:${ip(req)}`,
    5,
    60 * 60 * 1000,
    'Too many messages from here. Give it an hour and try again.',
  );
  const viewer = await currentUser(req, env);
  if (viewer) {
    await rateLimit(
      env,
      `contact-user:${viewer.id}`,
      5,
      60 * 60 * 1000,
      'You have sent several messages already. The moderator will get to them.',
    );
  }

  const body = await readJson(req);
  const category = contactCategory(typeof body.category === 'string' ? body.category.trim() : '');
  if (!category) throw bad('Choose what this message is about.');

  const email = normalizeEmail(body.email);
  const message = str(body.body, 'Tell us what happened', 2000, 10);
  const device = str(body.device, 'Device details', 500, 3);
  const pageUrl = optionalStr(body.pageUrl, 300);
  const rawTarget = optionalStr(body.targetUsername, 21);
  const targetUsername = rawTarget ? rawTarget.replace(/^@/, '').trim().toLowerCase() : null;
  if (targetUsername && !/^[a-z0-9_]{3,20}$/.test(targetUsername)) {
    throw bad('That username does not look right.');
  }
  if (category.id === 'person' && !targetUsername) {
    throw bad('Add the username of the account you are reporting.');
  }

  const target = targetUsername
    ? await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(targetUsername).first<{ id: string }>()
    : null;

  const id = uid('tkt');
  const createdAt = now();
  await env.DB.prepare(
    `INSERT INTO support_tickets
       (id, user_id, category, email, target_username, target_user_id, body, device, page_url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  )
    .bind(
      id,
      viewer?.id ?? null,
      category.id,
      email,
      targetUsername,
      target?.id ?? null,
      message,
      device,
      pageUrl,
      createdAt,
    )
    .run();

  const admins = await env.DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL",
  ).all<{ id: string }>();
  if (admins.results?.length) {
    await env.DB.batch(
      admins.results.map((admin) =>
        env.DB.prepare(
          `INSERT INTO notifications (id, user_id, type, actor_id, detail, ticket_id, created_at)
           VALUES (?, ?, 'support', ?, ?, ?, ?)`,
        ).bind(
          uid('ntf'),
          admin.id,
          viewer?.id ?? null,
          `${category.label}: ${message.slice(0, 100)}`,
          id,
          createdAt,
        ),
      ),
    );
  }

  return json(
    {
      ok: true,
      id,
      message: 'Sent. The moderator will review this and reply by email.',
    },
    201,
  );
}

/** The moderator-only inbox. "Open" means anything not yet closed. */
export async function tickets(req: Request, env: Env, url: URL) {
  await requireAdmin(req, env);
  const scope = url.searchParams.get('status') === 'all' ? 'all' : 'open';
  const rows = await env.DB.prepare(
    `${TICKET_SELECT}
      WHERE (${scope === 'all' ? '1 = 1' : "t.status <> 'closed'"})
      ORDER BY CASE t.status WHEN 'reviewing' THEN 0 ELSE 1 END, t.created_at DESC
      LIMIT 60`,
  ).all<TicketRow>();
  return json({ items: (rows.results || []).map(ticketItem) });
}

export async function resolveTicket(req: Request, env: Env, id: string) {
  const admin = await requireAdmin(req, env);
  const body = await readJson(req);
  const status = body.status === 'reviewing' ? 'reviewing' : body.status === 'closed' ? 'closed' : '';
  if (!status) throw bad('Choose whether to start reviewing or close the request.');
  const note = optionalStr(body.note, 600);

  const exists = await env.DB.prepare('SELECT id FROM support_tickets WHERE id = ?').bind(id).first<{ id: string }>();
  if (!exists) throw missing('That request is gone.');

  await env.DB.prepare(
    'UPDATE support_tickets SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ?',
  )
    .bind(status, status === 'closed' ? now() : null, status === 'closed' ? admin.id : null, note, id)
    .run();
  return json({ ok: true, status });
}
