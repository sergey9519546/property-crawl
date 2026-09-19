# Scraper → Listing 10x upgrade

Date: 2026-09-19  
Constraint: $0 infra, no CAPTCHA bypass, no fabricated inventory.

## What “10x” means here

Not 10× live national volume overnight. It means **10× more useful pull + display**:

| Axis | Before | After this upgrade |
|---|---|---|
| Sheriff OH default counties | 10 | **20** + env enrollment + parallel fetch |
| Sheriff HTML parse | Narrow table-row | Broader class set + appraisal/sale-date extraction |
| CivilView enrollment | Single `CIVILVIEW_COUNTY_ID` | **`CIVILVIEW_EXTRA_COUNTIES`** multi-id |
| HUD depth | Fixed 3 pages × 50 | Env `HUD_MAX_PAGES_PER_STATE` / `HUD_PAGE_SIZE` / `HUD_STATE_CONCURRENCY` |
| Listing research quality | Evidence counts only | **`researchQuality` score 0–100 + band** |
| Opportunity ranking | dealScore only | **`opportunity.rank`** = deal score + sale urgency + evidence |
| Identity merge | parcelKey only | **`identityFallback`** address+state key (no invented APNs) |
| Inventory dashboard | Power scorecard only | **`npm run listing:pipeline`** + `/api/listings` `pipeline` summary |
| UI triage | Stale/completeness chips | **Evidence badge + sale-urgency + opportunity rank** |

## Architecture (new)

```
scrapers (expanded) ──► validation ──► data.js / live cache
                                              │
                                              ▼
                                    presentListing()
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
            sourceFreshness          researchQuality              opportunity
            evidenceCompleteness     (quality band)               (rank/urgency)
                    │                         │                         │
                    └─────────────────────────┼─────────────────────────┘
                                              ▼
                              /api/listings { pipeline, listings[] }
                                              ▼
                         DiscoveryCard badges + listing:pipeline report
```

## New modules / scripts

- `server/scrapers/listing-intelligence.js` — quality, opportunity, identity, inventory summary
- `scripts/listing-pipeline-report.js` — CLI quality dashboard (`npm run listing:pipeline`)
- Tests: `test/listing-intelligence.test.js`

## Env knobs (collection depth)

```bash
SHERIFF_EXTRA_COUNTIES=Name:domain:ST,...
SHERIFF_COUNTY_CONCURRENCY=3
CIVILVIEW_EXTRA_COUNTIES=1,2,3
CIVILVIEW_MAX_COUNTIES=8
CIVILVIEW_DETAIL_LIMIT=80
HUD_MAX_PAGES_PER_STATE=6
HUD_PAGE_SIZE=50
HUD_STATE_CONCURRENCY=3
```

## Honesty rules preserved

- Quality ≠ deal quality: **evidence** score is about reviewability.
- Opportunity rank uses modeled deal score + published sale dates only.
- CAPTCHA publishers stay fail-closed (Bid4Assets, Land Bank, CA Controller Cloudflare).
- identityFallback never invents parcel numbers.

## Verify

```powershell
node --test test/listing-intelligence.test.js test/scraper-upgrade.test.js
npm run listing:pipeline
npm run quality:report
curl -s "http://127.0.0.1:3000/api/listings?limit=5" | jq .pipeline
```
