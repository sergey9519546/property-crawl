-- Occupancy can be a full legal disclaimer from foreclosure sellers.
--
-- CivilView and other sheriff sale publishers sometimes emit full sentences
-- in the occupancy status field ("Definative occupany status is not available
-- and Plaintiff makes no representation regarding occupancy" - 101 chars).
-- 64 was an arbitrary limit. Widen to TEXT to preserve honest publisher evidence.
ALTER TABLE listings
  ALTER COLUMN occupancy TYPE TEXT;
