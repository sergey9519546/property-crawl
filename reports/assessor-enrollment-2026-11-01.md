# Assessor enrollment expansion — 2026-11-01 (AZ ×4, MI-Wayne, PA-Philadelphia)

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

| `AZ-MOHAVE` | `mcgis.mohave.gov/arcgis/rest/services/PARCELS/MapServer/14/query` | `FULL_CASH_VALUE` | market-figure | County-owned ArcGIS server. Structure verified 2,000/2,000 sampled parcels: `FULL_CASH_VALUE` = `LANDVALUE` + `IMPVALUE` exactly, while the column named `TOTAL_FCV_VALUE` = FCV × statutory ratio (0.10-0.15) and `ASSESSED_FULL_CASH_VALUE` duplicates it — a mislabeled taxed basis (see below). Sampled APN `22802081` (1465 E Gemini St): FCV 864,270; point-intersect on the parcel's own `LATITUDE`/`LONGITUDE` returned the same record; 267,500 parcels in the layer. FCV corroborated at ~0.81 of recorded 2025-2026 sale prices |
| `AZ-YUMA` | `arcgis.yumacountyaz.gov/webgis/rest/services/YC_Parcels/MapServer/0/query` | `TOTAL_FULL_CASH_VALUE` | market-figure | County-owned ArcGIS server, 97,954 parcels. Sum identity verified 500/500 (`TOTAL_FULL_CASH_VALUE` = `LAND_FULL_CASH_VALUE` + `IMP_FULL_CASH_VALUE`). Sampled APN `70053293` (11230 E 37th Pl): FCV 152,118; point-intersect on a Yuma coordinate returned a real parcel with FCV 343,486. FCV corroborated against the layer's own 57,749 dated priced sales: median 0.662-0.663 for 2025-2026 sales, rising above 1.0 against pre-2022 sales (valuation lag) |
| `MI-WAYNE` | `services2.arcgis.com/.../Detroit_MP_Parcel_Authoritative/FeatureServer/0/query` | `amt_assessed_value` (taxable-fraction 0.5) | statutory fraction | MCL 211.27a(1) fetched this session from `legislature.mi.gov`: "property shall be assessed at 50% of its true cash value under section 3 of article IX of the state constitution of 1963." Sampled APN `15008031-3`: assessed 905,600. The roll measures at ~0.33 of recorded 2024-2025 sale prices (n=2,000) — below the statutory 50% — so the derived market is a conservative lower bound, disclosed in the citation. `amt_taxable_value` (the Prop A capped value) is the taxed basis and is not used. Detroit's dashed `parcel_id` spellings required the new separator-tolerant APN retry (below) |
| `PA-PHILADELPHIA` | (already registered) `services.arcgis.com/.../OPA_Properties_Public/FeatureServer/0/query` | `market_value` | market-figure | Sampled live: median `market_value`/sale = **0.966** across 2,000 dated 2026 sales (p10 0.64 / p90 1.60) — OPA's figure is a market figure. Sampled APN `301325005`: market_value 717,800; APN and point-intersect lookups both resolve with fips `42101`. `taxable_land`/`taxable_building` are the taxed components and are not used |

Registry totals after this batch: **18 enrolled counties**, 14 with verified market
conversions (TX-BEXAR, FL-ORANGE, OH-CUYAHOGA, FL-ALACHUA, TX-HARRIS,
OH-FRANKLIN, OH-HAMILTON, TX-TARRANT, AZ-MARICOPA, AZ-PIMA, AZ-MOHAVE,
AZ-YUMA, MI-WAYNE, PA-PHILADELPHIA), 4 withheld with named reasons (IL-COOK,
NV-CLARK, ID-BANNOCK, NV-WASHOE).

Evidence tiers are explicit and enforced by tests: Maricopa, Mohave, and Yuma
carry sampled sale-price ratios (measured against each county's own recorded
sales); Pima does not — its citation states that, and the test forbids it from
borrowing another county's figure.

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

### Mohave: the layer's field names are a trap

Mohave's parcel fabric names its columns the opposite of what they are:

