# Migration 014 promotion — ServiceLink (2026-09-28)

Local PostgreSQL (`property_crawl` on port 5432) + `DISCOVERY_MODE=advanced`.

## Declared scope / env

| Knob | Value |
|---|---|
| `SERVICELINK_MAX_PAGES` | `100` |
| `SERVICELINK_PAGE_SIZE` | `100` |

Default collector budget (`maxPages=1`, `pageSize=25`) marks truncated sweeps NOT_CLEAN — gate held correctly on the first attempts.

## Bugs fixed en route

- `scripts/discovery-worker.js` created a discovery store for canary evidence
  but never wired it into the collector (`scheduler.discoveryStore`), so
  `discovery_source_runs` stayed empty and `runId` was null. Promotion
  evidence (`Migration 014`) requires a UUID run id bound to a complete
  `discovery_source_runs` row. Fix: set `collector.discoveryStore = store`
  when absent before executing the canary job.
- `server/db/migrations/015_status_contract.sql` applied: status CHECK
  constraint now admits `unknown`, `canonicalStatus` default is honest
  `unknown` (was fabricating `active`). Without this migration the live DB
  rejected scraper rows on `listings_status_check`.
- `server/discovery/query.js` `parseBbox` rejects zero-width longitude
  (`west === east`) to match `test/discovery/query-helpers.test.js`.
- `hasDocuments=unknown` tri-state bucket restored in the discovery query
  parser (`parseTristateBool`) — `test/server.test.js` asserts the unknown
  document-evidence bucket is accepted and returns `hasDocuments == null`.

## Result

| Source | State | Clean canaries | Distinct run IDs | Notes |
|---|---|---:|---:|---|
| **servicelink** | **promoted** | 2 | 2 | Full feed walk 6273 then 6271 accepted, rejected=0, `fullSweepComplete=true`, `truncated=false` |

Run IDs: `55a4a03e-55f8-472f-80b9-bf0a4ca97ee8`, `f4f23889-9063-4df2-a4fb-2a71daabb975`.

Scope: `{"filters":{},"endpoint":"/api/listingsvc/v1/Listings"}` (complete publisher slice).

## Commands

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5432/property_crawl'
$env:DISCOVERY_MODE='advanced'
$env:SERVICELINK_MAX_PAGES='100'
$env:SERVICELINK_PAGE_SIZE='100'
node scripts/discovery-worker.js --canary servicelink   # run 1/2
node scripts/discovery-worker.js --canary servicelink   # run 2/2
node scripts/discovery-worker.js --promote servicelink
node scripts/promotion-gate-check.js                    # PROMOTION GATE CONTRACT OK
```

## Policy note

`gsa`, `irs`, and nationwide `hud` remain **unpromoted** by policy:
- gsa: publisher robots exclusion on `/our-listing` (collector fail-closed).
- irs: 2026-09-27 live rerun found 0 real-estate auction cards on two
  distinct runs (`reports/canary-irs-2026-09-27.md`) — empty publisher
  inventory is not a clean canary.
- hud: stays at the declared OH,NJ scope.
