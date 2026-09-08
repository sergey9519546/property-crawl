# HUD live-path release gate — 2026-09-07

## Result

HUD collection is operational and promoted on an official public source. The production singleton reads HUD's public Single Family REO ArcGIS layer and selects only `CASE_STEP_NUMBER = 6`, which HUD defines as properties publicly listed on HUD HomeStore. Two post-integrity-fix national canaries enumerated all 52 configured jurisdictions at the identical scope; each accepted 1,992 live records with zero rejections or errors.

## Failure identified

The previous adapter called:

- `https://www.hudhomestore.gov/Home/DataGrid?state=CA&pageNo=1&pageSize=5`
- `https://www.hudhomestore.gov/Home/Index?state=CA`

Both returned HTTP 404 on 2026-09-07. This was an obsolete route contract, not a CAPTCHA or session challenge. The adapter's HTML fallback called a second obsolete route and therefore could not recover.

HUD's current official [Homes for Sale](https://www.hud.gov/helping-americans/homes-for-sale) and [How To Sell HUD Homes](https://www.hud.gov/helping-americans/hudhomes-how-to-sell) pages still identify HUD HomeStore as the publication venue. HUD also publishes the official [REO Properties — All feature layer](https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1), whose own description defines lifecycle steps: 1–5 acquired but not listed, 6 publicly listed, 7–9 sold in process, and 10 closed.

## Implemented contract

The live singleton queries:

`GET https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query`

with a state-specific standardized filter:

`CASE_STEP_NUMBER = 6 AND STATE_CODE = '<jurisdiction>'`

It requests an explicit field list, WGS84 geometry, stable `OBJECTID ASC` ordering, and bounded `resultOffset` / `resultRecordCount` pagination. ArcGIS service errors and malformed responses remain hard failures; they are never converted into an empty inventory. Page and jurisdiction caps mark the report truncated. Each normalized record retains the ArcGIS object ID, case number, step 6 status, and exact source-layer URL in provenance. Its source record URL is a strict case-bound eGIS query (`CASE_NUM = 'ddd-dddddd'`). Null, missing, non-finite, and out-of-range coordinates are rejected and counted as malformed source rows; they can never become zero coordinates.

The fixture path remains explicit and unchanged. Constructor instances without `inventoryUrl` retain the injected legacy contract used by local fixture tests; only the exported live singleton selects the official feature layer.

## Live observations

A bounded official query for California returned HTTP 200, five features, and `exceededTransferLimit: true`. The first feature was case `045-641868`, step 6, with HUD-published address and map coordinates.

The final bounded canary command was:

```powershell
$env:HUD_STATES='CA'
$env:HUD_MAX_STATES='1'
$env:HUD_MAX_PAGES_PER_STATE='1'
$env:HUD_PAGE_SIZE='5'
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary hud --once
```

Run ID `ec1c5dc6-da33-4b04-98da-8e0ea2ae9c33` accepted 5, rejected 0, and had no source or observation error. The report correctly states `complete=false`, `fullSweepComplete=false`, and `truncated=true`; it was not used for promotion. An earlier bounded run exposed `source_host_mismatch` when the broad ArcGIS layer URL was used as the record URL. The final adapter uses the narrowly allowed case-bound eGIS query and retains the broad layer URL only as provenance.

## Verification

```text
node --test test/hud-live-contract.test.js test/source-collector-coverage.test.js test/national-core-reports.test.js
10 tests passed, 0 failed
```

## National promotion gate

The two qualifying post-fix source runs were `f7a2967b-5328-491a-ad01-cf39649eb102` and `cff97e6a-74d4-488f-95d6-36e45328484c`. Both used all 50 states plus DC and Puerto Rico, page size 100, and at most 10 pages per jurisdiction. Each reported 1,992 discovered and accepted, zero rejected, no source or observation error, `complete=true`, `fullSweepComplete=true`, and `truncated=false`. Their persisted scope hash was identical: `7acfd29035e7a148d69cde66fadde9f62233eb094eef2cb6cf1df9c3fc46834a`.

PostgreSQL verification found 1,992 snapshots, 1,992 non-null raw payloads, and 1,992 provenance objects for each run. Every provenance object contained the ArcGIS object ID and `caseStepNumber=6`. A direct case-bound query for `045-641868` returned HTTP 200, exactly one matching feature, step 6, and object ID 1311.

HUD was promoted at `2026-09-08T03:24:35.376Z`; the promotion guard recorded `cff97e6a-74d4-488f-95d6-36e45328484c` as its last clean run. The collection worker was notified that the HUD gate was terminal and it could start in promoted-only mode. Publisher fields unavailable from this layer remain unknown: opening bid, sale date, transaction outcome, occupancy, and deposit are not inferred.

The shared normalizer now preserves explicit `auctionProgram`, `lifecycleStatus`, `transactionOutcome`, and tri-state `hasDocuments`. HUD supplies `HUD REO`, `publicly_listed`, `null`, and `null` respectively; its generic active inventory status remains `active`. The scheduler prefers the normalized listing program for its evidence observation. HUD also binds publisher coordinates to the exact case record URL with `origin=publisher_record` and `verification=source_extracted`.

The 1,992 existing HUD listing projections were updated idempotently from their latest durable step-6 raw snapshots and original observation timestamps. All 1,992 now contain the program, lifecycle, unknown outcome/documents, active inventory status, and exact coordinate provenance. The operation created no source run and did not alter snapshots: the HUD snapshot count was 7,973 before and after projection.
