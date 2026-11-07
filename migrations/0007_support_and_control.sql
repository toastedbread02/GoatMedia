-- Contact reports land in a moderator-only inbox, and accounts can be removed
-- and brought back without losing their row (and therefore their history).

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('problem', 'person', 'account', 'other')),
  email TEXT NOT NULL,
  target_username TEXT,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  device TEXT NOT NULL,
  page_url TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'closed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS support_tickets_status ON support_tickets(status, created_at DESC);

ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_reason TEXT;

-- SQLite cannot alter a CHECK constraint, so the notifications table is rebuilt
-- once to admit the new support type and an optional ticket reference.
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('approved', 'rejected', 'follow', 'comment', 'removed', 'sound', 'support')),
  post_id TEXT,
  actor_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  is_reply INTEGER NOT NULL DEFAULT 0,
  ticket_id TEXT REFERENCES support_tickets(id) ON DELETE CASCADE
);

INSERT INTO notifications_new (id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply)
  SELECT id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply
    FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);
