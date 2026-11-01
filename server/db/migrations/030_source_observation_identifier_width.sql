-- Migration 030: Unbounded publisher identifiers in the observation store
--
-- source_observations.listing_id was VARCHAR(64) and record_id was
-- VARCHAR(128). Migration 022 already taught this lesson for listings.id:
-- GSA dispositions and complex federal records generate descriptive slugs
-- longer than 64 characters, and discovery_snapshots.source_record_id (the
-- same concept, migration 006) was TEXT from the start. An observation for a
-- long-ID listing failed its INSERT with "value too long" and the write path
-- swallowed the error as a per-row warning — the observation for exactly the
-- listings whose identifiers are the hardest to reconstruct was silently
-- dropped.
--
-- Publisher identifiers are unbounded. TEXT is the honest type. listings.id
-- is already TEXT (migration 022); this aligns the observation store with it.

ALTER TABLE source_observations ALTER COLUMN listing_id TYPE TEXT;
ALTER TABLE source_observations ALTER COLUMN record_id TYPE TEXT;
