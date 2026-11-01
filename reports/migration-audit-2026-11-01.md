# Migration audit — 2026-11-01

Scope: all 27 migration files (003–029, now 28 with 030), the migrator
(`scripts/discovery-migrate.js`), the mirror system, the boot wiring, and the
fresh-boot path. Motivated by three near-misses/incidents in the preceding
weeks: the ledger wedge (an in-place edit of applied migration 024 blocked
025–027 and took down the listing feed), the missing `AUTO_MIGRATE` on the live
service, and `schema.sql` drift from the migration end-state.

## Findings and resolutions

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `source_observations.listing_id VARCHAR(64)` and `record_id VARCHAR(128)` — publisher identifiers are unbounded; migration 022 fixed exactly this for `listings.id` (GSA slugs >64 chars), and `discovery_snapshots.source_record_id` (the same concept) was TEXT from the start. An observation for a long-ID listing failed its INSERT and the write path swallowed the error as a per-row warning — the observation for the hardest-to-reconstruct listings was silently dropped. | High (silent data loss) | **Fixed**: migration `030_source_observation_identifier_width.sql` widens both to TEXT; `schema.sql` (both mirrors) corrected to the end state. |
| 2 | `schema.sql` drift from the migration end-state: `listings.id` was still `VARCHAR(64)` after 022 widened it to TEXT. A fresh database only became correct because 022 happened to run after schema.sql — an untracked dependency between two hand-maintained descriptions. | High (structural) | **Fixed + guarded**: schema.sql corrected (both mirrors), and a new fresh-boot guard (`test/db/fresh-boot-schema.test.js`) boots a throwaway embedded PostgreSQL, runs the real migrator, and compares every table/column/type/nullability/default to a committed golden (`test/db/golden-schema.json`, 38 tables / 339 columns). Regenerate deliberately with `UPDATE_GOLDEN=1`. |
| 3 | The advisory lock wait had no timeout: a second migrator holding the lock hung boot indefinitely, surfacing as an opaque deploy health-check failure. | Medium | **Fixed**: `SET lock_timeout='15s'` around the lock, reset in `finally` (session-level, not `SET LOCAL` — the lock is taken in autocommit). |
| 4 | A failing migration surfaced a bare Postgres error with no file name. | Medium (debugging cost; contributed to the 10-22 outage triage time) | **Fixed**: apply failures are rethrown as `<migration name>: <postgres message>`. |
| 5 | The in-place-edit convention had no written statement; the ledger self-heal (d197a1d) made silent no-ops possible instead of loud failures. | Medium (process) | **Fixed**: `server/db/migrations/README.md` — forward-only, never edit an applied file, mirror copies, transaction-wrapper rules, unbounded-identifier rule, fresh-boot guard usage. |
| 6 | Mirror parity (byte-identical `src/lib/db/migrations` + `schema.sql`) | OK | Already enforced by `test/db/migration-mirror.test.js` (generalized, not name-pinned). |
| 7 | Fresh-boot idempotency of the chain against the final schema | OK | Verified by reading all 27 files and by the new fresh-boot guard: `IF NOT EXISTS`/`DROP IF EXISTS`/`ON CONFLICT` used consistently; no `CONCURRENTLY`/nested-`COMMIT` statements (003/004 document the history); data migrations (003's deal_score rewrite, 014's rollout demotion) are no-ops on empty fresh tables. |
| 8 | Extensions on the fresh path (`pg_trgm` in 006, `pgcrypto` in 008, uuid-ossp in `schema.sql`) | OK | Each is created before its first use. |
| 9 | Status CHECK constraint carries a dual vocabulary (`postponed` + `POSTPONED`, `stayed` + `STAYED`, `adjourned` + `ADJOURNED`) inherited from the pre-normalization era | Low (hygiene) | Documented, deliberately not rewritten: a data-normalization migration on 10k+ production rows for cosmetics is not worth the write lock. New writes are lowercase (`classifyStatusActivity`). |
| 10 | `source_observations.id` remains VARCHAR(64) | OK | The row PK is always a 64-char sha256 hex digest — exactly sized, no ingestion risk. |
| 11 | `account_login_tokens` has no index on `email` | Low | Not added: the table holds one row per outstanding magic link; a scan is fine at this scale. Revisit if link volume grows. |

## Migrator contract after this audit

- One ledger: `discovery_schema_migrations(name, sha256, applied_at)`, guarded by
  advisory lock `72463198` with a 15s `lock_timeout`.
- Fresh database: `schema.sql` first, then the full chain; every file recorded.
- Existing database: pending files apply in name order; a drifted already-applied
  file is re-recorded (never re-run) with a warning; a failing file aborts with
  its name attached.
- Boot wiring: `AUTO_MIGRATE=1` (now set on the live service) invokes the same
  `migrate()`; target resolution is centralized in `server/db/database-target.js`.

## Verification

- `npm run test:db`: 140/140 (adds `test/db/fresh-boot-schema.test.js` and the
  drift guards; 030 applies on the existing local embedded database and on the
  fresh boot).
- `test/db/migration-ledger-drift.test.js`: 2/2.
- `test/db/migration-mirror.test.js`: byte-identity across 28 migrations.
- Release gate: run before push (pre-push hook).
