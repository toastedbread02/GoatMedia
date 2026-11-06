import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { DB_PATH, ensureDataDirs } from './config.ts';

ensureDataDirs();

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspended_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci ON users(lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  hashtags TEXT NOT NULL DEFAULT '[]',
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'video/mp4',
  poster_name TEXT,
  duration REAL NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  reject_reason TEXT,
  removed_reason TEXT,
  credit TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  seed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS videos_status_created ON videos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_owner ON videos(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_published ON videos(status, published_at DESC);

CREATE TABLE IF NOT EXISTS video_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  viewer_key TEXT,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  watch_seconds REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS video_views_video ON video_views(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_views_user ON video_views(user_id, video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS video_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS video_events_once
  ON video_events(user_id, video_id, type)
  WHERE type IN ('complete', 'rewatch', 'skip', 'not_interested');

CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS likes_video ON likes(video_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_video ON comments(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_user ON comments(user_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS follows_following ON follows(following_id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS interests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('category', 'hashtag')),
  value TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, value)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('video', 'comment', 'user')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_target ON reports(target_type, target_id);

CREATE TABLE IF NOT EXISTS moderation_events (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('submit', 'approve', 'reject', 'remove', 'resubmit')),
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS moderation_events_video ON moderation_events(video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('approved', 'rejected', 'follow', 'comment', 'removed')),
  video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  detail TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);
`);

// Older installs predate anonymous viewer keys. Keep the migration local and
// idempotent so an existing .data directory keeps working.
const viewColumns = db.prepare(`PRAGMA table_info(video_views)`).all() as { name: string }[];
if (!viewColumns.some((column) => column.name === 'viewer_key')) {
  db.exec(`ALTER TABLE video_views ADD COLUMN viewer_key TEXT`);
}
db.exec(`CREATE INDEX IF NOT EXISTS video_views_viewer ON video_views(viewer_key, video_id, created_at DESC)`);

db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', '2')`).run();

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function usernameTaken(username: string): boolean {
  return Boolean(get(`SELECT id FROM users WHERE lower(username) = lower(?)`, username));
}

export function emailTaken(email: string): boolean {
  return Boolean(get(`SELECT id FROM users WHERE lower(email) = lower(?)`, email));
}

export function notify(input: {
  userId: string;
  type: 'approved' | 'rejected' | 'follow' | 'comment' | 'removed';
  videoId?: string | null;
  actorId?: string | null;
  detail?: string | null;
}) {
  if (input.userId === input.actorId) return;
  run(
    `INSERT INTO notifications (id, user_id, type, video_id, actor_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    input.userId,
    input.type,
    input.videoId ?? null,
    input.actorId ?? null,
    input.detail ?? null,
    Date.now(),
  );
}
