# Technical Concerns & Architectural Vulnerabilities Ledger

> **Date:** 2026-11-09  
> **Repository:** `property-crawl` (`C:\Users\serge\.minimax\sessions\mvs_33469e4a8e48472faf25c6f55a29c489\workspace\property-crawl`)  
> **Auditor:** Reality Checker & Full-Stack Gap Analyst (Agency-Agents / GSD Role)  
> **Governing Strategy:** `docs/STRATEGY.md`, `docs/COMPLETION_CHECKLIST.md`, `AGENTS.md`  

---

## 1. Executive Summary of Critical Concerns

| Priority | Concern | Immediate Blast Radius | Fatal Deadline / Constraint |
|---|---|---|---|
| **CRITICAL (P0)** | **Render Free PostgreSQL Expiry** | Complete database deletion; 11,382 listings & tables lost; live site returns HTTP 503 | **2026-11-19T01:31:31Z** (10 days remaining) |
| **CRITICAL (P0)** | **Hardcoded Secrets in Untracked Backup Script** | Compromise of production Render PostgreSQL credentials (`scripts/export-hosted-backup.js`) if committed | Immediate Git commit risk |
| **HIGH (P1)** | **Hosted Ephemeral Storage & Zero-Cost Constraint** | Evidence ledger, snapshots, and local caches wiped on every container restart/redeploy; user banned paid Render upgrades | Active in production (`mountVerified=false`) |
| **HIGH (P1)** | **Publisher Identity Vacuum in Recorder Track 1** | Maricopa blocked by 403; Harris grid provides 0 situs addresses/APNs (scanned non-OCR PDFs) | Halts Track 1 source promotion |
| **HIGH (P1)** | **Valuation Void & HPI Series Unavailability** | 0 of 11,382 listings carry `estLow`/`estHigh`; FHFA quarterly index levels not public | MAO calculation and HPI trajectory remain withheld |
| **MEDIUM (P2)** | **Local PostGIS Test Isolation Discrepancy** | 18 external-database integration tests skipped in standard local test runs | Obscures row-lock fencing and PostGIS query regressions |
| **MEDIUM (P2)** | **Automated Alerting & Scheduler Dormancy** | No automated background scraping (`SCRAPER_BACKGROUND_ENABLED=0`); missing production `RESEND_API_KEY` | Real-time investor alerts and recurring sweeps inactive |
| **LOW (P3)** | **Uncommitted Working Tree Accumulation** | 14 modified files (+688/-47 lines) across core logic, tests, and checklists uncommitted | Risk of concurrent session overwrite |

---

## 2. Infrastructure & Hosting Vulnerabilities

### 2.1. Render Free Tier PostgreSQL Termination (10 Days Remaining)
* **Exact Component:** Render PostgreSQL instance `dpg-dbbc8su7bikc73819uo0-a` (Oregon, PostgreSQL 16.15).
* **Observed State:** Expiry timestamp strictly set to **`2026-11-19T01:31:31Z`**.
* **Risk Detail:** Render automatically purges free PostgreSQL instances after 30 days. When this deadline passes, the database server will cease listening, causing `/api/health` to report `dataMode: unavailable`, and all listing routes (`/api/listings`, `/listings`, `/`) will fail closed with HTTP 503.
* **Cost Constraint:** User directives strictly enforce **$0 hosting continuity** ("Keep hosting at $0 — do not apply paid Render upgrades or persistent-disk changes without renewed approval"). The prepared $20/month upgrade plan in `ops/render-durability-plan.json` cannot be applied.
* **Status:** An authorized offline database backup was successfully dumped to `.secrets/hosted-backups/property-crawl-render-2026-11-09.dump` (35.74 MB, SHA-256 `ddcb2a40b13baf0e8a0dc0a1d6d0dfc79735855f53671c004292ec2fef54539e`), verified with 38 tables via `pg_restore --list`.
* **Action Required:** Provision a permanent free-tier replacement database (e.g. Supabase Free Tier [500MB PostGIS], Neon Serverless Free Tier [0.5GB], or Fly.io Postgres) before 2026-11-19, restore the schema and 11,382 listings, re-point `DATABASE_URL` in Render environment variables, and verify with `npm run smoke:production`.

### 2.2. Plaintext Secrets in Untracked `scripts/export-hosted-backup.js`
* **Exact File:** `scripts/export-hosted-backup.js` (Lines 54–58).
* **Observed Code:**
  ```javascript
  return {
    host: process.env.PGHOST || 'dpg-dbbc8su7bikc73819uo0-a.oregon-postgres.render.com',
    port: process.env.PGPORT || '5432',
    user: process.env.PGUSER || 'property_crawl_db_user',
    database: process.env.PGDATABASE || 'property_crawl_db',
    password: process.env.PGPASSWORD || 'SGbYHitV6KEUKBMdqm4jmJC5mTDe4ILi'
  };
  ```
