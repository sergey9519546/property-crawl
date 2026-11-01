# Assessor enrollment expansion — 2026-11-01 (Maricopa County, AZ)

> Follow-on batch to `reports/assessor-enrollment-2026-10-21.md`. Same
> no-fabrication rule (AGENTS.md: "Never invent sources, scores, or listings"):
> the county is enrolled only after its endpoint answered live in this session,
> with the field mapping read off the service's own layer metadata and pinned by
> tests.

## What was enrolled

| County key | Registry endpoint | Market value field | Conversion | Verification evidence |
|---|---|---|---|---|
| `AZ-MARICOPA` | `gis.maricopa.gov/arcgis/rest/services/Reference/ParcelCityCounty/MapServer/0/query` | `FullCashValue` | market-figure | Layer metadata read live (`f=json` → 93 fields). Sampled APN `10101010`: `FullCashValue` 10,205,862 = `LandFullCashValue` 1,834,600 + `ImprovementFullCashValue` 8,371,262. Spatial point-intersect on the same parcel's own `Longitude_DD`/`Latitude_DD` returned the same record and the same figure. APN `LIKE` lookups returned exactly 1 feature each for `10101010` and `10101001C` (no `%` ambiguity). Layer holds 1,761,798 parcels |

Registry totals after this batch: **13 enrolled counties**, 9 with verified market
conversions (TX-BEXAR, FL-ORANGE, OH-CUYAHOGA, FL-ALACHUA, TX-HARRIS,
OH-FRANKLIN, OH-HAMILTON, TX-TARRANT, AZ-MARICOPA), 4 withheld with named
reasons (IL-COOK, NV-CLARK, ID-BANNOCK, NV-WASHOE).

## Why full cash value is the market figure here

A.R.S. § 42-11001 defines "full cash value" as the market value of the
property; the county publishes it directly as `FullCashValue`, so it converts
1:1 against the published opening amount — the same treatment as the verified
Texas and Florida market-figure counties.

The layer also publishes `AssessedFullCashValue` (= FCV × the statutory
assessment ratio) and `AssessmentRatio_Pct`. Those are the **taxed basis** and
are deliberately not used as market: reading them would multiply the FCV by the
ratio and overstate the discount. `test/assessor-reading.test.js` pins the field
choice (`assessedTotalField === 'FullCashValue'`, and explicitly not
`AssessedFullCashValue`).

## The two-year label (new handling, not new fabrication)

Maricopa labels the same record twice: `TaxYear` 2026 **and**
`ParcelValuationYear` 2027 (verified live on the sampled record; the layer-wide
distinct values are `{2027, 2026}`, `{2027, null}`, `{null, null}`).

The harvest now reads the county's own year attributes through the registry
(`taxYearField: 'TaxYear'`, `valuationYearField: 'ParcelValuationYear'`):

- `assessmentYear` = the publisher's **tax year** (2026) — the roll the figure
  belongs to, which is not a future-dated year;
- `valuationYear` = the publisher's valuation-year label (2027) — preserved
  verbatim in `provenance.derivedFields.assessorRoll` so neither label is
  dropped or silently reinterpreted;
- a parcel whose `TaxYear` is null falls back to the publisher's
  valuation-year label, which is then recorded as the assessment year.

The generic roll-year field list keeps tax-year spellings ahead of
valuation-year spellings, so a county publishing both is stamped with the tax
year (regression-pinned in `test/assessor-harvest.test.js`). No other county's
year handling changed.

## Code changes in this batch

- `server/enrichment/arcgis-parcels.js`: `AZ-MARICOPA` registry entry (fips
  `04013`, APN/land-use/FCV/land/improvement/legal/situs field mapping,
  `taxYearField`, `valuationYearField`).
- `server/enrichment/assessor-reading.js`: `AZ-MARICOPA` market-figure
  conversion rule with the A.R.S. § 42-11001 citation.
- `server/enrichment/assessor-harvest.js`: registry-driven publisher-year
  extraction (`readYearField`), tax-year-first roll-year ordering, and
  `taxYear` / `valuationYear` added to the durable assessor-roll provenance.
- Tests: `test/assessor-reading.test.js` (conversion pin + registry field
  pins), `test/assessor-harvest.test.js` (tax-year stamp, valuation-year
  preservation, null-tax-year fallback, tax-year-first ordering).

## Evidence (all run 2026-11-01, exit 0)

| Gate | Result |
|---|---|
| `node --test test/assessor-reading.test.js test/assessor-harvest.test.js` | 23/23 pass |
| `npm run test:enrichment-intelligence` | 85/85 pass |
| `npm run test:sources` | 602/602 pass |
| `npm run test:canonical` | 48/48 pass |
| `npm run test:db` | 140/140 pass |
| `npm run verify:gate` | 5/5 suites pass (module load, server, unit, hardening, payload/truth) |
| `npm run lint` (`tsc --noEmit`) | clean |
| `npm run schema:check` | schema + 28 migration mirrors identical |
| `node scripts/gen-context.js --check` | CONTEXT.md current |

Live endpoint probes (this session): layer metadata (`f=json`), APN attribute
query, spatial point-intersect, and APN-uniqueness counts — all through the
repository's own `queryArcgisParcel` path, not a hand-rolled request.

## Expected effect and how to measure it

The ratio component resolves when a Maricopa listing gets a roll harvested at
ingest (`harvestAssessorRolls` → `assessorRoll` → `interpretAssessorParcel` →
FCV band ±8%). Measurement needs the production inventory:

```
npm run triage:measure
```

That script requires `DATABASE_URL` (it refuses to measure a demo inventory),
so the re-measure belongs on the deployed database after a collection cycle,
against the baseline in `reports/valuation-resolution-remeasure-2026-11-01.md`.

## Still uncovered

Uncovered inventory by state at the 2026-11-01 baseline (same report): AZ 196,
PA 140, CA 76, MI 52, OR 40 records. Maricopa closes one AZ county; the
remaining AZ counties (and the PA/CA/MI/OR cohorts) each need their own
verified endpoint and field mapping under the method above.
