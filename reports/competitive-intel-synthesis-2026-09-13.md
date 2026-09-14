# Competitive Intelligence Synthesis — 2026-09-13

Extracted from ServiceLink Auction recon (31+17 pp), PropertyRadar technical
dossiers (29+20+21 pp), and the verified Property Intelligence Source Atlas
(501 sources). Goal: improve PerfectProperty's discovery/triage product.
**Explicit non-goal: building an auction platform.**

---

## What we already do better

| Area | Evidence |
|---|---|
| Federal REO scrapers (Treasury, USDA, IRS, GSA, HUD, VA, FDIC, Marshals) | Production scrapers with circuit breakers; atlas only lists these as secondary |
| ServiceLink + CivilView integration | Absent from atlas entirely |
| Canary→promotion gate (Migration 014) | Two clean durable runs required; neither competitor documents this rigor |
| Lease fencing + job ownership | `server/discovery/job-fence.js` with `FOR UPDATE` + `clock_timestamp()` |
| Evidence provenance contract | Every listing carries source-observed provenance; demo records are labeled |
| Honest fail-closed UI | API down → 503, no substitute data; demo records get amber badges |

---

## Top 10 adoptable patterns (ranked by leverage × effort)

### 1. Server-computed triage flags
**Source:** ServiceLink Dossier §10 — `isInPreAuction`, `showRegisterToBid`, `clearedForSale` are delivered by the server, never derived in the client.
**Our gap:** `discovery-card.tsx` and `discovery-workbench.tsx` compute freshness/completeness client-side.
**Action:** Add `triage` object to listing API responses: `{ isNew, priceDropped, staleDays, hasDocs, occupancyKnown, distressStage }`. Compute once in `server/scrapers/normalization.js` or `server/db/client.js`.

### 2. Source status taxonomy
**Source:** Source Atlas — `VERIFIED official|first-party|scope limited|dynamic claim|access restricted`, `LIVE SOURCE claim limited`, `LOCAL ROUTE verify jurisdiction`, `DISCOVERY ONLY`, `INCONCLUSIVE blocked`, `RETIRED/REPLACED`.
**Our gap:** `server/sources/catalog.js` has `role` and `access` fields but no lifecycle status.
**Action:** Add `status` field to every catalog entry. Source Radar UI should render it. CivilView Salem County = `LOCAL ROUTE verify jurisdiction`; GSA = `INCONCLUSIVE blocked` (robots); ServiceLink = `VERIFIED first-party`.

### 3. Canonical parcel key (FIPS + APN)
**Source:** PropertyRadar Open Items §8 — canonical key = county FIPS + normalized APN.
**Our gap:** Listing IDs are source-specific (`OH-CUY-10231`, `HUD-011-516864`, `servicelink:a1cVO...`). No cross-source parcel identity.
**Action:** Add `parcelKey` field (`{countyFips}-{normalizedApn}`) when APN is available. Use it for cross-source dedup and enrichment joins. Do NOT replace source IDs — layer it like ServiceLink's `globalPropertyId`.

### 4. Per-county coverage matrix
**Source:** PropertyRadar — 52 `/coverage` pages, 11 dimensions per county (assessor, recorder, probate, foreclosure, trustee-sale, listings, parcel boundary, doc image, tax status...).
**Our gap:** Source Radar shows source-level readiness but not county×datatype coverage.
**Action:** Extend `server/sources/catalog.js` entries with a `coverage` object: `{ counties: [...], dimensions: { assessor: true, recorder: false, ... } }`. Source Radar renders a matrix. Absence ≠ thin coverage — mark explicitly.

### 5. Multi-source bake-off
**Source:** PropertyRadar Dossier §8.2 — "multi-sourced, baked-off, backtested, backfilled. Most reliable version wins."
**Our gap:** Single-source ingestion. If HUD says one thing and a county record says another, we keep only what the scraper returned.
**Action:** When two sources describe the same `parcelKey`, store both observations with confidence scores. Prefer fresher. Never silently overwrite.

### 6. Immutable timestamped raw snapshots
**Source:** PropertyRadar Open Items §8 — every pull stored as immutable raw snapshot, replayable.
**Our gap:** `discovery_snapshots` exists in PG mode but JSON mode overwrites.
**Action:** Ensure every ingestion writes an immutable snapshot row with pull timestamp, even in demo mode. This is partially done — verify `server/discovery/store.js` `ingestSnapshot` never mutates.

