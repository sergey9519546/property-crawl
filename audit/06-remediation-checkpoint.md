# AUDIT CHECKPOINT 06 — Autonomous Remediation & Capability Upgrades

> **Date**: 2026-10-08  
> **Status**: Verified & Stable  
> **Branch**: `main`  
> **Methodology**: Continuous Autonomous Verification Loop (`continuous-agent-loop` + `SPARC` rigor)  

---

## 1. Executive Summary & System Goals

The **property-crawl** system is an evidence-first discovery and triage engine for distressed and government-sold property (sheriff sales, trustee sales, HUD/REO, IRS/Treasury/GSA dispositions).

### Three-Layer Architecture
1. **v0 — Static PWA** (`index.html`, `app.js`): Legacy reference interface with client-side filters, local storage fallbacks, and score band visualization.
2. **v1 — Listing API & Scrapers** (`server/`): Node `http` daemon (`server/server.js`), REST endpoints, 163 catalog entries (`server/sources/catalog.js`), 16 seed sources (`data.js`), 21 scheduled adapters (`server/scrapers/scheduler.js`), security middleware (constant-time token comparison, SSRF protection, circuit breakers).
3. **v2 — Marketing & Operator UI** (`src/`): Next.js 16 App Router interface proxying to the listing API via `PROPERTY_API_URL`.

### Core Operational Truth Rules (Preserved Invariants)
- `closed` ≠ `sold` (status indicators must never be conflated with completed conveyance).
- `reserve_met` ≠ `completed_sale` (meeting reserve does not prove escrow settlement).
- `bidsPlaced` ≠ bid history (default schema values must not drive activity analytics).
- Truncated or failed collector sweeps preserve prior verified snapshots; unverified delisting claims are suppressed.
- Deal Score formula: `Math.round((1 - ratio) * 130)` clamped 1–99 across the canonical 4-tier `SCORE_BANDS` (`elite`, `strong`, `fair`, `thin`).
- All dynamic/AI strings pass through `esc()` / `mdToHtml()` (XSS invariant).

---

## 2. Quantitative Baseline vs. Final Verification Receipts

Every claim is backed by empirical test execution receipts:

| Test Suite | Command | Baseline Result | Final Result | Delta / Status |
|---|---|---|---|---|
| **Canonical Runtime** | `npm run test:canonical` | 47 / 47 pass | **47 / 47 pass** (0 fail) | Zero regressions |
| **E2E User Journey** | `npm run test:e2e` | 3 / 3 pass | **3 / 3 pass** (0 fail) | Verified |
| **Discovery Suite** | `npm run test:discovery` | 71 pass / 16 skip | **71 pass / 16 skip** (0 fail) | Stable (PG skips expected) |
| **Evidence Truth** | `npm run test:evidence-truth` | 543 / 543 pass | **543 / 543 pass** (0 fail) | Full parity |
| **Sources & Ingestion** | `npm run test:sources` | 570 pass / 5 fail | **575 / 575 pass** (0 fail) | **+5 tests passing (Fixed)** |
| **Intelligence Suite** | `npm run test:intelligence` | 616 pass / 1 fail | **617 / 617 pass** (0 fail) | **+1 test passing (Fixed)** |
| **AI Rules & Normalizer** | `npm run test:ai` | 119 / 119 pass | **119 / 119 pass** (0 fail) | Clean |
| **Fast Unit Suite** | `npm run test:unit` | 38 / 38 pass | **38 / 38 pass** (0 fail) | Clean |
| **Server & API Integration** | `node test/server.test.js` | 31 / 31 pass | **31 / 31 pass** (0 fail) | Clean |
| **Full Verify Suite** | `npm test` (`test/verify.js`) | 50 suites | **50 / 50 suites passed** (0 fail) | **1,300 tests pass, 18 PG skips** |
| **TypeScript / Typecheck** | `npm run typecheck` | Clean (0 err) | **Clean (0 errors)** | Clean |
| **Next.js Production Build** | `npm run build` | — | **52 / 52 static routes generated** | Clean Turbopack bundle |
| **Schema Mirror Check** | `npm run schema:check` | Identical | **15 migrations identical** | Verified |
| **Full Release Gate** | `npm run release:gate` | — | **9 / 9 gates passed** (exit 0) | Full build + 25-check E2E |
| **Proportional Gate** | `npm run verify:gate` | 6 / 6 pass | **6 / 6 pass** (exit 0) | Certified |

