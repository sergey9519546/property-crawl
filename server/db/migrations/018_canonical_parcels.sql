-- Canonical parcel deduplication and cross-source clustering
--
-- Groups multi-docket notices for the same physical property
-- (sheriff docket, Bid4Assets auction, and statewide legal notice)
-- into a unified canonical parcel record.

CREATE TABLE IF NOT EXISTS canonical_parcels (
  id TEXT PRIMARY KEY,
  canonical_apn TEXT,
  state VARCHAR(2) NOT NULL,
  county TEXT NOT NULL,
  normalized_address TEXT,
  latitude FLOAT8,
  longitude FLOAT8,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_parcels_apn ON canonical_parcels(state, county, canonical_apn);
CREATE INDEX IF NOT EXISTS idx_canonical_parcels_address ON canonical_parcels(state, normalized_address);

ALTER TABLE listings ADD COLUMN IF NOT EXISTS canonical_parcel_id TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_canonical_parcel_id ON listings(canonical_parcel_id);
