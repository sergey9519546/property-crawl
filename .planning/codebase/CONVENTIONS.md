# Testing, Quality & Verification Conventions

> **Project:** `property-crawl` (Version 2.0.0)  
> **Auditor:** Quality, TDD & Verification Auditor  
> **Scope:** Full test directory (`test/`), release gates (`scripts/release-gate.js`), completion gates (`scripts/verify-gate.js`), CI coverage architecture (`scripts/verify-test-coverage.js`), quality reporting (`scripts/quality-gate-report.js`), and test suites.  
> **Status:** 7/7 Quick Release Gates PASS | 442 Total Test Files (437 JS/MJS, 5 Python) | Zero Unwired Test Files | Zero Vacuous Tests.

---

## 1. Executive Summary

The `property-crawl` codebase implements an **evidence-first, defense-in-depth verification architecture** engineered specifically to prevent silent regressions, false all-clears, and orphaned tests. Rather than relying on heavyweight external third-party test runners (such as Jest, Mocha, or Vitest), the repository standardizes on:

1. **Native Node.js Test Runner (`node:test`, `node:assert/strict`)**: Node 22+ built-in test runner executing both CommonJS (`.test.js`) and modern ESM/TypeScript (`.test.mjs`, run via `node --experimental-strip-types --test`).
2. **Python Playwright (`unittest` + `playwright.sync_api`)**: Canonical full-stack browser automation and UI journey tests running against isolated production Next.js builds and isolated listing API servers.
3. **Source-Bound Release Gates (PP-02)**: Strict release validation (`scripts/release-gate.js`) pinning the exact Git commit SHA and verifying tree cleanliness before emitting release ledgers.
4. **Proportional Completion Gates (`scripts/verify-gate.js`)**: Dynamic change detection across `git diff HEAD`, `git diff --cached`, and `git ls-files --others` (untracked files) to run proportional test tiers while failing closed on any Git failure.
5. **Self-Healing CI Coverage (`scripts/verify-test-coverage.js`)**: Two-hop token resolution preventing test-suite drift by finding every test file in `test/` not reached by `test/verify.js` and executing them dynamically in Suite 31.

---

## 2. Inventory of Test Suites

The repository contains **442 total test files**:
- **437 JavaScript/ECMAScript files** (`.test.js`, `.test.mjs`, `.test.cjs`).
- **5 Python test suites** (`.py`) for Playwright browser automation and Scrapling runtime extraction.

### Categorized Suite Inventory

