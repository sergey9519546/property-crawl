# Triage resolution baseline — 2026-10-21

> First run of the repeatable measurement harness (`npm run triage:measure`,
> scripts/measure-triage-resolution.js). This baseline was captured against the
> **local discovery stack** (`discovery:local` Postgres on 127.0.0.1:55432,
> 2,192 seeded listings + the imported 32+ day legacy observation history:
> 25,052 snapshots / 11,202 tracked records spanning 2026-09-05 → 2026-10-21).
> Production numbers should be re-captured in production after a few collection
> cycles; the harness is the same command.

## Baseline (local stack, 300 of 2,192 listings)

```
Listings measured: 300 of 2192
Direct publisher valuation bands (estLow/estHigh): 0
Harvested assessor rolls: 0
Ratio component: supported=0 contradicted=0 unknown=300
  by evidenceClass: {"official_parcel_roll":0,"macro_housing_index":0,"calculated_ratio":0}
bid_reduction supported: 0
returned_to_market supported: 0
triage distribution: {"zero":270,"low":30,"moderate":0,"high":0,"max":20,"avg":2}
County coverage: unenrolled: listings=300 rolls=0
```

## Reading the numbers

- **Valuation bands dark, as expected**: the seed inventory carries no
  `estLow`/`estHigh` and no harvested rolls, so the ratio component (30% weight)
  resolves for 0 of 300. The enrollment expansion
  (`reports/assessor-enrollment-2026-10-21.md`, 8 converted counties) and the
  raised harvest budget (`PROPERTY_ASSESSOR_HARVEST_LIMIT`, default 100) are the
  levers; the measure command is the before/after gate.
- **Observation history is intact in Postgres**: the one-time import
  (`npm run observations:import`) moved every legacy snapshot idempotently
  (a second run persisted 0), and per-record replay derives transitions live —
  records with 6–7 snapshots show their full sale-date/status transition
  sequences to the evaluator.
- **Live import + sort round-trip**: migration 027's `source_observation_runs`
  table is live (16 run rows imported; 5 unknown-source run keys skipped with
  reasons), and `sort=triage` executes against Postgres with the
  refreshed_at staleness guard (all-seeded rows rank NULLS LAST by id).

## What changes after harvest cycles

Re-run `npm run triage:measure` after a few collection cycles and compare:

1. `assessorRollHarvested` > 0 for listings in converted counties;
2. ratio-component `supported`/`contradicted` > 0 with
   `official_parcel_roll` dominating `byEvidenceClass`;
3. triage distribution shifting from `zero`/`low` toward `moderate`/`high`.

Band-threshold recalibration (`src/lib/triage-bands.ts`, moderate 30 / high 50)
remains deferred until (2) has data, per the plan.
