# Nationwide U.S. source coverage

Date: 2026-09-19 · $0 · CAPTCHA never bypassed

## What “nationwide” means here

| Layer | Coverage | How |
|---|---|---|
| **Federal national** | All U.S. (inventory varies) | HUD, IRS, Treasury, USDA, GSA, FEMA, EPA, FWS, Census, CourtListener, Federal Register — **scheduled adapters** where verified |
| **CivilView multi-state** | **18 states / 67 counties** published on Sales Web | `config/nationwide-civilview.js` + `CIVILVIEW_NATIONWIDE=1` |
| **Realauction sheriff** | OH default 20 counties + multi-state enrollment template | `sheriff.js` + `SHERIFF_EXTRA_COUNTIES` |
| **50 states + DC tax sale** | Enrollment templates only | `state-tax-sale-{code}` catalog entries |
| **50 states + DC surplus** | Enrollment templates only | `state-surplus-{code}` catalog entries |
| **CAPTCHA platforms** | **Fail-closed** | bid4assets, landbank, CA Controller Cloudflare |

**Honesty:** there is no single public API for every U.S. county foreclosure. Nationwide means *maximum first-party + participating-platform coverage + a catalog entry for every state*, not invented inventory.

## Commands

```powershell
npm run nationwide:coverage
npm run civilview:counties
npm run market:enroll
# CivilView nationwide bounded run
$env:CIVILVIEW_NATIONWIDE='1'
$env:CIVILVIEW_MAX_COUNTIES='8'
$env:CIVILVIEW_DETAIL_LIMIT='80'
```

## Federal adapters (already national)

| Adapter | Source id |
|---|---|
| hud | hud-homestore |
| irs | irs-auctions |
| treasury | treasury-forfeiture |
| usda | usda-resales |
| gsa | gsa-real-estate-sales |
| servicelink | servicelink (publisher-reported multi-market feed) |

## Next enrollment work (operator)

For each county you care about: official tax collector/treasurer URL → `LOCAL_SURPLUS_DISCOVERY_URL` / `GOV_LAND_DISCOVERY_URL` / `SHERIFF_EXTRA_COUNTIES` / county-specific intake. Canaries (Migration 014) still required before promoting a source.