* **Risk Detail:** Hardcoded database host, database name, username, and password exist directly in the script source. If this file is staged and committed to Git, credentials will be leaked into repository history and pushed to remotes.
* **Action Required:** Remove hardcoded credential fallbacks immediately. Mandate reading exclusively from `process.env.DATABASE_URL` or `process.env.PGPASSWORD`. Ensure `scripts/export-hosted-backup.js` fails closed with an informative error if environment variables are not supplied.

### 2.3. Ephemeral Filesystem & Evidence Durability Loss on Render
* **Exact Component:** `server/discovery/evidence-storage.js` and live `/api/health`.
* **Observed State:** Live health reports `storageType: "ephemeral_filesystem"`, `mountVerified: false`, `backupVerified: false`.
* **Risk Detail:** Render's free compute container uses an ephemeral Docker overlay. Every redeploy, configuration restart, or crash wipes `/app/.cache/` clean. This erases local evidence ledger append logs, scraper snapshots (`.cache/discovery-evidence/`), and SQLite document stores. While PostgreSQL retains tabular listing records, secondary audit files are lost.
* **Mitigation / Reality:** Under the $0 budget constraint, persistent disks cannot be attached on Render. The system must continue to treat the local filesystem as non-durable and push critical evidence into PostgreSQL tables (`discovery_snapshots`, `source_observations`, `document_review`).

---

## 3. Data Truth & Zero-Fabrication Vulnerabilities

### 3.1. The Valuation Void (0 of 11,382 Records With Publisher Valuation)
* **Exact Files:** `server/db/client.js`, `src/lib/underwriting.ts`, `src/components/terminal/bidding-simulator.tsx`.
* **Observed Reality:** Across 11,382 live records (ServiceLink, HUD, CivilView, FL DOR, CourtListener, Treasury, USDA, IRS, GSA), `estLow`, `estHigh`, `assessed`, and `mid` are populated on **exactly 0 rows**.
* **Risk Detail:** Distress property publishers publish legal descriptions, court cause numbers, and opening bids—they do not publish market valuations or ARVs. Previous attempts to synthesize bands (`bid * 1.35`) or calculate macro HPI valuations were eliminated in Audit 10 to prevent publishing simulated data as observed evidence.
* **User Experience Hazard:** 
  - Maximum Allowable Offer (MAO) cannot be calculated automatically and remains withheld with "Price scenario unavailable".
  - Triage score and Deal Score sorting return default order because unmodeled listings cannot be ranked by Deal Score.
  - Users must manually input their own assumed ARV / repair budget in the bidding simulator or link an enrolled county assessor record (`/api/listings/[id]/assessor`).

### 3.2. FHFA Quarterly HPI Index Levels Unavailable Publicly
* **Exact Files:** `server/enrichment/fhfa-state-hpi.js`, `server/enrichment/hpi.js`, `scripts/ingest-fhfa-hpi.js`.
* **Observed State:** While statewide 1-year and 5-year percentage changes are observed from the live FHFA CSV (`https://www.fhfa.gov/hpi-state/csv`, sha256 `2dd86a2c...`), FHFA does not publicly serve quarterly raw index levels via API (only percentage changes).
* **Risk Detail:** Calculating a historical appreciation multiplier requires an explicit base-period index level. Without an operator-supplied index series (`FHFA_HPI_SERIES_PATH`), the trajectory remains unknown and the feature must fail closed.
* **Mitigation:** The system honestly labels HPI appreciation as "unobserved series" rather than reverting to fabricated tables.

---

## 4. Recorder & Adapter Source Qualification Blockers

### 4.1. Maricopa County (AZ) Robots Policy 403 Blockade
* **Exact Files:** `server/scrapers/adapters/maricopa-recorder.js`, `server/scrapers/trustee.js`.
* **Observed State:** The standard crawler request to `https://recorder.maricopa.gov/robots.txt` returns HTTP 403.
* **Risk / Rule:** In accordance with project policy, no user-agent spoofing, proxy rotation, or challenge bypass is permitted. The scraper immediately halts with `HTTP 403 policy unavailable` and records the run as failed.
* **Blocker:** Maricopa cannot be promoted to a live listing collector without official publisher authorization, an allowed public API, or explicit policy access.

### 4.2. Harris County (TX) Scanned PDF & Zero Situs Identity Trap
* **Exact Files:** `server/scrapers/adapters/harris-clerk-query.js`, `server/scrapers/adapters/harris-clerk-foreclosure.js`.
* **Observed State:** The official Harris County foreclosure search (`FRCL_R.aspx`) returns a query table with document numbers, grantor names, and links to `ViewECdocs.aspx?ID=...`. It supplies **zero addresses, parcel IDs, or opening bids**.
* **Risk Detail:** The captured 2-page PDFs are scanned graphic images containing no embedded text. Admitting these records as listings would inject address-less, unidentifiable stub records into inventory, corrupting the search experience.
* **Control in Place:** The scraper classifies Harris runs as `outcome=evidence_only` and stages records into the operator review queue (`intake.json`) with `confidenceScore: 0.0`. Promotion to clean listing canaries remains blocked until an OCR extraction pipeline or manual parcel-matching step is certified.

