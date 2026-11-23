@CONTEXT.md

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — property-crawl (PerfectProperty) Agent Reference
> Authoritative repository guide. Generated totals, catalog counts, route tables, and npm scripts live in `CONTEXT.md` (auto-generated, do not hand-edit; regenerate with `npm run context:gen`).

## 1. What this project is
Evidence-first discovery and underwriting triage layer for distressed and government-sold real estate — sheriff sales, trustee sales, HUD/REO, IRS/Treasury/GSA dispositions. *"Zillow for distressed property, with an AI that reads the fine print and tells you if each one is actually a deal — and what the catch is."* (`docs/STRATEGY.md`, `PRODUCT.md`)

## 2. Architecture & Production Topology
Three production runtimes plus one legacy reference:

| Component | Entry / Path | Role | Local Dev | Production Surface |
|---|---|---|---|---|
| Canonical Web UI | `src/` (`src/proxy.ts` + `middleware.ts`) | Next.js 16 App Router UI, SSR/RSC pages, per-request nonce CSP, trilingual i18n (`en`, `hy`, `ru`) | `npm run dev` (port 3001) | Vercel (`https://perfectproperty.bid`) |
| Listing API & Engine | `server/` (`server/server.js`, `server/vercel-handler.js`) | Node `http` API, scrapers, enrichment, intelligence engines, PostGIS persistence | `npm run dev:api` (port 3000) | Vercel Serverless (`https://property-crawl-api.vercel.app`) |
| Edge Proxy, Vault & Cron | `cloudflare/property-crawl-edge/worker.js` | Edge caching, public R2 `/vault/public/*` delivery, scheduled crons (`next-slice`, `repair-enrichment`, `prune`), Cloudflare Email Routing (`email()` -> `action=email-ingest`) | `node --test test/cloudflare/worker.test.mjs` | Cloudflare Worker (`https://edge.perfectproperty.bid`) |
| v0 Legacy PWA | `index.html`, `app.js` | Legacy static reference only (not launched by `npm run dev`) | Static file | Retired reference |

- **Next.js <-> Server Coupling**: `next.config.mjs` maps `@server/*` to `./server/*`; UI routes proxy API calls through `PROPERTY_API_URL`, while 18 `src/` files directly import `@server/*` modules (including `@server/db/client`, `@server/export/decision-packet`, `@server/intelligence/title-risk-engine`, and `@server/billing/stripe-checkout`).
- **Database Policy (No Silent Demo Fallback)**: When no reachable database is configured, `server/db/client.js` reports `dataMode()` `'unavailable'` and listing routes refuse with `503` rather than silently serving demo data. In-memory storage is strictly opt-in (`PROPERTY_INVENTORY_BACKEND=memory`) or `NODE_ENV=test`, seeded from `data.js`. Production uses Supabase PostgreSQL + PostGIS (`42` migrations through `042_catch_summary.sql`, byte-mirrored under `src/lib/db/migrations/`). Embedded PGlite (`PROPERTY_DB=embedded` + `PROPERTY_PG_DATA_DIR`) supports local/isolated execution; `server/db/database-target.js` ensures a configured `DATABASE_URL` wins on cloud runtimes.

## 3. Domain Model & Data Contracts
- **Authoritative Source Catalog**: `server/sources/catalog.js` tracks `288` federal, state, and county catalog entries across collector, evidence, and discovery roles. Live scheduled collection currently serves 8 primary active sources (`servicelink`, `hud`, `sheriff`, `civilview`, `gsa`, `usda`, `treasury`, `irs`) alongside gated/canary-staged `trustee` and `email-notices`. Read current counts and route tables from `CONTEXT.md` (do not hand-edit `CONTEXT.md` or copy seed totals into prose).
- **Seed Snapshot (`data.js`)**: Seed snapshot for v0 and test-double memory initialization; never treat `data.js` as live inventory truth (`CONTEXT.md`).
- **API Data Contract & Default Sort**: API payloads expose camelCase (`dealScore`, `openingBid`, `estLow`, `estHigh`, `propType`, `saleDate`, `catchSummary`, `triage`). Postgres stores `snake_case` columns and `server/db/client.js` aliases/prepares both `LISTING_SELECT` and `SUMMARY_LISTING_SELECT`. Default discovery grid sort in `server/discovery/query.js` and `src/components/listings/discovery-workbench.tsx` is `triage` (`triagePriority` + upcoming sale deadline), since publisher valuation ranges are absent on unappraised auction listings.

## 4. Verified Key Commands
All commands below are verified against `package.json`:

