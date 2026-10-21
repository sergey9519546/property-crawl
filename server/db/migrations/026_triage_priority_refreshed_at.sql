-- Migration 026: Triage Priority Refresh Timestamp
-- listings.triage_priority is a write-through cache of the deterministic
-- opportunity-signal evaluation (route write-through on read, ingest recompute
-- via recomputeTriageForListings). The score is time-dependent -- a confirmed
-- sale date passes and observation events accumulate -- so every write stamps
-- triage_priority_refreshed_at. Sorting consumers must treat a stale value as
-- unknown rather than as a fresh ranking.

ALTER TABLE listings ADD COLUMN IF NOT EXISTS triage_priority_refreshed_at TIMESTAMPTZ;
