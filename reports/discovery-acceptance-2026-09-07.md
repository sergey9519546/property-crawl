# Discovery brain acceptance — 2026-09-07

## Result

The PostgreSQL/PostGIS persistence, isolation, cursor, job, lease, hunt-baseline, and evidence-history checks passed against a real PostgreSQL 16.15 / PostGIS 3.6.2 runtime. The latency gate is currently marginal and is not accepted as stable: two 100,000-row runs measured search p95 of 985.18 ms and 1,088.61 ms against a 1,000 ms target. Map p95 passed in both runs.

## Runtime and benchmark

- Host: Windows `win32/x64`, Node `v25.2.1`.
- Fixture: 100,000 legitimate PostgreSQL rows in a disposable schema, removed after each run.
- Load: 10 concurrent readers, 20 measured iterations after warm-up.
- Latest search p95: 1,088.61 ms (target 1,000 ms; failed).
- Latest PostGIS map p95: 572.74 ms (target 1,500 ms; passed).
- Earlier search p95: 985.18 ms; earlier map p95: 464.21 ms.
- Machine-readable latest report: `.cache/discovery-benchmark-report.json`.

The variation across the threshold means a single passing run is insufficient evidence for the search latency objective. Query profiling or a larger margin is required before calling the performance gate complete.

## Verified behavior

Twenty-two focused assertions passed across the PostgreSQL acceptance, readiness, restart, evidence, large-hunt, and SQL query suites. They cover:

- required migrations, PostGIS, and durable discovery tables;
- run, snapshot, observation, checkpoint, job, and lease state across store recreation;
- atomic ten-way job claiming, idempotency scope binding, repeated JSONB stage/error transitions, and guarded owner updates;
- a real claimant process kill followed by blocked immediate reclaim and successful reclaim after lease expiry;
- revision-bound cursor invalidation after a listing mutation and map queries through PostGIS;
- 10,050-record hunt baselines accumulated in 1,000-row pages, with partial pages retaining unobserved identities and emitting no disappearance events;
- exact publisher snapshot binding, raw snapshot access, closed-result separation, parcel-and-jurisdiction links, address-only candidates, publisher conflicts, durable research, and suppression of local media paths.

## Read-only archive accounting

- Raw catalog snapshots: 5,900
- Closed-result snapshots: 128
- Media references: 40,578
- Media assets: 5,270
- Media links: 5,313
- Atlas sources: 501
- Atlas ledger entries: 557
- Listings whose current projection still has archive origin: 5,875 (some records can have newer live projections)
- Archive listings with a known transaction outcome: 0
- Archive observations promoted to known bid evidence: 0

The replay reported 5,900 reused snapshots and no new snapshots, consistent with import idempotency.

## Limits

Docker Desktop was unavailable on this host, so Compose configuration was parsed but images and the complete container stack were not started. Live-source gates are evaluated separately from this database acceptance. End-to-end UI behavior is outside this report and has not been claimed.
