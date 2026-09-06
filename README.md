# PerfectProperty

PerfectProperty is a distressed-property discovery and underwriting beta. The canonical product is the Next.js interface in `src/`; the Node service in `server/` supplies its listing API.

The root-level static PWA (`index.html`, `app.js`) remains in the repository as a legacy reference. It is not the default UI and is not launched by `npm run dev`.

## Run the current product

Install dependencies once:

```bash
npm install
```

Start the listing API in one terminal:

```bash
npm run dev:api
```

Start the canonical Next.js UI in another:

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). The API runs at [http://localhost:3000](http://localhost:3000).

| Service | Command | Address |
|---|---|---|
| Canonical UI | `npm run dev` | `http://localhost:3001` |
| Listing API | `npm run dev:api` | `http://localhost:3000` |

Set `PROPERTY_API_URL` when the API is hosted elsewhere. If `DATABASE_URL` is unset, the backend uses the generated records in `data.js` as its in-memory seed.

## Current product behavior

- [Source Radar](http://localhost:3001/sources) connects 47 source workflows to their collection or evidence-import path. It reports observed coverage and run failures, and compares successive source records for bid, date, status, address, and payment-term changes.
- `npm run sources:setup` configures the local source operator without rotating an existing credential. It prints the location of a private credential file to use in the Source Radar and Saved Hunts access controls.
- [Saved Hunts](http://localhost:3001/hunts) saves versioned criteria, explains each match or missing fact, and compares later observations. Uses the source operator credential and persists in `.cache/saved-hunts.json`.
- Every property has an evidence dossier with source history, current research gaps, public-record lookup, and JSON export. `npm run sources:public-records -- --help` describes the bounded CLI; set `CENSUS_API_KEY` for ACS data.
- [Reference audits and implementation map](docs/reference-audit/README.md) record all 26 supplied files and the resulting upgrades.
- `npm run sources:collect -- --list` lists all registered production collectors. `npm run sources:collect -- civilview --state NJ --counties 1 --limit 12` performs a bounded collection. Collected records and history are stored in `.cache` without rewriting `data.js`.
- `npm run sources:intake -- list` inspects the evidence queue. Source Radar can import text/CSV/JSON, enroll a local publisher alongside its evidence, and record an operator review. UI operations use `SCRAPER_ADMIN_TOKEN`; CLI imports rely on local workspace access. Reviewing evidence does not publish it as an actionable property listing.
- See [the operating workflow](docs/source-network-workflow.md), [source catalog](docs/source-coverage.md), and [live collector audit](docs/source-live-audit.md) for exact coverage and remaining source-access requirements.

- The hero searches city, county, state, country, ZIP, and address scopes. Selecting an address opens the surrounding market rather than pretending one property is the entire result.
- Grid and map views share the same live search, source, state, and sort state. Map markers open the same underwriting drawer and record page as their cards.
- The live feed is loaded through `src/app/api/listings/route.ts`, which proxies the Node listing API. If that API is unavailable, the UI explicitly labels the local sample records as a demo fallback.
- Each card links to its own `/listings/[id]` page.
- `sourceUrl` means an exact upstream record URL. A portal homepage is never shown as if it were a property record. Demo listings without a verified record-level URL remain usable for the homepage composition and display an honest unavailable state.
- Property media follows an evidence hierarchy: an exact publisher-record photo first, then a server-verified Google Street View panorama only when no publisher photo exists, then the coordinate map. Generic stock-house imagery is rejected for live records. Street View is labeled as nearby street context rather than proof that the visible facade is the parcel.
- Street View availability is checked through Google metadata, constrained to outdoor panoramas near source-backed coordinates (or one strict, non-partial rooftop geocode of the full source-observed address). Google image bytes are proxied with `no-store` and are not persisted or re-hosted.
- Watchlists and the newsletter preview persist locally in the browser. They are not represented as production accounts or live email delivery.
- Notice parsing, deal analysis, CSV/JSON export, responsive navigation, modal keyboard behavior, and the feature demonstrations are covered by browser tests.

## Data flow

```text
source-specific scrapers or demo data.js
        |
        v
normalization + provenance + exact-record validation
        |
        v
Node listing API :3000 + server-side media fallback
        |
        v
Next /api/listings proxy
        |
        v
hero search + grid/map feed + /listings/[id]
```

`scripts/build-data.js` gathers registered scrapers, normalizes their records, removes duplicate IDs, and writes `data.js`. Live records require source-observed provenance and a record-level URL that matches the source policy. A successful source observation may clear stale media; a whole-source failure preserves the last known observed records instead of manufacturing replacements.

Run the fast local fixture refresh with:

```bash
npm run refresh-data
```

Networked live-source collection is opt-in:

```bash
npm run refresh-data:real
```

That flag applies to data-file refreshes. The Node API normally starts scheduled collection outside tests; set `RUN_REAL_SCRAPERS=0` for a preview without outbound collection, or `1` to explicitly enable it.

Sources may be slow, rate-limited, blocked, or unavailable. The collectors use bounded concurrency, timeouts, jitter, source telemetry, and circuit breakers; failures are reported rather than silently converted into listings. Fixture-only and historical-only collectors are excluded from the live feed.

To enable the verified Street View fallback, set `GOOGLE_MAPS_API_KEY` only in the server runtime or ignored `.env.local`. Next.js loads that file automatically; `npm run dev:api` and `npm run start:api` load it with Node's optional env-file flag. Enable Street View Static API on the key's Google Cloud project; Geocoding API is also needed when a publisher supplies an address without coordinates. See `.env.example` for conservative distance, timeout, concurrency, rate-limit, and circuit-breaker controls. Restrict and rotate any key shared in chat before production use.

## Verification

The complete quality gate is self-contained — no servers need to be running first:

```bash
npm test
```

`test/verify.js` runs the complete set of unit, API, scraper-reliability, source-integrity, evidence-truth, media-fallback, security, database, production-build, canonical-runtime, browser, adversary, telemetry, and agent-contract gates in sequence. Verification uses a separate `.next-verify` build with persistent build caching disabled. The browser runner boots a fresh, in-memory Node API on `:3102` and a production Next server on `:3100`, waits for readiness, runs the tests, then tears both down. It never reuses a possibly stale development API or calls billable Google imagery services. With `DATABASE_URL` set, `npm run test:db` additionally round-trips a record through Postgres and checks the result matches the in-memory shape.

Useful focused commands:

```bash
npm run test:unit
npm run test:server
npm run test:scrapers
npm run test:scraper-reliability
npm run test:source-integrity
npm run test:evidence-truth
npm run test:property-image
npm run test:ai
npm run test:e2e
npm run test:canonical
npm run test:db
npm run test:ui:e2e
npm run build
```

The browser suite in `test/next_ui_e2e_test.py` exercises desktop and mobile navigation, every listing-page URL, all geographic search scopes, grid/map synchronization, live filters and sorting, watchlist persistence, source-link truthfulness, notice parsing, dialogs, exports, responsive widget geometry, accessible names, and runtime-console failures.

## Production commands

Build and run the UI:

```bash
npm run build
npm start
```

Run the API separately:

```bash
npm run start:api
```

For a deployed environment, configure `PROPERTY_API_URL`, database credentials when persistence is enabled, and the production controls documented in `.env.example`. This beta is a research and workflow tool; property status, legal notice terms, title, liens, redemption rights, and bid requirements must be confirmed at the official record before funds are committed.

## Project map

```text
src/app/                    Next.js App Router, API proxy, info and listing pages
src/components/site/        Marketing and product-story sections
src/components/terminal/    Search, grid/map, parser, drawer, watchlist, 3D view
src/lib/listing-links.ts     Exact-source-link safety contract
server/                     Node listing API, DB layer, scrapers, security
scripts/build-data.js       Generated seed-data pipeline
data.js                     Generated local seed records and source taxonomy
test/next_ui_e2e_test.py    Canonical Playwright E2E suite
test/verify.js              Complete verification runner
index.html + app.js         Legacy static UI retained for reference
```