### 7. Delta-sync endpoints
**Source:** ServiceLink DeepDive §6 — `listingchanges?since=`, `ageofflistings`, `auctioncalendar`.
**Our gap:** Full re-fetch on every collection cycle. No incremental delta.
**Action:** Add `?since=` parameter to `/api/listings` that returns only records with `updatedAt > since`. Enables efficient watchlist re-polling and hunt re-evaluation.

### 8. Distress lifecycle status machine
**Source:** ServiceLink Dossier §18.2 — 13-state foreclosure status machine (Cleared → Active → On Website → Postponed/Removed/Cancelled/On Hold/Pending Sale Date/Auction in Progress/Pending Results/Outbid/Sold/Reverted).
**Our gap:** We have `lifecycle` as a free-text-ish filter but no explicit state machine.
**Action:** Define a distress lifecycle enum: `pre_foreclosure | notice_recorded | scheduled | sold | reverted |reo | tax_sale | unknown`. Map each source's statuses into it. Use for triage priority.

### 9. Feature-flag discovery chips
**Source:** ServiceLink Dossier Table 9-1 — `showOnly`: Hot Property, New Listing, Price Reduced, Buyer exclusive, Financing considered.
**Our gap:** We have filters but no quick-toggle chips for common triage patterns.
**Action:** Add chips to Discovery Workbench: "New this crawl" (isNew), "Price dropped" (priceDropped), "Has documents" (hasDocs), "Stale >30d" (staleDays>30), "Occupancy known". Each maps to a server-computed triage flag.

### 10. Enrichment gateway keyed by property identity
**Source:** ServiceLink Dossier §6 — PropertyReportData comps, WalkScore, GreatSchools all keyed by `globalPropertyId`.
**Our gap:** Enrichment is per-request, not keyed by stable identity.
**Action:** Once `parcelKey` exists, key enrichment cache by it. Comps/schools/walkability lookups become stable across source changes.

---

## Highest-leverage catalog additions

From the Source Atlas + PropertyRadar gap analysis, add to `server/sources/catalog.js`:

| Priority | Source | Access | Why |
|---|---|---|---|
| 1 | FL DOR statewide cadastral (ArcGIS) | Free REST | One endpoint = assessor + parcel geometry for all 67 FL counties |
| 2 | TX CAD bulk rolls (Harris pattern) | Bulk download | Multi-county assessor/tax in one pattern |
| 3 | County recorder NOD/NOS indexes (Maricopa, Orange CA, Sacramento, LA) | Portal scrape | Pre-foreclosure discovery — we have zero recorder feeds |
| 4 | CourtListener / RECAP API | Free API | Court distress enrichment; PACER alternative |
| 5 | CA Controller tax-defaulted sales directory | Free browse | Tax-sale discovery beyond Bid4Assets |
| 6 | HUD/USPS quarterly vacancy | Free download | Vacancy as triage ranking input |
| 7 | FHFA HPI (monthly) | Free API key | Index-adjusted equity estimation |
| 8 | Census Geocoder + ACS | Free API key | Address→tract enrichment |
| 9 | MERS ServicerID | Account | Servicer point-in-time lookup |
| 10 | Excess-funds/unclaimed (Orange FL, Forsyth GA, Salt Lake UT, NY OSC) | Portal scrape | Post-sale recovery opportunities — zero coverage today |

---

## Explicit do-NOT-copy list

- SignalR live bidding, proxy bids, anti-sniping, bid increments
- Funds wallet, EMD allocation, wire instructions, KYC-for-bidding
- Buyer's premium, broker co-op commercial terms
- Multi-tenant bank white-label SSO
- Auction calendar as primary discovery surface (sale dates are triage inputs, not an auction product)
- Marketing stack (postcards, dialer/SMS, display ads, psychographic lists)
- Consumer CRM pipeline, kanban, accounting, e-sign
- Per-record skip-trace productization
- Zillow-style consumer search/valuation UI

---

## Implementation order

```
P0 (this week — pure server, no UI dependency)
  1. Source status taxonomy in catalog.js + Source Radar render
  2. Triage flags in listing API responses
  3. parcelKey field when APN available

P1 (next — enables better discovery)
  4. Distress lifecycle enum + source status mapping
  5. Feature-flag chips in Discovery Workbench
  6. Delta-sync ?since= on /api/listings

P2 (catalog expansion)
  7. FL DOR statewide cadastral adapter
  8. CourtListener/RECAP enrichment
  9. CA Controller tax-defaulted sales
 10. HUD/USPS vacancy + FHFA HPI

P3 (architecture)
 11. Multi-source bake-off on parcelKey collisions
 12. Per-county coverage matrix
 13. Enrichment gateway keyed by parcelKey
```
