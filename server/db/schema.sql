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

-- 2. Property Listings Table
CREATE TABLE IF NOT EXISTS listings (
    id VARCHAR(64) PRIMARY KEY,
    source_key VARCHAR(32) NOT NULL REFERENCES sources(key) ON DELETE RESTRICT,
    state VARCHAR(2) NOT NULL,
    county VARCHAR(64) NOT NULL,
    city VARCHAR(64) NOT NULL,
    zip VARCHAR(10) NOT NULL,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geog GEOGRAPHY(Point, 4326),
    beds INT DEFAULT 0,
    baths INT DEFAULT 0,
    sqft INT DEFAULT 0,
    year_built INT,
    prop_type VARCHAR(64) NOT NULL DEFAULT 'Single Family',
    opening_bid NUMERIC(14, 2) NOT NULL,
    est_low NUMERIC(14, 2) NOT NULL,
    est_high NUMERIC(14, 2) NOT NULL,
    assessed_value NUMERIC(14, 2),
    mid_value NUMERIC(14, 2) GENERATED ALWAYS AS ((est_low + est_high) / 2) STORED,
    deal_score INT NOT NULL CHECK (deal_score BETWEEN 1 AND 99),
    equity_spread NUMERIC(14, 2) GENERATED ALWAYS AS (GREATEST(0, ((est_low + est_high) / 2) - opening_bid)) STORED,
    sale_date DATE NOT NULL,
    plaintiff VARCHAR(255) DEFAULT '—',
    defendant VARCHAR(255) DEFAULT '—',
    judgment_amount NUMERIC(14, 2) DEFAULT 0,
    attorney VARCHAR(255) DEFAULT '—',
    occupancy VARCHAR(64) DEFAULT 'Unknown',
    deposit_terms TEXT NOT NULL DEFAULT 'Certified funds',
    photo_url TEXT,
    source_url TEXT,
    raw_notice TEXT,
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
CREATE INDEX IF NOT EXISTS idx_listings_deal_score ON listings(deal_score DESC);
CREATE INDEX IF NOT EXISTS idx_listings_opening_bid ON listings(opening_bid ASC);
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


