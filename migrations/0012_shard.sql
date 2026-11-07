-- Video bytes outgrow one free database (500 MB each), so chunks are spread
-- across extra databases. Every upload records which one holds its bytes; 0 is
-- the main database, where all chunks written before sharding live.
ALTER TABLE uploads ADD COLUMN shard INTEGER NOT NULL DEFAULT 0;
