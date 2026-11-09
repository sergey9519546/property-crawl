# PerfectProperty / property-crawl

## What This Is

PerfectProperty (`property-crawl`) is an evidence-first discovery, triage, and underwriting platform for distressed and government-sold real estate across the United States. It ingests 24+ federal, state, county, and commercial auction sources (HUD, USDA, GSA, Treasury, IRS, LandBankSearch, sheriff/tax sales, recorder dockets) into a PostGIS/PGlite spatial database and exposes a Next.js 16 workbench with SHA-256 evidence blocks, statutory title-risk modeling, and bidding simulations.

## Core Value

Zero-fabrication, evidence-backed property discovery and underwriting: every listing, lien risk, hazard, and valuation metric must trace to a verifiable primary source or explicitly declare unknown state without inventing numbers.

## Requirements

### Validated

- ✓ Dual-runtime architecture (Port 3000 native Node.js HTTP API/scraper engine + Port 3001 Next.js 16 App Router UI with CSP nonces) — v2.0
- ✓ Dual-engine persistence (PostgreSQL 16 + PostGIS 3.4 in production and embedded WASM PGlite + PostGIS for $0 hosting/local E2E) across 31 idempotent migrations — v2.0
- ✓ 442 automated test suites with 100% test-wiring enforcement (`test-wiring.test.js`) and zero vacuous tests (`no-vacuous-tests.test.js`) — v2.0
- ✓ Statutory title-risk engine (22-state HOA super-priority rules, 10-state post-sale possession timelines, Tyler v. Hennepin surplus waterfall, dual-outcome redemption EV) — Track 7/8/9
- ✓ Federal hazard screening (FEMA flood, EPA Superfund, USGS slope) wired into `/api/enrichment/hazards` and property dossier — Track 8

### Active

- [ ] **INFRA-01**: Zero-cost ($0/mo) database continuity and migration before Render free PostgreSQL expiry on 2026-11-19
- [ ] **SEC-01**: Zero hardcoded database credentials or API secrets across all operational and backup scripts
- [ ] **COMPACT-01**: Observation snapshot deduplication compaction (`scripts/compact-snapshots.js`) preserving price/status transitions and SHA-256 hashes
- [ ] **REC-01**: Live canary qualification and promotion gates for county recorder and auction adapters (Clark County AcclaimWeb, Cook, Miami-Dade, GSA)
- [ ] **UI-01**: Impeccable design system conformance (zero anti-patterns, zero layout shift, honest data-mode banners across all buyer-facing surfaces)
- [ ] **REL-01**: Full 9/9 PP-02 source-bound release gate pass (`scripts/release-gate.js`) on clean working tree

### Out of Scope

- Paid recurring database tiers ($20+/mo Render Postgres upgrades) — Founder mandated strict $0 hosting continuity
- Fabricated or interpolated HPI/ARV appraisals when primary source valuation is absent — violates Zero-Fabrication policy
- Scraping publishers that explicitly forbid automated access via HTTP 403 `/robots.txt` (e.g., Maricopa without partner API) — compliance boundary

## Context

- **Codebase Map**: `.planning/codebase/STACK.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `CONCERNS.md`, `GAP_ANALYSIS.md`
- **Single Source of Truth Checklist**: `docs/COMPLETION_CHECKLIST.md`
- **Hosted Backup**: `.secrets/hosted-backups/property-crawl-render-2026-11-09.dump` (35.74 MB, SHA-256 `ddcb2a40b13baf0e8a0dc0a1d6d0dfc79735855f53671c004292ec2fef54539e`, 11,382 listings across 38 tables)

## Constraints

- **Budget**: Strict $0/month hosting continuity
- **Data Integrity**: Zero-Fabrication policy enforced by automated tests (`underwriting-truth.test.mjs`, `raw-payload-honesty.test.js`)
- **Security**: Fail-closed operator authentication (`PROPERTY_OPERATOR_TOKEN`) and strict SSRF domain allowlisting

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use native `node:http` + `node:test` | Zero framework overhead, deterministic cold boot, no third-party test runner drift | ✓ Good |
| Support both Postgres/PostGIS and embedded PGlite WASM | Enables $0 self-contained hosting and isolated local E2E testing | ✓ Good |
| Sanitize `scripts/export-hosted-backup.js` | Eliminate hardcoded fallback password and require `process.env.PGPASSWORD` | ✓ Good |

---
*Last updated: 2026-11-09 after GSD + Agency-Agents + Chief of Staff team initialization*
