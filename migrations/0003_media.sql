-- Videos are uploaded in chunks and kept as blobs in D1: R2 is not enabled on
-- this Cloudflare account, and a single D1 row can only hold about 2 MB. A post
-- is now either a video or a photo album; existing rows stay photo albums.

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  poster_mime TEXT,
  poster_bytes BLOB,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_chunks (
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (upload_id, idx)
);

ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'photos';
ALTER TABLE posts ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN width INTEGER;
ALTER TABLE posts ADD COLUMN height INTEGER;
ALTER TABLE posts ADD COLUMN video_upload_id TEXT REFERENCES uploads(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_upload_chunks_upload ON upload_chunks(upload_id, idx);
CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(status, published_at DESC);
