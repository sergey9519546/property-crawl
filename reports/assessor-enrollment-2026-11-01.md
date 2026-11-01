# Assessor enrollment expansion — 2026-11-01 (Maricopa and Pima Counties, AZ)

> Follow-on batch to `reports/assessor-enrollment-2026-10-21.md`. Same
> no-fabrication rule (AGENTS.md: "Never invent sources, scores, or listings"):
> the county is enrolled only after its endpoint answered live in this session,
> with the field mapping read off the service's own layer metadata and pinned by
> tests.

## What was enrolled

| County key | Registry endpoint | Market value field | Conversion | Verification evidence |
|---|---|---|---|---|
| `AZ-MARICOPA` | `gis.maricopa.gov/arcgis/rest/services/Reference/ParcelCityCounty/MapServer/0/query` | `FullCashValue` | market-figure | Layer metadata read live (`f=json` → 93 fields). Sampled APN `10101010`: `FullCashValue` 10,205,862 = `LandFullCashValue` 1,834,600 + `ImprovementFullCashValue` 8,371,262. Spatial point-intersect on the same parcel's own `Longitude_DD`/`Latitude_DD` returned the same record and the same figure. APN `LIKE` lookups returned exactly 1 feature each for `10101010` and `10101001C` (no `%` ambiguity). Layer holds 1,761,798 parcels. FCV corroborated against the layer's own recorded sales (see below) |
| `AZ-PIMA` | `gisdata.pima.gov/arcgis1/rest/services/GISOpenData/LandRecords/MapServer/12/query` | `FCV` | market-figure | Layer metadata read live (`f=json`). Sampled APN `10101003E` (2150 W Orange Grove Rd): `FCV` 3,051,606, `TAXYR` `"2026"`, `PARCEL_USE` `1170`. Spatial point-intersect on the same parcel's own `LON`/`LAT` returned the same record and figure; APN `LIKE` returned exactly 1 feature. Layer holds 448,600 parcels and is Pima-only (sampled `JURIS_OL` values are Pima jurisdictions: unincorporated Pima County, Marana). No sale-price or valuation-year column exists on this layer |

Registry totals after this batch: **14 enrolled counties**, 10 with verified market
conversions (TX-BEXAR, FL-ORANGE, OH-CUYAHOGA, FL-ALACHUA, TX-HARRIS,
OH-FRANKLIN, OH-HAMILTON, TX-TARRANT, AZ-MARICOPA, AZ-PIMA), 4 withheld with
named reasons (IL-COOK, NV-CLARK, ID-BANNOCK, NV-WASHOE).

The two Arizona entries rest on the same statewide statute but do **not** share
the same evidence, and the code says so: Maricopa's citation carries its sampled
ratio, Pima's states that no sale-price column exists and that the entry is not
sale-price corroborated. `test/assessor-reading.test.js` asserts the Pima
citation does not contain Maricopa's `0.82` figure, so the stronger claim cannot
be copied onto the weaker evidence.

## Why full cash value is the market figure here

A.R.S. § 42-11001(6) makes full cash value the assessor's market-value estimate
and caps it: "Full cash value shall not be greater than market value regardless
of the method prescribed to determine value for property tax purposes." Both
counties publish that figure directly (`FullCashValue` in Maricopa, `FCV` in
Pima), so it is compared with the published opening amount like the verified
Texas and Florida market-figure counties.

The cap is what makes the comparison safe: because the published figure cannot
exceed market value, `openingBid / FullCashValue` cannot understate the ratio, so
the derived discount is a **conservative lower bound** — the failure mode is a
deal that looks worse than it is, never better.

Maricopa's layer also publishes `AssessedFullCashValue` and
`AssessmentRatio_Pct`; those are the **taxed basis** and are deliberately not
used as market. `test/assessor-reading.test.js` pins the field choice
(`assessedTotalField === 'FullCashValue'`, and explicitly not
`AssessedFullCashValue`); the citation pinned by the test carries the statutory
cap and names the excluded taxed basis. Pima's layer exposes no taxed-basis
column at all — only `FCV` — so there is no second figure to confuse it with.

### Maricopa: live measurement against the county's own recorded sales

