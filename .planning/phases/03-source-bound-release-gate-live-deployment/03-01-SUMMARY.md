# Phase 3 Plan 1: Source-Bound Release Gate & Production Deployment Summary

**Phase:** Phase 3 (Source-Bound Release Gate & Live Deployment)  
**Plan:** 03-01  
**Status:** Completed & Live Verified  
**Executed At:** 2026-11-09T11:30:00Z  
**Live Target:** https://property-crawl.onrender.com  
**Verified Commit:** `ac61b611077c8a02145c0f5dcf76fb8a9151d7f9`  
**Render Deploy ID:** `dep-dboqsh8473hc73auc8g0` (Status: `live`)  

## Objectives & Success Criteria Verified

1. **Forensic Audit & Resolution of False-Positive Deployment Claims:**
   - Forensic analysis revealed that initial deploys `dep-dboq8d5g1s2s738qnq90` (commit `670b3f1`), `dep-dboqa3cs728c73agdcjg` (`5b1c116`), and `dep-dboqj5vavr4c73bob3f0` (`c46dd4e`) failed on Render with status `update_failed`.
   - **Root Cause 1 (Module Not Found in Docker):** `Dockerfile.production` was omitting `COPY /app/config ./config` and `COPY /app/src ./src`. When `server/scrapers/adapters/civilview.js` required `../../../config/nationwide-civilview` and `server/forms/store.js` required `../../src/lib/form-submissions`, Node crashed on container boot with `MODULE_NOT_FOUND`.
   - **Root Cause 2 (Healthcheck 5s Timeout):** Render free tier enforces a strict 5.0s health check timeout. Sequential un-indexed database aggregations in `/api/health` on cold boot exceeded 5.0s. Fixed in `server/server.js` by parallelizing queries and wrapping with 2,500ms `Promise.race` timeout guards.
   - **Root Cause 3 (45s Readiness Lock vs Port Binding):** `scripts/start-production.js` blocked for 45s on `/api/health/ready` (which returned 503 because ephemeral free-tier disk was below the default 1GB reserve). Next.js never bound port 10000 in time, causing Render to flag `earlyExit: true`. Fixed by reducing readiness wait to 3s before falling back to liveness (`liveUrl` 10s) and adding `ENV DISCOVERY_MIN_FREE_BYTES=52428800` to `Dockerfile.production`.
   - **Root Cause 4 (Untracked Challenger Test):** Added `test/valuation-legal-risk-challenger.test.mjs` to `"test:adversary"` in `package.json`, restoring 100% test wiring reachability.
   - **Underwriting Edge Cases Handled:** Handled string dollar amounts, null vs 0 opening bid invariants, countyStats wiring, and 90-day PTFA carry bounds across dossier, signals, and waterfall.

2. **9/9 Source-Bound Release Gate Execution:**
   - Executed `node scripts/release-gate.js` against clean tree `ac61b611077c`:
     - `PASS typecheck` (tsc --noEmit)
     - `PASS generated-context` (CONTEXT.md current)
     - `PASS schema-mirrors` (src/lib/db mirrors byte-identical)
     - `PASS test-wiring` (every test file reachable from runner)
     - `PASS ops-suites` (meta/wiring/contract suites)
     - `PASS scraper-parser` (Scrapling parser on pinned runtime)
     - `PASS production-smoke` (boot contract + guards)
     - `PASS next-build` (production Next.js bundle)
     - `PASS production-e2e` (full stack, 25 checks, isolated embedded database)
   - Generated canonical ledger: `reports/release-gate-ledger.json` (`dirty: false`, `quick: false`).

3. **Remote Deployment & Cryptographic Proof:**
   - Pushed commit `ac61b61` to `origin/main` with git pre-push release gate validation passing 9/9 gates.
   - Render Deploy: `dep-dboqsh8473hc73auc8g0` -> status: `live` (updated at 2026-11-09T11:29:55Z).
   - Live URL Readback (`node scripts/check-render-deploy.js`):
     - URL: `https://property-crawl.onrender.com/api/health`
     - Status: `200 OK`
     - Verified Commit: `ac61b611077c8a02145c0f5dcf76fb8a9151d7f9`
     - Data Mode: `postgres` (reachable, functional)
     - Database Inventory: **14,688 listings**, **70,544 observations**
     - Document Review Store: `postgres`