| Category | Primary Test Files | Framework / Runner | Purpose & Invariants |
|---|---|---|---|
| **Client Unit & Domain Formulas** | `test/suite.test.js`, `test/signals.test.js`, `test/score-bands.test.mjs`, `test/terminal-filter-store.test.mjs`, `test/triage-bands.test.mjs` | Custom `test(name, fn)` + `node:test` | Deal score mathematics (1–99 clamp, worked Columbus OH 77 example), PWA manifest integrity, countdown date normalization, filter stores. |
| **Server API & Routing** | `test/server.test.js`, `test/property-api.test.mjs`, `test/property-api-proxy-inventory.test.js`, `test/routes/*.test.js`, `test/list-response-payload.test.mjs` | `node:test` + `node:assert/strict` | REST API routes (`/api/listings`, `/api/health`, `/api/sources`), proxy inventory routing, pagination, error schemas, route contracts. |
| **Security & Hardening** | `test/hardening.test.js`, `test/cors-policy.test.js`, `test/api-rate-policy.test.js`, `test/content-security-policy.test.js`, `test/fetch-strategy-ssrf.test.js`, `test/rate_limiter_security.test.js` | `node:test` | SSRF prevention, strict CSP nonces, CORS policies, rate limiting (HTTP 429), path traversal defense, RBAC role gating. |
| **Data Scrapers & Tooling** | `test/scrapers.test.js`, `test/scraper-reliability.test.js`, `test/civilview.test.js`, `test/irs-scraper.test.js`, `test/scrapers/*.test.js`, `test/scrapling-bridge.test.js`, `test/scrapling_parser_test.py` | `node:test` + Python `unittest` | 50+ government and distress data scrapers, auto-throttle, circuit breakers, selector drift alarms, and Scrapling engine pinning. |
| **Sources & Ingestion Pipeline** | `test/source-catalog.test.js`, `test/source-network.test.js`, `test/source-intake.test.js`, `test/email-ingest.test.js`, `test/sources/*.test.js` | `node:test` | Catalog source classification (`DISCOVERY_ONLY` vs live listings), IMAP / email notices ingestion, statutory distress taxonomy. |
| **Database & Schema Integrity** | `test/db.test.js`, `test/db/*.test.js`, `scripts/sync-schema-mirror.js`, `test/schema-mirror-contract.test.js` | `node:test` (concurrency=1 for migrations) | SQLite/PostgreSQL schema parity, migration ledger drift resilience, byte-identical `src/lib/db/schema.sql` mirrors, non-destructive import. |
| **Discovery Engine & Hunts** | `test/discovery-backend.test.js`, `test/discovery-acceptance*.test.js`, `test/discovery/*.test.js`, `test/hunts*.test.js` | `node:test` | Multi-source hunt queries, lease-loss fencing, worker soak resilience, snapshot compactor, evidence ledger. |
| **Intelligence & Underwriting** | `test/property-intelligence.test.js`, `test/underwriting-truth.test.mjs`, `test/intelligence/*.test.js`, `test/fhfa_hpi_valuation.test.js` | `node:test` + ESM | Property valuation models, HOA & bankruptcy forensics, title risk engine, municipal code enforcement, post-sale possession risk. |
| **Adversary, Swarm & Agents** | `test/adversary.test.js`, `test/challenger-m1-adversary.test.mjs`, `test/agent-system.test.js`, `test/swarm.test.js`, `test/capability-graph.test.js` | `node:test` + scenario runners | Scenarios 1–10 adversarial test harness, DAG orchestrator, capability routing, Chief of Staff agent delegation guards. |
| **Playwright UI & E2E Journeys** | `test/run-ui-suite.js`, `test/next_ui_e2e_test.py`, `test/detail_media_recovery_e2e_test.py`, `scripts/run-production-e2e.js`, `scripts/e2e-user-workflow.js` | Python `playwright` + Node HTTP | 57 browser journeys in `next_ui_e2e_test.py`, production Next.js server boot (`next start`), MapLibre interaction, keyboard accessibility. |
| **Meta Guards & Test Wiring** | `test/test-wiring.test.js`, `test/no-vacuous-tests.test.js`, `test/ci-test-coverage.test.js`, `test/gen-context-route-drift.test.js`, `scripts/verify-test-coverage.js` | `node:test` | Meta-auditing tests ensuring all test files are wired, have real assertions, have documented exemptions, and prevent documentation drift. |

---

## 3. Test Execution Architecture & Quality Gates

The project organizes verification into distinct, hierarchical execution gates:

```
+--------------------------------------------------------------------------------+
|                         scripts/release-gate.js (PP-02)                        |
| Tree SHA Pinned | Clean Working Tree Required | Emits reports/release-gate-ledger.json |
+--------------------------------------------------------------------------------+
     |
     +--> 1. Typecheck: tsc --noEmit -p tsconfig.json
     +--> 2. Generated Context: scripts/gen-context.js --check
     +--> 3. Schema Mirrors: scripts/sync-schema-mirror.js --check
     +--> 4. Test Wiring: node --test test/test-wiring.test.js
     +--> 5. Ops Suites: node --test (17 contract, storage & drift test suites)
     +--> 6. Scraper Parser: scripts/run-scrapling-parser-tests.js
     +--> 7. Production Smoke: scripts/production-smoke.js
     +--> 8. Next Build (slow): next build (.next-verify distDir)
     +--> 9. Production E2E (slow): scripts/run-production-e2e.js (25 checks)
```

### Proportional Verification Gate (`scripts/verify-gate.js`)

Designed for fast inner loops and automated CI hooks, `verify-gate.js` inspects Git diffs across three vectors (`git diff HEAD`, `git diff --cached`, `git ls-files --others`):