---

## 3. Discovered Defects, Forensic Root-Cause Analysis & Interventions

### D1. Route Collision Shadowing `/api/listings/compare` (P0)
- **File**: `server/server.js:185`
- **Root Cause**: `url.pathname.startsWith('/api/listings')` was evaluated before `url.pathname === '/api/listings/compare'`. Because the compare path matched the prefix, `handleListings` treated `"compare"` as a listing identifier and attempted `db.getListingById('compare')`, returning 400 or 404 instead of dispatching to `handlePropertyComparison`.
- **Fix**: Re-ordered the route evaluation table so `/api/listings/compare` is explicitly checked and dispatched before generic prefix matching.
- **Evidence**: `test/routes/property-comparison.test.js` passed 11/11 tests, and `test/server.test.js` passed 31/31 tests.

### D2. Test Isolation Failure in `listings-delta-sync.test.js` (P1)
- **File**: `test/listings-delta-sync.test.js`
- **Root Cause**: The test ran in standalone mode where `DATABASE_URL` was unset and `NODE_ENV` was undefined. `server/db/client.js` requires an explicit opt-in via `PROPERTY_INVENTORY_BACKEND='memory'` or `NODE_ENV='test'`. Without it, `inventoryUnavailableReason()` returned 503 ("No inventory is being served"), failing 4 out of 5 tests.
- **Fix**: Added `process.env.PROPERTY_INVENTORY_BACKEND = 'memory';` at the top of the test suite before importing any server modules.
- **Evidence**: `test/listings-delta-sync.test.js` now passes 5/5 tests (exit 0), and full `npm run test:sources` passes 575/575 tests.

### D3. Score Bands Taxonomy Drift in Legacy PWA Surface (P2)
- **File**: `app.js:107-114`
- **Root Cause**: `app.js` contained a legacy 3-tier array (`Strong`, `Moderate`, `Thin`) with different thresholds and colors, drifting from the canonical 4-tier model (`Elite`, `Strong`, `Fair`, `Thin`) defined in `server/intelligence/score-bands.js` and `src/lib/score-bands.ts`.
- **Fix**: Aligned `app.js` `SCORE_BANDS` with the canonical 4 tiers:
  - `Elite` (70–99, `#059669`, alpha `18`)
  - `Strong` (55–69, `#16a34a`, alpha `15`)
  - `Fair` (35–54, `#d97706`, alpha `14`)
  - `Thin` (1–34, `#dc2626`, alpha `12`)
- **Evidence**: Modal and card rendering matches canonical score band semantics; `test/suite.test.js` passed 38/38.

### D4. Puter Runtime Crash & Offline Fragility in `app.js` (P2)
- **File**: `app.js:128-210, 600-640`
- **Root Cause**: Direct references to global `puter.auth`, `puter.kv`, and `puter.ai` threw `ReferenceError` when offline, when third-party scripts were blocked by Content Security Policy, or when Puter failed to load.
- **Fix**: Added protective `typeof puter !== 'undefined'` guards across `loadSaved()`, `persistSaved()`, `initAuth()`, `renderAuth()`, `runAnalysis()`, and `runParse()`. Storage seamlessly falls back to `localStorage` when Puter is absent.
- **Evidence**: Standalone browser and Node execution load `app.js` without runtime errors; `test/production-boot.test.js` and `test/e2e.test.js` pass.

