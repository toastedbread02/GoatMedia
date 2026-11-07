-- Followers hear when a creator posts something new, which is a seventh
-- notification type. SQLite cannot alter the CHECK in place, so the table is
-- rebuilt again with every existing row carried across.
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('approved', 'rejected', 'follow', 'comment', 'like', 'new_post', 'removed', 'sound', 'support')),
  post_id TEXT,
  actor_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  is_reply INTEGER NOT NULL DEFAULT 0,
  ticket_id TEXT REFERENCES support_tickets(id) ON DELETE CASCADE
);

INSERT INTO notifications_new (id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply, ticket_id)
  SELECT id, user_id, type, post_id, actor_id, detail, created_at, read_at, is_reply, ticket_id
    FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);
-- Approval checks this once per post to avoid telling the same people twice.
CREATE INDEX IF NOT EXISTS notifications_new_post ON notifications (post_id, type);
