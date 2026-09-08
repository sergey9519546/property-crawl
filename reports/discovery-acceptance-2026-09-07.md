# Discovery brain acceptance — 2026-09-07

## Result

The PostgreSQL/PostGIS persistence, isolation, cursor, job, lease, hunt-baseline, and evidence-history checks passed against a real PostgreSQL 16.15 / PostGIS 3.6.2 runtime. After consolidating count and facet aggregation and adding migration-backed search/sort indexes, three consecutive corrected 100,000-row runs passed both latency targets.

## Runtime and benchmark

- Host: Windows `win32/x64`, Node `v25.2.1`; Intel Core i7-14700KF, 28 logical CPUs, 68,423,806,976 bytes RAM.
- Fixture: 100,000 legitimate PostgreSQL rows in a disposable schema, removed after each run.
- Load: 10 concurrent readers, 20 measured iterations after warm-up.
- Conservative ten-reader search batch p95 across three runs: 358.52 ms, 380.51 ms, 274.15 ms (target 1,000 ms).
- Conservative ten-reader PostGIS map batch p95: 348.16 ms, 799.14 ms, 466.71 ms (target 1,500 ms).
- Individual search-request p95: 275.82 ms, 323.02 ms, 256.08 ms.
- Individual map-request p95: 325.09 ms, 438.62 ms, 408.70 ms.
- Seed plus `ANALYZE` time: 7.33 s, 7.68 s, 11.18 s; this is excluded from request latency.
- Machine-readable reports: `.cache/discovery-benchmark-report-run1.json`, `run2.json`, and `run3.json`.

The batch measurement is wall time until all ten concurrent requests complete; the request measurement is p95 across all 200 individual requests. `EXPLAIN (ANALYZE, BUFFERS)` on the same 100,000-row fixture measured the representative search page at 79.59 ms and the combined facet aggregation at 22.79 ms after warm-up. The prior conservative search batch p95 was 1,088.61 ms.

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
- Listings whose projection still has archive origin after the completed national-core canaries: 250; another 7,763 have live origin, for 8,013 retained listings. ServiceLink accounts for 5,730 live plus 250 archive records; HUD adds 1,992, Treasury 16, USDA 15, IRS 7, and GSA 3 live records. Absence from a live sweep does not establish a withdrawal or sale.
- Archive listings with a known transaction outcome: 0
- Archive observations promoted to known bid evidence: 0

The replay reported 5,900 reused snapshots and no new snapshots, consistent with import idempotency.

## Limits

Docker Desktop was unavailable on this host, so Compose configuration was parsed but images and the complete container stack were not started. Live-source gates are evaluated separately from this database acceptance. Browser and actual HTTP verification are recorded in `reports/discovery-ui-walkthrough-2026-09-07.md`.
