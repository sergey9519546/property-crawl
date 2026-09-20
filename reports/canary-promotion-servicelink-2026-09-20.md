# Migration 014 promotion — ServiceLink (2026-09-20)

Local PostgreSQL + `DISCOVERY_MODE=advanced`.

## Declared scope / env

| Knob | Value |
|---|---|
| `SERVICELINK_MAX_PAGES` | `100` |
| `SERVICELINK_PAGE_SIZE` | `100` |

Default collector budget (`maxPages=1`, `pageSize=25`) marks truncated sweeps NOT_CLEAN — gate held correctly.

## Bugs fixed en route

- `servicelink.js` set `report.sweepStartedAt` but checked `this.sweepStartedAt` for `fullSweepComplete` (always false on first run).
- Truncation now only when a **continuation token remains** after the page budget.

## Result

| Source | State | Clean canaries | Distinct run IDs | Notes |
|---|---|---:|---:|---|
| **servicelink** | **promoted** | 2 | 2 | Full feed walk 3609 then 5709 accepted, rejected=0 |

## Commands

```powershell
$env:DATABASE_URL='postgres://property:property-local-dev@127.0.0.1:55432/property_crawl'
$env:DISCOVERY_MODE='advanced'
$env:SERVICELINK_MAX_PAGES='100'
$env:SERVICELINK_PAGE_SIZE='100'
node scripts/canary-live.js run --sources servicelink --repeat 2
node scripts/canary-live.js promote --source servicelink
```
