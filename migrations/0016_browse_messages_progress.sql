-- Three things the app needs that no earlier migration covered: a way to pin
-- one comment per post, a place to remember how far into a video someone got,
-- and the tables behind direct messages.

ALTER TABLE comments ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS post_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS post_progress_recent ON post_progress(user_id, updated_at DESC);

-- A conversation is one row for a pair of people, stored with the lower id
-- first so the pair can never exist twice in both orders.
CREATE TABLE IF NOT EXISTS dm_threads (
  id TEXT PRIMARY KEY,
  a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  last_body TEXT NOT NULL DEFAULT '',
  last_sender_id TEXT,
  UNIQUE (a_id, b_id)
);
CREATE INDEX IF NOT EXISTS dm_threads_a ON dm_threads(a_id, last_at DESC);
CREATE INDEX IF NOT EXISTS dm_threads_b ON dm_threads(b_id, last_at DESC);

CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS dm_messages_thread ON dm_messages(thread_id, created_at DESC);
