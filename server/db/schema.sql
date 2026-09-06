-- ==========================================================
-- PROPERTY_CRAWL — Production PostgreSQL & PostGIS Schema
-- ==========================================================

-- Enable PostGIS and UUID extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. Verified Sources Registry Table
CREATE TABLE IF NOT EXISTS sources (
    key VARCHAR(32) PRIMARY KEY,
    label VARCHAR(128) NOT NULL,
    tier CHAR(1) NOT NULL CHECK (tier IN ('A', 'B')),
    color VARCHAR(16) NOT NULL,
    note TEXT NOT NULL,
    website_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the 15 verified sources into PostgreSQL
INSERT INTO sources (key, label, tier, color, note, website_url) VALUES
  ('servicelink', 'Public Auction Network', 'B', '#0369a1', 'Public auction listings; sale status and terms require confirmation', 'https://www.servicelinkauction.com'),
  ('sheriff', 'Sheriff Sale', 'B', '#0f766e', 'Foreclosure sale notice published under state law', 'https://www.cuyahogasheriff.org'),
  ('trustee', 'Trustee''s Sale', 'B', '#0ea5e9', 'Non-judicial foreclosure auction', 'https://www.clarkcountynv.gov'),
  ('hud', 'HUD Home', 'A', '#1d4ed8', 'hudhomestore.gov — owner-occupant window applies', 'https://www.hudhomestore.gov'),
  ('fannie', 'Fannie Mae REO', 'A', '#2563eb', 'homepath.com — First Look window', 'https://www.homepath.com'),
  ('freddie', 'Freddie Mac REO', 'A', '#1e40af', 'homesteps.com', 'https://www.homesteps.com'),
  ('usda', 'USDA RD/FSA REO', 'A', '#3b82f6', 'resales.usda.gov', 'https://www.resales.usda.gov'),
  ('va', 'VA REO', 'A', '#0e7490', 'vrmproperties.com', 'https://vrmproperties.com'),
  ('irs', 'IRS Seized', 'A', '#b45309', 'irsauctions.gov — email subscribe', 'https://www.irsauctions.gov'),
  ('treasury', 'Treasury Forfeiture', 'A', '#c2410c', 'CWS Marketing contractor', 'https://www.treasury.gov/auctions/treasury/rp/realprop.shtml'),
  ('marshals', 'US Marshals', 'A', '#a16207', 'RealLook.com / Gaston & Sheehan', 'https://www.usmarshals.gov'),
  ('gsa', 'GSA Surplus', 'A', '#92400e', 'realestatesales.gov', 'https://realestatesales.gov'),
  ('landbank', 'Land Bank', 'B', '#059669', 'landbanksearch.com — 70+ county land bank aggregator', 'https://www.landbanksearch.com'),
  ('fdic', 'FDIC REO', 'A', '#1e3a8a', 'sales.fdic.gov — Closed sales & receivership assets', 'https://sales.fdic.gov'),
  ('civilview', 'CivilView Sheriff', 'B', '#0d9488', 'salesweb.civilview.com — Tyler Technologies docket', 'https://salesweb.civilview.com'),
  ('bid4assets', 'Bid4Assets', 'B', '#7c3aed', 'bid4assets.com — County sheriff & tax auctions', 'https://www.bid4assets.com')
ON CONFLICT (key) DO NOTHING;

-- 2. Property Listings Table
CREATE TABLE IF NOT EXISTS listings (
    id VARCHAR(64) PRIMARY KEY,
    source_key VARCHAR(32) NOT NULL REFERENCES sources(key) ON DELETE RESTRICT,
    state VARCHAR(2) NOT NULL,
    county VARCHAR(64),
    city VARCHAR(64),
    zip VARCHAR(10),
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geog GEOGRAPHY(Point, 4326),
    beds INT,
    baths NUMERIC(4, 1),
    sqft INT,
    year_built INT,
    prop_type VARCHAR(64),
    opening_bid NUMERIC(14, 2),
    est_low NUMERIC(14, 2),
    est_high NUMERIC(14, 2),
    assessed_value NUMERIC(14, 2),
    mid_value NUMERIC(14, 2) GENERATED ALWAYS AS (
      CASE
        WHEN est_low IS NULL OR est_high IS NULL OR est_low <= 0 OR est_high < est_low THEN NULL
        ELSE (est_low + est_high) / 2
      END
    ) STORED,
    deal_score INT CHECK (deal_score BETWEEN 1 AND 99),
    equity_spread NUMERIC(14, 2) GENERATED ALWAYS AS (
      CASE
        WHEN est_low IS NULL OR est_high IS NULL OR opening_bid IS NULL
          OR est_low <= 0 OR est_high < est_low OR opening_bid <= 0 THEN NULL
        ELSE GREATEST(0, ((est_low + est_high) / 2) - opening_bid)
      END
    ) STORED,
    sale_date DATE,
    plaintiff VARCHAR(255),
    defendant VARCHAR(255),
    judgment_amount NUMERIC(14, 2),
    attorney VARCHAR(255),
    occupancy VARCHAR(64),
    deposit_terms TEXT,
    photo_url TEXT,
    images TEXT[],
    source_url TEXT,
    raw_notice TEXT,
    provenance JSONB,
    source_observed_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    price NUMERIC(14, 2),
    listing_date DATE,
    redemption_days INT,
    redemption_warning TEXT,
    senior_lien_risk VARCHAR(16),
    senior_lien_warning TEXT,
    cash_to_close NUMERIC(14, 2),
    cash_to_close_details JSONB CONSTRAINT chk_listings_cash_to_close_details_bounded CHECK (
      cash_to_close_details IS NULL OR (
        jsonb_typeof(cash_to_close_details) = 'object'
        AND octet_length(cash_to_close_details::text) <= 65536
      )
    ),
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'sold', 'cancelled', 'scheduled', 'STAYED_BANKRUPTCY', 'ADJOURNED', 'ACTIVE_SCHEDULED', 'POSTPONED', 'STAYED', 'WITHDRAWN', 'postponed', 'stayed', 'adjourned')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Saved Deals & User Alerts Table
CREATE TABLE IF NOT EXISTS saved_deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(128) NOT NULL,
    listing_id VARCHAR(64) NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    notes TEXT,
    is_alert_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, listing_id)
);

