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

- The hero searches city, county, state, country, ZIP, and address scopes. Selecting an address opens the surrounding market rather than pretending one property is the entire result.
- Grid and map views share the same live search, source, state, and sort state. Map markers open the same underwriting drawer and record page as their cards.
- The live feed is loaded through `src/app/api/listings/route.ts`, which proxies the Node listing API. If that API is unavailable, the UI explicitly labels the local sample records as a demo fallback.
- Each card links to its own `/listings/[id]` page.
- `sourceUrl` means an exact upstream record URL. A portal homepage is never shown as if it were a property record. Demo listings without a verified record-level URL remain usable for the homepage composition and display an honest unavailable state.
- Watchlists and the newsletter preview persist locally in the browser. They are not represented as production accounts or live email delivery.
- Notice parsing, deal analysis, CSV/JSON export, responsive navigation, modal keyboard behavior, and the feature demonstrations are covered by browser tests.

## Data flow

```text
scrapers or data.js
        |
        v
Node listing API :3000
        |
        v
Next /api/listings proxy
        |
        v
hero search + grid/map feed + /listings/[id]
```

`scripts/build-data.js` gathers registered scrapers, normalizes their records, removes duplicate IDs, and writes `data.js`. The generator strips a `sourceUrl` when it is merely the source homepage. The Treasury scraper is the current example that can retain a true record-detail URL.

Run the fast local fixture refresh with:

```bash
npm run refresh-data
```

The networked Treasury collection is opt-in:

```bash
npm run refresh-data:real
```

The source may be slow or unavailable; failures are reported rather than silently converted into listings.

## Verification

The complete quality gate is self-contained — no servers need to be running first:

```bash
npm test
```

`test/verify.js` runs eleven suites in sequence: client formulas, backend routes, scraper pipeline, AI/security checks, emulated journeys, hostile-input hardening, source-registry/link contracts, a DB row-shape/type contract, a production Next build, the canonical-runtime contract, and the Playwright browser suite. The browser suite is launched by `test/run-ui-suite.js`, which boots the Node API on `:3000` and a production Next server on a dedicated port, waits for readiness, runs the tests, then tears both down. With `DATABASE_URL` set, suite 8 (`npm run test:db`) additionally round-trips a record through Postgres and checks the result matches the in-memory shape.

Useful focused commands:

```bash
npm run test:unit
npm run test:server
npm run test:scrapers
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
