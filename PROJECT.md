# Project: property-crawl Autonomous Remediation & Capability Upgrade

## Architecture
- **v0 Static PWA** (`index.html`, `app.js`): Legacy browser interface, localStorage / cache fallbacks, 4-tier score band display.
- **v1 Listing API & Scrapers** (`server/`): Plain Node HTTP daemon (`server/server.js`), REST endpoints, 16 seed sources, 163 catalog entries (`server/sources/catalog.js`), 21 scheduled adapters (`server/scrapers/scheduler.js`), security middleware (constant-time token comparison, SSRF protection, circuit breakers).
- **v2 Next.js 16 App Router UI** (`src/`): Canonical marketing & operator workspace, server-side proxying to Node API via `PROPERTY_API_URL` (`src/app/api/`), terminal components.
- **Persistence Layer** (`server/db/`): Dual provider (in-memory demo fallback when `DATABASE_URL` unset, PostGIS client with 15 schema migrations and camelCase/snake_case aliasing).
- **Triage & Deal Score Engine** (`server/intelligence/score-bands.js`, `signals.js`): Mathematical formula `Math.round((1 - ratio) * 130)` clamped 1–99, 4 frozen bands (`elite`, `strong`, `fair`, `thin`), composite 6-signal triage priority.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Baseline Test Verification | Measure numerical baselines across canonical, discovery, e2e, truth, and gate | M0 (Done) | Survey |
| 2 | Compare Route Unshadowing | Fix `/api/listings/compare` route collision in `server/server.js:185` | M1 (Done) | Arch Survey (P0) |
| 3 | Next.js API Proxy Coverage | Maintain verified reachability contract without phantom routes | M1 (Done) | Arch Survey (P1) |
| 4 | Delta Sync Test Isolation | Configure `PROPERTY_INVENTORY_BACKEND=memory` in `listings-delta-sync.test.js` | M2 (Done) | Baseline Survey (P1) |
| 5 | Research Workspace Test Isolation | Ensure live cache fixture or isolation under `test:intelligence` lifecycle | M2 (Done) | Baseline Survey (P1) |
| 6 | PWA Puter Zombie Remediation | Guard global `puter` calls in `app.js` with graceful local storage fallback | M3 (Done) | Arch Survey (P1) |
| 7 | Dead Mock Dataset Removal | Audited `INITIAL_LISTINGS` in `src/components/terminal/property-data.ts` (pinned in `test/sync.test.js`) | M3 (Done) | Arch Survey (P2) |
| 8 | Score Bands Taxonomy Parity | Align `app.js` tier display with canonical 4-tier `SCORE_BANDS` | M3 (Done) | Arch Survey (P2) |
| 9 | Child Process Shell Remediation | Eliminate `shell: true` and DEP0190 warning in gate tests | M3 (Done) | Security Audit (P2) |
| 10 | Zero-Regression Verification Gate | Pass 50/50 test suites, 9/9 full release gate, and `npm run verify:gate` | M4 (Done) | R2, R3 |
| 11 | Structured Audit Checkpoint Report | Write final checkpoint report to `audit/06-remediation-checkpoint.md` | M4 (Done) | AC Checkpoint |
| 12 | End-to-End Operator Journey Suite (PP-03) | Operator unlock, discovery, case, pass, intake, Second Look, export, doc review, hunts, watchlist, a11y, mobile CLS | M5 (Done) | Walkthrough Suite |
| 13 | Case Action Accessibility & 401 Expiry Auto-Prompt | Added `aria-busy`, `aria-live`, `aria-hidden` icons, and 401 session expiry `session.requestUnlock()` trigger in `case-action.tsx` | M5 (Done) | UI & Security Audit |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Survey & Baselines | Initial survey, test execution, defect inventory | none | DONE |
| M1 | Routing & Proxy Parity | Fix compare route shadowing & maintain verified reachability | M0 | DONE |
| M2 | Test Suite Reliability | Fix `test:sources` delta-sync & `test:intelligence` workspace test isolation | M0 | DONE |
| M3 | Client Resilience & Mock Purge | Hardened Puter safety, aligned 4-tier score bands, child process security | M1 | DONE |
| M4 | Gate & Final Checkpoint | Verify zero regressions, run full release gate, deliver checkpoint report | M1, M2, M3 | DONE |
| M5 | Acceptance Walkthrough Suite | PP-03 operator journey verified end-to-end with 0 errors in 15.3s | M4 | DONE |

## Interface Contracts
### `server/server.js` ↔ `server/routes/listings.js`
- Route: `/api/listings/compare` MUST be evaluated BEFORE prefix `/api/listings` match.
- Query parameters: `?ids=id1,id2,id3` -> returns `{ success: true, count: N, listings: [...] }`.
- Error handling: Returns HTTP 400 when missing `ids`, HTTP 404 when no matching listings found.

### `src/lib/property-api.ts` ↔ `server/server.js`
- `KNOWN_BROWSER_UNREACHABLE`: Preserved agreement with backend endpoints that intentionally have no active UI caller.
- Proxy handlers in `src/app/api/`: forwards requests to `PROPERTY_API_URL` preserving query params and returning JSON.

### `server/db/client.js` ↔ Test Suites
- Test environment detection: tests requiring memory inventory specify `PROPERTY_INVENTORY_BACKEND = 'memory'`.
- Research workspace tests: provides a validated source-observed record or sets test cache path with automatic cleanup.

## Code Layout
- `server/server.js` — HTTP entry point & routing table
- `server/routes/` — Route handlers (`listings.js`, `scrapers.js`, etc.)
- `server/db/` — DB client, in-memory provider, Postgres migrations
- `server/intelligence/` — Deal score bands & signals
- `server/sources/` — Source catalog & tier taxonomy
- `src/app/api/` — Next.js proxy route handlers
- `src/lib/` — API helpers, session auth, CSP
- `src/components/` — Next.js UI components
- `app.js` — v0 static PWA client script
- `test/` — Node.js test suites
- `audit/` — Audit logs and checkpoint records
