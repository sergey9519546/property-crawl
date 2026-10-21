# Triage-evaluator defect fixes — 2026-10-21

> Follow-up to the in-flight Opportunity-Signal expansion work (8 signals,
> migration 025) reviewed on 2026-10-20. This report records the six verified
> defects from that review, their fixes, the test evidence, and an honest
> re-measurement of the live score distribution. The 50/70 priority thresholds
> were deliberately NOT recalibrated; with the ratio component still dark the
> honest fix is feeding inputs, not rescaling the ruler.

## What was fixed

1. **Relist classifier dead on production vocabulary (CRITICAL).**
   `compareSnapshots` and the evaluator's history check used anchored
   `^enum$` regexes against prose statuses. Measured before the fix: 0 of
   1,526 real transitions classified. Both now share one exported
   `classifyStatusActivity` normalizer (strip `Status:` prefix, collapse
   whitespace, substring match; an inactive marker wins over an `Active -`
   prefix, so `"Status: Active - Postponed"` is inactive). Real strings from
   the live store are pinned in tests: `"Status: Active - Postponed"` (950
   listings), `"Status: Cancelled"`, `"Status: Auctioned - Reverted to
   Beneficiary"`, `"Auction Ends: Oct 07, 2026"`.
   `server/sources/observations.js`, `server/intelligence/signals.js`.

2. **Migration 025 was unwired scaffolding.**
   `source_observations` had no writer and `listings.triage_priority` had no
   writer anywhere. New `server/db/observations-persistence.js`:
   - `persistSourceObservations` — batched, idempotent
     (`ON CONFLICT (id) DO NOTHING`) row mirror with an `sources(key)` FK
     pre-check (an unenrolled source skips the mirror instead of aborting
     the batch), wired into the scheduler ingest path and
     `scripts/collect-source.js` (best-effort; the filesystem store remains
     the operational record).
   - `loadObservationsForRecord` — PG reader for `/api/property-signals` that
     rebuilds the evaluator-shaped `{records, signals}` view by replaying the
     same `compareSnapshots` classifier, so PG and the JSON store can never
     classify the same history differently. The route reads PG first and falls
     back to the filesystem store while the table fills.
   - `updateTriagePriority` — write-through refresh on every evaluation; a
     score computed over an unreadable history (`historyUnavailable`) is a
     degraded view and is never persisted. Every write stamps
     `triage_priority_refreshed_at` (migration 026, added by the concurrent
     session): the score is time-dependent, so sorting consumers must treat
     a stale value as unknown.
   - `recomputeTriageForListings` — ingest-time refresh for the listings a
     collection run advanced (added by the concurrent session on top of the
     reader/writer above), so hunt sorting does not wait on views.

3. **`document_vault_verified` overclaimed verification.**
   Spot-check of production `sourceFacts.documents` (7,962/10,285 listings):
   the files are publisher-hosted auction PDFs — PA consumer notices,
   lead-paint pamphlets, PSA templates. Renamed the signal to
   `publisher_documents` with `evidenceClass: 'publisher_document_links'` and
   wording that states they are publisher-hosted files, not independently
   verified docket or title instruments.

4. **Dead code / comment nits in the evaluator.**
   `valuationLabel = hasDirectRange ? null : null` simplified; the redundant
   third clause of the observation-relist matcher removed; the
   "prevents double-counting" comment now states the real framing (area and
   ratio intentionally contribute both depth and research completeness).

5. **Snapshot reporting for persistence.** `updateObservations` /
   `recordSourceRun` now return the exact snapshots that advanced a record
   (stale captures excluded), which is what the ingest writer consumes.

6. **Live re-measurement** (below).

## Verification (all on the dirty tree containing these fixes)

- `npm run test:signals` — 24/24 (was 19; +route PG wiring, +prose-vocabulary,
  +document-honesty tests)
- `test/intelligence/signals-helpers.test.js` — 39/39 (key set updated for the
  renamed signal; honesty assertions tightened)
- `node --test test/source-observations.test.js` — 13/13 (+3 real-vocabulary
  and snapshot-reporting tests)
- `npm run test:db` — 97/97 (includes new
  `test/db/observations-persistence.test.js`, 6/6, wired into the runner)
- `npm run test:intelligence` — 630/630
- `npm run test:evidence-truth` — 585/585
- `node --test test/sources/observations-snapshot.test.js test/property-intelligence.test.js test/source-network.test.js test/source-intake.test.js test/scheduler-checkpoint.test.js` — 66/66
- `npx tsc --noEmit -p tsconfig.json` — clean
- `npm run context:gen` + release gate `--quick` — **7/7 PASS** (typecheck,
  generated-context, schema-mirrors, test-wiring, ops-suites,
  scraper-parser, production-smoke) on the final merged tree.
- A concurrent session extended this work in the same tree and its additions
  are included in the verification above: migration 026
  `triage_priority_refreshed_at`, ingest-time `recomputeTriageForListings`,
  assessor-roll harvest on ingest, valuation fallbacks via
  `provenance.derivedFields.assessorRoll`, `src/lib/triage-bands.ts` with
  band constants recalibrated to the measured distribution
  (moderate at 30, high at 50), and its own
  `test/observations-persistence.test.js` / `test/assessor-harvest.test.js` /
  `test/triage-bands.test.mjs` suites — all wired into runners and green.

## Live re-measurement (10,285 live records, real observation store)

| Metric | Before fixes (2026-10-20 review) | After fixes |
|---|---|---|
| `returned_to_market` supported | 0 of 1,526 transitions | **280** (all `exact_source_observation`, spot-checked: genuine postpone/cancel → active histories) |
| max triagePriority | 22 | **30** |
| avg triagePriority | ~2.9 (score-20 set) | 4.31 |
| listings with any score > 0 | 2,075 actionable all scoring 20 | 2,300 (0 / 1–49 / 50–69 / 70+ = 7,985 / 2,300 / 0 / 0) |

The stored signal log still contains no `returned_to_market` events (it was
written by the old classifier and is capped at 2,000 entries) — the 280
supported evaluations come from the history-status path. New collection runs
will emit structured relist events going forward.

## Still open (honest residuals)

- **Valuation bands remain dark at the record level**: `estLow`/`estHigh` on
  0/10,285 records; the assessor/FHFA fallback resolves for ~1% directly
  (101 records with assessed values, 3 enrolled counties). The concurrent
  session's ingest-time assessor-roll harvest is designed to light this up —
  re-measure the ratio-component resolution after a few collection cycles
  before drawing conclusions.
- `bid_reduction` support is 3 records (3 real `bid_reduced` events
  store-wide); multi-snapshot histories must accumulate (Scrapy Cloud job
  scheduling is the intended lever).
- The band thresholds are now calibrated to the measured distribution
  (moderate 30 / high 50); re-visit once the ratio component has real input
  data.
- The evaluator's PG read path lives in `/api/property-signals` and the
  ingest recompute; the property-intelligence route still reads durable
  discovery evidence or the filesystem store (its `stored.observations` path
  predates migration 025).
- The stored signal log (2,000-entry cap) predates the classifier fix, so it
  holds no `returned_to_market` events yet; the 280 supported evaluations
  above come from the history-status path. New collection runs emit
  structured relist events going forward.
