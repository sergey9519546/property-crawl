# Migration 014 promotion — HUD narrow scope (2026-09-20)

Local PostgreSQL (`127.0.0.1:55432`) + `DISCOVERY_MODE=advanced`.

## Declared scope

| Knob | Value |
|---|---|
| `HUD_STATES` | `OH,NJ` |
| `HUD_MAX_STATES` | `2` |
| `HUD_MAX_PAGES_PER_STATE` | `20` |
| `HUD_PAGE_SIZE` | `50` |

Nationwide 52-jurisdiction sweeps remain **out of scope** for promotion
(honest fail-closed when pagination budgets are hit).

## Result

| Source | State | Clean canaries | Distinct run IDs | Scope |
|---|---|---:|---:|---|
| **hud** | **promoted** | 2 | 2 | HomeStore query, caseStepNumber=6, states OH+NJ |

## Commands

```powershell
$env:DATABASE_URL='postgres://property:property-local-dev@127.0.0.1:55432/property_crawl'
$env:DISCOVERY_MODE='advanced'
$env:HUD_STATES='OH,NJ'
$env:HUD_MAX_PAGES_PER_STATE='20'
$env:HUD_PAGE_SIZE='50'
node scripts/discovery-migrate.js
node scripts/canary-live.js run --sources hud --repeat 2
node scripts/canary-live.js promote --source hud
node scripts/canary-live.js status
```

## Policy evidence

- First attempt with `HUD_MAX_PAGES_PER_STATE=2` was **NOT_CLEAN** (incomplete sweep / truncated pages) — gate held.
- Two subsequent clean runs at the declared larger page budget qualified.
- Promotion scope hash is bound to configured states + pageSize + endpoint filters
  (`server/scrapers/collection-scope.js` HUD branch). Changing `HUD_STATES`
  invalidates prior promotion evidence (Migration 014 scope hash reset).