The field was verified against the same layer's `SalePrice`/`SaleDate` columns
(not a third party): every parcel the county records as sold above $100k with a
dated 2023-2026 sale, compared with the single current-roll value the layer
holds.

| Cohort (dated sales) | n | median FullCashValue / SalePrice | median LimitedPropertyValue / SalePrice |
|---|---|---|---|
| All classes, 2023 | 4,000 | 0.803 | — |
| All classes, 2024 | 4,000 | 0.785 | — |
| All classes, 2025 | 4,000 | 0.803 | — |
| All classes, 2026 | 4,000 | 0.819 | — |
| 2026 SFR only | 2,907 | 0.822 | 0.366 |
| 2026 condo/townhouse | 411 | 0.848 | 0.334 |
| 2026 other (commercial etc.) | 574 | 0.773 | 0.247 |

Reading: `FullCashValue` sits at a market level (~0.8 of recorded sale price,
stable across four sale years), while the taxed basis reads ~0.37 or lower — a
taxable-fraction misread would have shown roughly 0.1-0.2. In this layer
`AssessedFullCashValue` merely duplicates `FullCashValue` (median ratio 1.000),
so it is unusable as a taxed basis and is not read.

One caveat worth recording: an assessor opinion anchored ~20% below recorded
sale prices is the assessor's estimate, not a contemporaneous market price. The
comparison is therefore labelled as a market estimate that bounds the discount
from below, and the citation says so.

### Pima: statutory basis only (recorded as a residual)

Pima's layer carries no sale-price column, and its host (`gisdata.pima.gov`
GISOpenData) exposes no sales or recorder service, so the same corroboration
could not be run. The entry therefore rests on the statutory definition alone
(the county's own `FCV` column, named for full cash value) and its citation
states that. Residual: corroborate Pima's `FCV` against a sales source (county
recorder layer, or the assessor's comparable-sales service) when one is found;
until then the conversion is a conservative statutory bound, not a measured
ratio — and the test forbids the Maricopa sample from being cited here.

## The two-year label (new handling, not new fabrication)

Maricopa labels the same record twice: `TaxYear` 2026 **and**
`ParcelValuationYear` 2027 (verified live on the sampled record; the layer-wide
distinct values are `{2027, 2026}`, `{2027, null}`, `{null, null}`).

The labels are kept as published, not reinterpreted, because the county's own
labels do not line up with the statutory vocabulary: A.R.S. § 42-11001(17)
defines "tax year" as the calendar year in which taxes are levied, and
§ 42-11001(20) defines "valuation year" as the calendar year *preceding* the tax
year — so a statutory valuation year of 2027 would imply a 2028 tax year, not
the 2026 `TaxYear` the same record carries. Guessing which label is the
statutory one would be fabrication; recording both is not.

The harvest now reads the county's own year attributes through the registry
(`taxYearField: 'TaxYear'`, `valuationYearField: 'ParcelValuationYear'`):

- `assessmentYear` = the publisher's **tax year** (2026) — the roll the figure
  belongs to, which is not a future-dated year;
- `valuationYear` = the publisher's valuation-year label (2027) — preserved
  verbatim in `provenance.derivedFields.assessorRoll` so neither label is
  dropped or silently reinterpreted;
- a parcel whose `TaxYear` is null falls back to the publisher's
  valuation-year label, which is then recorded as the assessment year.

Pima publishes its tax year under a spelling the generic list does not carry
(`TAXYR`, a string), so it is read through the registry's `taxYearField` instead
of widening the global field list — no other county's year handling changes. It
publishes no valuation-year column, so `valuationYear` stays null rather than
being inferred.

The generic roll-year field list keeps tax-year spellings ahead of
valuation-year spellings, so a county publishing both is stamped with the tax
year (regression-pinned in `test/assessor-harvest.test.js`).

## Code changes in this batch

- `server/enrichment/arcgis-parcels.js`: `AZ-MARICOPA` registry entry (fips
  `04013`, APN/land-use/FCV/land/improvement/legal/situs field mapping,
  `taxYearField`, `valuationYearField`) and `AZ-PIMA` (fips `04019`, `PARCEL` /
  `PARCEL_USE` / `FCV` / `LEGAL1` / `ADDRESS_OL`, `taxYearField: 'TAXYR'`, no
  land/improvement split on this layer).
- `server/enrichment/assessor-reading.js`: `AZ-MARICOPA` and `AZ-PIMA`
  market-figure conversion rules. Each citation carries the A.R.S. § 42-11001(6)
  cap and the conservative-lower-bound consequence; only Maricopa's carries a
  sampled ratio, and Pima's states that its layer has no sale-price column (the
  test pins all of this, so a future edit can neither downgrade the citation to
  a bare "full cash value = market value" claim nor copy Maricopa's sample onto
  Pima).