```bash
# Development & Build
npm run dev                        # Next.js 16 canonical UI (port 3001)
npm run dev:api                    # Node listing API (port 3000)
npm run lint                       # tsc --noEmit -p tsconfig.json
npm run build                      # next build + NFT/edge manifest checks

# Context & Schema Mirror Sync
npm run context:gen                # Regenerate CONTEXT.md
npm run schema:check               # Verify server/db <-> src/lib/db mirror parity
npm run schema:sync                # Sync schema & migration mirrors

# Release & Verification Gates
npm run release:gate:quick         # Fast pre-flight (typecheck, context, mirrors, test-wiring, ops, regressions, scrapling, smoke)
npm run release:gate               # Full release gate including Next build + production e2e
npm run test:ci-coverage           # Runs all unreached JS test files in test/
npm run test:canonical             # Runtime contract, production boot, i18n, vercel handler & CF worker
npm run test:db                    # DB contract & PGlite migration parity suite (set DISCOVERY_TEST_DATABASE_URL for live PG)
npm run test:discovery             # Discovery backend, worker & PostGIS spatial soak
npm run test:ops                   # Operational infrastructure & release-gate suites
npm run test:intelligence          # Dossier, title-risk, second-look, hunts & microstructure suites
npm run test:enrichment-intelligence # Assessor reading, HPI series, SAFMR & macro benchmarks
npm run test:evidence-truth        # Underwriting honesty, CORS, rate-limits, SSRF, CSP & route contracts
npm run test:underwriting-resilience # Statutory carry, lien waterfall, escrow, DSCR & tax-deed math
npm run test:meta-guards           # Structural anti-drift, no-vacuous-tests & A11y guards
npm run test:seo                   # County SEO pages, metadata & sitemap contracts
npm run test:email-ingest          # Email-as-API notice parsing & ingestion
npm run test:ai                    # Notice parser, AI cache, cost tracker & bidding math
npm run test:hunts                 # Saved hunts, alerts & digest evaluation

# Scrapers, Canaries & Crawlers
npm run canary:list                # List canary sources
npm run canary:live                # Run live canary probe
npm run canary:promote             # Promote verified canary source
npm run promotion:gate             # Enforce canary promotion thresholds
npm run crawler:doctor             # Check crawler/Scrapling toolchain
npm run crawler:spider             # Spider collector workflow
npm run crawler:unbrowse           # Unbrowse collector workflow
npm run discovery:migrate          # Apply server/db/migrations to Postgres
```

## 5. Verified Engineering Patterns (`docs/STRATEGY.md`, `docs/FOOLPROOF_SCRAPE_RESEARCH.md`)
- **Hack #1 — Email-as-API (`server/sources/email-notices.js`, `server/scrapers/email-ingest.js`)**: Statutory public-notice alert feeds routed via Cloudflare Email Routing (`email()` in `cloudflare/property-crawl-edge/worker.js` -> `POST /api/scrapers/run?action=email-ingest`) avoid scraping ToS/liquidated-damages portals and serverless IMAP socket constraints. Low-confidence parses escalate to the `document_reviews` queue.
- **Hack #2 — Platform-Level Adapters (`server/scrapers/`)**: One shared adapter covers dozens of counties sharing a vendor platform (`civilview.js` for NJ/PA sheriff portals, `sheriff.js` for RealAuction/Ohio/Florida, `trustee.js` with cursor checkpointing, `servicelink.js` auction network).
- **Hack #3 — Citation-Locked Notice Parsing (`server/ai/notice-parser.js`)**: Strict JSON extraction backed by character-offset `verifyVerbatimSpan` verification and SHA-256 cached outputs in `ai_cache`; public `GET /api/enrich?listingId=...` serves cached/deterministic evidence summaries only with zero live LLM spend on user traffic.
- **Hack #4 — Free Public-Record Enrichment Stack**: US Census Geocoder, County & Statewide ArcGIS REST layers (`server/enrichment/arcgis-parcels.js`), NJGIN MOD-IV cadastral + deed price capture (`server/enrichment/nj-cadastral.js`), Florida DOR statewide parcels (`server/public-records/florida.js`), enrolled state/county ratio rules (`server/enrichment/assessor-reading.js`), FHFA HPI quarterly series (`server/enrichment/public-benchmark-consensus.js`, using explicitly labeled `annual_roll_midyear_q2` convention when assessment quarter is omitted), and HUD SAFMR rent benchmarks.
- **Hack #5 — Honest Scarcity, Triage & Deterministic Catch (`server/intelligence/catch-summary.js`, `src/lib/score-bands.ts`)**: `SCORE_BANDS` stays the single source of truth for Deal Score bands when publisher valuations exist; every card also receives a `$0` deterministic `catchSummary` computed at ingest from publisher fields and title-risk warnings, and UI values distinguish Printed, Yours, and Unknown states cleanly (`PRODUCT.md`).

