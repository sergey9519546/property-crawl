# Project: property-crawl (PerfectProperty)

> **Canonical Workflow & Ground Truth**:
> - Generated System Snapshot: [`CONTEXT.md`](./CONTEXT.md) *(regenerate via `npm run context:gen`)*
> - Agent Rules & Architecture Guide: [`AGENTS.md`](./AGENTS.md)
> - Single Status & Open Work Ledger: [`docs/COMPLETION_CHECKLIST.md`](./docs/COMPLETION_CHECKLIST.md)
> - Historical Plans & Roadmap: [`docs/UNIMPLEMENTED_PLANS_AND_ROADMAP.md`](./docs/UNIMPLEMENTED_PLANS_AND_ROADMAP.md)

## Architecture Overview
- **v2 Canonical Web App (`src/`)**: Next.js 16 App Router (`next dev -p 3001`), server-side API proxy (`PROPERTY_API_URL`), full-site trilingual localization (`en` English, `hy` Armenian / Հայերեն, `ru` Russian / Русский via `src/proxy.ts` + `src/lib/i18n/`), strict nonce CSP, and Evidence Ink design tokens.
- **v1 Listing API & Scraper Runtime (`server/`)**: Node `http` daemon (`server/server.js`, port `3000`), pre-compressed revision-keyed listing responses, discovery query engine (`server/discovery/query.js`), enrichment/intelligence adapters (`server/enrichment/`, `server/intelligence/`), and fail-closed circuit-broken source collectors (`server/scrapers/`).
- **v0 Legacy Reference (`index.html`, `app.js`)**: Retained static PWA reference only (not launched by `npm run dev`).
- **Persistence Layer (`server/db/`)**: PostgreSQL + PostGIS (through Migration `042` with byte-identical mirror under `src/lib/db/`), embedded PGlite test/runtime mode, and opt-in in-memory test backend (`PROPERTY_INVENTORY_BACKEND=memory`).
- **Triage & Underwriting Standard**: Zero-Fabrication Underwriting (`estLow`/`estHigh` never invented from `openingBid` or assessed value; `SCORE_BANDS` frozen across `elite`, `strong`, `fair`, `thin`; statutory carry & cash-to-close modeled cleanly in `src/lib/underwriting.ts` and `server/export/decision-packet.js`).

## Standard Engineering Workflow
1. **Local Development**: Run `npm run dev:api` (`3000`) and `npm run dev` (`3001`) in parallel.
2. **After Schema or Route Changes**: Run `npm run schema:sync` (if migrations/schema edited) and `npm run context:gen` to keep `CONTEXT.md` and `src/lib/db/` mirrors synchronized.
3. **Pre-Commit Verification**:
   - Typecheck: `npm run lint`
   - Structural & Meta Guards: `npm run test:meta-guards`
   - SEO & i18n Parity: `npm run test:seo && node --test test/i18n-completeness.test.js`
   - Full JS Coverage Suite: `npm run test:ci-coverage`
   - Production Build: `npm run build`
   - Playwright UI E2E Suite: `node test/run-ui-suite.js`
4. **Release / Pre-Push Gate**: `npm run release:gate` (verifies `typecheck`, `generated-context`, `schema-mirrors`, `test-wiring`, `ops-suites`, `scraper-parser`, `production-smoke`, `next-build`, `nft-manifests`, and `production-e2e`).

## Completed Program Milestones
- **M0–M4 (Core Discovery, Persistence & Release Gate)**: Unshadowed `/api/listings/compare`, PostGIS migrations + PGlite/PG query parity, corrupt-store quarantine, and automated `release:gate` (`PP-02`).
- **M5–M6 (Underwriting Depth, Scrapers & Live Latency)**: Statutory cash-to-close/carry timelines, Title Risk & Second-Look engines, Email-as-API review split-pane with verbatim spans, Migration `034`–`039` inline discovery indexing, batched history/observation writes, pre-compressed revision-keyed `GET /api/listings` cache, and Florida/NY/Clark parcel boundary resolution.
- **M7 (Sitewide Audit Remediation & Full Trilingual i18n)**: Resolved all EGM/Goldfish findings (`F-01`–`F-10` & operational health/checkpoint hardening), completed sitewide UX/RBAC/SEO/accessibility audit fixes across public, property detail, research, and workspace surfaces, and implemented request-negotiated English (`en`), Armenian (`hy`), and Russian (`ru`) localization across the platform.

## Code Layout
- `src/app/`, `src/components/`, `src/lib/` — Next.js 16 App Router pages, UI components, i18n dictionaries, underwriting & API helpers
- `server/routes/`, `server/discovery/`, `server/scrapers/`, `server/enrichment/`, `server/intelligence/`, `server/db/` — Node API handlers, scrapers, Postgres client & migrations
- `scripts/` — CLI workflows (`gen-context.js`, `release-gate.js`, `verify-test-coverage.js`, `compact-snapshots.js`, `canary-live.js`, etc.)
- `test/` — Node test runner suites & Python Playwright E2E suites (`run-ui-suite.js`)
- `docs/`, `audit/`, `reports/` — Governance docs, historical audit receipts, canary/verification ledgers