- `server/enrichment/assessor-harvest.js`: registry-driven publisher-year
  extraction (`readYearField`), tax-year-first roll-year ordering, and
  `taxYear` / `valuationYear` added to the durable assessor-roll provenance.
- Tests: `test/assessor-reading.test.js` (conversion pins + registry field
  pins for both AZ counties), `test/assessor-harvest.test.js` (tax-year stamp,
  valuation-year preservation, null-tax-year fallback, tax-year-first ordering,
  Pima's string-valued `TAXYR`).

## Evidence (all run 2026-11-01, exit 0)

| Gate | Result |
|---|---|
| `node --test test/assessor-reading.test.js test/assessor-harvest.test.js` | 26/26 pass |
| `npm run test:enrichment-intelligence` | 88/88 pass |
| `npm run test:sources` | 602/602 pass |
| `npm run test:canonical` | 48/48 pass |
| `npm run test:db` | 140/140 pass |
| `npm run verify:gate` | 5/5 suites pass (module load, server, unit, hardening, payload/truth) |
| `npm run lint` (`tsc --noEmit`) | clean |
| `npm run schema:check` | schema + 28 migration mirrors identical |
| `node scripts/gen-context.js --check` | CONTEXT.md current |

Live endpoint probes (this session): layer metadata (`f=json`), APN attribute
query, spatial point-intersect, and APN-uniqueness counts, for both counties —
all through the repository's own `queryArcgisParcel` path, not a hand-rolled
request. Pima re-verified after the registry entry landed: APN lookup returned
`FCV` 3,051,606 with `fips` `04019` and `TAXYR` `"2026"`, and a point-intersect
on the record's own coordinate returned the same parcel.

Live value-chain measurement (this session, read-only): ~16,000 dated
2023-2026 recorded sales from the same layer, compared against
`FullCashValue` / `LimitedPropertyValue` / `AssessedFullCashValue` (table in
"Live measurement" above). Outcome: `FullCashValue` is a market-level figure
(~0.82 of sale price) and cannot exceed market value by statute, so the
conversion is retained; `AssessedFullCashValue` was found to duplicate
`FullCashValue` in this layer and is not read.

Statute text fetched this session from `azleg.gov`: A.R.S. § 42-11001
(definitions, incl. paragraphs 6, 17, 19, 20). The 80%-of-market-value reading
that a first pass suggested was **not** found in Title 42 chapters 11/13/15;
what the statute does supply is the cap that makes the comparison conservative.

## Expected effect and how to measure it

The ratio component resolves when a Maricopa or Pima listing gets a roll
harvested at ingest (`harvestAssessorRolls` → `assessorRoll` →
`interpretAssessorParcel` → FCV band ±8%). Measurement needs the production
inventory:

```
npm run triage:measure
```

That script requires `DATABASE_URL` (it refuses to measure a demo inventory),
so the re-measure belongs on the deployed database after a collection cycle,
against the baseline in `reports/valuation-resolution-remeasure-2026-11-01.md`.

## Still uncovered

Uncovered inventory by state at the 2026-11-01 baseline (same report): AZ 196,
PA 140, CA 76, MI 52, OR 40 actionable records. The two counties enrolled here
are the largest Arizona cohorts in the live cache (Maricopa 186, Pima 72
records); the rest of the AZ inventory sits in smaller counties (Pinal 74, Yuma
18, Mohave 16, Cochise 15, Yavapai 11, and a tail).

Those two denominators are different measures (uncovered-actionable records vs
live-cache records per county), so the post-enrollment uncovered count must be
re-measured against the deployed inventory with `npm run triage:measure` rather
than inferred by subtraction here. Pinal is the next target; the PA/CA/MI/OR
cohorts are untouched.
