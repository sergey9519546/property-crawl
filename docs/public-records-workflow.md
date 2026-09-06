# Public-record evidence workflow

The public-record adapters attach a small evidence dossier to an existing source-observed property. Evidence remains separate from listing fields. A parcel record, an area statistic, and an equity scenario each carry their own scope and limitations.

## Sources and delivery paths

| Source | Executable path | Input | Output | Remaining requirement |
| --- | --- | --- | --- | --- |
| Alachua reviewed tax-deed cases | `buildAlachuaPilot` | Approved intake packet with exact case URLs, intact parcel IDs, explicit status, and optional official documents/cost components | Stable source refs, approved status history, List of Lands research leads, unresolved quote, optional bounded county parcel comparisons | Confirm current case status and obtain the current clerk purchase quote |
| Alachua county parcel/planning | `lookupAlachuaParcel` | Intact APN scoped to FIPS county `12001` | Exact/candidate/ambiguous match, dated roll facts, planning codes/links, geometry and property-appraiser reference | Treat planning fields as research evidence; confirm jurisdiction, site conditions, and development rights |
| Florida statewide cadastral/assessment | `collectFloridaParcels`, `lookupFloridaParcel` | DOR county code + intact APN; or observed point for candidate search | Source parcel identity, annual assessment facts, polygon, evidence URL, continuation | Confirm candidate APN; add jurisdiction crosswalks from official records when needed |
| Census address geocoder | `geocodeCensusAddress` | Source street/address, city or ZIP, state | Unique matched address and tract for selected ACS vintage | Ambiguous/unmatched addresses require correction |
| Census ACS five-year | `getAcsContext`, `lookupCensusContext` | Tract GEOID or state/county FIPS, dataset year, operator API key | Area metrics + margins of error + geography/year | Set `CENSUS_API_KEY`; select a published dataset year |
| HUD/USPS vacancy | Capability/access workflow only | Eligible organizational account and stated-purpose entitlement | No unauthorized retrieval; no property occupancy inference | Obtain applicable entitlement; use ACS context otherwise |
| HPI/debt scenario | `estimateEquityScenario` | Recorded sale basis/date, matched HPI anchors, complete loan assumptions | Explicit illustrative value/debt/equity scenario | Actual HPI and debt acquisition/verification remain separate |

Official references are linked in [the per-file audit](reference-audit/data-pipelines.md). No adapter accepts a user-supplied source host or arbitrary ArcGIS SQL clause.

## Node contract

```js
const { buildPublicRecordEvidence } = require('./server/public-records');
const evidence = await buildPublicRecordEvidence(listing, {
  allowNetwork: true,  // Default false: reading a dossier never silently requests enrichment.
  acsYear: 2024,
  timeoutMs: 8000,
});
```

The builder returns `{version, listingId, observedAt, parcel, countyParcel, areaContext, equityScenario, issues, issueCodes, sources, capabilities}`. Data blocks may be null when unavailable. Successful sources survive a different source's failure. `sources` contain `{id,label,url,observedAt}`; Census credentials are removed from evidence URLs and errors. `countyParcel` is queried only when the listing has source-observed Alachua scope and a non-derived parcel identifier; it does not replace the separate statewide `parcel` result.

`parcel` exposes `status`, `matchState`, `rawParcelId`, `jurisdiction`, `properties`, `geometry`, `records`, `hasMore`, and `source`. Status is `matched`, `candidate`, `ambiguous`, or `not_found`. `matched` requires the exact supplied APN and DOR county scope; an intersecting point alone yields a candidate. Several records remain ambiguous. Candidate facts must not support property-specific mismatch claims until confirmed. `properties` includes `assessmentYear`, `justValue`, separate school/non-school assessed values, `landSqft`, `livingAreaSqft`, `buildingCount`, `residentialUnits`, `useCode`, `physicalAddress`, `city`, and reported sale fields. Geometry is source-provided WGS84 GeoJSON or null.

`areaContext` exposes `geographyLabel`, `geographyLevel`, `geoid`, `year`, `period`, `metrics`, `marginsOfError`, `source`, and matched-address/geography evidence. Metrics are `medianHomeValue`, `medianHouseholdIncome`, `housingUnits`, `vacantHousingUnits`, `vacancyRate` (fraction, not percent), `ownerOccupiedUnits`, and `renterOccupiedUnits`. Missing or suppressed values remain null. The derived vacancy ratio has no invented margin of error. No area metric is written to property value or occupancy.

Each lookup is bounded: 100 records maximum per Florida request, up to 10 pages/500 records through the collector, and one page/10 records for property detail. Responses are byte-limited, requests time out, redirects are rejected, repeated pages fail explicitly, and a full page with no exhaustion indicator retains `hasMore: true`. This is bounded query coverage, not nationwide or statewide exhaustion.

## Run it

```powershell
node scripts/collect-public-records.js --fl-county 11 --parcel-id 07702-000-000 --output .cache/parcel-evidence.json
node scripts/collect-public-records.js --fl-county 11 --limit 25 --pages 2
node scripts/collect-public-records.js --acs-geoid 24033802405 --year 2024
node scripts/collect-public-records.js --state-fips 12 --county-fips 001 --year 2024
node scripts/collect-public-records.js --listing-id LISTING_ID
node --test test/public-records.test.js
```

The Florida numbers in this CLI are DOR codes: `11` must not be relabeled FIPS `011`. Preserve APNs as strings, including zeros and separators. Do not reuse the lossy normalizer from the attachment.

## Expand coverage without inventing facts

For a new assessor/GIS jurisdiction, verify the official layer metadata, native parcel ID and county namespace, selected fields, update year, geometry projection, and paging semantics. Implement a bounded adapter with the existing evidence contract and source attribution; add a real-shaped fixture, ambiguity checks, and one read-only live sample. Retain a source-specific identity even when another provider formats an APN differently. A separately reviewed jurisdiction normalization rule can later link those identities without destroying their originals.

A county source can then support a customer finding such as an unexpected structure or acreage discrepancy. Require a confirmed property link, compare like-for-like dated fields, show both source observations, and describe the remaining verification step. Assessment differences alone do not prove a bargain.
