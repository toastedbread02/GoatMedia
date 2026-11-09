// One-to-one messages. Thread membership is the whole permission model: if a
// conversation is not yours, it does not exist. Blocks are honoured in both
// directions, before a thread opens and before every send.

import { Env, bad, json, missing, now, rateLimit, readJson, uid } from '../lib';
import { requireActive } from '../session';
import { avatarUrl } from '../models';

const MESSAGE_MAX = 2000;
const THREAD_PAGE = 60;

interface ThreadRow {
  id: string;
  last_at: number;
  last_body: string;
  last_sender_id: string | null;
  other_id: string;
  username: string;
  display_name: string;
  avatar_version: number;
  has_avatar: number;
  unread: number;
}

function threadDto(origin: string, row: ThreadRow, meId: string) {
  return {
    id: row.id,
    lastAt: row.last_at,
    lastBody: row.last_body,
    lastFromMe: row.last_sender_id === meId,
    unread: Number(row.unread || 0),
    user: {
      id: row.other_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: avatarUrl(origin, row.other_id, row.avatar_version, Boolean(row.has_avatar)),
    },
  };
}

const THREAD_SELECT = `
  SELECT t.id, t.last_at, t.last_body, t.last_sender_id,
         CASE WHEN t.a_id = ? THEN t.b_id ELSE t.a_id END AS other_id,
         u.username, u.display_name, u.avatar_version,
         (u.avatar_bytes IS NOT NULL) AS has_avatar,
         (SELECT COUNT(*) FROM dm_messages m
           WHERE m.thread_id = t.id AND m.sender_id <> ? AND m.read_at IS NULL) AS unread
    FROM dm_threads t
    JOIN users u ON u.id = CASE WHEN t.a_id = ? THEN t.b_id ELSE t.a_id END`;

async function blockedBetween(env: Env, a: string, b: string) {
  return env.DB.prepare(
    `SELECT 1 AS n FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
  )
    .bind(a, b, b, a)
    .first<{ n: number }>();
}

async function myThread(env: Env, id: string, meId: string): Promise<ThreadRow | null> {
  return env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ? AND (t.a_id = ? OR t.b_id = ?)`)
    .bind(meId, meId, meId, id, meId, meId)
    .first<ThreadRow>();
}

export async function inbox(req: Request, env: Env) {
  const user = await requireActive(req, env);
  const origin = new URL(req.url).origin;
  const rows = await env.DB.prepare(
    `${THREAD_SELECT} WHERE t.a_id = ? OR t.b_id = ? ORDER BY t.last_at DESC LIMIT 50`,
  )
    .bind(user.id, user.id, user.id, user.id, user.id)
    .all<ThreadRow>();

  const threads = (rows.results || []).map((row) => threadDto(origin, row, user.id));
  return json({
    threads,
    unread: threads.reduce((total, thread) => total + thread.unread, 0),
  });
}

/** Opens the conversation with someone, creating it the first time. */
export async function openThread(req: Request, env: Env) {
  const user = await requireActive(req, env);
  const body = await readJson<Record<string, unknown>>(req);
  const username =
    typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!username) throw bad('Pick someone to message.');

  const target = await env.DB.prepare('SELECT id, username, status FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string; username: string; status: string }>();
  if (!target) throw missing('No creator with that username.');
  if (target.id === user.id) throw bad('That is your own inbox.');
  if (target.status !== 'active') throw bad('That account cannot receive messages.');
  if (await blockedBetween(env, user.id, target.id)) {
    throw bad('Messaging is closed between these two accounts.');
  }

  // Storing the smaller id first is what keeps one conversation from existing
  // twice, once in each direction.
  const [a, b] = user.id < target.id ? [user.id, target.id] : [target.id, user.id];
  const existing = await env.DB.prepare('SELECT id FROM dm_threads WHERE a_id = ? AND b_id = ?')
    .bind(a, b)
    .first<{ id: string }>();
  if (existing) return json({ id: existing.id });

  const id = uid('dm');
  const at = now();
  await env.DB.prepare(
    `INSERT INTO dm_threads (id, a_id, b_id, created_at, last_at, last_body, last_sender_id)
     VALUES (?, ?, ?, ?, ?, '', ?)`,
  )
    .bind(id, a, b, at, at, user.id)
    .run();
  return json({ id }, 201);
}

export async function threadMessages(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  const origin = new URL(req.url).origin;
  const thread = await myThread(env, id, user.id);
  if (!thread) throw missing('That conversation is not here.');

  const rows = await env.DB.prepare(
    `SELECT id, sender_id, body, created_at
       FROM dm_messages WHERE thread_id = ?
      ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(id, THREAD_PAGE + 1)
    .all<{ id: string; sender_id: string; body: string; created_at: number }>();

  const list = rows.results || [];
  const hasMore = list.length > THREAD_PAGE;
  const messages = list
    .slice(0, THREAD_PAGE)
    .reverse()
    .map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      mine: row.sender_id === user.id,
    }));

  // Opening the conversation is reading it: anything the other person sent
  // becomes read here rather than needing a second request from the browser.
  await env.DB.prepare(
    'UPDATE dm_messages SET read_at = ? WHERE thread_id = ? AND sender_id <> ? AND read_at IS NULL',
  )
    .bind(now(), id, user.id)
    .run();

  return json({ thread: threadDto(origin, thread, user.id), messages, hasMore });
}

export async function sendMessage(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  await rateLimit(env, `dm:${user.id}`, 30, 60 * 1000, 'You are sending messages quickly. Give it a minute.');
  const body = await readJson<Record<string, unknown>>(req);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) throw bad('Write something first.');
  if (text.length > MESSAGE_MAX) throw bad(`Messages are limited to ${MESSAGE_MAX} characters.`);

  const thread = await myThread(env, id, user.id);
  if (!thread) throw missing('That conversation is not here.');
  if (await blockedBetween(env, user.id, thread.other_id)) {
    throw bad('Messaging is closed between these two accounts.');
  }

  const at = now();
  const messageId = uid('msg');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO dm_messages (id, thread_id, sender_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(messageId, id, user.id, text, at),
    env.DB.prepare(
      'UPDATE dm_threads SET last_at = ?, last_body = ?, last_sender_id = ? WHERE id = ?',
    ).bind(at, text.slice(0, 140), user.id, id),
  ]);

  return json(
    {
      message: { id: messageId, body: text, createdAt: at, mine: true },
      threadId: id,
    },
    201,
  );
}

export async function markThreadRead(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  const thread = await myThread(env, id, user.id);
  if (!thread) throw missing('That conversation is not here.');
  await env.DB.prepare(
    'UPDATE dm_messages SET read_at = ? WHERE thread_id = ? AND sender_id <> ? AND read_at IS NULL',
  )
    .bind(now(), id, user.id)
    .run();
  return json({ ok: true });
}

export async function unreadCount(req: Request, env: Env) {
  const user = await requireActive(req, env);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dm_messages m
       JOIN dm_threads t ON t.id = m.thread_id
      WHERE m.sender_id <> ? AND m.read_at IS NULL AND (t.a_id = ? OR t.b_id = ?)`,
  )
    .bind(user.id, user.id, user.id)
    .first<{ n: number }>();
  return json({ unread: Number(row?.n ?? 0) });
}
