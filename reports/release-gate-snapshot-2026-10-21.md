# Release gate snapshot — 2026-10-21 (tree `0f9bcc8`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding `release-gate-snapshot-2026-10-15.md` (tree `f7c413c`).

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `0f9bcc860c6e266a39be0a813f19bf5faa08d6e6` — dirty: false — 2026-10-21

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 1810 |
| generated-context (CONTEXT.md current) | PASS | 132 |
| schema-mirrors (byte-identical) | PASS | 48 |
| test-wiring (every test file reachable) | PASS | 110 |
| ops-suites (meta/wiring/contract) | PASS | 11564 |
| scraper-parser (pinned runtime) | PASS | 3165 |
| production-smoke | PASS | 104 |
| next-build (production bundle) | PASS | 6667 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 19112 |

## Comprehensive Verification Suites Status

- **Verification Gate (`node test/verify.js`)**: 50/50 suites passed (1,556 assertions passed, 0 failed).
- **Evidence Truth Suite (`npm run test:evidence-truth`)**: 576/576 tests passed (0 failed).
- **Crawler Toolchain Doctor (`npm run test:crawler-doctor`)**: 10/10 tests passed (Unbrowse, Scrapling, Camoufox).
- **Crawler Tools Suite (`npm run test:crawler-tools`)**: 168/168 tests passed.
- **AI & Underwriting Suites (`npm run test:ai` + `npm run test:underwriting-resilience`)**: 173/173 tests passed.
- **Operator Walkthrough (`npm run workspace:walkthrough`)**: Clean Chromium headless pass in 19.4s.

## What this tree resolved

1. **Lifecycle Test Isolation Defect**: In `test/routes/next-decision-packet-route.test.js`, running under lifecycle runners without `NODE_ENV=test` left in-memory inventory unseeded. Added deterministic listing fixture creation and fallback when run in test-mode isolation, bringing `test:evidence-truth` from failing to 576/576 passed.
2. **Read-Replica Scope and Materialized Views**: Resolved database read-replica pooling variable scope references, comp ID exclusion logic, and prevented double-counting in materialized view aggregations.
3. **Crawler Toolchain Integration**: Certified global Unbrowse 11.4.1, Scrapling 0.4.15 with stealth fetchers, and Camoufox 0.5.8 with pinned Firefox binaries under `.cache/crawler-tools/venv`.
