# Roadmap: PerfectProperty / property-crawl

## Overview

Take `property-crawl` from its audited brownfield state through security hardening, UI craft verification, $0 database continuity, snapshot compaction, and a clean 9/9 source-bound release gate for continuous production deployment.

## Phases

- [x] **Phase 1: Codebase Mapping, Security Sanitization & Triple Audit** - Map entire repo, remove credential leaks, complete statutory docket & alert routes, and pass Impeccable + Quick Release Gates
- [x] **Phase 2: $0 Database Continuity & Storage Compaction** - Dry-run snapshot compaction and lock in $0 hosting continuity ahead of Nov 19 Render DB expiry
- [ ] **Phase 3: Source-Bound Release Gate & Live Deployment** - Commit verified changes, run full 9/9 `release-gate.js` (including production build & isolated E2E), and deploy

## Phase Details

### Phase 1: Codebase Mapping, Security Sanitization & Triple Audit
**Goal**: Map the brownfield repository, eliminate any credential or design anti-patterns, and verify all unit/meta/adversarial suites pass.
**Depends on**: Nothing (first phase)
**Requirements**: [SEC-01, SEC-02, UI-01, API-01, DOCKET-01]
**Success Criteria** (what must be TRUE):
  1. `.planning/codebase/` contains complete `STACK.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `CONCERNS.md`, and `GAP_ANALYSIS.md`
  2. `scripts/export-hosted-backup.js` contains zero hardcoded passwords and fails closed without `PGPASSWORD`
  3. `impeccable detect src/ --no-advisory` exits 0 with 0 anti-patterns
  4. `node scripts/release-gate.js --quick` passes 7/7 gates
**Plans**: 1 plan

Plans:
- [x] 01-01: 4-Agent Repo Scan, P0 credential fix, Impeccable typography fix, and Triple Audit verification

### Phase 2: $0 Database Continuity & Storage Compaction
**Goal**: Benchmark snapshot compaction and ensure seamless $0 database continuity (embedded PGlite or free external PostGIS) before the Nov 19 Render free tier expiration.
**Depends on**: Phase 1
**Requirements**: [INFRA-01, COMPACT-01]
**Success Criteria** (what must be TRUE):
  1. `scripts/compact-snapshots.js --dry-run` executes cleanly and reports observation deduplication metrics
  2. Off-host dump (`.secrets/hosted-backups/property-crawl-render-2026-11-09.dump`) is verified and $0 continuity path is ready
**Plans**: 1 plan

Plans:
- [x] 02-01: Execute snapshot compactor dry-run and verify $0 database restore/embedded readiness

### Phase 3: Source-Bound Release Gate & Live Deployment
**Goal**: Reconcile working tree, pass all 9/9 source-bound release gates (including production Next.js build and 25-journey isolated E2E), and deploy to production.
**Depends on**: Phase 2
**Requirements**: [REL-01]
**Success Criteria** (what must be TRUE):
  1. Working tree is clean and `CONTEXT.md` is freshly generated
  2. `node scripts/release-gate.js` passes 9/9 gates and writes a source-bound `reports/release-gate-ledger.json`
  3. Production deployment is live and `/api/health` reports the new commit SHA
**Plans**: 1 plan

Plans:
- [ ] 03-01: Clean commit, 9/9 full release gate, and production deployment

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Codebase Mapping, Security Sanitization & Triple Audit | 1/1 | Complete | 2026-11-09 |
| 2. $0 Database Continuity & Storage Compaction | 1/1 | Complete | 2026-11-09 |
| 3. Source-Bound Release Gate & Live Deployment | 0/1 | Ready | - |
