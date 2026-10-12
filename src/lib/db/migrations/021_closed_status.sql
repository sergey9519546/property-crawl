-- Migration 015 rewrote historical closed, auctioned, and post-auction rows
-- to sold. Those rows stay sold: the original publisher word is gone, and
-- some of them are genuine sales. New writes store a finished auction that
-- was not reported as sold with status 'closed'.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check CHECK (status IN (
  'unknown', 'active', 'pending', 'sold', 'closed', 'cancelled', 'scheduled',
  'STAYED_BANKRUPTCY', 'ADJOURNED', 'ACTIVE_SCHEDULED', 'POSTPONED',
  'STAYED', 'WITHDRAWN', 'postponed', 'stayed', 'adjourned'
));
