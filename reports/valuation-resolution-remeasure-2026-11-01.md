# Valuation resolution re-measure — 2026-11-01

Purpose: the standing instruction from the 2026-10-22 session — re-measure the
ratio-component resolution after production collection cycles, then choose the
next enrollment targets from evidence.

## Method

`evaluateOpportunitySignals` (current evaluator: 8 signals, publisher-gated,
situs-resolved) over the live store (10,785 records; 1,558 actionable with a
future sale date). Observation history was passed as empty — the file store is
retired and production's PostgreSQL observation mirror is not reachable from the
workstation. This under-counts the relist/bid-reduction signals (which read
observation history) but does not affect the headline ratio measurement, which
depends only on listing fields (estLow/estHigh, assessed, provenance).

## Findings

| Signal | Resolves (of 1,558 actionable) |
|---|---|
| sale_date_known | 1,558 (100%) — confirmed future auction date |
| publisher_documents | 872 (56%) — unweighted ledger signal |
| bid_to_value_ratio (30% weight) | **0** |
| building_area_discrepancy | 0 (needs public-records research) |
| title_equity_unresolved | 0 (needs verified cash-to-close) |
| bid_reduction / returned_to_market | 0 with empty history |
| municipal_code_enforcement | 0 (not cross-referenced) |
| **Score distribution** | **{20: 1558}** — every actionable listing scores exactly 20 |

The ratio component — 30% of the triage score — resolves for **zero** listings.
The score remains a single bit: "has a future auction date."

## The enrollment answer changed

The actionable inventory does **not** sit in the enrolled counties. Current
registry (market-conversion counties): Cuyahoga OH, Alachua FL, Harris TX,
Bexar TX, Orange FL — none appear in the top of the actionable concentration.

Where the 1,558 actionable listings actually are:

| State | Actionable | Top counties |
|---|---|---|
| NJ | 399 | Hudson 135, Bergen 131, Passaic 75, Monmouth 38 (civilview stronghold) |
| PA | 203 | Philadelphia 46, Allegheny 22 |
| AZ | 196 | **Maricopa 99**, Pima 35, Pinal 35 |
| CO | 140 | Arapahoe 19, Adams 19, Weld 15 (+ Denver) |
| CA | 86 | Los Angeles 20 |
| MI | 68 | Wayne 16 |

## Enrollment shortlist (next data-ops targets, in order)

1. **AZ — Maricopa (99 actionable).** Highest single-county concentration, and
   `server/scrapers/adapters/maricopa-recorder.js` already exists (recorder
   documents flow); the assessor side (MARICOPA parcel layer with
   `assessedTotalField` + a statutory market conversion) is the missing piece.
   Maricopa publishes an ArcGIS parcel layer with full assessment fields.
2. **NJ — Hudson/Bergen/Passaic (341 combined).** New Jersey publishes
   county-level MOD-IV assessment data; per-county ArcGIS endpoints exist for
   the larger counties. Highest-value cluster if one or two layers cover
   multiple counties.
3. **PA — Philadelphia (46) + Allegheny (22).** Both publish open-data
   assessment layers (Philadelphia's is API-first).
4. **CO — Arapahoe/Adams/Weld (~53).** Colorado assessors publish parcel
   layers; three counties share a similar schema.

Each enrollment is a `COUNTY_ARCGIS_REGISTRY` entry in
`server/enrichment/arcgis-parcels.js`: layer URL, APN field, assessed
land/improvement/total fields, and (when the county publishes one) a statutory
assessment-to-market conversion ratio — never a raw assessed value without one
(zero-fabrication rule). `test/assessor-reading.test.js` and
`test/enrichment_geocoding.test.js` pin the conversion behavior.

## Score outlook once valuation lands

With the ratio component live at, e.g., a 40% discount, an actionable listing
scores 20 (sale date) + 12 (ratio) ≈ 32 → Moderate; deeper discounts push past
50 → High. The bands (moderate ≥ 30, high ≥ 50) were calibrated for exactly
this; re-measure the distribution after each enrollment batch.
