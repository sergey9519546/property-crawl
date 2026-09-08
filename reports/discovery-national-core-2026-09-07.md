# National-core discovery gate audit — 2026-09-07

## Gate used

A source canary is clean only when it returns at least one validated, publisher-observed record, has no source or observation error, and its run report declares an exact scope with `complete: true`, `fullSweepComplete: true`, and `truncated: false`. Fixture or embedded demo inventory, transport failures, challenge pages, partial continuations, and unverified zero-yield responses are not promotion evidence. The operational worker is configured to admit promoted sources only.

The canary command is:

```powershell
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary <source> --once
```

Promotion is permitted only after two distinct clean run IDs at the same real scope:

```powershell
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --promote <source>
```

Promotion commands were run only after the database recorded two distinct clean run IDs at an identical complete scope.

## Adapter audit

| Source | Publisher scope and URL | Bounded behavior | Gate readiness before live run |
| --- | --- | --- | --- |
| ServiceLink | Anonymous listing feed, `https://www.servicelinkauction.com/api/listingsvc/v1/Listings` | 25 records/page and one page/run by default; an explicit canary may request up to 100 records/page and 100 pages/run. Continuation checkpoints are committed pagewise, and a remaining continuation is explicitly partial. | Gate-capable. It declares endpoint/filter scope, completeness, full-sweep state, and truncation. The former hidden five-page ceiling was removed; every explicit budget remains hard bounded and observes crawl jitter. |
| Treasury | Real-property index plus every discovered detail page, `https://www.treasury.gov/auctions/treasury/rp/realprop.shtml` | Detail concurrency 2 with crawl jitter; no fixture fallback in `scrapeFeed()` | Gate-capable after this audit. Any failed detail makes the sweep incomplete. Embedded demo records remain only behind `getMockListings()`. |
| IRS | Auction item index plus discovered `/ad/` detail pages, `https://www.irsauctions.gov/auction/items` | Detail concurrency 2 with crawl jitter; no fixture fallback in `scrapeFeed()` | Gate-capable after this audit. Any failed detail makes the sweep incomplete. Embedded demo records remain only behind `getMockListings()`. |
| USDA | SFH search form and state POST searches, `https://www.resales.usda.gov/resales/public/searchSFH` | Iterates states exposed by the publisher form; requests are sequential | Gate-capable after this audit. Any failed state makes the publisher-driven sweep incomplete. No fixture fallback is used by the live path. |
| GSA | Current listing index plus discovered property details, `https://realestatesales.gov/our-listing` | Detail pages fetched sequentially through the guarded base client | Gate-capable after this audit. Any failed detail makes the sweep incomplete. “Current Bid” remains publisher evidence and is not relabeled as an opening bid. |
| HUD | Official Single Family REO feature layer, `https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1` | All 50 states, DC, and Puerto Rico; step 6 publicly listed records; stable object pagination with explicit page caps | Gate-capable and promoted. Invalid features are counted; missing coordinates, service errors, state caps, or page truncation fail completeness. Embedded demos remain outside the live path. |

All six live paths use the shared guarded scraper client with retries, circuit-breaker challenge detection, response size limits, and crawl jitter. A WAF/CAPTCHA/Cloudflare/Akamai response is a stop condition, not empty inventory.

## Canary results

| Attempt | Source | Scope | Result | Accepted | Run ID | Promotion effect |
| --- | --- | --- | --- | ---: | --- | --- |
| 1 | ServiceLink | Public listings endpoint, first bounded page | Local sandbox denied the publisher request (`fetch failed`). The source run ingested no records. Coordinator finalization then exposed an independent error-shape defect (`current.errors is not iterable`) and left the durable job running. | 0 | Not returned; job `job_69202b3ea3bcb4011cdf012c` | None. Escalated retry was safely skipped because the failed job claim remained held. |

Exact attempted commands:

```powershell
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary servicelink --once
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary servicelink --once
```

The second invocation had external network access but returned `{"skipped":true,"reason":"collection_jobs_claimed"}`. The collection coordinator must repair the durable job error shape and safely reclaim or fail the stuck job before another canary is run.

The coordinator defect was repaired, the stranded job was marked failed, and subsequent canaries used a UUID nonce while recurring jobs retained hourly deduplication.

