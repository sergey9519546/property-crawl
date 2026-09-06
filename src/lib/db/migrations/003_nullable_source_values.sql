-- Migration 003: preserve unknown source values without fabricated metrics.
--
-- `equity_spread` is generated data, so recreating it does not discard source
-- evidence. Run this migration once on existing PostgreSQL deployments.

BEGIN;

ALTER TABLE listings
  ALTER COLUMN county DROP NOT NULL,
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN zip DROP NOT NULL,
  ALTER COLUMN latitude DROP NOT NULL,
  ALTER COLUMN longitude DROP NOT NULL,
  ALTER COLUMN prop_type DROP NOT NULL,
  ALTER COLUMN opening_bid DROP NOT NULL,
  ALTER COLUMN est_low DROP NOT NULL,
  ALTER COLUMN est_high DROP NOT NULL,
  ALTER COLUMN deal_score DROP NOT NULL,
  ALTER COLUMN sale_date DROP NOT NULL,
  ALTER COLUMN deposit_terms DROP NOT NULL,
  ALTER COLUMN deposit_terms DROP DEFAULT,
  ALTER COLUMN redemption_days DROP DEFAULT,
  ALTER COLUMN senior_lien_risk DROP DEFAULT;

ALTER TABLE listings
  ALTER COLUMN beds DROP DEFAULT,
  ALTER COLUMN baths DROP DEFAULT,
  ALTER COLUMN sqft DROP DEFAULT,
  ALTER COLUMN prop_type DROP DEFAULT,
  ALTER COLUMN plaintiff DROP DEFAULT,
  ALTER COLUMN defendant DROP DEFAULT,
  ALTER COLUMN judgment_amount DROP DEFAULT,
  ALTER COLUMN attorney DROP DEFAULT,
  ALTER COLUMN occupancy DROP DEFAULT;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS provenance JSONB,
  ADD COLUMN IF NOT EXISTS source_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE listings DROP COLUMN equity_spread;
ALTER TABLE listings DROP COLUMN mid_value;
ALTER TABLE listings ADD COLUMN mid_value NUMERIC(14, 2)
  GENERATED ALWAYS AS (
    CASE
      WHEN est_low IS NULL OR est_high IS NULL OR est_low <= 0 OR est_high < est_low THEN NULL
      ELSE (est_low + est_high) / 2
    END
  ) STORED;
ALTER TABLE listings ADD COLUMN equity_spread NUMERIC(14, 2)
  GENERATED ALWAYS AS (
    CASE
      WHEN est_low IS NULL OR est_high IS NULL OR opening_bid IS NULL
        OR est_low <= 0 OR est_high < est_low OR opening_bid <= 0 THEN NULL
      ELSE GREATEST(0, ((est_low + est_high) / 2) - opening_bid)
    END
  ) STORED;

UPDATE listings
SET deal_score = CASE
  WHEN opening_bid > 0 AND est_low > 0 AND est_high >= est_low
    THEN GREATEST(1, LEAST(99, ROUND((1 - (opening_bid / ((est_low + est_high) / 2))) * 130)))::int
  ELSE NULL
END;

CREATE INDEX IF NOT EXISTS idx_listings_equity_spread
  ON listings (equity_spread DESC NULLS LAST);

DROP INDEX IF EXISTS idx_listings_deal_score;
CREATE INDEX idx_listings_deal_score
  ON listings (deal_score DESC NULLS LAST);

DROP INDEX IF EXISTS idx_listings_opening_bid;
CREATE INDEX idx_listings_opening_bid
  ON listings (opening_bid ASC NULLS LAST);

COMMIT;
