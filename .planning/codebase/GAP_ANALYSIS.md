# Full-Stack Gap Analysis & Action Ledger

> **Date:** 2026-11-09  
> **Repository:** `property-crawl` (`C:\Users\serge\.minimax\sessions\mvs_33469e4a8e48472faf25c6f55a29c489\workspace\property-crawl`)  
> **Auditor:** Reality Checker & Full-Stack Gap Analyst (Agency-Agents / GSD Role)  
> **Single Source of Truth:** `docs/COMPLETION_CHECKLIST.md`  
> **Supporting Audits:** `audit/08`, `audit/09`, `audit/10`, `audit/11`  

---

## 1. Prioritized Gap Matrix (10-Track Inventory)

| Gap ID | Track / Domain | Component | Current State | Risk Level | Target Resolution Date | Blocked By / Required To Close |
|---|---|---|---|---|---|---|
| **GAP-01** | Track 3 / Infra | Render Free PostgreSQL Expiry | Database expires **2026-11-19T01:31:31Z** (10 days) | **CRITICAL (P0)** | 2026-11-15 | Provision $0 PostGIS (Supabase/Neon), restore dump, switch `DATABASE_URL` |
| **GAP-02** | Track 3 / Security | Plaintext Secrets in Script | `scripts/export-hosted-backup.js` has raw Render DB password | **CRITICAL (P0)** | Immediate | Remove hardcoded fallbacks; mandate reading from env variables |
| **GAP-03** | Track 1 / Scrapers | Maricopa Recorder Qualification | Crawl blocked by publisher `/robots.txt` returning HTTP 403 | **HIGH (P1)** | Backlog | Authorized access agreement, official API key, or policy exemption |
| **GAP-04** | Track 1 / Scrapers | Harris County Recorder Qualification | Search grid supplies 0 addresses/APNs; PDFs are scanned graphics | **HIGH (P1)** | Backlog | Scanned PDF OCR parsing + CAD property identity cross-matching |
| **GAP-05** | Track 1 / Scrapers | AcclaimWeb Recorder Adapter | Clark County NV adapter implemented; no live canary promotion | **MEDIUM (P2)** | Sprint 2 | Two consecutive live canary qualification runs without regressions |
| **GAP-06** | Track 2 / Database | Local PostGIS Integration Gating | 18 tests skipped locally when Docker is inactive | **MEDIUM (P2)** | Sprint 1 | Local PostGIS service or shared dev PostgreSQL connection string |
| **GAP-07** | Track 4 / Adapters | In-Repo Recorder & Agency Adapters | Cook, Miami-Dade, GSA API, LA Recorder implemented; unpromoted | **MEDIUM (P2)** | Sprint 2 | Publisher canary qualification runs; LA Recorder limited to intake (A31-09) |
| **GAP-08** | Track 5 / Delivery | Production Alert Email Dispatch | Resend client built; `RESEND_API_KEY` unset in hosted environment | **HIGH (P1)** | Sprint 1 | Operator supplies `RESEND_API_KEY` in Render environment variables |
| **GAP-09** | Track 5 / Scheduler | Background Collector Daemon | `SCRAPER_BACKGROUND_ENABLED=0`; scrapers do not run on timer | **MEDIUM (P2)** | Sprint 2 | Configure background scheduler with conservative rate budgets |
| **GAP-10** | Track 6 / Deploy | Deployed Commit SHA Drift | Render live at `519d46a`; working branch at `f04c2f0` + dirty tree | **HIGH (P1)** | Sprint 1 | Clean working tree, commit, push, and verify deployed SHA on `/api/health` |
| **GAP-11** | Track 7 / Title | Live Docket Legal Opinion Review | 22-state HOA super-liens & 10-state possession timelines modeled | **MEDIUM (P2)** | Policy | Retain disclaimer that title rules do not substitute for formal legal opinion |
| **GAP-12** | Tracks 8/9 / Hazards | Federal Hazards API Resilience | FEMA, EPA, USGS APIs fail closed on network timeout or rural gaps | **MEDIUM (P2)** | Sprint 2 | Geometry index soak; caching layer for external geospatial endpoints |
| **GAP-13** | Tracks 8/9 / Economics | Tyler v. Hennepin Waterfall & MAO | 5-tier waterfall & redemption EV modeled; MAO withheld for null ARV | **LOW (P3)** | By Design | Zero-Fabrication rule: MAO stays withheld until user enters custom ARV |
| **GAP-14** | Track 10 / Storage | Deduplication Compaction Soak | Snapshot compactor CLI implemented; not run on hosted database | **MEDIUM (P2)** | Sprint 2 | Execute dry-run and apply compaction against hosted observation tables |
| **GAP-15** | Data / Macro | FHFA Quarterly HPI Index Levels | Statewide summary active; raw quarterly index levels not public | **LOW (P3)** | By Design | Trajectory remains unobserved until operator supplies series file |

