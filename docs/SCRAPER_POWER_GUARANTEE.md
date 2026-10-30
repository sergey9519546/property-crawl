# Scraper power & source amount — coverage guarantee

> Generated 2026-10-30T22:39:59.001Z from `server/sources/catalog.js` + `server/scrapers/scheduler.js` + `data.js`.
> **Code guarantee ≠ live inventory guarantee.** Volume depends on publisher reachability.

## Headline numbers

| Metric | Value |
|---|---:|
| Catalog sources (all ends) | **288** |
| Scheduled production adapters | **21** |
| Adapters with Scrapling profiles | **46** |
| Seed listings in data.js | **2130** |
| Required end coverage (scheduled) | **10/10** |

## End coverage (all channels)

| End | Catalog | Scheduled | Strong (P4) | Required | Status |
|---|---:|---:|---:|:---:|---|
| Federal/GSE REO | 7 | 5 | 1 | yes | ✅ adapter |
| Federal seizure/forfeiture | 5 | 3 | 2 | yes | ✅ adapter |
| Federal/state surplus real property | 54 | 1 | 1 | yes | ✅ adapter |
| Federal/state land sales | 2 | 1 | 0 | yes | ✅ adapter |
| Foreclosure/sheriff/trustee auction | 25 | 7 | 1 | yes | ✅ adapter |
| Tax lien/deed sale | 132 | 31 | 0 | yes | ✅ adapter |
| Land bank inventory | 12 | 1 | 0 | yes | ✅ adapter |
| County/municipal surplus | 1 | 1 | 0 | yes | ✅ adapter |
| Commercial marketplaces (issuer-preserving) | 10 | 0 | 0 | no | catalog only |
| Public notices / early signal | 3 | 1 | 0 | yes | ✅ adapter |
| Court/PACER dockets | 20 | 1 | 0 | no | catalog only |
| Parcel/assessor evidence | 6 | 1 | 0 | yes | ✅ adapter |
| Title/recorder evidence | 3 | 0 | 0 | no | catalog only |
| Area/market context | 3 | 0 | 0 | no | catalog only |
| Hazard/environmental screening | 3 | 0 | 0 | no | catalog only |
| Vacancy context | 1 | 1 | 0 | no | catalog only |
| Zoning/land use | 1 | 0 | 0 | no | catalog only |

## Power tiers

| Tier | Meaning | Count |
|---|---|---:|
| P4_LIVE_STRONG | Scheduled + Scrapling optional + fail-closed + lastRunReport | 5 |
| P2_DISCOVERY_ADAPTER | Adapter registered but DISCOVERY_ONLY (canaries pending) | 11 |
| P2_BLOCKED_PUBLISHER | Publisher blocked/challenged; fail-closed in code | 2 |
| P0_CATALOG_ONLY | Catalog workflow/enrollment template only | 234 |

## Scheduled adapters (power scorecard)