### D5. Debunked Hypothesis: Removal of `INITIAL_LISTINGS`
- **Context**: A preliminary survey proposed removing `INITIAL_LISTINGS` from `src/components/terminal/property-data.ts` under the assumption that it was dead mock code.
- **Audit Findings**:
  - `test/sync.test.js` specifically asserts that `INITIAL_LISTINGS` exists in `property-data.ts` and contains at least 3 curated demo listings.
  - `test/suite.test.js` ensures that active runtime UI components do *not* use `INITIAL_LISTINGS` in live state (`useState(INITIAL_LISTINGS)`).
  - Removing it would have broken `test/sync.test.js`.
- **Decision**: Preserved `INITIAL_LISTINGS` in `property-data.ts` as a tested design reference while ensuring all user-facing pages load dynamic inventory from the API.

### D6. Architectural Honesty in API Proxy Reachability
- **Context**: A preliminary proposal suggested adding Next.js proxy handlers for `/api/coverage`, `/api/portfolio/dashboard`, and `/api/price-drops`.
- **Audit Findings**:
  - `test/api-reachability.test.js` intentionally maintains a pinned `KNOWN_BROWSER_UNREACHABLE` set for endpoints that are served by the backend but have no caller in the UI.
  - Exposing them in the proxy without a caller creates the illusion of wired functionality while failing the reachability contract.
- **Decision**: Reverted speculative proxy additions, maintaining 100% agreement between declared reachability and tested reality (7/7 passing in `test/api-reachability.test.js`).

### D7. Research Workspace Test Isolation Under Lifecycle Scripts (P1)
- **File**: `test/research-workspace.test.js:255-278`
- **Root Cause**: When run under lifecycle scripts (`npm run test:intelligence`), `process.env.npm_lifecycle_event` triggers `testMode = true` inside `DatabaseClient`, leaving `liveCachePath` null. `test/research-workspace.test.js` expected at least one listing with `provenance.origin === 'live'`, which caused an `AssertionError: test inventory needs one validated source-observed record`.
- **Fix**: In `test/research-workspace.test.js`, check if `observed` is present in memory; if absent due to lifecycle test mode, insert a validated live source-observed record using `database.createListing(listing())`, verify it in the test, and splice it out during `t.after` cleanup.
- **Evidence**: `npm run test:intelligence` now achieves 100% pass rate: **617 / 617 passed** (exit 0). Standalone `node --test test/research-workspace.test.js` also passes 9/9.

### D8. Child Process Shell Injection Risk & Deprecation Remediation (P2)
- **Files**: `test/module-load-gate-fails-closed.test.js:42`, `test/verify-gate-reports-git-failure.test.js:38`
- **Root Cause**: `spawnSync('git', ['--version'], { cwd: ROOT, shell: true })` invoked shell execution with concatenated arguments, triggering `[DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities`.
- **Fix**: Replaced `shell: true` with `shell: false`, passing argument arrays directly to the executable without shell wrapping.
- **Evidence**: Warning eliminated completely; both test suites execute cleanly and pass 12/12 tests.

### D9. End-to-End Operator Browser Journey & Security Alignment (PP-03) (P1)
- **Files**: `scripts/record-workspace-walkthrough.py`, `src/components/workspace/workspace-shell.tsx`, `server/discovery/query.js`
- **Root Causes**:
  1. Accessibility label in `workspace-shell.tsx` used a single text form that drifted between visual text and Playwright accessible role locators.
  2. In `server/discovery/query.js`, listing search filters did not match on `row.id`, causing exact-ID searches to return empty results.
  3. Playwright's `context.request.post()` is an out-of-browser HTTP client that omitted the `Origin` header by default, triggering Next.js 403 `Same-origin workspace request required` from `workspaceMutationAllowed()`.
- **Fixes**:
  1. Updated `workspace-shell.tsx` to `<label htmlFor="workspace-credential" className="text-xs font-semibold">Operator key <span className="sr-only">(Workspace access key)</span></label>`, satisfying accessible names and screen readers.
  2. Added `row.id` to in-memory `matches()` and `coalesce(id, '')` in SQL query matching in `server/discovery/query.js`.
  3. Created `api_post()` helper in `record-workspace-walkthrough.py` injecting `Origin: BASE_URL`, `Content-Type: application/json`, and `x-workspace-request: 1`.
  4. Expanded journey to cover document review queue UI approval (`/workspace/documents-review`), saved hunts natural language criteria drafting (`/hunts`), watchlist toggling on `/listings`, keyboard autofocus & Escape modal focus traps, and mobile responsive passes (390x844) across 5 routes with CLS budget validation.
