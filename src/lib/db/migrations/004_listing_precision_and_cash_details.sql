-- Migration 004: preserve fractional bathrooms and itemized cash-to-close evidence.

BEGIN;

ALTER TABLE listings
  ALTER COLUMN baths TYPE NUMERIC(4, 1)
  USING CASE WHEN baths IS NULL THEN NULL ELSE baths::numeric(4, 1) END;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS cash_to_close_details JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_listings_cash_to_close_details_bounded'
      AND conrelid = 'listings'::regclass
  ) THEN
    ALTER TABLE listings
      ADD CONSTRAINT chk_listings_cash_to_close_details_bounded
      CHECK (
        cash_to_close_details IS NULL OR (
          jsonb_typeof(cash_to_close_details) = 'object'
          AND octet_length(cash_to_close_details::text) <= 65536
        )
      ) NOT VALID;
  END IF;
END
$$;

COMMIT;
