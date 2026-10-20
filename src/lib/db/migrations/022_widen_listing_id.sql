-- Listing IDs are not guaranteed to fit in 64 characters.
--
-- GSA dispositions and complex federal records generate descriptive slugs
-- such as "GSA-WA-federal-center-south-1201-building-bia-building-and-slab-only-not-the-en-98134"
-- (85 characters). When listings.id was VARCHAR(64), inserting these valid
-- official notices threw "value too long for type character varying(64)".
--
-- Widen listings.id and all dependent foreign keys to TEXT to prevent ingestion
-- failures on long official identifier slugs.

ALTER TABLE saved_deals DROP CONSTRAINT IF EXISTS saved_deals_listing_id_fkey;
ALTER TABLE listing_history DROP CONSTRAINT IF EXISTS listing_history_listing_id_fkey;
ALTER TABLE alert_matches DROP CONSTRAINT IF EXISTS alert_matches_listing_id_fkey;

ALTER TABLE listings ALTER COLUMN id TYPE TEXT;
ALTER TABLE saved_deals ALTER COLUMN listing_id TYPE TEXT;
ALTER TABLE listing_history ALTER COLUMN listing_id TYPE TEXT;
ALTER TABLE alert_matches ALTER COLUMN listing_id TYPE TEXT;

ALTER TABLE saved_deals ADD CONSTRAINT saved_deals_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
ALTER TABLE listing_history ADD CONSTRAINT listing_history_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
ALTER TABLE alert_matches ADD CONSTRAINT alert_matches_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
