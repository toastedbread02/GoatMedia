-- Automatic safety screening, written warnings, and appeals.
--
-- A post that the filter flags is rejected rather than published, but nothing
-- is deleted: a moderator can approve it after watching it. Repeated flags,
-- whether they look like accidents or like someone testing the filter, become
-- warnings, and the third warning suspends the account. Every warning and
-- every suspension can be appealed from a link that is emailed to the account.

-- When a suspension happened, and who applied it, so an appeal can be judged
-- against the moderation record rather than memory.
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN suspended_by TEXT;

-- What the filter thought it saw, kept on the post so the moderator sees the
-- reason next to the thumbnails instead of a bare rejection.
ALTER TABLE posts ADD COLUMN auto_flag TEXT;

CREATE TABLE IF NOT EXISTS warnings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The upload that caused it, when there was one.
  post_id TEXT,
  -- 'gore' for the automatic filter, 'manual' for a moderator's warning.
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto', 'moderator')),
  admin_id TEXT,
  created_at INTEGER NOT NULL,
  -- none | open | accepted | declined. An accepted warning no longer counts.
  appeal_status TEXT NOT NULL DEFAULT 'none'
);

CREATE INDEX IF NOT EXISTS warnings_user ON warnings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS warnings_open ON warnings (appeal_status, created_at DESC);

-- One row per link that was emailed. The token is stored hashed, exactly like
-- a session, so the database alone cannot be used to file an appeal as someone.
CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('ban', 'warning')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warning_id TEXT,
  -- The reason being appealed, copied so the page reads correctly even if the
  -- warning is later edited or the account deleted.
  reason TEXT NOT NULL,
  -- sent | open | accepted | declined
  status TEXT NOT NULL DEFAULT 'sent',
  message TEXT,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  resolved_at INTEGER,
  resolved_by TEXT,
  decision_note TEXT
);

CREATE INDEX IF NOT EXISTS appeals_status ON appeals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals (user_id, created_at DESC);

-- A record of every notice the site tried to email. Delivery failures are
-- otherwise invisible, and "I never got the email" needs an answer.
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  -- sent | failed | skipped (no provider configured)
  status TEXT NOT NULL,
  error TEXT,
  appeal_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS emails_created ON emails (created_at DESC);

-- Two more notification types. SQLite cannot alter a CHECK, so the table is
-- rebuilt again with every row carried across.
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('approved', 'rejected', 'follow', 'comment', 'like', 'new_post', 'removed', 'sound', 'support', 'milestone', 'weekly', 'warning', 'ban', 'appeal')),
  post_id TEXT,
  actor_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  is_reply INTEGER NOT NULL DEFAULT 0,
  ticket_id TEXT REFERENCES support_tickets(id) ON DELETE CASCADE,
  dedupe TEXT
);

INSERT INTO notifications_new (id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply, ticket_id, dedupe)
  SELECT id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply, ticket_id, dedupe
    FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_new_post ON notifications (post_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications (user_id, dedupe)
  WHERE dedupe IS NOT NULL;
