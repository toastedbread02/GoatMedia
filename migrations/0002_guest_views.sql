-- View counting for signed-out visitors. post_events.user_id references users,
-- so anonymous views need their own table keyed by a coarse visitor fingerprint
-- (hashed IP + user agent) to keep counts unique-ish without storing an IP.

CREATE TABLE IF NOT EXISTS guest_views (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  visitor_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, visitor_key)
);

CREATE INDEX IF NOT EXISTS guest_views_recent ON guest_views(created_at);