### 4.3. Los Angeles County (CA) Web Scraping Prohibition (A31-09)
* **Exact Files:** `server/scrapers/adapters/la-recorder.js`.
* **Legal Policy:** LA County Registrar-Recorder explicitly prohibits automated online scraping of real estate records and indexes.
* **Architectural Constraint:** `la-recorder.js` is strictly restricted to parsing intaken evidence files (NOD, NTS, Trustee Deeds) obtained via authorized bulk feeds or public records requests. It must never execute automated network sweeps against `lavote.gov`.

---

## 5. Test Suite & Verification Environment Gaps

### 5.1. 18 Integration Tests Skipped Locally Without Docker
* **Exact Suites:** `test/discovery-acceptance.test.js` (16 tests) and `test/discovery-lease-loss.test.js` / operations (2 tests).
* **Observed Output:**
  ```
  VERIFICATION RESULT: 50/50 Suites Passed (0 Failed)
  NOTE: 18 test(s) were SKIPPED and did not execute. A skipped test is not a passing test.
    skipped: 3i. Discovery backend (16)
    skipped: 3j. Discovery operations (2)
  ```
* **Risk Detail:** These tests assert PostgreSQL row-level locks (`FOR UPDATE SKIP LOCKED`), lease-fencing under concurrent workers, and trigram fuzzy matching (`pg_trgm`). PGlite and embedded engines cannot execute them.
* **Status:** These tests were successfully executed against the live Render database (137/138 passed, 1 skip for optional-live-endpoint). However, developers running `npm test` on local machines without Docker Desktop active will continue to skip these 18 tests, leaving concurrent lease and job-fencing logic unverified locally.

### 5.2. Flaky Playwright E2E UI Tests Under Cold Compilation
* **Exact File:** `test/next_ui_e2e_test.py`.
* **Observed Failure Modes:**
  1. `storyteller_uses_a_real_map_engine_with_accessible_opportunities`: MapLibre asynchronous tile loading occasionally misses the 5-second assertion deadline.
  2. Hero suggestion datalist timing: Building the market vocabulary requires paging the inventory, which can time out on cold runs.
  3. API rate limit: Running all 53 Playwright tests against a default server triggers rate limiter 429s unless `PROPERTY_API_RATE_LIMIT=10000` is explicitly set.

---

## 6. Background Scheduling & Delivery Gaps

### 6.1. Disabled Background Scraper Scheduler
* **Exact File:** `server/server.js` (Line 410).
* **Observed State:** `SCRAPER_BACKGROUND_ENABLED` defaults to `undefined` / `0`.
* **Consequence:** The server prints `[Server] Manual source collection enabled; background collection is disabled.` Inventory is not refreshed on a continuous automated loop. Without manual invocation of `npm run refresh:known -- --apply` or `scripts/collect-source.js`, records age past their publisher refresh cadence (e.g., ServiceLink's 6-hour window).

### 6.2. Production Resend API Key Unconfigured
* **Exact Files:** `server/delivery/resend-client.js`, `src/lib/resend.ts`.
* **Observed State:** `RESEND_API_KEY` is not present in hosted environment variables.
* **Consequence:** Calling `/api/alerts` with `action: 'dispatch_digest'` or member sign-in links safely fails closed with an error response. Automated investor email delivery is non-operational until an operator configures an authorized API key.

---

## 7. Working Tree Hygiene

* **Uncommitted Changes:** 14 modified files and 1 untracked script (`scripts/export-hosted-backup.js`).
* **Files with Unstaged Changes:**
  - `CONTEXT.md`
  - `docs/COMPLETION_CHECKLIST.md`
  - `scripts/benchmark-discovery.js`
  - `server/delivery/webhook-notify.js`
  - `server/discovery/hunt-store.js`
  - `server/scrapers/trustee.js`
  - `src/lib/adversarial-docket.ts`
  - `test/adversarial-trial-docket.test.mjs`
  - `test/db/listing-q-field-parity.test.js`
  - `test/delivery/webhook-notify-pinned.test.js`
  - `test/detail_media_recovery_e2e_test.py`
  - `test/discovery-acceptance.test.js`
  - `test/discovery-lease-loss.test.js`
  - `test/next_ui_e2e_test.py`
  - `test/recorder-qualification-durability.test.js`
* **Risk:** The changes are clean and pass verification (typecheck green, test-wiring green, adversarial docket 14/14 green). However, maintaining a dirty working tree risks accidental overwrites or lost work across concurrent agent sessions.
