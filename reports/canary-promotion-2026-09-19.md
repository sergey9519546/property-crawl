# Migration 014 promotions — Treasury + USDA (2026-09-19)

Local PostgreSQL (`127.0.0.1:55432`) + `DISCOVERY_MODE=advanced`.

## Result

| Source | State | Clean canaries | Distinct run IDs | Scope |
|---|---|---:|---:|---|
| **treasury** | **promoted** | 2 | 2 | `realprop.shtml` assetClass=real_property |
| **usda** | **promoted** | 2 | 2 | resales SFH publisher inventory options |
| hud | not promote-ready | 1 CLEAN / 1 NOT_CLEAN | 1 | Full 52-jurisdiction sweep marked truncated (honest fail-closed) |

## Commands

```powershell
$env:DATABASE_URL='postgres://property:property-local-dev@127.0.0.1:55432/property_crawl'
$env:DISCOVERY_MODE='advanced'
node scripts/discovery-migrate.js
node scripts/canary-live.js run --sources treasury,usda --repeat 2
node scripts/canary-live.js promote --source treasury
node scripts/canary-live.js promote --source usda
node scripts/canary-live.js status --source treasury
```

## Policy evidence

- Promotion requires **two distinct durable clean runs** (Migration 014). Never weakened.
- HUD nationwide 52-state sweep stays **truncated** under careful pagination → NOT_CLEAN (correct). Use a declared narrow scope (e.g. `HUD_STATES=OH,NJ`) if HUD promotion is required.
- CAPTCHA sources remain fail-closed and unpromotable without legitimate access.

## Related verification (same window)

- Production E2E workflow: **17/17** (`npm run e2e:workflow`)
- Quality gate with PG: **13/13**
- Live scrapers via Next: HUD 1971 + CivilView 170 + others; CAPTCHA circuit-broken
