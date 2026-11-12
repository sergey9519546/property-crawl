# Live Canary Verification Report

**Timestamp**: 2026-11-12T07:38:02Z  
**Environment**: Embedded PostgreSQL 17 + PostGIS 3.6 Engine (`PROPERTY_DB=embedded`, `DISCOVERY_MODE=advanced`)  
**Methodology**: Migration 014 Canary Gate (`scripts/canary-live.js`)

---

## 1. Executive Summary

Executed live end-to-end canary acquisition against live public auction endpoints to verify zero-drop parsing, schema validation, and database ingestion under production constraints.

---

## 2. Ingestion Results

| Source | Scope | Discovered | Accepted | Rejected | Error | Clean Status | Report Artifact |
|---|---|---|---|---|---|---|---|
| `treasury` | live web portal | 16 | 16 | 0 | None | **CLEAN (1/1)** | `.cache/canary-reports/canary-2026-11-12T07-38-02-322Z-8322d3a9.json` |

### Key Ingestion Invariants Verified:
1. **Zero-Drop Parsing**: 16/16 discovered listings successfully parsed without schema rejection (`rejected = 0`).
2. **Snapshot Tracking**: All 16 records snapshotted for price-drop and lien-risk tracking.
3. **Triage Priority**: Dynamic triage scores calculated and indexed in Postgres for all 16 listings.
4. **PostgreSQL Durability**: Ingestion completed cleanly in transaction without database lock contention.