---

## 2. Deep Gap Breakdown by Workstream

### 2.1. Track 1 — Recorder Qualification & Source Verification
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §1; `audit/09`.
* **Current State:**
  - `server/scrapers/adapters/maricopa-recorder.js`: Implements Maricopa County AZ Notice of Trustee Sale, Notice of Default, and Certificate of Sale parser. When run against the live publisher, `/robots.txt` returns HTTP 403. Collector immediately halts and records `outcome: failed`.
  - `server/scrapers/adapters/harris-clerk-query.js` & `harris-clerk-foreclosure.js`: State-of-the-art WebForms query submission with anti-forgery tokens, query cookie scoping, and page bounding. Correctly retrieves official document links (`ViewECdocs.aspx?ID=...`). However, the publisher search results contain **only document numbers and grantor names—no street address, situs, legal description, or APN**. The linked documents are 300-DPI raster scans without embedded text.
  - `server/scrapers/adapters/acclaimweb.js`: Built to parse Harris Recording Solutions AcclaimWeb portals (Clark County NV, etc.). Passes unit tests in `test/county_platform_adapters.test.js`.
* **The Gap:**
  - Maricopa cannot be promoted without policy permission or authorized API credentials.
  - Harris County cannot be promoted to a listing collector because admitting address-less records violates the listing contract. It must remain an `evidence_only` document source until OCR extraction is wired.
  - AcclaimWeb needs live canary runs recorded to `.cache/` before promoting to active scheduler rotation.
* **Requirements to Close:**
  1. Authorize Maricopa access via county developer portal or maintain explicit `POLICY_BLOCKED` classification.
  2. Authorize OCR extraction pipeline (e.g. Tesseract or cloud OCR) for Harris County 2-page notice scans to resolve parcel/address identity.
  3. Execute two consecutive canary passes on AcclaimWeb with zero regressions and record receipts in `reports/`.

---

### 2.2. Track 2 — Real PostGIS Acceptance & Concurrency Fencing
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §2; `audit/08`, `audit/09`.
* **Current State:**
  - On the live Render PostgreSQL 16.15 database (`dpg-dbbc8su7bikc73819uo0-a`), acceptance was executed on 2026-11-09: 137/138 passed in `test:discovery` (1 skip for optional live endpoint), 106/106 in `test:discovery:operations`.
  - 10,050 listings were successfully persisted in 98.8s using batched `jsonb_to_recordset` queries of 500 rows (`server/discovery/hunt-store.js`).
  - Locally, Docker Desktop is not running. In the default environment (`npm test`), 18 integration tests are skipped: 16 in `test/discovery-acceptance.test.js` and 2 in `test/discovery-lease-loss.test.js`.
* **The Gap:**
  - Local developers running standard test suites do not get local execution of row-level lock fencing (`FOR UPDATE SKIP LOCKED`) and PostGIS geometry queries.
* **Requirements to Close:**
  1. Provide a lightweight local PostgreSQL service or loopback Docker command in developer setup scripts.
  2. Keep the honesty guard in `test/verify.js` ensuring skipped tests are explicitly reported and never counted as passing tests.

---

### 2.3. Track 3 — Off-Host Backup, $0 Hosting Migration & Durability
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §3; `audit/09`.
* **Current State:**
  - **Database Expiration:** Render free PostgreSQL expires on **2026-11-19T01:31:31Z**.
  - **Offline Dump Secured:** 35.74 MB custom-format dump exported to `.secrets/hosted-backups/property-crawl-render-2026-11-09.dump` (SHA-256 `ddcb2a40b13baf0e8a0dc0a1d6d0dfc79735855f53671c004292ec2fef54539e`), verified with `pg_restore --list`.
  - **Plaintext Secret Risk:** `scripts/export-hosted-backup.js` contains hardcoded production passwords.
  - **Storage Durability:** Render web service has ephemeral filesystem.
  - **Cost Directive:** The user has strictly ruled out the $20/month paid Render disk/starter plan.
* **The Gap:**
  - No target $0 database has been provisioned to receive the restored dump before the November 19 cutoff.
  - Hardcoded credentials in `export-hosted-backup.js` present a security leak risk.
* **Requirements to Close:**
  1. **Immediate:** Sanitize `scripts/export-hosted-backup.js` to strip hardcoded fallbacks and enforce environment variable ingestion.
  2. Provision a replacement free-tier PostgreSQL 16 + PostGIS database (e.g. Supabase Free Tier or Neon Free Tier).
  3. Execute `pg_restore` of `property-crawl-render-2026-11-09.dump` into the new target database.
  4. Update `DATABASE_URL` in Render service settings.
  5. Verify connectivity and 11,382 listings via `/api/health`.

---

