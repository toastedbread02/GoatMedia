-- Goat of the day: one moderator pick per calendar day, kept so yesterday's
-- choice is still reachable after it stops being pinned.
CREATE TABLE IF NOT EXISTS daily_goats (
  day TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  admin_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS daily_goats_recent ON daily_goats (created_at DESC);

-- Milestones and the weekly summary are two more notification types, and they
-- need a dedupe key: a milestone should reach someone exactly once even if the
-- trigger fires again. SQLite cannot alter a CHECK, so the table is rebuilt a
-- third time with every row carried across.
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('approved', 'rejected', 'follow', 'comment', 'like', 'new_post', 'removed', 'sound', 'support', 'milestone', 'weekly')),
  post_id TEXT,
  actor_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  is_reply INTEGER NOT NULL DEFAULT 0,
  ticket_id TEXT REFERENCES support_tickets(id) ON DELETE CASCADE,
  dedupe TEXT
);

INSERT INTO notifications_new (id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply, ticket_id)
  SELECT id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply, ticket_id
    FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_new_post ON notifications (post_id, type);
-- The same milestone or weekly note can never be written twice for one person.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications (user_id, dedupe)
  WHERE dedupe IS NOT NULL;
