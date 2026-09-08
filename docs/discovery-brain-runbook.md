# Discovery brain operations

The canonical runtime is Next.js 16 plus the Node API, backed by PostgreSQL/PostGIS in advanced mode. ServiceLink is a functional benchmark and dated evidence source. The supplied architecture report is a reported reverse-engineering account; it does not establish the complete publisher backend. Atlas entries are onboarding candidates, not operating integrations.

## Mode and readiness

Set DATABASE_URL and DISCOVERY_MODE=advanced on the API and dedicated worker. Set the same SCRAPER_ADMIN_TOKEN on the API and Next server, plus WORKSPACE_SESSION_SECRET and PROPERTY_WORKSPACE_ID for the operator workspace. Keep SCRAPER_BACKGROUND_ENABLED=0. Private state derives ownership on the server; caller user IDs do not select another workspace.

`GET /api/health` checks process liveness. `GET /api/health/ready` checks PostgreSQL, PostGIS, required discovery tables, and job lease columns. An advanced-mode database outage returns an explicit failure; demo inventory is never substituted. With DATABASE_URL unset, the existing demo still boots, with limited inventory and no advanced durability guarantees.

## Setup and migrations

1. Provision PostgreSQL with PostGIS, or start `discovery-db` from `docker-compose.discovery.yml`. Keep database credentials in the environment/secret store.
2. Run `npm run discovery:migrate`. The migrator creates the base schema if needed, applies every numbered migration, serializes concurrent migration attempts, and rejects changes to already applied migration checksums.
3. Run `npm run discovery:ready` with the deployment environment.
4. Import archives before beginning live canaries. Start the API/UI, then one dedicated collection worker.

The local acceptance environment uses an isolated PostgreSQL 16.15/PostGIS 3.6.2 instance bound to 127.0.0.1:55432 under `.cache/discovery-runtime`. Its environment file is local and ignored by Git. The container configuration is supplied separately; the Docker engine was unavailable during local verification.

For a discovery preview alongside another Next development process in the same checkout, set `NEXT_DISCOVERY_PREVIEW=1` and run Next on its own port. This uses `.next-discovery-preview` so the two processes do not compete for the default `.next` development lock. The verified preview uses port 3103 and `PROPERTY_API_URL=http://127.0.0.1:3102`. Production build checks use the existing `NEXT_VERIFY_BUILD=1` output instead of the live preview directory.

## ServiceLink archive and atlas import

Prepare and validate the supplied files (dry-run is the default):

```powershell
node scripts/discovery-import.js --catalog 'C:/Users/serge/Downloads/ServiceLink-Auction-GODMODE-Complete.zip' --photos 'C:/Users/serge/Downloads/ServiceLink-Auction-GODMODE-Photos-5313.zip' --atlas 'C:/Users/serge/Downloads/Property_Intelligence_Source_Atlas_VERIFIED_2026-09-05.docx' --observed-at '2026-09-05T09:08:00Z' --python '<python executable>'
```

Use the same command with `--apply` and DATABASE_URL to store evidence and hash-named media. Configure `--media-dir` on persistent storage. Prepared JSONL, manifests, rejection reports, and input hashes remain in `.cache/discovery-import`. A prepared stage can be replayed with `node scripts/discovery-import.js --stage .cache/discovery-import --apply`.

The validated archive contains 5,900 catalog rows, 40,578 image references, 5,313 photo links, and 5,270 distinct image hashes. The 128 closed-result records are separate snapshots. Neither a closed state, a reserve flag, nor repeated bid counts establish a completed sale or observed bidding activity. The capture time is attachment-author supplied; importing does not refresh verification. Photos retain integrity and reuse status and are not automatically displayed.

Atlas ingestion preserves 501 registry entries, 557 ledger rows, access classifications, original claims, and 24 unmapped ledger rows. A source remains manual/backlog until adapter coverage, provenance, and two clean observed runs pass the promotion gate.

For existing local state, run `npm run discovery:import:legacy -- --directory .cache` to inspect, then add `--apply`. Original hunt, observation, and job files are retained. Import is idempotent. Interrupted legacy jobs remain historical failed jobs and require a new collection trigger.

## Collection and promotion

Run `npm run discovery:worker -- --canary servicelink` for an explicit canary, or substitute a supported source. Configure publisher bounds using its environment variables (for example SERVICELINK_PAGE_SIZE and SERVICELINK_MAX_PAGES). A request budget pauses a sweep and commits a checkpoint only after accepted records have been stored. Continuations retain declared scope. Partial pages are never counted as clean complete canaries.

Two distinct clean, complete runs of the same declared scope are required before `npm run discovery:worker -- --promote <source>`. Run `npm run discovery:worker` for the dedicated worker, or append `--once` for a bounded iteration. Recurring work only selects promoted sources and applies source cadence. Keep failed or blocked sources unpromoted.

