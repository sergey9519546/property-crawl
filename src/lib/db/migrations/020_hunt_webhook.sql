ALTER TABLE discovery_hunts
  ADD COLUMN IF NOT EXISTS webhook_url TEXT;

ALTER TABLE discovery_hunts
  DROP CONSTRAINT IF EXISTS discovery_hunts_webhook_url_length;

ALTER TABLE discovery_hunts
  ADD CONSTRAINT discovery_hunts_webhook_url_length
  CHECK (webhook_url IS NULL OR char_length(webhook_url) <= 512);