| Classification | Trigger Conditions | Executed Suite | Maximum Timeout |
|---|---|---|---|
| `trivial` | Markdown docs, comments, or zero non-test changes | `node test/suite.test.js` | 5,000 ms |
| `scraper` | Changes in `server/scrapers/`, `server/ai/`, or `test/scrapers` | Module load + scrapers + unit + telemetry + payload parity | 60,000 ms |
| `schema` | Changes in `data.js`, `schema.sql`, `server/db/`, `CONTEXT.md`, `package.json` | `sync.test.js` + `context.test.js` + `db.test.js` | 15,000 ms |
| `runtime` | Changes in `server/`, `src/`, `index.html`, `app.js`, `Dockerfile*`, build scripts | Module load + server + unit + hardening + payload parity | 60,000 ms |
| `agent` | Changes in `.kilo/`, `.agents/`, `memory/`, `scripts/skill-*`, `capability-graph` | Agent system acceptance + commands + agents config + graph | 30,000 ms |
| `full` | Fallback on Git failure or explicit `--change-type full` | Complete `node test/verify.js` (31 suites) | 1,800,000 ms |

### Complete Verification Loop (`test/verify.js`)

`test/verify.js` runs **31 discrete suites** covering unit, contract, API, scraper, Playwright UI, adversary, and swarm tests. Suite 31 (`node scripts/verify-test-coverage.js`) dynamically analyzes any test file not reached by Suites 1–30 and executes all remaining runnable JS tests in a single pass.

---

## 4. Test Commands Reference

All test commands are defined in `package.json`. Core commands include:

```bash
# -------------------------------------------------------------
# Primary Verification & Release Gates
# -------------------------------------------------------------
npm test                           # Complete 31-suite verification loop (test/verify.js)
npm run release:gate               # Full 9-gate source-bound release gate (PP-02)
npm run release:gate:quick         # Fast 7-gate release gate (skips next-build and e2e)
npm run verify:gate                # Auto-detects changed files & runs proportional suite
npm run quality:report             # Runs non-PG suites and classifies env failures

# -------------------------------------------------------------
# Static Typing & Code Quality
# -------------------------------------------------------------
npm run lint                       # TypeScript type checking (tsc --noEmit -p tsconfig.json)
npm run typecheck                  # Alias for strict tsc check
npm run schema:check               # Verifies DB schema mirror parity
npm run context:gen                # Regenerates CONTEXT.md with SHA256 digest

# -------------------------------------------------------------
# Domain-Specific Test Suites
# -------------------------------------------------------------
npm run test:unit                  # Client formulas, deal score, PWA metadata (suite.test.js)
npm run test:server                # Backend Express REST API routes & contracts
npm run test:db                    # SQLite/PostgreSQL schema, migrations, listings lifecycle
npm run test:scrapers              # Live & mock scraper pipeline and error handling
npm run test:sources               # Source catalog, network intake, email ingestion
npm run test:intelligence          # Valuation, deal scoring, search alerts, comparisons
npm run test:discovery             # Discovery backend, acceptance, evidence store
npm run test:discovery:operations  # Worker lease fences, soak, run reports, health
npm run test:ai                    # AI notice parsers, bidding simulator, cost tracker
npm run test:adversary             # Adversarial challenger scenarios 1-10
npm run test:meta-guards           # Meta-audits (wiring, vacuous tests, drift, honesty)

# -------------------------------------------------------------
# Playwright & Browser E2E
# -------------------------------------------------------------
npm run test:production-e2e        # Boots production stack & runs 25-point workflow check
npm run test:ui:e2e                # Python Playwright canonical UI suite (57 journeys)
npm run test:ui:discovery          # Python Playwright discovery workbench UI regression
npm run test:scrapling-parser      # Scrapling parser test under pinned Python runtime
```

---

## 5. Skipped Tests & Environment Gating

### The "No Undeclared Fallback" & "No Silent All-Clear" Rules

