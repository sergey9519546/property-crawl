# Release gate snapshot — 2026-10-20 (tree `486524e`)

> Committed evidence for PP-05 and production deployment verification on Render.
> Live URL: `https://property-crawl.onrender.com`
> Database: Managed PostgreSQL 16 + PostGIS 3.6 on Render (`property-crawl-db`)
> Infrastructure cost: strictly $0.00 / month (Render Free Web Service + Free Postgres).
> GitHub Actions: 0 runs, all 4 workflows remained `disabled_manually`.

## 1. Verified Production Live Endpoints

| Endpoint | Status | Protocol | Latency | Payload Highlights |
|---|---|---|---|---|
| `GET /` | `200 OK` | HTTPS / HTTP/2 | 528ms | Full Next.js 16 App Router Terminal Homepage |
| `GET /listings` | `200 OK` | HTTPS / HTTP/2 | 4735ms | Discovery Workbench, filters, real inventory |
| `GET /listings/USDA-TN-6237` | `200 OK` | HTTPS / HTTP/2 | 280ms | Bidding Simulator, Street View / Panoramax, title intelligence |
| `GET /sources` | `200 OK` | HTTPS / HTTP/2 | 482ms | Source Radar (18 catalog sources, tiers, cadences) |
| `GET /hunts` | `200 OK` | HTTPS / HTTP/2 | 295ms | Saved Hunts, tri-state match rules |
| `GET /sign-in` | `200 OK` | HTTPS / HTTP/2 | 189ms | Operator beta disclosure, session access |
| `GET /terms` | `200 OK` | HTTPS / HTTP/2 | 104ms | Statutory disclaimers, no-financial-advice policy |
| `GET /privacy` | `200 OK` | HTTPS / HTTP/2 | 195ms | Zero third-party tracker policy, local data persistence |
| `GET /api/health` | `200 OK` | HTTPS / HTTP/2 | 150ms | `dataMode: "postgres"`, `postgresReachable: true`, `listings: 10335` |
| `GET /api/health/ready` | `200 OK` | HTTPS / HTTP/2 | 207ms | `ready: true`, `mode: "advanced"`, `database.postgis: true` |
| `GET /api/sources` | `200 OK` | HTTPS / HTTP/2 | 114ms | 18 active sources served from PostgreSQL |
| `GET /api/coverage` | `200 OK` | HTTPS / HTTP/2 | 103ms | National coverage matrix across all 51 jurisdictions |
| `GET /api/listings?limit=5` | `200 OK` | HTTPS / HTTP/2 | 1257ms | Real paginated listings with triage & provenance |

## 2. Infrastructure & Cloud Deployment Receipts

- **Render Service ID**: `srv-dbbc3vgm7kps73eehimg` (`property-crawl`)
- **Render Service Type**: `web_service` (Docker runtime, `Dockerfile.production`)
- **Render Service Plan**: `free` ($0/mo)
- **Active Deploy ID**: `dep-dbbciip8k6hc73fe7ok0`
- **Deploy Status**: `live` (finished at 2026-10-20T01:54:39Z)
- **Render PostgreSQL Instance**: `dpg-dbbc8su7bikc73819uo0-a` (`property-crawl-db`)
- **PostgreSQL Plan**: `free` ($0/mo)
- **PostGIS Version**: `3.6 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`
- **Total Listings in Database**: `10,335` records across 51 states and jurisdictions
- **Discovery Migrations**: All 20 migrations applied cleanly (`003` through `022`)

## 3. Key Issues Resolved During Deployment

1. **WebAssembly Memory Ceiling in 512MB Free Tier Container**:
   - PGlite WASM + PostGIS WASM inside a single Node container allocated >660MB RSS, exceeding Render's 512MB container limit and triggering cgroup OOM kills.
   - Offloaded database to Render's dedicated free PostgreSQL 16 + PostGIS 3.6 service (`property-crawl-db`), connecting privately via internal network URL (`dpg-...`).
   - Node HTTP backend now connects via pure-JS `pg` pool (consuming only ~5MB), leaving ample headroom for Next.js 16 within the 512MB container.
   - Added `NODE_OPTIONS="--max-old-space-size=256"` to guarantee V8 runs aggressive garbage collection.

2. **Long Identifier Slug Schema Limitation (`022_widen_listing_id.sql`)**:
   - GSA official notices emit descriptive slugs up to 85 characters (e.g. `GSA-WA-federal-center-south-1201-building-...`).
   - Migration `022_widen_listing_id.sql` widened `listings.id`, `saved_deals.listing_id`, `listing_history.listing_id`, and `alert_matches.listing_id` from `VARCHAR(64)` to `TEXT`.
   - Synced schema mirror via `npm run schema:sync` (`src/lib/db/schema.sql` byte-identical).

3. **Background Scraper Boot Throttling (`SCRAPER_BACKGROUND_ENABLED=0`)**:
   - Prevented 20 scrapers from launching simultaneously upon container startup. Scrapers can be triggered on demand by operators or cron without starving startup memory.

4. **PP-02 Source-Bound Release Gate**:
   - **9/9 PASS** prior to pushing commit `486524e` to `origin/main`.