- **Evidence**: `npm run workspace:walkthrough` (`python scripts/record-workspace-walkthrough.py`) executed cleanly in 15.3s:
  - `completed: true`
  - `caseId: rcase_26e2a11c05528744e557dd5b`
  - `evidenceIntakeId: intake_bfa1fd5e01f4343af66a17a7`
  - `packetSurvivesRestart: true`
  - `privateAccessAndDeduplication: true`
  - `documentReviewJourney: true`
  - `savedHuntsJourney: true`
  - `watchlistJourney: true`
  - `keyboardA11y: true`
  - `clsScores`: `activity: 0.0005`, `research/alachua: 0.0114`, `listings: 0.1596`, `hunts: 0.0044`, `workspace/documents-review: 0.1577` (all < 0.25 budget)
  - `video`: `workspace-walkthrough.webm` created.

### D10. Research Case Action A11y & Session Expiration Recovery (P2)
- **File**: `src/components/research/case-action.tsx`
- **Root Cause**:
  1. When a user's workspace session expired and returned 401 on `/api/workspace/cases`, `CaseAction` threw a generic error without triggering `session.requestUnlock()`, leaving the operator stranded without an unlock modal prompt (unlike `save-search-button.tsx`).
  2. The button lacked `aria-busy={busy}`, `aria-hidden="true"` on the spinner/icon, and `aria-live="polite"` on the status label ("Opening…"), leaving screen readers unaware of async case opening.
- **Fix**:
  1. Added 401 interception in `openCase()` that triggers `session.requestUnlock()` with clear session expiry feedback.
  2. Added `aria-busy={busy}`, `aria-hidden="true"` on SVG icons, and `aria-live="polite"` wrapping the button text.
- **Evidence**: `npm run typecheck` passes with zero errors; full release gate passes 9/9 with `production-e2e` and `test/document-review-queue-ui.test.js`.

### D11. Super-Priority HOA Assessment Lien Arbitration & Statutory Notice (P1)
- **File**: `server/ai/legal-rules.js:150-235`, `server/scrapers/normalization.js:227`
- **Root Cause**: HOA and condo association assessment liens were previously labeled as generic junior liens, ignoring that ~20 jurisdictions (NV N.R.S. § 116.3116, CO C.R.S. § 38-33.3-316, WA, MA, CT, FL, NJ, PA, etc.) grant 6-to-9 months of assessments statutory super-priority over first mortgages.
- **Fix**:
  1. Defined `SUPER_PRIORITY_HOA_STATES` set and exported it from `legal-rules.js`.
  2. Enhanced `detectSeniorLienSurvival(plaintiff, legalText, state)` to parse `hasHoaLien` and output jurisdiction-specific warnings citing super-priority statutes.
  3. Passed `state` from `standardizeListingRecord` into `detectSeniorLienSurvival`.
- **Evidence**: `node --test test/legal-rules-truth.test.js` passed 9/9 tests including new super-priority verification.

### D12. 26 U.S.C. § 7425(d) Federal Tax Lien 120-Day Redemption Overlay (P1)
- **File**: `server/ai/legal-rules.js`, `server/scrapers/normalization.js`
- **Root Cause**: Non-judicial foreclosure states (such as CA with 0-day state statutory redemption) did not account for federal tax lien survival when the IRS was a junior lienholder, leaving purchasers unaware of the 120-day federal redemption right.
- **Fix**: Wired `hasFederalTaxLien` detection into `getRedemptionRule` so that federal overlay enforces a 120-day minimum cloud regardless of state-level 0-day baselines.
- **Evidence**: Verified in `test/legal-rules-truth.test.js` (`federal tax lien triggers 26 U.S.C. § 7425(d) 120-day redemption overlay`).