In earlier iterations of the codebase, two critical failure shapes were identified:
1. **The undeclared in-memory fallback**: Code silently fell back to an in-memory test double when PostgreSQL was missing, allowing tests requiring PostgreSQL to falsely pass without verifying persistence.
2. **The silent skip all-clear**: Tests requiring PostgreSQL exited with status 0 when skipped. A test summary reporting "50/50 suites passed" concealed that 15+ database tests were skipped entirely.

### Environmental Skip Mechanism

Suites that interact with external services or PostgreSQL adhere to strict, explicit skip conventions:

```javascript
// Example from test/discovery-acceptance.test.js:
const databaseUrl = process.env.DISCOVERY_TEST_DATABASE_URL
  || process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL;

test('migrations expose PostGIS and every durable discovery table', {
  skip: !databaseUrl
}, async () => {
  // Test body only executes when real databaseUrl is present
});
```

### Environment-Gated Suites and Guard Variables

| Test Suite / File | Required Environment Variable | Fallback Behavior when Unset |
|---|---|---|
| `test/discovery-acceptance*.test.js` | `DISCOVERY_TEST_DATABASE_URL` or `DATABASE_URL` | Clean skip via `{ skip: !databaseUrl }`. |
| `test/discovery-job-fence.test.js` | `DISCOVERY_TEST_DATABASE_URL` or `DATABASE_URL` | Clean skip via `{ skip: !configured }` (pinned by `discovery-operations-pg-gating.test.js`). |
| `test/discovery-promotion-evidence.test.js` | `DISCOVERY_TEST_DATABASE_URL` or `DATABASE_URL` | Clean skip via `{ skip: !configured }`. |
| `test/hunt-store-pg-concurrency.test.js` | `DATABASE_URL` | Clean skip via `{ skip: !databaseUrl }`. |
| `test/property-title.test.js` | Live API credentials | Documented exemption in `ALLOW_UNWIRED` and `NOT_RUNNABLE_HERE`. |
| `test/test-landbanksearch.js` | External network / credentials | Documented manual scratch script in `NOT_RUNNABLE_HERE`. |

### Summary Verification & Skip Reporting

`scripts/verify-summary.js` parses the `skipped N` output from the Node test runner and forces `test/verify.js` to surface every skipped test in the final output:
```
NOTE: 16 test(s) were SKIPPED and did not execute. A skipped test is not a passing test.
  skipped: 3i. Discovery backend (16)
```

---

## 6. Code Quality, Linting & Design Tooling

### TypeScript Compiler as Strict Linter

The project relies on strict TypeScript type checking (`npm run lint` / `npm run typecheck` invoking `tsc --noEmit -p tsconfig.json`) rather than loose AST linting:
- **`target`**: `ES2022`
- **`strict`**: `true`
- **`moduleResolution`**: `bundler`
- **`paths`**: Path aliases configured for `@/*` (`src/*`) and `@server/*` (`server/*`).
- **`exclude`**: `node_modules`, `audit`, `scratch`, `server`.

### Impeccable Design Quality Engine

The repository integrates **Impeccable** (`.impeccable/`), an automated design audit and critique harness:
- **`config.json`**: Configures detector rules, file exclusions (`src/components/terminal/property-data.ts`), and typography/layout rules.
- **`.impeccable/critique/`**: Stores timestamped design audits evaluating typography, responsive layouts, color contrast, and component spacing against the design tokens.
- **`.impeccable/live/`**: Tracks active design critique sessions and visual annotations.

### Integrity & Drift Automation

- **`scripts/gen-context.js`**: Recomputes `CONTEXT.md` containing a SHA256 digest of core domain sources (`data.js`, server routes, `package.json`). Guarded by `test/context.test.js`.
- **`scripts/sync-schema-mirror.js`**: Asserts byte-identical parity between `server/db/schema.sql` and `src/lib/db/schema.sql`. Guarded by release-gate and `test/schema-mirror-contract.test.js`.
- **`scripts/crawler-toolchain-doctor.cjs`**: Verifies crawler dependencies, virtualenvs, and Playwright browsers.

---

## 7. Testing Conventions & TDD Standards

