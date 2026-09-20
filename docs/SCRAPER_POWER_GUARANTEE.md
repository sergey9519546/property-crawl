# Scraper power & source amount — coverage guarantee

> Generated 2026-09-19T23:37:17.846Z from `server/sources/catalog.js` + `server/scrapers/scheduler.js` + `data.js`.
> **Code guarantee ≠ live inventory guarantee.** Volume depends on publisher reachability.

## Headline numbers

| Metric | Value |
|---|---:|
| Catalog sources (all ends) | **163** |
| Scheduled production adapters | **21** |
| Adapters with Scrapling profiles | **8** |
| Seed listings in data.js | **2096** |
| Required end coverage (scheduled) | **10/10** |

## End coverage (all channels)

| End | Catalog | Scheduled | Strong (P4) | Required | Status |
|---|---:|---:|---:|:---:|---|
| Federal/GSE REO | 7 | 5 | 2 | yes | ✅ adapter |
| Federal seizure/forfeiture | 5 | 3 | 2 | yes | ✅ adapter |
| Federal/state surplus real property | 54 | 1 | 1 | yes | ✅ adapter |
| Federal/state land sales | 2 | 1 | 0 | yes | ✅ adapter |
| Foreclosure/sheriff/trustee auction | 7 | 6 | 2 | yes | ✅ adapter |
| Tax lien/deed sale | 58 | 1 | 0 | yes | ✅ adapter |
| Land bank inventory | 2 | 1 | 0 | yes | ✅ adapter |
| County/municipal surplus | 1 | 1 | 0 | yes | ✅ adapter |
| Commercial marketplaces (issuer-preserving) | 4 | 0 | 0 | no | catalog only |
| Public notices / early signal | 3 | 1 | 0 | yes | ✅ adapter |
| Court/PACER dockets | 3 | 1 | 0 | no | catalog only |
| Parcel/assessor evidence | 6 | 1 | 0 | yes | ✅ adapter |
| Title/recorder evidence | 3 | 0 | 0 | no | catalog only |
| Area/market context | 3 | 0 | 0 | no | catalog only |
| Hazard/environmental screening | 3 | 0 | 0 | no | catalog only |
| Vacancy context | 1 | 0 | 0 | no | catalog only |
| Zoning/land use | 1 | 0 | 0 | no | catalog only |

## Power tiers

| Tier | Meaning | Count |
|---|---|---:|
| P4_LIVE_STRONG | Scheduled + Scrapling optional + fail-closed + lastRunReport | 7 |
| P3_LIVE_ADAPTER | Scheduled production adapter with run reports | 3 |
| P2_DISCOVERY_ADAPTER | Adapter registered but DISCOVERY_ONLY (canaries pending) | 10 |
| P2_BLOCKED_PUBLISHER | Publisher blocked/challenged; fail-closed in code | 2 |
| P0_CATALOG_ONLY | Catalog workflow/enrollment template only | 141 |

## Scheduled adapters (power scorecard)

| Adapter | Tier | Scrapling | Seed listings | Limitation |
|---|---|---|---:|---|
| `civilview` (CivilView Sheriff/Tax Sale Platform) | P4_LIVE_STRONG | civilview-sales | 60 | Jurisdiction-scoped (countyId); not nationwide |
| `civilview` (CivilView Participating Jurisdictions (Nationwide set)) | P4_LIVE_STRONG | civilview-sales | 60 | Jurisdiction-scoped (countyId); not nationwide |
| `gsa` (GSA Real Estate Sales) | P4_LIVE_STRONG | gsa-index, gsa-detail | 2 | robots exclusion on /our-listing; sparse inventory; Scrapling optional |
| `hud` (HUD HomeStore) | P4_LIVE_STRONG | hud-cards | 1971 | Publisher maintenance/challenges possible; fail-closed + Scrapling hud-cards |
| `irs` (IRS Auctions) | P4_LIVE_STRONG | irs-detail | 8 | — |
| `treasury` (Treasury Forfeiture Real Property) | P4_LIVE_STRONG | treasury-detail | 15 | — |
| `usda` (USDA RD/FSA Property Resales) | P4_LIVE_STRONG | usda-table | 15 | — |
| `servicelink` (Public Auction Network) | P3_LIVE_ADAPTER | — | 25 | — |
| `sheriff` (Ohio Sheriff Sale Auction) | P3_LIVE_ADAPTER | — | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `sheriff` (Realauction Sheriff/Tax Sale Portals (Multi-state)) | P3_LIVE_ADAPTER | — | 0 | OH Realauction default + SHERIFF_EXTRA_COUNTIES enrollment |
| `bid4assets` (Bid4Assets) | P2_BLOCKED_PUBLISHER | — | 0 | CAPTCHA/account; circuit breaker fails closed |
| `ca-controller-tax-sale` (CA State Controller Tax-Defaulted Sales Directory) | P2_DISCOVERY_ADAPTER | table-extract | 0 | Cloudflare; DISCOVERY_ONLY until canaries |
| `courtlistener` (CourtListener / RECAP) | P2_DISCOVERY_ADAPTER | — | 0 | DISCOVERY_ONLY; enrichment only — never invents bid/sale |
| `fannie` (Fannie Mae HomePath) | P2_DISCOVERY_ADAPTER | — | 0 | SPA/API often unparseable without partner feed; fail-closed + SPA observation_error |
| `fl-dor-cadastral` (FL DOR Statewide Cadastral (ArcGIS REST)) | P2_DISCOVERY_ADAPTER | — | 0 | DISCOVERY_ONLY until two clean canaries (parcel evidence, not sale inventory) |
| `freddie` (Freddie Mac HomeSteps) | P2_DISCOVERY_ADAPTER | — | 0 | SPA/API often unparseable; fail-closed + SPA observation_error |
| `government-land` (State Trust/Public Land Auction Office) | P2_DISCOVERY_ADAPTER | — | 0 | Enrollment template: GOV_LAND_DISCOVERY_URL required; skipped_not_enrolled until enrolled |
| `landbank` (Land Bank Search) | P2_BLOCKED_PUBLISHER | — | 0 | Turnstile/CAPTCHA on some portals |
| `local-surplus` (County/Municipal Surplus Real Property) | P2_DISCOVERY_ADAPTER | — | 0 | Enrollment template: LOCAL_SURPLUS_DISCOVERY_URL required; skipped_not_enrolled until enrolled |
| `marshals` (U.S. Marshals Asset Forfeiture) | P2_DISCOVERY_ADAPTER | — | 0 | USMS bot-protection / brokered RealLook; fail-closed |
| `public-notices-email` (Press-Association Public Notice Email Alerts) | P2_DISCOVERY_ADAPTER | — | 0 | DISCOVERY_ONLY; operator IMAP/corpus evidence only |
| `va` (VA REO / VRM Properties) | P2_DISCOVERY_ADAPTER | — | 0 | Historical host 404; VA_REO_BASE_URL operator-configured; fail-closed |

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