| Source | Final observed result | Clean run IDs | Gate decision |
| --- | --- | --- | --- |
| ServiceLink | The original continuation sweep remained partial through bounded segments, then reached publisher exhaustion after a final 1,430-record segment. That segmented sweep accepted 6,430 records in aggregate, which may include repeated or changed publisher inventory across its elapsed window and is not a canonical inventory total. After the compatibility-cache fix, two fresh same-scope terminal sweeps each accepted 5,730 current publisher records with zero rejects and reported `complete:true`, `fullSweepComplete:true`, `truncated:false`. | `c1d70afa-f764-44ff-8be0-e35d584293ef`, `06543c00-b927-43a6-a463-ed910ea272e4` | Promoted at scope `/api/listingsvc/v1/Listings`, empty filters. The terminal checkpoint is empty. Jobs: `job_f7d7117934dcc138b2df3d09`, `job_30952ef26c418d357e0f1e27`. |
| Treasury | Each complete national index/detail sweep discovered and accepted 16 records with zero failed detail requests. | `1e17af6d-485e-4b86-8847-4ee33007ee16`, `a1b17e2c-ab18-4924-9e35-02d90ed56ebb` | Promoted at scope `/auctions/treasury/rp/realprop.shtml`, filter `assetClass=real_property`. |
| IRS | Each complete national index/detail sweep discovered 8 real-estate cards and accepted 7 canonical property records; the non-emitted card was inspected, not a transport failure. | `1d71138f-9722-4a9e-ad45-d2baf7633ade`, `873b46b7-ee45-4c0b-a028-97a6163c4bf4` | Promoted at scope `/auction/items`, filter `assetClass=real_estate`. |
| USDA | Each complete publisher-driven state sweep covered the six inventory options `13,21,28,31,45,47` and accepted 15 records. | `e5bbfde4-e2f1-484d-b9b0-36eed46a5182`, `14818906-e050-4a2a-b36d-11daa73f3d32` | Promoted at scope `/resales/public/searchSFH`, Single Family across publisher inventory options. |
| GSA | Each complete index/detail sweep discovered four property IDs and accepted three canonical records; all detail URLs were attempted. | `e198ad45-cad2-4772-95d3-b292f01ee9fa`, `f6644973-fefd-43b9-aae5-c081b40c452f` | Promoted at scope `/our-listing`, filter `assetClass=real_estate`. |
| HUD | Legacy HomeStore routes returned 404. The adapter moved to HUD's official eGIS REO layer and filters `CASE_STEP_NUMBER = 6`, which the layer defines as publicly listed. Two post-integrity-fix national sweeps each accepted 1,992 records from all 52 configured jurisdictions with zero rejects or errors. | `f7a2967b-5328-491a-ad01-cf39649eb102`, `cff97e6a-74d4-488f-95d6-36e45328484c` | Promoted at the identical step-6 national scope. Exact case-bound eGIS URLs and publisher coordinate provenance were validated; unavailable price, date, outcome, and document facts remain null. |

Additional exact commands:

```powershell
$env:SERVICELINK_MAX_PAGES='5'; $env:SERVICELINK_PAGE_SIZE='100'; node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary servicelink --once
$env:SERVICELINK_MAX_PAGES='100'; $env:SERVICELINK_PAGE_SIZE='100'; node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary servicelink --once
$env:SERVICELINK_MAX_PAGES='100'; $env:SERVICELINK_PAGE_SIZE='100'; node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary servicelink --once
$env:HUD_MAX_STATES='1'; $env:HUD_MAX_PAGES_PER_STATE='1'; $env:HUD_PAGE_SIZE='10'; $env:HUD_STATE_CONCURRENCY='1'; node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary hud --once
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary treasury --once
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary irs --once
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary usda --once
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary gsa --once
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --promote treasury
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --promote irs
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --promote usda
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --promote gsa
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --promote servicelink
```

Each promoted source has at least two clean complete observations at its accepted scope. HUD's rollout row contains four historical clean counters, but the two post-integrity-fix runs named above are the acceptance evidence for the current adapter contract. The operational worker is configured to run promoted sources only.

## Verification

```powershell
node --test test/national-core-reports.test.js test/source-collector-coverage.test.js test/scraper-reliability.test.js
```

All 35 targeted tests passed. Later broad release verification passed 229 tests with three documented optional skips and no failures. PostgreSQL confirmed Treasury, IRS, USDA, GSA, ServiceLink, and HUD are promoted. The first five have `clean_canary_runs=2`; HUD records four historical clean counters, including the two post-fix acceptance runs. The ServiceLink checkpoint is empty after both terminal sweeps.

The current database contains 8,013 national-core records: GSA 3, HUD 1,992, IRS 7, ServiceLink 5,980, Treasury 16, and USDA 15. Origins are 7,763 live and 250 archive. ServiceLink accounts for 5,730 live plus all 250 archive records. Historical records absent from the current publisher response remain historical context; clean sweeps do not infer that they were withdrawn, closed, or sold.

Earlier large ServiceLink segments exposed two independent bounded-file compatibility issues after durable inventory and evidence had already committed. Windows research-workspace replacement now retries transient `EPERM`, `EACCES`, and `EBUSY` rename failures without deleting the retained file. The 20 MB legacy live-listings JSON cache can no longer invalidate atomic PostgreSQL evidence in advanced discovery mode; it emits a compatibility-cache warning while durable observations, hunts, and cases continue. Both final 5,730-record canaries completed those durable stages with no errors.
