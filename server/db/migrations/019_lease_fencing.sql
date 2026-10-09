-- Worker Task Pool & Lease Fencing Schema
--
-- Manages concurrent distributed task execution across scraper workers,
-- enrichers, and evaluators using row-level locking (FOR UPDATE SKIP LOCKED)
-- and automatic heartbeat lease expiry reclaim.

CREATE TABLE IF NOT EXISTS worker_leases (
  id TEXT PRIMARY KEY,
  lease_owner TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  leased_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_leases_status_expiry
  ON worker_leases(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_worker_leases_owner
  ON worker_leases(lease_owner, status);