1. **Test File Naming & Organization**:
   - Unit & Integration: `test/<domain>.test.js` or `test/<subsystem>/<domain>.test.js`.
   - TypeScript / ESM: `test/<domain>.test.mjs` (executed with `--experimental-strip-types`).
   - Browser & UI: `test/<domain>_e2e_test.py` or `test/<domain>_ui_*.py`.
2. **Assertion Standards**:
   - Always use `const assert = require('node:assert/strict')` or `import assert from 'node:assert/strict'`.
   - Every test must make concrete assertions. `test/no-vacuous-tests.test.js` audits the entire tree to fail on any test missing recognized assertion patterns (`assert.*`, `expect()`, `should`).
3. **Explicit Test Doubles**:
   - Tests using in-memory data must explicitly set `process.env.PROPERTY_INVENTORY_BACKEND = 'memory'`. Unspecified backends are rejected.
4. **Isolated Production Verification**:
   - UI tests run against production Next.js builds (`next start`) with `.next-verify` distDir, never `next dev`. This prevents transient route recompilation 503s during testing.
5. **No Tree Pollution**:
   - Next.js builds rewrite `next-env.d.ts`. Test runners (`test/verify.js`, `test/run-ui-suite.js`, `scripts/release-gate.js`) snapshot `next-env.d.ts` before the build and restore it immediately after, ensuring the working tree remains source-bound.

---

## 8. Documented Failure Modes & Historical Traps

| Historical Trap | Root Cause | Implemented Guard & Permanent Fix |
|---|---|---|
| **91 Orphaned Test Files** | Test files added to `test/` without being referenced by any `package.json` script. Tests never executed, so they could never fail. | `test/test-wiring.test.js` enforces that every single test file is referenced in `package.json` or explicitly justified in `ALLOW_UNWIRED`. |
| **73 Invisible CI Tests** | Tests wired to `npm run test:*` but omitted from `test/verify.js` were never executed in CI. | `scripts/verify-test-coverage.js` parses reachable test tokens via two hops and dynamically runs all remaining JS test files in Suite 31. |
| **Vacuous Tests** | Tests written with mock setups but zero assertion calls. They passed on any code change. | `test/no-vacuous-tests.test.js` scans all test files for assertion patterns, failing if any test file contains zero assertions. |
| **Git Failure Blind Spot** | `verify-gate.js` caught Git errors and returned empty file lists, classifying the change as `trivial` and reporting PASS without running real tests. | `discoverChangeType()` fails closed to the `full` 31-suite gate on any Git error. Also incorporates untracked files (`git ls-files --others`). |
| **Stale UI Bundle Reuse** | `test/run-ui-suite.js` reused old `.next-verify` bundles if `BUILD_ID` existed, testing outdated source code. | `bundleIsStale()` compares directory mtimes under `src/` against `BUILD_ID` to force automatic rebuilds when sources change. |
| **`next-env.d.ts` Dirtying Tree** | `next build` modifies `next-env.d.ts`, dirtying the Git tree and invalidating PP-02 source-bound release results. | Snapshot and restore pattern implemented across `release-gate.js`, `verify.js`, and `run-ui-suite.js`. |
| **Infinite Gate Re-entrancy** | Tests verifying `verify-gate.js` triggered recursive spawning loops when run from inside `verify-gate.js`. | `PROPERTY_VERIFY_GATE_ACTIVE=1` environment guard prevents re-entry while returning a structured bypass result. |
| **Listing Admission Leaks** | DISCOVERY_ONLY sources (e.g. `courtlistener`, `fl-dor-cadastral`) served as actionable sale listings. | Strict class-level admission gates (`servesListings()`, `isDiscoveryOnlySource()`) enforced across all API routes, guarded by `test/listing-serving-gate.test.js`. |
| **Migration Digest Drift** | Manual edits to SQL migration files caused the migrator to abort on digest mismatch, blocking migrations. | Migrator updated to re-record drifted digests and proceed, guarded by `test/db/migration-ledger-drift.test.js`. |

---

*Verified by Quality, TDD & Verification Auditor — 2026-11-09*
