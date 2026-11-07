-- Account settings added after launch. birth_date powers the age check and is
-- never shown on a public profile. hide_follows keeps follower/following lists
-- private; searchable controls whether an account shows up in people search.

ALTER TABLE users ADD COLUMN birth_date TEXT;
ALTER TABLE users ADD COLUMN hide_follows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN searchable INTEGER NOT NULL DEFAULT 1;
