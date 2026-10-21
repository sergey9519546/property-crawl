-- Migration 027: Source Observation Run Metadata
--
-- With the bounded JSON observation store retired (its history imported by
-- scripts/import-observation-store.js), the runs metadata that recordSourceRun
-- maintained in that file needs a durable home. One row per source mirrors the
-- file store's `runs[sourceId]` shape: when a source last ran, whether it
-- succeeded, how many listings it accepted, and how many runs it has recorded.
-- The /sources change-detection view and scripts/audit-source-network.js read
-- this table instead of parsing a JSON file.

CREATE TABLE IF NOT EXISTS source_observation_runs (
    source_key VARCHAR(32) PRIMARY KEY REFERENCES sources(key) ON DELETE CASCADE,
    last_run_at TIMESTAMPTZ NOT NULL,
    last_success_at TIMESTAMPTZ,
    last_non_empty_at TIMESTAMPTZ,
    accepted_count INT NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
    evidence_count INT NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
    rejected_count INT NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
    error TEXT,
    duration_ms BIGINT NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    runs_count INT NOT NULL DEFAULT 0 CHECK (runs_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
