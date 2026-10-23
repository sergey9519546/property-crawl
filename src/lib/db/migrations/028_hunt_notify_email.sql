ALTER TABLE discovery_hunts
  ADD COLUMN IF NOT EXISTS notify_email TEXT;

ALTER TABLE discovery_hunts
  DROP CONSTRAINT IF EXISTS discovery_hunts_notify_email_length;

ALTER TABLE discovery_hunts
  ADD CONSTRAINT discovery_hunts_notify_email_length
  CHECK (notify_email IS NULL OR char_length(notify_email) <= 254);