### D13. Next.js 16 Proxy Convention & CSP Conformance (P1)
- **File**: `src/proxy.ts`
- **Root Cause**: Next.js 16 officially deprecated `middleware.ts` in favor of `proxy.ts` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). `src/proxy.ts` required both named and default export compatibility for complete runtime conformance.
- **Fix**: Exported both named `export function proxy` and `export default proxy;` to satisfy all Next.js 16 bundler resolution paths.
- **Evidence**: `node scripts/release-gate.js` passes all 9 gates including `next-build` and `production-e2e`.

### D14. Accessible Pagination & Decision Dossier Export (P2)
- **File**: `src/components/listings/discovery-workbench.tsx:810-828`, `src/components/research/research-case.tsx:151`
- **Root Cause**: Pagination buttons and decision packet export buttons lacked explicit `type="button"` and `aria-label` attributes, creating ambiguous screen-reader announcements.
- **Fix**: Added explicit `type="button"` and semantic `aria-label`s ("Previous page", "Next page", "Download JSON decision packet", "Download print-ready decision report").
- **Evidence**: `npm run typecheck` clean; Playwright accessibility runs clean.

### D15. Standalone Execution Isolation for PropertyTitle Tests (P2)
- **File**: `test/property-title.test.js:105`
- **Root Cause**: `test/property-title.test.js` contained a live API integration suite attempting to connect to api.market that failed without live credentials when invoked directly with `node --test`.
- **Fix**: Added `hasLiveApiKey` skip guard so live calls only execute when `RUN_LIVE_PROPERTY_TITLE_TESTS` or real credentials are provided, allowing unit underwriting assertions to pass 100% standalone.
- **Evidence**: `node --test test/property-title.test.js` passes 5/5 unit assertions with live suite skipped.

---

## 4. Verification Gate & Operational Integrity Receipts

### Release Gate Execution (PP-02)
```
========================================================================
PP-02 RELEASE GATE
tree    : eda816ef9d870a6c4d937933d249e9ccbba1da29
PASS  typecheck             3104ms  tsc --noEmit
PASS  generated-context      161ms  CONTEXT.md current
PASS  schema-mirrors          54ms  src/lib/db mirrors byte-identical
PASS  test-wiring            123ms  every test file reachable from a runner
PASS  ops-suites            5734ms  meta/wiring/contract suites
PASS  scraper-parser        6280ms  Scrapling parser on the pinned runtime
PASS  production-smoke       503ms  boot contract + guards without booting
PASS  next-build            8887ms  production bundle
PASS  production-e2e       29738ms  full stack, 25 checks, isolated embedded database
------------------------------------------------------------------------
PP-02: 9/9 gates passed against eda816ef9d87
ledger: reports/release-gate-ledger.json
```

### Proportional Verification Gate
```
=== COMPLETION GATE ===
Change type: agent
Gate: agent-system acceptance + drift gates
Files changed: 64
Suites run: 6
All passed: true

Evidence:
  node --test test/agent-system.test.js: PASS (exit 0, 1712ms)
  node --test test/commands.test.js: PASS (exit 0, 111ms)
  node --test test/agents.test.js: PASS (exit 0, 119ms)
  node --test test/capability-graph.test.js: PASS (exit 0, 109ms)
  node scripts/gen-skills-index.js --check: PASS (exit 0, 61ms)
  node scripts/gen-context.js --check: PASS (exit 0, 149ms)
=== END COMPLETION GATE ===
```

### Remaining Open Residuals (Tracked in `docs/COMPLETION_CHECKLIST.md`)
1. **PP-03 Real Isolated PostgreSQL Server**: 18 discovery acceptance tests skip cleanly in demo memory / embedded mode until a multi-connection PostgreSQL instance is provisioned (`DISCOVERY_TEST_DATABASE_URL`).
2. **PP-04 External Operator Secrets & Hosted HTTPS CSP Proof**: Requires cloud deployment environment (Fly/Koyeb dashboard secrets and public DNS).
3. **PP-05 Release Ledger Commit**: Clean source-bound commit to be applied by operator.

---

*Checkpoint compiled and certified.*
