-- Saving posts, so people keep a reason to come back to their own list.
CREATE TABLE IF NOT EXISTS saves (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_saves_user ON saves (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saves_post ON saves (post_id);

-- The feed and the "saved by" counts both read saved posts newest first.
CREATE INDEX IF NOT EXISTS idx_post_events_viewer
  ON post_events (user_id, kind, created_at DESC);