-- 4. AI Deal Analysis & Notice Cache Table
CREATE TABLE IF NOT EXISTS ai_cache (
    content_hash VARCHAR(64) PRIMARY KEY,
    prompt_type VARCHAR(32) NOT NULL,
    model_used VARCHAR(64) NOT NULL,
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    cost_usd NUMERIC(10, 6) NOT NULL,
    response_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Audit & Ingestion Logs Table
CREATE TABLE IF NOT EXISTS ingestion_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_key VARCHAR(32) REFERENCES sources(key),
    status VARCHAR(32) NOT NULL,
    items_scraped INT DEFAULT 0,
    items_inserted INT DEFAULT 0,
    items_updated INT DEFAULT 0,
    error_message TEXT,
    duration_ms INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================================
-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
-- ==========================================================

CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source_key);
CREATE INDEX IF NOT EXISTS idx_listings_state ON listings(state);
CREATE INDEX IF NOT EXISTS idx_listings_sale_date ON listings(sale_date);
CREATE INDEX IF NOT EXISTS idx_listings_deal_score ON listings(deal_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_listings_equity_spread ON listings(equity_spread DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_listings_opening_bid ON listings(opening_bid ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_listing_date ON listings(listing_date);
-- GiST spatial index: required for ST_DWithin radius queries to use index scan.
CREATE INDEX IF NOT EXISTS idx_listings_geog ON listings USING GIST(geog);
CREATE INDEX IF NOT EXISTS idx_saved_deals_user ON saved_deals(user_id);

-- ==========================================================
-- Migration 002: Spatial Radius Search Function
-- ==========================================================

CREATE OR REPLACE FUNCTION find_listings_within_radius(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_meters DOUBLE PRECISION DEFAULT 50000
)
RETURNS TABLE (
    id VARCHAR(64),
    address TEXT,
    city VARCHAR(64),
    state VARCHAR(2),
    distance_meters DOUBLE PRECISION,
    opening_bid NUMERIC(14, 2),
    deal_score INT,
    sale_date DATE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.id,
        l.address,
        l.city,
        l.state,
        ST_Distance(l.geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_meters,
        l.opening_bid,
        l.deal_score,
        l.sale_date
    FROM listings l
    WHERE ST_DWithin(l.geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_meters)
    ORDER BY distance_meters ASC;
END;
$$;
