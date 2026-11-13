-- Migration 033: Align trigram GIN search index with discovery query.js predicate
-- Migration 006 indexed (address || city || county), which PostgreSQL cannot use
-- when query.js checks id, source_key, auction_program, and provenance->>'recordId'
-- in the same concatenated string. Matching the exact expression avoids sequential
-- scans and TOAST provenance decompression on live ?q= autocomplete and search queries.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_listings_discovery_full_search ON listings USING GIN (
  (
    coalesce(id, '') || ' ' ||
    coalesce(address, '') || ' ' ||
    coalesce(city, '') || ' ' ||
    coalesce(county, '') || ' ' ||
    coalesce(source_key, '') || ' ' ||
    coalesce(auction_program, provenance->'sourceFacts'->>'auctionProgram', '') || ' ' ||
    coalesce(provenance->>'recordId', '')
  ) gin_trgm_ops
);
