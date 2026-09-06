# Episode — 2026-09-06 All Mentioned Upgrades Executed (Tier 3 & Priority Upgrades Complete)

**Date**: 2026-09-06
**Branch**: main
**Task**: Implement all mentioned roadmap upgrades (Tier 3.3, Priority Upgrade 3, Task 3.1)

## What was done

1. **Capability Graph & Runtime Dispatch (T3.3)**:
   - Created `scripts/capability-graph.js`: typed capability registry declaring inputs, outputs, dependencies, and produced products.
   - Built DAG compiler with cycle detection, topological sorting, and parallel stage grouping using Kahn's algorithm.
   - Verified that standard distressed-property workflow groups into 4 deterministic stages:
     - Stage 1 [Sequential]: `scrape_auctions`
     - Stage 2 [Sequential]: `normalize_listings`
     - Stage 3 [Parallel]: `compute_deal_score`, `enrich_public_records`, `evaluate_opportunity_signals`
     - Stage 4 [Sequential]: `generate_property_dossier`
   - Added `test/capability-graph.test.js` (7/7 pass).

2. **Transparent Opportunity-Signal Evaluator (Priority Upgrade 3)**:
   - Implemented `server/intelligence/signals.js`: evaluates 6 evidence-backed signals (`sale_date_known`, `bid_reduction`, `returned_to_market`, `bid_to_value_ratio`, `building_area_discrepancy`, `title_equity_unresolved`).
   - Generates deterministic status (`supported`, `unknown`, `contradicted`), exact evidence class, timestamps, reasons, and next research actions.
   - Computes transparent `triagePriority` (0-100) using published component weights (30% ratio, 20% sale date, 20% bid reduction, 10% area discrepancy, 10% return to market, 10% completeness).
   - Integrated into `server/intelligence/dossier.js` so property dossiers automatically include opportunity signals.
   - Created route `server/routes/property-signals.js` wired into `server/server.js` (`/api/signals` and `/api/property-signals`).
   - Added `test/signals.test.js` (9/9 pass).

3. **Database Seeder from v0 Data (Task 3.1)**:
   - Created `scripts/seed-from-v0.js` with `--dry-run`, `--init-schema`, and live PostgreSQL seeding options.
   - Added `test/seed-from-v0.test.js` (3/3 pass).

4. **Master Verification Loop Expansion**:
   - Fixed `src/lib/db/client.js` to re-export canonical `server/db/client.js`.
   - Added Suites 18, 19, 20, 21 to `test/verify.js` (expanding verification from 24 to 28 suites).
   - Regenerated drift-gated `CONTEXT.md`.

## Verification Results

- `npm run test:sources`: 64/64 PASS
- `npm run test:intelligence`: 53/53 PASS
- `node --test test/capability-graph.test.js`: 7/7 PASS
- `node --test test/signals.test.js test/seed-from-v0.test.js`: 12/12 PASS
- `node scripts/verify-gate.js --change-type=agent`: 6/6 PASS
- `node test/verify.js`: 28/28 Suites Passed (0 Failed)
