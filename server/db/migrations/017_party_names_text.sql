-- Party names are not 255 characters.
--
-- CivilView publishes defendant strings that are lists of heirs and
-- successors ("...AND HIS/HER HEIRS, DEVISEES AND PERSONAL REPRESENTATIVES AND
-- HIS, HERS, THEIR OR ANY OF THEIR SUCCESSORS IN RIGHT, TITLE AND INTEREST;
-- ..."). Observed records in that shape run to 800+ characters, and the write
-- path has no truncation: two real observed records failed the INSERT outright
-- with "value too long for type character varying(255)".
--
-- 255 was an arbitrary width, not a property of the data. Truncating would
-- discard the party list that makes the record identifiable, so widen instead.
-- TEXT is the honest type for a free-form legal name.
ALTER TABLE listings
  ALTER COLUMN plaintiff TYPE TEXT,
  ALTER COLUMN defendant  TYPE TEXT,
  ALTER COLUMN attorney   TYPE TEXT;