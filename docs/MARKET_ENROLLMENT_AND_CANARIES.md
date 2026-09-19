# Market enrollment + local Migration 014

Date: 2026-09-19 · $0 constraint · CAPTCHA never bypassed

## 1) CivilView + Sheriff enrollment (done)

Validated live CivilView `countyId` map (`npm run civilview:counties`):

| State | Enrolled ids | Example names |
|---|---|---|
| NJ | 10,7,73,2,8,17,15,85 | Hudson, Bergen, Middlesex, Essex, Monmouth, Passaic, Union, Ocean |
| OH | 34,18,81,61 | Allen, Lorain, Medina, Richland |
| PA | 51,23,60 | Lehigh, Montgomery, Philadelphia |
| FL | 49,75 | Palm Beach, Santa Rosa |
| TX | 93,94,90,63 | Dallas P1/P2, Guadalupe Sheriff, Rockwall Sheriff |
| AZ | 47 | Maricopa |

Sheriff OH extras (on top of 20 defaults): Portage, Union, Wayne, Miami, Greene.

```powershell
npm run market:enroll   # prints env block for host dashboard
```

Primary CivilView run uses **one** `CIVILVIEW_TARGET_STATE` + `CIVILVIEW_EXTRA_COUNTIES` (rotate states or schedule per-market jobs).

## 2) Careful HUD / scheduled collection (done in config)

```bash
HUD_STATES=OH,NJ,PA,FL,TX,GA,AZ,NC,IL,MI
HUD_MAX_PAGES_PER_STATE=4
HUD_PAGE_SIZE=50
HUD_STATE_CONCURRENCY=2
SHERIFF_COUNTY_CONCURRENCY=3
SCRAPER_BACKGROUND_ENABLED=0   # enable only after canaries
```

Policy: polite pages, low concurrency, background off on $0 hosts until Migration 014 canaries are clean.

## 3) Postgres + Migration 014 (local $0 verified)

```powershell
npm run discovery:local -- up        # PostGIS on 127.0.0.1:55432
npm run discovery:local -- migrate   # includes 014 promotion evidence
npm run discovery:local -- canary    # list rollout state
```

Local verify 2026-09-19: **migrations applied**. Fresh DB has **no rollout rows** until collectors run under `DISCOVERY_MODE=advanced` + `DATABASE_URL`. Promotion still requires **two clean durable canaries** (Migration 014 contract — never weaken).

```powershell
$env:DATABASE_URL='postgres://property:property-local-dev@127.0.0.1:55432/property_crawl'
$env:DISCOVERY_MODE='advanced'
npm run canary:live -- --wave wave1 --repeat 2
```

## 4) CAPTCHA fail-closed (unchanged)

| Source | Policy |
|---|---|
| bid4assets | Akamai/CAPTCHA — not enrolled; circuit breaker |
| landbank | Turnstile — not enrolled |
| ca-controller-tax-sale | Cloudflare — DISCOVERY_ONLY |

`config/market-enrollment.js` lists these under `captchaFailClosed`. Tests assert policy text; no auto-bypass exists in scrapers.

## Verify

```powershell
npm run market:enroll
node --test test/market-enrollment.test.js
npm run quality:report
npm run discovery:local -- migrate
```
