# Source network operating workflow

Source Radar lives at `/sources`. Its product promise is to find overlooked changes and preserve their evidence. The source catalog is a coverage plan, never an assertion that every source is delivering current inventory.

## Collection to decision

1. Choose a geography and source family in Source Radar. Inspect the publisher link, source role, required evidence, fallback path, and collection status.
2. For an automated property collector, collect through the operator control or `npm run sources:collect -- <key>`. The CLI supports all 14 production collector keys; `--list` reads the scheduler registry. Fixture-only trustee and historical FDIC adapters cannot enter live ingestion.
3. Every record passes the existing publisher URL, provenance, value, challenge, and canonical-schema gates. Scheduler collections persist accepted records to the local live store as well as the canonical database. Rejected/error payloads do not clear inventory.
4. The observation store matches exact publisher record IDs within the same source. First observation establishes a baseline. Later observations compare bid, sale date, status, payment terms, and address. Older captures cannot refresh freshness or overwrite current evidence. Missing fields and missing results cannot establish a reduction, sale, or disappearance.
5. Investigate a change using its before/after values, timestamps, and source links. Changed snapshots retain notice excerpts and a SHA-256 of the captured raw notice. A published opening-bid reduction is a research signal, not a profit prediction.
6. If a collector cannot operate, use the source-specific fallback. Capture the exact record URL, time, and authorized text/CSV/JSON export. Source Radar and `sources:intake` retain the original evidence with content deduplication. Unknown local publishers require explicit source metadata. No arbitrary user URL is fetched by intake.
7. An operator inspects the original evidence, follows the source link, and accepts or rejects the packet. Accepted evidence remains a research packet. Canonical property publication still requires a compatible source adapter, exact-record URL policy, normalization, and property verification; evidence approval does not invent a title conclusion or offer eligibility.

## Runtime endpoints

| Endpoint | Purpose | Access |
| --- | --- | --- |
| `GET /api/source-network` | Catalog, actual registered adapters, current observations and changes | Read-only public |
| `POST /api/source-network/run` | Start one registered collector asynchronously | Operator token |
| `GET /api/source-network/intake` | Latest 50 evidence summaries; `includeContent=true` includes originals | Operator token |
| `POST /api/source-network/intake` | Submit and deduplicate an evidence packet | Operator token |
| `POST /api/source-network/review` | Record approve/reject evidence review | Operator token |

Next.js proxies these routes to the same Node API used by the listing feed. `SCRAPER_ADMIN_TOKEN` is configured on the API server; supply it through the Source Radar operator panel or a Bearer header. It is not stored in browser local storage. The local CLI can import and review packets without starting either web process.

## Persistence and operation

- `.cache/live-listings.json`: canonical validated live observations, merged without rewriting fixture/seed files.
- `.cache/source-observations.json`: source runs, latest snapshots, up to 20 changed snapshots per record and 2,000 recent change signals. Up to 40 MB; exhaustion surfaces an error instead of silently deleting history.
- `.cache/source-intake.json`: review evidence, up to 2,000 packets / 20 MB. Each packet is bounded. Exhaustion surfaces an error and requires an operator archive/export policy.
- Writes use exclusive locks and temporary-file rename. Do not remove an active lock. Mount these stores on a persistent volume for container operation. This file-backed implementation assumes a single shared writer host; use transactional database storage before scaling independent hosts.
- Network collectors keep the existing six-hour scheduler by default (`SCRAPE_INTERVAL_HOURS`). Source-specific catalog cadences are suggested check intervals displayed in Source Radar, not individually enforced scheduler schedules.
- HUD collection supports `HUD_STATES`, `HUD_MAX_STATES`, `HUD_MAX_PAGES_PER_STATE`, `HUD_PAGE_SIZE`, and `HUD_STATE_CONCURRENCY`. Its jurisdiction list includes 50 states, DC, and PR; this is a query plan, not evidence of inventory in all 52 jurisdictions.

## What coverage means

The catalog covers named publishers and source families. County, state, trustee, land-bank, court, and licensed-feed templates make the long tail enterable through evidence intake. They do not imply every county portal is enumerated, contracted, or automated. No national MLS entitlement, PACER account, paid feed license, or authenticated publisher access is created by registering its workflow.

The September 5 live audit is recorded in `source-live-audit.md`. Tests cover source identities, import isolation, freshness, failed/empty runs, stale observations, collection selection, operator authorization, and original-evidence preservation. Use `npm run test:sources` plus the scraper/runtime verification gates when changing this network.