Current-run validated records may generate positive hunt matches independently of unrelated source failures. Missing or unobserved records retain their baselines. Disappearance never establishes sold, withdrawn, or completed. Challenge pages stop collection; use the explicit lookup/import path for inaccessible sources.

Wave 1: ServiceLink, Treasury, IRS, USDA, GSA, HUD. Wave 2: land banks, CivilView, Bid4Assets, each with explicit jurisdiction coverage. Existing FDIC history remains historical evidence.

## Shared discovery contract

`GET /api/listings` retains `listings`, `total`, and offset compatibility, and adds facets, revision, and page cursor metadata. Filters cover query identifiers, state/county, source/type, program/lifecycle, date window, published amount, occupancy, source recency, documents, and existing modeled-score inputs. Unknown fields remain unknown. Cursors bind filters and inventory revision; a changed revision returns 409 and requires refresh.

`GET /api/listings/map` accepts bbox and zoom and returns bounded GeoJSON clusters or points; it handles antimeridian viewports. Grid, calendar, exports, and hunt matching use the same filter engine. Calendar windows are bounded and explicitly labeled. Exports page through the query into a temporary file, then stream a complete revision-consistent download.

`GET /api/property-intelligence?listingId=...` adds durable snapshot history, exact parcel/jurisdiction publisher links, address candidates, conflicting values, sale mechanics, and document/media evidence. `snapshotId=...` exposes the exact stored raw record only when it belongs to that listing's publisher identity. Public-record research persists separately and retains its own observation time. AI is optional.

## Acceptance and incident response

Run `npm run test:discovery` with DISCOVERY_TEST_DATABASE_URL (or TEST_DATABASE_URL/DATABASE_URL). PostgreSQL acceptance fails if the database is missing. Tests create isolated schemas; they do not truncate imported inventory. Run source, intelligence, database, canonical-runtime, evidence-truth, TypeScript, and production-build checks as well.

`npm run discovery:benchmark` seeds an isolated 100,000-record schema and exercises search/facets and maps with ten concurrent readers. Record CPU, RAM, Node, PostgreSQL/PostGIS versions, request latency distributions, and report path. Targets: warm search p95 under 1,000 ms and map p95 under 1,500 ms. Repeat only after changes or to resolve a demonstrated performance concern.

On drift, empty/truncated inventory, or access failure, pause the source and preserve existing records, raw snapshots, checkpoints, and rejection details. Lease expiry permits recovery after process death. Review the source run and retry within its bounds. Restore pre-migration backups for a full rollback; original import inputs and legacy files remain available.

See `reports/discovery-acceptance-2026-09-07.md` and `reports/discovery-national-core-2026-09-07.md` for observed gates and limitations. Do not equate configured sources with complete nationwide coverage.

## Exterior walkthrough

Every property dossier has an Exterior Walkthrough tab. Selecting the tab runs a bounded metadata lookup and opens the interactive panorama when coverage is found. Google Maps Embed supplies native camera movement, linked street navigation, zoom, and fullscreen; a return control restores the original property panorama. The optional Maps JavaScript viewer loads once and has a bounded timeout and retry. Imagery is provider-hosted and is never downloaded into the property photo archive. Completed metadata is not cached and content is not prefetched, following the [Street View policies](https://developers.google.com/maps/documentation/streetview/policies).

Configure `GOOGLE_MAPS_API_KEY` on the canonical API for address verification and panorama metadata. Configure `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` on Next for Maps Embed, or `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` for the optional JavaScript viewer. Browser keys are intentionally public credentials and must be restricted to the corresponding Maps API and application referrers. Never make a private server credential public by automatically falling back to it. Changes to public environment variables require rebuilding/restarting Next.

`GET /api/property-image?listingId=...&mode=walkthrough` first searches beside the verified property location, then allows nearby outdoor street imagery within 500m. It returns panorama ID, capture date, distance, bearing toward the property, Google launch link, and `near_property`/`nearby_street` coverage. A source address must match one rooftop geocode when usable source coordinates are absent; approximate geocodes fail closed. The response never claims that the panorama verifies the subject facade. Static `mode=image` and thumbnail metadata retain the stricter proximity gate. Rate limits, bounded concurrency, concurrent-request coalescing, and circuit breakers apply in the Node service; Next proxies the same API. Capture date and distance describe the starting panorama because native iframe navigation can move to different imagery.

No provider guarantees a tour at every property. A missing panorama leaves an explicit coverage state, publisher photos, and an official map-search link. The evaluated Potter Valley property returned no Google panorama within 500m. Panoramax's surrounding town-scale public search also returned no imagery. Keep Panoramax gated: working adjacent-frame sequences do not establish 360 imagery, and reviewed US coverage was sparse. See `reports/street-walkthrough-alternatives-2026-09-07.md` for the GitHub/provider evaluation and observed probes. Licensed or owner-supplied panoramas can support a later Photo Sphere Viewer tour workflow.