### 2.4. Track 4 — In-Repo Recorder & Agency Adapters
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §5; `audit/07`.
* **Current State:**
  - `server/scrapers/adapters/cook-recorder.js`: Full Cook County IL chancery Lis Pendens and sheriff sale adapter.
  - `server/scrapers/adapters/miami-dade-clerk.js`: Dual-intake adapter for Miami-Dade Clerk onrecords Lis Pendens and RealTaxDeed auctions.
  - `server/scrapers/adapters/gsa-api.js`: Machine-readable REST client against official `api.gsa.gov/assets/gsaauctions/v2/auctions`, strictly filtered to real estate.
  - `server/scrapers/adapters/la-recorder.js`: Deterministic notice parser for intaken NOD, NTS, and Trustee Deeds.
* **The Gap:**
  - Adapters are written, unit-tested, and wired, but none have completed formal canary qualification runs against live endpoints.
  - LA Recorder must remain constrained to offline document intake per A31-09 policy.
* **Requirements to Close:**
  1. Execute read-only canary queries for Cook County, Miami-Dade, and GSA API.
  2. Record canary receipts in `reports/canary-<source>-<date>.md`.
  3. Formally promote qualified adapters in `server/sources/catalog.js` from `LOCAL_ROUTE` to `VERIFIED_OFFICIAL`.

---

### 2.5. Track 5 — Alert Digest & Delivery Pipeline
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §6; `server/delivery/alert-digest.js`.
* **Current State:**
  - `server/delivery/alert-digest.js` implements `generateInvestorDigestReport` and `dispatchInvestorAlertDigest`.
  - `server/delivery/resend-client.js` sends structured HTML emails via the Resend API with inline CSS and deal score badges.
  - `server/routes/alerts.js` exposes `/api/alerts` with `action: 'dispatch_digest'`.
  - `server/delivery/webhook-notify.js` provides SSRF-safe, DNS-rebinding-pinned webhook delivery for hunt events.
* **The Gap:**
  - `RESEND_API_KEY` is not configured in the live Render environment, so email delivery fails closed.
  - Automated continuous execution is dormant because `SCRAPER_BACKGROUND_ENABLED` is turned off.
* **Requirements to Close:**
  1. Set `RESEND_API_KEY` in environment variables.
  2. Deploy a lightweight cron worker or enable bounded background polling to trigger hunt evaluations and digest dispatches periodically.

---

### 2.6. Track 6 — Deployed SHA & Production Alignment
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §3; `audit/09`.
* **Current State:**
  - Live Render deployment reports commit `519d46a3ae35c1a1d21c805d35792f0ed9b2d8cb`.
  - Local repository is at `f04c2f0` (+ unstaged working tree changes).
* **The Gap:**
  - Recent improvements (HPI fabrication removal, representative journey remediations, underwriting scenario bridge, and adversarial docket expansions) have landed in git history but have not been deployed to the live URL.
* **Requirements to Close:**
  1. Verify working tree integrity with full test gate.
  2. Stage and commit changes cleanly.
  3. Push to `main` and trigger Render auto-deploy.
  4. Verify `/api/health.release.commit` on `https://property-crawl.onrender.com` matches HEAD.

---

### 2.7. Track 7 — Title Risk, HOA Super-Priority & Possession Rules
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §7; `server/intelligence/hoa-super-lien.js`.
* **Current State:**
  - `server/intelligence/hoa-super-lien.js`: Comprehensive 22-state super-priority engine covering Nevada (NRS 116.3116 first-mortgage extinguishment risk), Florida (1% safe harbor cap), Maryland ($1,200 cap), Colorado, DC, etc.
  - `server/intelligence/post-sale-possession.js`: Statutory quiet title and writ of possession timelines for OH, GA, IL, PA, FL, TX, NJ, CA, NY, MI with holding carry calculation.
  - `src/lib/adversarial-docket.ts`: Deal-killer prosecution vs defense trial docket evaluating senior lien risks, HOA super-priority, municipal liens, bankruptcy stays, IRS redemption, and tenant protections.
* **The Gap:**
  - The statutory rules engine is fully functional, but individual listings do not always have property-specific title abstracts (e.g. recorded deeds of trust, open mortgage balances, HOA ledger balances) attached.
  - The UI must maintain clear disclaimers that automated title risk analysis is decision support, not an attorney title opinion or title insurance policy.
* **Requirements to Close:**
  1. Ingest title abstracts via the document intake split-pane (`/workspace/documents-review`) when available.
  2. Ensure all exported decision packets (`/research/[id]/export`) carry the required statutory citations and non-legal-advice disclaimer.

---