| Column | What it actually holds (verified 2,000/2,000 sampled parcels) |
|---|---|
| `FULL_CASH_VALUE` | **the full cash value** — exactly `LANDVALUE` + `IMPVALUE` on every sampled parcel |
| `TOTAL_FCV_VALUE` | full cash value **×** the statutory assessment ratio (0.10 owner-occupied residential / 0.15 commercial, per the layer's own `ASSESSMENT_RATIO` column) — the taxed basis |
| `ASSESSED_FULL_CASH_VALUE` | duplicates `TOTAL_FCV_VALUE` (the same mislabel seen on Maricopa) |
| `TOTAL_LPV_NAV` | limited value × ratio (`LIMITED_VALUE` 506,638 → 75,996 at 0.15 on the sampled parcel) |

Enrolling `TOTAL_FCV_VALUE` would have repeated the exact error the registry
exists to prevent: comparing the opening amount against a figure that is 10-15
cents on the dollar, and overstating the discount several-fold. The registry
entry, the citation, and the tests all pin `FULL_CASH_VALUE` and name the trap;
`test/assessor-reading.test.js` asserts the entry's `assessedTotalField !==
'TOTAL_FCV_VALUE'`.

Corroboration, with the confound recorded: the newest-3,000-sale median of
FCV/Sale is meaningless in Mohave because the fabric carries undivided-interest
and token parcels (one $2.2M land sale spreads across many $363-FCV partials),
so the measurement excludes token partials (`FULL_CASH_VALUE >= 50000`) and
compares only 2025-2026 dated sales: median 0.819 (n=1,175) and 0.808 (n=825) —
the same market level as Maricopa's 0.82.

### Yuma: measured, and lag is visible in the sales

Yuma's `TOTAL_FULL_CASH_VALUE` (= land + improvement full cash value, 500/500)
sits at median 0.662-0.663 of recorded 2025-2026 sale prices (n=210/160), rising
to ~0.68-0.74 for 2022-2024 sales and above 1.0 for pre-2022 cohorts — the
signature of an assessor opinion that lags a moving market, not of a statutory
fraction. A taxed-basis misread would sit near 0.10-0.20 regardless of sale
year; Yuma's figure does not. The citation records the number and the lag.

### Wayne and Philadelphia: statutory fraction vs measured market

Two counties that were already in the registry (harvesting worked) but dark for
the ratio component got their conversions this session:

- **MI-Wayne** is a statutory-fraction enrollment. MCL 211.27a(1) (fetched from
  `legislature.mi.gov` this session) fixes assessments at 50% of true cash
  value, so `amt_assessed_value / 0.5` grosses up to market. The measurement is
  disclosed in the citation rather than hidden: Detroit's roll assesses at
  ~0.33 of recorded 2024-2025 sale prices — below the statutory 50% — so the
  derived market figure understates market and the resulting discount is a
  conservative lower bound (a deal can only look worse than it is, never
  better). `amt_taxable_value` (Proposal A's capped value) is the taxed basis
  and is explicitly excluded.
- **PA-Philadelphia** is a market-figure enrollment measured at 0.966 of the
  layer's own recorded 2026 sales (n=2,000): OPA's `market_value` is what it
  says it is. No code citation was available to fetch this session, so the
  citation rests on the measured sample plus the publisher's own field name —
  the same standard as TX-BEXAR (field-based citation, no statute).

### Separator-tolerant APN retry (new query capability)

Detroit stores `parcel_id` with separators (`15008031-3`, `15008011.`), which
the repo's normalized APN LIKE (`%150080313%`) can never match — the same trap
Mohave solved by pointing at its compact `TPARCEL` column. Wayne has no compact
column, and a server-side `REPLACE` is unavailable (ArcGIS hosted layers reject
it — verified live: the where clause returns a 400 error payload).

`queryArcgisParcel` now supports an opt-in `apnSeparatorRetry` registry flag:
when the normalized LIKE misses exactly once, a bounded retry compares with
every non-alphanumeric position of the raw spelling as a `%` wildcard
(`15008031-3` → `%15008031%3%`), which matches any separator variant of the
same parcel number and cannot cross onto a different one (digits must appear in
order; the wildcard spans only separator positions). Verified live through the
repo path: APN `15008031-3` now resolves to assessed 905,600 / fips `26163`.
Counties without the flag issue exactly one request, unchanged
(regression-pinned).

### Pinal: not enrollable this session (documented gap)

Pinal County (74 uncovered records, the largest remaining AZ cohort) could not
be enrolled: `gis.pinal.gov` serves a bare IIS placeholder with no ArcGIS REST
endpoints at any probed path, `www.pinal.gov` returns 403 to this client,
`assessor.pinal.gov` was unreachable from the build environment, and the
third-party ArcGIS Online items found for Pinal (city- and contractor-hosted
snapshots) carry no valuation fields. No statewide Arizona parcel feature
service carries assessed values either (the NG911 statewide CAMA tables on
`server.azgeo.az.gov` expose no anonymous layers). A Pinal enrollment must wait
for a verified endpoint; nothing was fabricated in its place.

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

Mohave and Yuma both label the current roll `TAX_YEAR` 2027 — the same roll
Maricopa's layer calls `ParcelValuationYear` 2027. The rule is verbatim
recording: the publisher's label is stamped as `taxYear`/`assessmentYear`
exactly as published, even though it is future-dated, and never shifted to
satisfy the statutory vocabulary (regression-pinned for Yuma in
`test/assessor-harvest.test.js`). Downstream guards already know how to treat a
future assessment year (the benchmark consensus declines to compute an HPI
trajectory for one), so the honest label does no harm.

The generic roll-year field list keeps tax-year spellings ahead of
valuation-year spellings, so a county publishing both is stamped with the tax
year (regression-pinned in `test/assessor-harvest.test.js`).

## Code changes in this batch

- `server/enrichment/arcgis-parcels.js`: four registry entries —
  `AZ-MARICOPA` (fips `04013`, APN/land-use/FCV/land/improvement/legal/situs
  field mapping, `taxYearField`, `valuationYearField`), `AZ-PIMA` (fips
  `04019`, `PARCEL` / `PARCEL_USE` / `FCV` / `LEGAL1` / `ADDRESS_OL`,
  `taxYearField: 'TAXYR'`, no land/improvement split on this layer),
  `AZ-MOHAVE` (fips `04015`, `TPARCEL` / `USE_CODE` / `FULL_CASH_VALUE` /
  `LANDVALUE` / `IMPVALUE` / `LEGAL_DESCRIPTION` / `SITE_ADDRESS`,
  `taxYearField: 'TAX_YEAR'`), and `AZ-YUMA` (fips `04027`, `PIDNUM` /
  `USE_CODE` / `TOTAL_FULL_CASH_VALUE` / `LAND_FULL_CASH_VALUE` /
  `IMP_FULL_CASH_VALUE` / `LEGAL_DESCRIPTION` / `STREET_ADDRESS`,
  `taxYearField: 'TAX_YEAR'`). Plus `MI-WAYNE` (fips `26163`) gaining
  `apnSeparatorRetry` for Detroit's dashed `parcel_id` spellings
  (`PA-PHILADELPHIA` was already registered), and the bounded
  separator-tolerant APN retry in `queryArcgisParcel`.
- `server/enrichment/assessor-reading.js`: six conversion rules. Every citation
  carries its statutory cap or fraction and the conservative-lower-bound
  consequence; sampled-ratio claims are per county (Maricopa ~0.82, Mohave
  ~0.81, Yuma ~0.66, Philadelphia ~0.97, Wayne ~0.33 deviation disclosure, Pima
  none — its citation states the gap). Tests pin each citation so a future edit
  can neither downgrade a measured claim nor copy one county's sample onto
  another.
- `server/enrichment/assessor-harvest.js`: registry-driven publisher-year
  extraction (`readYearField`), tax-year-first roll-year ordering, and
  `taxYear` / `valuationYear` added to the durable assessor-roll provenance.
- Tests: `test/assessor-reading.test.js` (conversion pins + registry field
  pins for the enrolled counties, including the Mohave taxed-basis trap guard
  and Wayne's statutory-fraction arithmetic),
  `test/assessor-harvest.test.js` (tax-year stamp, valuation-year preservation,
  null-tax-year fallback, tax-year-first ordering, Pima's string-valued
  `TAXYR`, Yuma's verbatim future-dated label),
  `test/enrichment_geocoding.test.js` (separator-tolerant retry recovers the
  dashed APN and stays bounded; non-opted counties unchanged).

## Evidence (all run 2026-11-01, exit 0)

| Gate | Result |
|---|---|
| `node --test test/assessor-reading.test.js test/assessor-harvest.test.js` | 32/32 pass |
| `npm run test:enrichment-intelligence` | 96/96 pass |
| `npm run test:sources` | 602/602 pass |
| `npm run test:canonical` | 48/48 pass |
| `npm run test:db` | 140/140 pass |
| `npm run verify:gate` | 5/5 suites pass (module load, server, unit, hardening, payload/truth) |
| `npm run lint` (`tsc --noEmit`) | clean |
| `npm run schema:check` | schema + 28 migration mirrors identical |
| `node scripts/gen-context.js --check` | CONTEXT.md current |

Live endpoint probes (this session): layer metadata (`f=json`), APN attribute
query, spatial point-intersect, and APN-uniqueness counts, for the enrolled
counties — all through the repository's own `queryArcgisParcel` path, not a
hand-rolled request. Re-verified after the registry entries landed: Mohave APN
lookup and a point-intersect on the parcel's own `LATITUDE`/`LONGITUDE` both
return FCV 864,270 / fips `04015`; Yuma APN and point-intersect both resolve
with fips `04027`; Wayne's dashed APN `15008031-3` resolves through the
separator-tolerant retry to assessed 905,600 / fips `26163`; Philadelphia APN
and point-intersect both resolve with fips `42101`.

Live value-chain measurement (this session, read-only): ~16,000 dated
2023-2026 Maricopa recorded sales against `FullCashValue` /
`LimitedPropertyValue` / `AssessedFullCashValue`; 2,000 Mohave parcels for the
field-structure identity plus 2,000 dated 2025-2026 Mohave sales against
`FULL_CASH_VALUE`; 500 Yuma parcels for the sum identity plus ~3,000 dated Yuma
sales against `TOTAL_FULL_CASH_VALUE`; 2,000 dated Philadelphia sales against
`market_value`; 2,000 dated Detroit sales against `amt_assessed_value`.
Outcome: the four market-figure counties publish a market-level figure
(0.66-0.97 of recorded sale prices); Wayne's assessed figure measures at ~0.33
of sale prices, so its statutory 0.5 fraction is applied with the deviation
disclosed; Maricopa's and Mohave's `ASSESSED_*` columns duplicate or derive the
taxed basis and are not read.

Statute text fetched this session from `azleg.gov`: A.R.S. § 42-11001
(definitions, incl. paragraphs 6, 17, 19, 20). The 80%-of-market-value reading
that a first pass suggested was **not** found in Title 42 chapters 11/13/15;
what the statute does supply is the cap that makes the comparison conservative.
MCL 211.27a(1) fetched from `legislature.mi.gov` (the 50% assessment rule); the
Pennsylvania citation is field-based (no code text was fetchable this session).

## Expected effect and how to measure it

The ratio component resolves when an enrolled-county listing gets a roll
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
PA 140, CA 76, MI 52, OR 40 actionable records. The counties enrolled here
cover the largest cohorts in the live cache for two states (AZ: Maricopa 186,
Pima 72, Yuma 18, Mohave 16; MI: Wayne 115; PA: Philadelphia 102), plus
existing registry entries for PA-Chester/Bucks/Berks and MI-Wayne's Macomb
neighbors remain dark. The rest of the AZ inventory sits in smaller counties
(Pinal 74, Cochise 15, Yavapai 11, and a tail).

Those denominators are different measures (uncovered-actionable records vs
live-cache records per county), so the post-enrollment uncovered count must be
re-measured against the deployed inventory with `npm run triage:measure` rather
than inferred by subtraction here. The next candidates under the method above:
PA-Allegheny (54 live records, no registry entry yet), CA-Riverside/Los Angeles
(44/84, no entries), MI-Macomb (44), and PA-Delaware/Westmoreland (21 each);
Pinal (74) remains blocked on a verified endpoint (documented gap above).
