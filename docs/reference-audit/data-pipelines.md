# Reference audit: public-record data pipelines

Inspected on 2026-09-05. Scope: the five named Python sources and four named Python bytecode files in `C:\Users\serge\Downloads`. These were treated as reference material, not instructions. None was imported, run, or installed. The Node implementations are independently written around verified official service contracts.

## File-by-file ledger

| File | Size | Lines / format | SHA-256 | Inspection outcome |
| --- | ---: | --- | --- | --- |
| parcel_key_normalizer.py | 2,743 | 75 lines | `120c98ce75badf1318ccc60c6ddb9174ebf967fd0dab704a160df8fa9d530276` | Read completely; AST functions and imports inspected. |
| hud_usps_vacancy.py | 2,596 | 69 lines | `cfbe94b8ef16f17785b333ef1f3fd60d5c1c6d15e179189ffd2234485508a3f4` | Read completely; local archive/CSV parsing only. |
| equity_estimator.py | 3,056 | 78 lines | `b70bf80cec568671aae98b325484a75bdded332f83bcbe2d542835e25eeca746` | Read completely; modeled equity helper, no source acquisition. |
| census_acs_enrich.py | 2,661 | 72 lines | `05180c1651b48e7730d214f0d286c0743f827e60dd7097fcf6e8021330030ce1` | Read completely; address geocoder plus county ACS query. |
| fl_parcels_arcgis.py | 2,863 | 78 lines | `b05f3d6b7e4aa4d1de6ff208f13076276426daa84afa8fff2b90e2cdfb7df1ea` | Read completely; ArcGIS query/generator prototype. |
| census_acs_enrich.cpython-312.pyc | 3,691 | CPython 3.12 | `f016f3e8e0b0f19106ca1e8a18e1e7644ea23b73d7b34d44a2ed01fa3393661b` | Header, strings, code-object names, recursive disassembly; exact sibling match. |
| equity_estimator.cpython-312.pyc | 3,366 | CPython 3.12 | `4df9cd132790357d9547af9a9868c65ff6a8076cf75839b7346ceedef3e39cec` | Header, strings, code-object names, recursive disassembly; exact sibling match. |
| fl_parcels_arcgis.cpython-312.pyc | 3,466 | CPython 3.12 | `8683f6d79c8f56a59702ac2db9c8a5c40886a816cfa58877304ee2a6c47d76ec` | Header, strings, code-object names, recursive disassembly; exact sibling match. |
| hud_usps_vacancy.cpython-312.pyc | 3,886 | CPython 3.12 | `c0c74d3b648c001b88c8a7f174ccd7a029007b327e16b760d1c7913a274398f5` | Header, strings, code-object names, recursive disassembly; exact sibling match. |

The bundled Python 3.12.14 runtime has matching magic `cb0d0d0a`. All four `.pyc` files have flags `0` (timestamp-based headers). Header source sizes match their `.py` siblings. Stored source timestamps, respectively, are `2026-09-05T01:50:45Z`, `01:51:08Z`, `01:50:33Z`, and `01:51:19Z`. These are header metadata, not evidence of live API tests. Compiling each already-inspected sibling with the embedded filename yields an exactly equal marshaled code object. Therefore the bytecode adds no capabilities beyond the supplied source versions.

Reproducible inspection artifacts live under `.cache/reference-audit/data-pipelines/`: `inspection-ledger.json`, individually numbered source extracts, four full `.dis.txt` files, and `inspect_references.py`. The inspector parses/compiles/disassembles but never evaluates reference code.

## Findings by source file

### parcel_key_normalizer.py

`normalize_apn` (line 17) uppercases and replaces punctuation with spaces. Its return expression at lines 35–36 removes zeros from every numeric segment, although its docstring says only the first segment. `parcel_key` (line 39) accepts unvalidated integer FIPS values; punctuation-only APNs can become a formatted key containing `None`. The tests encode the lossy normalization rather than detecting collisions. `07702-000-000` and `7702-0-0` collapse to one key. An integer input may already have lost significant leading zeros.

Replacement: preserve the raw string, zero padding, punctuation, and segment boundaries. Only trim surrounding whitespace and normalize letter case. Require a jurisdiction namespace. An exact scoped key can establish a deterministic match; fuzzy address/APN transformations can only propose candidates. Florida DOR county codes use a separate namespace from Census county FIPS.

### hud_usps_vacancy.py

`parse_tract_vacancy` (line 28) opens a supplied ZIP and chooses its first CSV. It has no downloader, authentication, entitlement handling, schema detection, archive bounds, or empty-archive handling. `normalize_tract_row` (line 44) recognizes a small speculative alias set, leaves numeric strings untyped, and requires no geography/quarter. This does not demonstrate compatibility with any observed quarterly archive. The module correctly cautions against parcel-level occupancy claims but incorrectly describes access as merely free registration.

