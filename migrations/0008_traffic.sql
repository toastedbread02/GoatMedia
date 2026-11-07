-- Where visits came from. Only the referring host and the landing route are
-- kept: no full referrer URL, no IP address, no user agent. That is enough to
-- answer "did the Reddit post send anyone?" without building a profile of a
-- reader, and the visitor key is a salted hash so one person is not linkable
-- across days.

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  visitor_key TEXT NOT NULL,
  source TEXT NOT NULL,
  landing TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS visits_recent ON visits(created_at DESC);
CREATE INDEX IF NOT EXISTS visits_source ON visits(source, created_at DESC);
