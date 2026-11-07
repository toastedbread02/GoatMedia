-- A reply notifies the person whose comment was answered, and the popover needs
-- to say "replied" rather than "commented on your post". Old notifications stay
-- ordinary comments, so the default is 0.

ALTER TABLE notifications ADD COLUMN is_reply INTEGER NOT NULL DEFAULT 0;
