-- Extra stills sampled from a clip by the browser before it uploads, kept only so
-- the automatic safety check can look past the preview frame. They are tiny
-- (WebP stills a few hundred pixels wide), are never served to anyone, and go
-- away with the upload when it is deleted or purged.
CREATE TABLE IF NOT EXISTS upload_frames (
  upload_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (upload_id, position)
);
