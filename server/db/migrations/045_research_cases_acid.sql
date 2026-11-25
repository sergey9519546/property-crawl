-- ACID PostgreSQL persistence and multi-tenant isolation for research_cases.
CREATE TABLE IF NOT EXISTS research_cases (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('inbox', 'pursue', 'pass')),
  payload JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, identity_key)
);

CREATE INDEX IF NOT EXISTS idx_research_cases_owner_updated
  ON research_cases (owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_cases_owner_state
  ON research_cases (owner_id, state);
