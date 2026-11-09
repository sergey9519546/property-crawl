# Requirements: PerfectProperty / property-crawl

**Defined:** 2026-11-09
**Core Value:** Zero-fabrication, evidence-backed property discovery and underwriting

## v1 Requirements

Requirements for full production completion and $0 continuous deployment.

### Security & Hygiene

- [x] **SEC-01**: Remove hardcoded fallback database credentials from `scripts/export-hosted-backup.js` and enforce `process.env.PGPASSWORD`
- [x] **SEC-02**: Verify zero leaked credentials or API keys across all tracked and untracked repository files

### Infrastructure & $0 Continuity

- [ ] **INFRA-01**: Preserve verified off-host PostgreSQL backup (`.secrets/hosted-backups/property-crawl-render-2026-11-09.dump`, 11,382 listings) and configure $0 database continuity before 2026-11-19 expiry
- [ ] **COMPACT-01**: Execute and verify observation snapshot deduplication compactor (`scripts/compact-snapshots.js`) with transition retention

### Full-Stack Completeness & UI Craft

- [x] **UI-01**: Pass Impeccable design detector (`impeccable detect src/ --no-advisory`) with zero anti-patterns
- [x] **API-01**: Wire `DELETE /api/alerts/[id]` proxy route and verify thin-route and alert delivery contracts
- [x] **DOCKET-01**: Complete statutory title-risk rules and adversarial docket coverage across priority states (`src/lib/adversarial-docket.ts`)

### Release & Verification Gates

- [ ] **REL-01**: Reconcile working tree, regenerate `CONTEXT.md` digest if needed, and pass all 9/9 PP-02 source-bound release gates (`scripts/release-gate.js`)

## v2 Requirements

Deferred to future external-access milestones.

### External Recorder & Partner Feeds

- **REC-01**: Maricopa County AZ authorized partner API integration (currently blocked by publisher robots.txt 403)
- **REC-02**: Harris County TX raster PDF OCR address/APN extraction pipeline (currently `evidence_only`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Paid Render Postgres tier ($20/mo) | Owner mandated $0 hosting continuity |
| Synthetic/interpolated ARV valuations | Prohibited by Zero-Fabrication architecture |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| UI-01 | Phase 1 | Complete |
| API-01 | Phase 1 | Complete |
| DOCKET-01 | Phase 1 | Complete |
| INFRA-01 | Phase 2 | Pending |
| COMPACT-01 | Phase 2 | Pending |
| REL-01 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 8 total
- Mapped to phases: 8
- Unmapped: 0

---
*Requirements defined: 2026-11-09*
*Last updated: 2026-11-09 after Triple Audit*
