# National-core discovery gate audit — 2026-09-07

## Gate used

A source canary is clean only when it returns at least one validated, publisher-observed record, has no source or observation error, and its run report declares an exact scope with `complete: true`, `fullSweepComplete: true`, and `truncated: false`. Fixture or embedded demo inventory, transport failures, challenge pages, partial continuations, and unverified zero-yield responses are not promotion evidence. No recurring timer was enabled.

The canary command is:

```powershell
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary <source> --once
```

Promotion is permitted only after two distinct clean run IDs at the same real scope:

```powershell
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --promote <source>
```

No promotion command was run during this audit.

## Adapter audit

| Source | Publisher scope and URL | Bounded behavior | Gate readiness before live run |
| --- | --- | --- | --- |
| ServiceLink | Anonymous listing feed, `https://www.servicelinkauction.com/api/listingsvc/v1/Listings` | 25 records/page by default, one page/run, continuation checkpoint retained; a remaining continuation is explicitly partial | Gate-capable. It declares endpoint/filter scope, completeness, full-sweep state, and truncation. A national sweep may require several runs and must never be called complete early. |
| Treasury | Real-property index plus every discovered detail page, `https://www.treasury.gov/auctions/treasury/rp/realprop.shtml` | Detail concurrency 2 with crawl jitter; no fixture fallback in `scrapeFeed()` | Fail closed for promotion: no exact `lastRunReport.scope`, `complete`, or `fullSweepComplete` contract. Embedded demo records exist only behind `getMockListings()`. |
| IRS | Auction item index plus discovered `/ad/` detail pages, `https://www.irsauctions.gov/auction/items` | Detail concurrency 2 with crawl jitter; no fixture fallback in `scrapeFeed()` | Fail closed for promotion: no exact exhaustive run report. Embedded demo records exist only behind `getMockListings()`. |
| USDA | SFH search form and state POST searches, `https://www.resales.usda.gov/resales/public/searchSFH` | Iterates states exposed by the publisher form; requests are sequential | Fail closed for promotion: no exact exhaustive run report. No embedded fixture fallback is used by the live path. |
| GSA | Current listing index plus discovered property details, `https://realestatesales.gov/our-listing` | Detail pages fetched sequentially through the guarded base client | Fail closed for promotion: no exact exhaustive run report. The adapter parses “Current Bid” only as publisher evidence and must not infer an opening bid from it. |
| HUD | State-scoped DataGrid with HTML fallback, `https://www.hudhomestore.gov/Home/DataGrid` | Defaults to all configured jurisdictions and at most five pages/state; supports explicit state/page caps | Fail closed for promotion: it reports per-state partial failures but does not yet declare exact `scope/fullSweepComplete`. A bounded one-state canary is coverage evidence only, never national completeness. Embedded demo records exist only behind `getMockListings()`. |

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