### 2.8. Tracks 8 & 9 — Hazards, Surplus Waterfall & Bidding Simulator
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §8; `server/intelligence/surplus-waterfall.js`.
* **Current State:**
  - `server/enrichment/federal-hazards.js`: FEMA NFHL, EPA Superfund (SEMS), and USGS 3DEP Slope screening. Fails closed with 503 when external APIs are unavailable.
  - `server/intelligence/surplus-waterfall.js`: Complete 5-tier excess proceeds waterfall under *Tyler v. Hennepin County*, 598 U.S. 631 (2023).
  - `src/lib/redemption-ev.ts`: Dual-outcome penalty redemption vs acquisition expected value calculation for TX, GA, TN, SC, IA.
  - `src/components/terminal/bidding-simulator.tsx`: Renders Bid Cost Model with buyer-assumed costs and withholds MAO when valuation is absent.
* **The Gap:**
  - External geospatial APIs (FEMA/USGS/EPA) occasionally throttle requests or time out on rural coordinates.
  - Seed listings with missing coordinates cannot query hazard layers.
* **Requirements to Close:**
  1. Add in-memory / database caching for resolved federal hazard polygons.
  2. Surface explicit "Hazard layer unavailable" badges rather than failing the whole underwriting packet when one external GIS layer drops.

---

### 2.9. Track 10 — Observation Deduplication & Snapshot Compaction
* **Governing Rule:** `docs/COMPLETION_CHECKLIST.md` §9; `server/discovery/snapshot-compactor.js`.
* **Current State:**
  - `server/discovery/snapshot-compactor.js`: Implements canonical JSON serialization and SHA-256 content hashing. Deduplicates consecutive observations while preserving first/last run markers and status transitions.
  - `scripts/compact-snapshots.js`: Maintenance CLI supporting `--dry-run` and `--apply`.
* **The Gap:**
  - The compactor has only been validated in unit tests and local fixtures.
  - It has not been run against the live hosted database's `source_observations` or `.cache/discovery-evidence/` store.
* **Requirements to Close:**
  1. Execute `node scripts/compact-snapshots.js --dry-run` against production data to measure storage reduction.
  2. Execute `--apply` during scheduled maintenance to prune redundant snapshot rows while verifying ledger head integrity.

---

### 2.10. Frontend & UI Verification Sweep
* **Governing Rule:** `audit/11`; `docs/COMPLETION_CHECKLIST.md`.
* **Current State:**
  - **TDZ Crash Fixed:** Hoisted `updateCustomOpeningBid` above early-return gate in `bidding-simulator.tsx`.
  - **Underwriting Scenario Bridge:** Underwriting assumptions on `/research/[caseId]` sync seamlessly to cases, decision packets, and markdown exports.
  - **Conversion Gateway Filters:** Live feed conversion card preserves all active filters when transitioning to `/listings`.
  - **Dead Controls Removed:** Storyboard / Deal Video Teaser removed from codebase; Street View embed strictly on-demand.
  - **Account / Billing:** Account panel provides clean login link flow and graceful fallback when Stripe checkout is unconfigured.
* **The Gap:**
  - No active dead-end buttons or broken links identified.
  - All public routes (`/`, `/listings`, `/research`, `/hunts`, `/about`, `/contact`, `/terms`, `/privacy`, `/sources`, `/account`, `/coverage`, `/resources`) return HTTP 200 with content and valid CSP headers.

---

## 3. Concrete Action Plan & Execution Roadmap

### Phase 1: Security & Emergency Migration (Days 1–3)
1. **Sanitize Secrets:** Edit `scripts/export-hosted-backup.js` to eliminate plaintext database passwords.
2. **Provision Free PostGIS Target:** Create a free database on Supabase or Neon (PostgreSQL 16 + PostGIS 3.x).
3. **Restore Data:** Run `pg_restore` using `.secrets/hosted-backups/property-crawl-render-2026-11-09.dump` into the new instance. Verify table row counts (11,382 listings).
4. **Update Render Config:** Re-point `DATABASE_URL` in the Render dashboard to the new instance before November 19.

### Phase 2: Working Tree Clean-Up & Release Verification (Days 3–4)
1. **Run Full Verification Gate:** Run `npm run typecheck`, `npm run test:canonical`, and `node test/docs-checklist-honesty.test.js`.
2. **Commit & Push:** Commit the pending 14 modified files with a structured commit message (`feat: complete track 7/8/9 statutory rules, webhook isolation, and test parity`).
3. **Deploy Verification:** Push to `main`, wait for Render deployment to complete, and verify deployed commit SHA via `/api/health`.

### Phase 3: Source Adapters & Operational Enablement (Days 5–7)
1. **Run Adapter Canaries:** Execute canary queries for Cook County, Miami-Dade, and GSA API; document evidence in `reports/`.
2. **Configure Alerting:** Populate `RESEND_API_KEY` in production environment to enable live email delivery.
3. **Run Storage Compaction:** Execute `node scripts/compact-snapshots.js --apply` on the restored database to compress redundant observation snapshots.