| Adapter | Tier | Scrapling | Seed listings | Limitation |
|---|---|---|---:|---|
| `gsa` (GSA Real Estate Sales) | P4_LIVE_STRONG | gsa-index, gsa-detail | 41 | robots exclusion on /our-listing; sparse inventory; Scrapling optional |
| `irs` (IRS Auctions) | P4_LIVE_STRONG | irs-detail | 1 | — |
| `servicelink` (Public Auction Network) | P4_LIVE_STRONG | table-extract | 25 | — |
| `treasury` (Treasury Forfeiture Real Property) | P4_LIVE_STRONG | treasury-detail | 16 | — |
| `usda` (USDA RD/FSA Property Resales) | P4_LIVE_STRONG | usda-table | 16 | — |
| `civilview` (CivilView Sheriff/Tax Sale Platform) | P3_SCOPE_LIMITED | civilview-sales | 60 | Jurisdiction-scoped (countyId); not nationwide |
| `civilview` (CivilView Participating Jurisdictions (Nationwide set)) | P3_SCOPE_LIMITED | civilview-sales | 60 | Jurisdiction-scoped (countyId); not nationwide |
| `hud` (HUD HomeStore) | P3_SCOPE_LIMITED | hud-cards | 1971 | Publisher maintenance/challenges possible; fail-closed + Scrapling hud-cards |
| `bid4assets` (Bid4Assets) | P2_BLOCKED_PUBLISHER | — | 0 | CAPTCHA/account; circuit breaker fails closed |
| `ca-controller-tax-sale` (CA State Controller Tax-Defaulted Sales Directory) | P2_DISCOVERY_ADAPTER | table-extract | 0 | Cloudflare; DISCOVERY_ONLY until canaries |
| `courtlistener` (CourtListener / RECAP) | P2_DISCOVERY_ADAPTER | — | 0 | DISCOVERY_ONLY; enrichment only — never invents bid/sale |
| `fannie` (Fannie Mae HomePath) | P2_DISCOVERY_ADAPTER | table-extract | 0 | SPA/API often unparseable without partner feed; fail-closed + SPA observation_error |
| `fl-dor-cadastral` (FL DOR Statewide Cadastral (ArcGIS REST)) | P2_DISCOVERY_ADAPTER | — | 0 | DISCOVERY_ONLY until two clean canaries (parcel evidence, not sale inventory) |
| `freddie` (Freddie Mac HomeSteps) | P2_DISCOVERY_ADAPTER | table-extract | 0 | SPA/API often unparseable; fail-closed + SPA observation_error |
| `government-land` (State Trust/Public Land Auction Office) | P2_DISCOVERY_ADAPTER | — | 0 | Enrollment template: GOV_LAND_DISCOVERY_URL required; skipped_not_enrolled until enrolled |
| `hud-usps-vacancy` (HUD/USPS Vacancy Data) | P2_DISCOVERY_ADAPTER | — | 0 | — |
| `landbank` (Land Bank Search) | P2_BLOCKED_PUBLISHER | — | 0 | Turnstile/CAPTCHA on some portals |
| `local-surplus` (County/Municipal Surplus Real Property) | P2_DISCOVERY_ADAPTER | — | 0 | Enrollment template: LOCAL_SURPLUS_DISCOVERY_URL required; skipped_not_enrolled until enrolled |
| `marshals` (U.S. Marshals Asset Forfeiture) | P2_DISCOVERY_ADAPTER | table-extract | 0 | USMS bot-protection / brokered RealLook; fail-closed |
| `public-notices-email` (Press-Association Public Notice Email Alerts) | P2_DISCOVERY_ADAPTER | — | 0 | DISCOVERY_ONLY; operator IMAP/corpus evidence only |
| `sheriff` (Ohio Sheriff Sale Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Realauction Sheriff/Tax Sale Portals (Multi-state)) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Miami-Dade County FL — Tax Deed Auction (RealForeclose)) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Broward County FL — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Palm Beach County FL — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Orange County FL (Orlando) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Hillsborough County FL (Tampa) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Lee County FL (Fort Myers) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Pinellas County FL (St. Petersburg) — Tax Deed) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Duval County FL (Jacksonville) — Tax Deed) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Polk County FL — Tax Deed) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Brevard County FL (Titusville/Melbourne) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Volusia County FL (DeLand/Daytona Beach) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Sarasota County FL (Sarasota) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Manatee County FL (Bradenton) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Collier County FL (Naples) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Pasco County FL (Dade City/New Port Richey) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Marion County FL (Ocala) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Lake County FL (Tavares) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Osceola County FL (Kissimmee) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Seminole County FL (Sanford) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (St. Lucie County FL (Fort Pierce) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Escambia County FL (Pensacola) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Charlotte County FL (Punta Gorda) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Clay County FL (Green Cove Springs) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Citrus County FL (Inverness) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Hernando County FL (Brooksville) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Martin County FL (Stuart) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Okaloosa County FL (Crestview/Fort Walton Beach) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Santa Rosa County FL (Milton) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (St. Johns County FL (St. Augustine) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Bay County FL (Panama City) — Tax Deed Auction) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Miami-Dade FL — Foreclosure Auction (RealForeclose)) | P2_LOCAL_ROUTE | table-extract | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `va` (VA REO / VRM Properties) | P2_DISCOVERY_ADAPTER | table-extract | 0 | Historical host 404; VA_REO_BASE_URL operator-configured; fail-closed |

## What we guarantee (code)

- Every catalog end is represented in server/sources/catalog.js (machine-readable).
- Every scheduled adapter extends BaseScraper with circuit breaker + timeout.
- Fannie/Freddie/VA/USMS/Sheriff/HUD fail closed — no silent empty inventory.
- Scrapling protocol validates all 9 profiles; SSRF + HTTPS + rejected=0 canary gates.
- Live inventory is never fabricated: demo Unsplash inventories removed; fixtures labeled origin=fixture.

## What we cannot guarantee (honest)

- Publisher inventory volume at runtime (blocked CAPTCHA/WAF/SPA sites may yield 0).
- Nationwide county foreclosure coverage (no universal U.S. endpoint — enrollment required).
- Promoted Migration 014 sources without PostgreSQL durable canaries.
- Bid4Assets / Land Bank / CA Controller live data while CAPTCHA/Cloudflare persist.

## Reproduce

```powershell
node scripts/scraper-power-report.js
node scripts/scraper-power-report.js --json > reports/scraper-power.json
```

Re-run after catalog/scheduler changes; numbers are derived, not hand-written.
