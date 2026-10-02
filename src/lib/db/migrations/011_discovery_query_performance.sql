-- Stable cursor sorts should not require sorting the full state slice.
CREATE INDEX IF NOT EXISTS idx_listings_discovery_state_score
  ON listings(state, deal_score DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS idx_listings_discovery_state_date
  ON listings(state, sale_date ASC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS idx_listings_discovery_state_bid
  ON listings(state, opening_bid ASC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS idx_listings_discovery_state_equity
  ON listings(state, equity_spread DESC NULLS LAST, id ASC);

-- Match the complete discovery free-text expression. The earlier index only
-- covered address/city/county and could not accelerate identifier searches.
CREATE INDEX IF NOT EXISTS idx_listings_discovery_full_search
  ON listings USING GIN (((coalesce(id,'')||' '||coalesce(address,'')||' '||coalesce(city,'')||' '||coalesce(county,'')||' '||coalesce(source_key,'')||' '||coalesce(auction_program,'')||' '||coalesce(provenance->>'recordId','')||' '||coalesce(provenance#>>'{sourceFacts,apn}','')||' '||coalesce(provenance#>>'{sourceFacts,parcelId}','')||' '||coalesce(provenance#>>'{sourceFacts,caseNumber}',''))) gin_trgm_ops);
