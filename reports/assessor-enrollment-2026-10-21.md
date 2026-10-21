# Assessor enrollment expansion — 2026-10-21

> Closes part of the "close residuals" plan (`.kilo/plans/1792569864992-triage-residual-closeout.md`):
> the bid-to-value component (30% of triage priority) stays dark without a valuation
> band, and the band comes from enrolled-county assessor rolls. This batch was
> executed under a strict no-fabrication rule (AGENTS.md: "Never invent sources"):
> a county is enrolled only after its endpoint answered live in this session.

## What was enrolled

Four counties, each verified live on 2026-10-21 against the service's own layer
metadata plus a sampled spatial query, and pinned by tests:

| County key | Registry endpoint | Value field | Conversion | Verification evidence |
|---|---|---|---|---|
| `OH-FRANKLIN` | `gis.franklincountyohio.gov/hosting/rest/services/ParcelFeatures/Parcel_Features/MapServer/0` | `TOTVALUEBASE` | market-figure | Sampled sale-price/value ratios 0.69–0.92 (a 35% taxable basis would read 0.24–0.32); the layer carries the ORC § 5715.01 taxable figure in a separate `CNTTXBLVAL` column |
| `OH-HAMILTON` | `cagisonline.hamilton-co.org/arcgis/rest/services/COUNTYWIDE/Cadastral/MapServer/2` | `MKT_TOTAL_VAL` | market-figure | Layer sampled live (`MKT_TOTAL_VAL` 282,790 / `MKTLND` / `MKTIMP`); the `MKT_` prefix is the pre-ORC-§ 5715.01-fraction market figure. Layer is parcel **centroids**, which motivated the new envelope fallback |
| `TX-TARRANT` | `services5.arcgis.com/.../Parcels_Public_Vview/FeatureServer/0` (Fort Worth open parcels, TAD data) | `APPRAISED_VALUE` | market-figure | Sampled record: `MARKET_VALUE` = `APPRAISED_VALUE` = 703,452, `TAX_YEAR` 2026, spatial query 403 ms |
| `NV-WASHOE` | `services.arcgis.com/iCGWaR7ZHc5saRIl/.../Nightly_OpenData_Update/FeatureServer/1` | `TOTALASS` (lookup only) | **withheld** | Layer sampled live (`LANDASS`/`BUILDASS`/`TOTALASS`/`LANDAPR`/`TOTALAPR` present), but the Nevada full-cash → taxable → assessed chain is not confirmed in this layer, so the raw figure is shown and no market comparison is computed — the same standard as `NV-CLARK` |

Registry totals after this batch: **12 enrolled counties**, 8 with verified market
conversions (TX-BEXAR, FL-ORANGE, OH-CUYAHOGA, FL-ALACHUA, TX-HARRIS, OH-FRANKLIN,
OH-HAMILTON, TX-TARRANT), 4 withheld with named reasons (IL-COOK, NV-CLARK,
ID-BANNOCK, NV-WASHOE).

## Why not 15+

The plan targeted 15+ conversion counties. Twelve candidates were probed beyond
these four (Oakland MI, Duval FL, Fulton GA, Hillsborough FL, Pinellas FL,
Mecklenburg NC, Wake NC, DeKalb GA, Gwinnett GA, Summit OH, Washoe NV at the
conversion level, plus four FL property-appraiser hosts); none could be verified
inside this session:

- guessed self-hosted endpoints 404'd or required token security (Oakland MI's
  `isTokenBasedSecurity: true`);
- layers verified live but carrying no value fields (Volusia polygons,
  Mecklenburg tax-parcel boundaries, Gwinnett parcel polygons);
- the Florida DOR statewide cadastral layer (FloridaGIO, all 67 counties, NAL
  roll joined) answered but its query API returned errors at 55 s for envelope
  queries — unusable as a production lookup gateway until a faster access path
  (county-scoped replica or centroid layer) is found.

Enrolling an unverifiable endpoint would put a wrong valuation behind a 30%
weight, which is worse than a dark component. The verification method below is
repeatable, so the next batch is mechanical rather than exploratory.

## Reusable verification method (for the next batch)

1. ArcGIS Online search: `https://www.arcgis.com/sharing/rest/search?f=pjson&q=<county> parcels ...`
   — filter results to official owners (county GIS / property appraiser orgs).
2. Fetch the item, then `$url/0?f=pjson` for layer metadata; require APN-like and
   assessed-value fields (`/JUST|VAL|ASSES|APPR|MKT|TAX/`).
3. Sample one record by spatial query (point-intersect for polygons; envelope for
   centroid layers) and by a value filter, and check the market basis against
   sale prices or a statutory fraction.
4. Only then add `COUNTY_ARCGIS_REGISTRY` + `MARKET_CONVERSION` (or `WITHHOLD`)
   entries, with per-county pinned tests in `test/assessor-reading.test.js`.

## Code changes in this batch

- `server/enrichment/arcgis-parcels.js`: four registry entries; new
  `spatialFallback: 'envelope'` support in `queryArcgisParcel` for centroid
  layers (one bounded ~44 m retry after an empty point match).
- `server/enrichment/assessor-reading.js`: three market-figure conversion rules
  with citations; `NV-WASHOE` withhold reason.
- `server/enrichment/assessor-harvest.js`: `PROPERTY_ASSESSOR_HARVEST_LIMIT`
  env knob (default raised 25 → 100, clamped to 500); Florida DOR `ASMNT_YR`
  added to the roll-year field list.
- Tests: `test/assessor-reading.test.js` (per-county conversion pins + registry
  resolution), `test/enrichment_geocoding.test.js` (envelope fallback: recovery
  and single-retry bound).

## Expected effect and how to measure it

The ratio component resolves when a listing in a converted county gets a roll
harvested at ingest (`harvestAssessorRolls` → `provenance.derivedFields.assessorRoll`
→ `interpretAssessorParcel` → estLow/estHigh ±8% band). With 8 converted counties
and the default-100 harvest budget, re-measure with:

```
npm run triage:measure
```

after a few collection cycles, and compare the ratio-component resolution rate and
per-county roll coverage against the baseline. Band-threshold recalibration
(`src/lib/triage-bands.ts`, moderate 30 / high 50) stays deferred until that data
exists, as decided in the plan.