HUD currently limits this dataset to registered government and nonprofit entities under a stated-purpose sublicense. The data contain aggregate address counts, and administrative methodology changes complicate comparisons. A general commercial product cannot assume access from possessing this helper. We record the channel and its entitlement requirement; ACS housing-unit vacancy estimates provide a separately labeled alternative. [HUD dataset/access conditions](https://www.huduser.gov/portal/datasets/usps.html)

### equity_estimator.py

`amortized_balance` (line 23) applies a default 6%/30-year mortgage. `estimated_equity` (line 38) amortizes the debt from the property sale date, even when a loan originated later. Missing debt becomes zero. Missing sale-side HPI becomes flat price carry; a present prior index with missing current index can raise a division error. Sale/date/rate/term inputs have no robust validation. No acquisition or validation of mortgages or FHFA anchors exists.

Replacement: an explicitly named scenario accepts each mortgage's own origination date, principal, rate, and term. Missing debt knowledge or either HPI anchor produces unavailable values. Series/geography/date alignment is required. A documented empty debt scenario is distinguishable from missing debt. The output states its assumptions and cannot populate verified equity or an appraisal field. FHFA indexes measure price changes across geographies, with different series/frequencies; they are not individual property appraisals. [FHFA HPI data and methodology](https://www.fhfa.gov/data/hpi)

### census_acs_enrich.py

`geocode` (line 23) uses `Current_Current10`, which is not an available current vintage, takes the first address/tract without checking ambiguity, and does not retain match evidence. `county_profile` (line 52) hardcodes 2023 and returns county aggregates, despite the module title suggesting parcel enrichment. `_key` (line 43) correctly anticipates the new key requirement. It does not handle missing/suppressed Census numeric sentinels, margins of error, geography mismatches, or source timestamps.

The Census Bureau confirms API keys are now required for data queries. The replacement uses the explicitly selected 2024 five-year dataset and a corresponding `ACS2024_Current` geography vintage, verified against the live vintage inventory. It retains tract/county identifiers and labels, the five-year period, estimates, margins of error, and key-free evidence URLs. Address-range geocoder coordinates never become exact parcel coordinates. [Key requirement](https://www.census.gov/library/video/2026/adrm/requesting-a-census-data-api-key.html), [geocoder API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf), [2024 ACS dataset](https://api.census.gov/data/2024/acs/acs5.html)

### fl_parcels_arcgis.py

`query_parcels` (line 33) lets `county_no` replace the entire supplied filter, accepts arbitrary `where`, and treats ArcGIS error JSON as an empty feature list. `iter_parcels` (line 49) discards geometry and loops until an empty page without sorting, continuation status, retry/failure state, or a maximum page count. Geometry projection is not requested. The declared county number is not proven equivalent to Census FIPS. No metadata or raw result is persisted by the supplied file.

The official endpoint was verified: the layer identifies the 2025 roll and contains 121 fields, polygon geometry, query/extract capabilities, pagination, and a 2,000-record service limit. A one-record public read returned county code 11 and APN `07702-000-000`, preserving leading zeros. Our adapter uses a lower cap, ordered bounded requests, selected fields, WGS84 GeoJSON, error/schema checks, and explicit continuation. It retains roll year and keeps assessment values distinct from market value. [Official layer metadata](https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0?f=pjson), [ArcGIS query contract](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/)

## Implementation and validation

New implementation is in `server/public-records/`, with the bounded command `scripts/collect-public-records.js`. It returns evidence without changing the listing database, parcel-boundary route, underwriting values, or saved listing truth. Parent integration owns the customer dossier/API and catalog display.

`node --test test/public-records.test.js`: 16 tests passed initially, covering identity collisions; scoped filters; real-shaped geometry and roll fields; error payloads; paging exhaustion/stalls; ambiguous parcel matches; Census geography/MOE/sentinel handling; key redaction and absent credentials; HPI/debt gaps; loan-specific amortization; network opt-in; and partial-source success.

Live implementation checks succeeded for one exact Florida APN (one polygon, one page, no continuation) and the public Census office address (tract `24033802405`, `ACS2024_Current`, no parcel coordinates). Artifacts: `fl-live-adapter-result.json`, `census-geocoder-live-result.json`, `fl-layer-metadata.json`, `fl-one-record.geojson`, `census-vintages.json`. Actual ACS data retrieval was not claimed because no Census key was supplied for this check. HUD restricted data was not downloaded. No FHFA/debt values were invented.