## 6. Security & Environment Configuration
- Public listing pages require **zero** external secrets to boot cleanly.
- Operator routes (`/api/scrapers/run`, `/api/document-review`, `/api/workspace/*` operator mutations, `POST /api/enrich` with `includeAiNarrative`) fail closed (`503`/`401`) without `SCRAPER_ADMIN_TOKEN` (or `PROPERTY_OPERATOR_SECRET`).
- Production infrastructure variables: `DATABASE_URL` / `DATABASE_DIRECT_URL`, `EDGE_SHARED_SECRET`, `TRUSTED_PROXY_COUNT`, `REQUIRE_DURABLE_VAULT=1` + R2 (`R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`), split GCP Maps keys (`GOOGLE_MAPS_API_KEY` server-side vs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` browser-referrer-restricted), `RESEND_API_KEY` / `RESEND_FROM` / `OPERATOR_EMAIL`, and `STRIPE_*`.
- `OPENAI_API_KEY` and `GEMINI_API_KEY` are optional and fail closed when unset.
- Strict security boundaries: timing-safe SHA-256 token comparison, SSRF validation on outbound fetches (`validatePublicHttpsUrl`), no `Host` / `X-Forwarded-Host` trust, and per-request nonce CSP enforced in `src/proxy.ts` + `middleware.ts`.

## 7. Blueprint Decision Principles, 10x Underwriting Architecture & Working-Method Guards
- **Blueprint Decision Principles (`docs/STRATEGY.md`, `docs/COMPLETION_CHECKLIST.md`)**:
  - **Zero-Fabrication Underwriting**: Never impute `estLow`, `estHigh`, or ARV from `openingBid` or assessed value; when publisher valuations are absent, require an explicit buyer-supplied assumption (`src/lib/underwriting.ts`). Never equate `closed` with `sold` or synthetic counters with bid competition.
  - **Legal/ToS/Robots Non-Negotiables ($0 Liability Moat)**: Discovery + triage layer only (zero cold homeowner outreach -> avoids TCPA & CA Civil Code § 1695). Never bypass CAPTCHAs (`landbank`, `ca-controller-tax-sale`, `bid4assets`), never violate `robots.txt` (`gsa` `/our-listing`), never bot-scrape press portals with liquidated damages, and never feed Google Maps Street View imagery to AI models.
  - **Control-Tested Verification**: Never promote a source or certify a fix from structural/quick checks alone; run `npm run test:meta-guards`, `npm run test:ci-coverage`, and `npm run release:gate`.
- **10x Product Intelligence Capabilities**:
  - **Statutory Cash-to-Close, Redemption Carry & Instrument Priority**: `computeStatutoryFeePreset` and `computeStatutoryDeadlinesAndCarry` in `src/lib/underwriting.ts` (wired into `src/components/terminal/bidding-simulator.tsx`), plus `extractInstrumentPrioritySignals` in `server/intelligence/title-risk-engine.js`.
  - **Adjournment-Exhaustion Trajectory & VoI Gap Ranking**: `trajectory` (`priorPostponements`, `statutoryStayExhausted`, `cumulativeBidDropPct`) in `server/intelligence/signals.js` and Value-of-Information (`potentialPointsGain`, `priorityTier`) in `server/intelligence/dossier.js` and `src/components/listings/property-intelligence.tsx`.
  - **Relative Second-Look Reconsideration & Digest Actions**: `openingBid` `dropped_by_pct`, `bid_to_assessed_lte`, and `saleDate` `within_days` in `server/intelligence/research-cases.js`, wired via `applySecondLookReconsideration` (`action=second-look`) and `runAllHuntDigests` (`action=dispatch-digests`) in `server/routes/scrapers.js`.
  - **Deterministic APN + County FIPS + Cadastral Parcel Bridge**: `extractRawApn` and `extractCountyFips` in `server/scrapers/normalization.js` & `server/routes/listings.js`, plus `resolveCadastralParcelIdentity` in `server/enrichment/arcgis-parcels.js`.
  - **Verbatim Character-Span Citations**: `verifyVerbatimSpan`, `evidenceSpans`, and `confidence_score` in `server/ai/notice-parser.js` with interactive click-to-highlight badges in `src/components/workspace/review-split-pane.tsx`.
- **Working-Method Guards**:
  - **Grid Payload Strip Invariant (`test/list-response-payload.test.mjs`)**: `GET /api/listings` strips `raw`, `provenance.sourceFields`, and `provenance.statusHistory`. Never read `listing.raw` in grid-mounted components (`bidding-simulator.tsx`, `discovery-card.tsx`).
  - **Enrichment Proxy Split (`src/app/api/enrichment/`)**: `GET` is public (`proxyPropertyApi`); `POST` (refresh) requires an operator session (`proxyPrivatePropertyApi`).
  - **Dated Auction Rollup Helper**: Always use `calendarDatedTotal(calendarRollup)` in `discovery-workbench.tsx` so `undatedCount` is never mislabeled as dated auctions.
  - **CRLF Edit Rule**: On Windows CRLF files, always use single-line `Target` strings in `edit_file` or `write_file` (`Overwrite: true`).
