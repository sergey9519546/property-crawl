# Discovery brain operations runbook

The discovery brain is an intelligence and evidence layer. It records publisher observations and supports search, map context, and research queues. It does not operate auctions, place bids, confirm completed sales, or treat a marketplace listing as transaction proof.

## Initial setup

1. Set `POSTGRES_PASSWORD`, `POSTGRES_USER`, and `POSTGRES_DB` through the deployment secret store. Do not commit them.
2. Start `docker compose -f docker-compose.discovery.yml up -d discovery-db` and wait for the PostGIS health check.
3. Apply `server/db/schema.sql`, then `server/db/migrations/006_discovery_brain.sql` using the deployment migration mechanism. Record the migration revision.
4. Start `discovery-api` and `discovery-web`. Keep `SCRAPER_BACKGROUND_ENABLED=0` until the canary gate passes.
5. Run `node scripts/discovery-readiness.js` as a configuration check and the API readiness endpoint once root wires its database probe.

## Import and evidence gate

Every imported record must retain source key, publisher record ID, exact source URL, observed timestamp, raw payload hash, and evidence class. ServiceLink/Public Auction Network records are discovery observations. A `closed` or `reserve met` field does not establish `sold`; `bidsPlaced` does not establish bid history. Archive photos require separate address, recency, and reuse review.

Import a bounded jurisdiction/source sample first. Compare discovered, accepted, rejected, empty, partial, and truncated counts. Do not promote hunts or research cases from a failed, partial, scoped, rejected, or truncated cycle. Preserve the raw records when normalization fails.

## Canary and rollout

The canary must show: database-backed job and lease state; no duplicate run for a repeated idempotency key; restart recovery for a stale lease/job; source identifiers and timestamps present on every accepted record; zero unexpected rejected rows; and search/map contract tests passing. Measure PostgreSQL API latency separately from the in-memory benchmark. Targets are p95 under 1 second for search and 1.5 seconds for map responses on recorded deployment hardware with 100,000 records and ten concurrent warm readers.

Only after the canary is reviewed should an operator enable a bounded source schedule. Start with one source or jurisdiction, retain the source-level kill switch, and expand only after two clean cycles. There is no automatic production enablement in this compose file.

## Incident response

Pause the affected source when critical-field yield drops, the source returns zero after a nonzero baseline, the parser reports drift, or upstream access changes. Mark the run partial/failed, preserve the last known good observation, and inspect raw evidence before retrying. A stale cursor must return HTTP 409 and require a fresh query; never silently continue from an unknown snapshot.

## Verification commands

```text
node --test test/discovery-acceptance-contract.test.js test/discovery-acceptance-source-failure.test.js
node scripts/benchmark-discovery.js
docker compose -f docker-compose.discovery.yml config
```

`benchmark-discovery.js` is explicitly a memory microbenchmark. It does not represent PostgreSQL, PostGIS, network, or API performance. Use a separately instrumented live API run for the production latency gate.
