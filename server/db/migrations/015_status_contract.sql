ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
UPDATE listings SET status = CASE
  WHEN lower(status) LIKE '%cancel%' OR lower(status) LIKE '%withdraw%' THEN 'cancelled'
  WHEN lower(status) LIKE '%postpon%' THEN 'postponed'
  WHEN lower(status) LIKE '%adjourn%' THEN 'adjourned'
  WHEN lower(status) LIKE '%stay%' THEN 'stayed'
  WHEN lower(status) LIKE '%sold%' OR lower(status) LIKE '%closed%' OR lower(status) LIKE '%auctioned%' OR lower(status) LIKE '%post-auction%' THEN 'sold'
  WHEN lower(status) LIKE '%scheduled%' OR lower(status) LIKE '%coming soon%' OR lower(status) LIKE '%pre-auction%' THEN 'scheduled'
  WHEN lower(status) LIKE '%pending%' THEN 'pending'
  WHEN lower(status) = 'active' THEN 'active'
  ELSE 'unknown'
END;
ALTER TABLE listings ALTER COLUMN status SET DEFAULT 'unknown';
ALTER TABLE listings ADD CONSTRAINT listings_status_check CHECK (status IN (
  'unknown', 'active', 'pending', 'sold', 'cancelled', 'scheduled',
  'STAYED_BANKRUPTCY', 'ADJOURNED', 'ACTIVE_SCHEDULED', 'POSTPONED',
  'STAYED', 'WITHDRAWN', 'postponed', 'stayed', 'adjourned'
));
