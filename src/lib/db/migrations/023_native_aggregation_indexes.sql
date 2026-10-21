-- Migration 023: Native Aggregation & Scale Indexes
-- Accelerates database-native aggregations for neighborhoods, freshness, geospatial comps, and document review.

CREATE INDEX IF NOT EXISTS idx_listings_zip ON listings(zip);
CREATE INDEX IF NOT EXISTS idx_listings_state_city ON listings(state, city);
CREATE INDEX IF NOT EXISTS idx_listings_source_observed ON listings(source_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_has_documents ON listings(has_documents) WHERE has_documents = TRUE;
CREATE INDEX IF NOT EXISTS idx_listings_lat_lng ON listings(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
