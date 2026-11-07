# Audit 10 — HPI Fabrication Removal & Observed State Trends (2026-11-07)

Scope: removal of the fabricated FHFA House Price Index engine and the
HPI→per-property-dollar-band path, replacement of the fake statewide YoY with
observed publisher data, and repair of the dead HPI collector. Companion to
`audit/07` (whose claim that `server/enrichment/hpi.js` re-exports the
intelligence table was false — `hpi.js` was always standalone) and to checklist
item #4, now updated in `docs/COMPLETION_CHECKLIST.md`.

## 1. Defect, verified at runtime before any edit

`server/intelligence/fhfa-hpi.js` shipped a hand-written `US_NATIONAL_HPI`
table (45 periods, 2015Q1–2026Q1) plus `STATE_HPI_WEIGHTS` (20 states) under
the comment "Representative benchmarks calibrated against official FHFA master
release data". No such calibration existed. Runtime proof on the session-start
tree:

- `getAppreciationMultiplier` returned the identical **1.793** for OH, FL, CA,
  WY, TX and AK — the per-state weight cancels between the two periods, so
  even the "state differentiation" was arithmetically inert.
- `deriveStateHpiYoy` returned the identical **3.8** for every state.
- `calculateMacroValuation({historicalValue:150000, historicalYear:2018,
  state:'OH'})` minted `estLow 247,434 / estHigh 290,466` with **no observed
  series**.
- `getCountyMarketTrends('OH','Cuyahoga')` served a hand-written
  `$215,000 / +5.4% / hot` "benchmark" (`COUNTY_MARKET_BENCHMARKS`, 21
  counties, provenance "calibrated against public housing market indices" —
  none existed).
- `evaluateOpportunitySignals` on a live-shaped listing produced
  `bid_to_value_ratio: supported`, `evidenceClass: macro_housing_index`,
  `valuationProvenance: fhfa_hpi_macro_trend`, **triagePriority 21** —
  30%-weight component scored from the fabricated band.
- `server/scrapers/fhfa-hpi.js` defaulted to
  `https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv`
  → **HTTP 404**; the collector could never run.

Policy basis (the design was already ruled by the repo, not by this audit):
`docs/COMPLETION_CHECKLIST.md` — "An HPI band is **not** a way out either: an
index reports percentage change over time, not a dollar value for one house";
AGENTS.md §10 — "Never impute `estLow`, `estHigh`, or ARV from `openingBid` or
assessed value". The fix therefore **removes** the band path rather than
re-sourcing it.

## 2. Publisher evidence (live, 2026-11-06/07)

- Legacy per-(state, period) DataTools file and every legacy path: 404.
- Live public state endpoint `https://www.fhfa.gov/hpi-state/csv`: 200,
  `text/csv`, 1901 bytes, header `State,Rank,"1 Quarter","1 Year","5 Year",
  "Since 1991"`, 51 rows, seasonally adjusted **percent changes only** —
  no per-quarter index levels, no period column. sha256 of the exact bytes:
  `2dd86a2c8b8053267b14868200afdc7910e56ddb4ba8b50d23d5a919c3d65c53`.
- Release schedule via `/data/hpi`: next quarterly release 2026-11-24 covering
  2026Q3; `api.fhfa.gov` does not resolve; HPI-calculator is a Drupal AJAX app
  with no index-level API.
- Consequence: quarterly **index levels** are not publicly published. The
  trajectory contract (`server/enrichment/hpi.js`, `isObservedSeries`) stays
  operator-supplied (`FHFA_HPI_SERIES_PATH`) and fails closed.

## 3. Changes

Deleted (fabrication surface removed outright):
- `server/intelligence/fhfa-hpi.js` (fabricated table + weights)
- `server/enrichment/macro-valuation.js` (`calculateMacroValuation` /
  `explicitDollarBasis` — the band path; `decision-packet`'s
  `listing.macroValuation` was always null and stays null)

New (observed data layer, tamper-evident):
- `server/enrichment/fhfa-state-hpi.js` — loads
  `server/enrichment/data/fhfa-state-hpi.json`, re-hashes the embedded raw
  publisher CSV on every read (`datasetSha256` over exact bytes), fails closed
  on any mismatch, non-fhfa source, or missing/invalid `retrievedAt`.
- `scripts/ingest-fhfa-hpi.js` — fetches the live endpoint (fhfa.gov-only,
  byte-bounded), validates, writes the snapshot. Run 2026-11-07: 51 states,
  sha256 above, `retrievedAt 2026-11-07T00:18:16.310Z`.

Rewired:
- `server/enrichment/hpi.js` — `DEFAULT_CURRENT_PERIOD` ('2026Q1' hardcode)
  removed; `getLatestObservedPeriod(series)` derives the current period from
  the observed series itself.
- `server/enrichment/public-benchmark-consensus.js` — current period derived
  from the series; trajectory computes only with an observed series and an
  explicit assessment quarter; estLow/estHigh/dealScore remain null.
- `server/enrichment/macro-valuation-data.js` — fabricated
  `COUNTY_MARKET_BENCHMARKS` deleted; `deriveStateHpiYoy` reads the observed
  snapshot (null when unobserved); `classifyMarketTemperature(null)` returns
  null (unknown) instead of the fabricated 'balanced'; source labels
  `FHFA_STATE_HPI_SUMMARY` / `PUBLIC_COUNTY_BENCHMARKS` / null.
- `server/intelligence/signals.js` — `fhfa_hpi_macro_trend` branch removed;
  `bid_to_value_ratio` uses only a publisher range
  (`calculated_ratio`) or the enrolled assessor registry
  (`official_parcel_roll`); otherwise unknown/unresolved. The declining-market
  caveat now keys off observed per-state YoY.
- `server/scrapers/fhfa-hpi.js` + `server/scrapers/source-policy.js` +
  `src/lib/listing-links.ts` — collector repointed to the live endpoint; one
  evidence record per state (percent changes + `datasetSha256` in
  `sourceFacts`, every property/bid/date/geo field null); record-shape
  validators accept `/hpi-state/csv?geo=<state>` only; retired path rejected;
  `DEFAULT_MAX_RECORDS` 50→100 so a default run covers all 51 rows.
- `server/sources/catalog.js` (fhfa-hpi row) — false "configured FHFA API key"
  workflow and "hand-written table … not applied to listings" note replaced
  with the live-endpoint reality; `access: 'account'` → `'public'`.
- `scripts/ingest-macro-trends.js` — YoY-less rows no longer crash on
  `classifyMarketTemperature(null)`; label "YoY Unobserved Market".
- `scripts/measure-triage-resolution.js` — `macro_housing_index` bucket
  removed (evidence class no longer exists).

## 4. Tests (fabrication pins → positive/negative controls)

- `test/fhfa_hpi_valuation.test.js` — deletion controls (both modules
  `MODULE_NOT_FOUND`), observed-series contract, snapshot tamper evidence,
  fixture-based per-state differentiation (OH 4.41 / AK 8.3 / CA −0.2 /
  XX null), signals negative + publisher-range positive controls. (Node 24
  note: `assert.throws(fn, /MODULE_NOT_FOUND/)` cannot match because the
  regex tests `String(err)`; the equivalent `error.code ===
  'MODULE_NOT_FOUND'` validation is used.)
- `test/enrichment/macro-valuation-data.test.js` — fixture harness; no
  `COUNTY_MARKET_BENCHMARKS` export; stringified-output scan proves
  `FHFA_AND_PUBLIC_BENCHMARKS` never appears.
- `test/intelligence/signals-helpers.test.js` — the `fhfa_hpi_macro_trend`
  pin rewritten as the negative control.
- `test/fhfa-hpi.test.js`, `test/scrapers/source-policy-helpers.test.js` —
  live-shape collector contract incl. negative controls (missing metric
  column, <50 rows, retired URL).
- `test/scripts/observation-tools.test.js` — buckets
  `['calculated_ratio','official_parcel_roll']`.

## 5. Live-inventory impact (10,849 publisher-observed records, `.cache/live-listings.json`)

| Bucket | Count | Note |
|---|---|---|
| Direct publisher band | 0 | matches the checklist's known finding |
| Assessor-registry supported | 3 | unchanged before/after — no triage regression |
| Would have hit the fabricated macro path | 0 | the band needed a top-level `assessedValue`+`assessmentYear`; no live record carries both. The mechanism was live (proven on a synthetic record: triage 21) but fired on zero current records |
| Now receive an honest declining-market caveat | 1,096 (CA 473, CO 405, WA 117, NM 101) | previously impossible — every state showed the fake uniform +3.8% |

## 6. Verification receipts

- `node --test test/fhfa-hpi.test.js test/scrapers/source-policy-helpers.test.js
  test/scrapers/scraper-interface.test.js test/distress-lifecycle.test.js`
  → 106/106; `npx tsc --noEmit -p tsconfig.json` → clean.
- Test-rewrite set → 111/111 across the six files.
- `node --test test/enrichment_geocoding.test.js test/docs-checklist-honesty.test.js`
  → 28/28 (after the two fixes in §7).
- `node scripts/verify-gate.js` → 6/6 suites; `npm run build` → green
  (middleware NFT manifests verified).
- `node test/verify.js` → **48/50 suites** (47/50 before the §7 fixes),
  18 DB-gated tests skipped without `DISCOVERY_TEST_DATABASE_URL`
  (documented residual; the full gate is not claimable without it).

## 7. Collateral fixes found by the full suite (not HPI-caused)

- `test/docs-checklist-honesty.test.js` correctly rejected this audit's first
  checklist row because it said "mostly closed" inside the open-work table —
  reworded; the meta-test is doing its job.
- `test/enrichment_geocoding.test.js` Bexar fixture still used the retired
  all-caps BCAD field names (`PROP_ID`, `APPRAISED_VAL`, …) after commit
  `c592913` corrected the layer config to the real publisher casing
  (`PropID`, `State_cd`, `TotVal`, `LandVal`, `ImprVal`, `LglDesc`). The code
  was right; the fixture was updated to match.

## 8. Remaining failures at HEAD (pre-existing, outside this change set)

- Suite 1: "InteractiveTerminal wires AlertsModal and Alerts button — Alerts
  button missing from `interactive-terminal.tsx`" (file unmodified in the
  working tree).
- Suite 11 (Playwright): search input `to_have_value('FL')` got `''`; duplicate
  `id="due-diligence-binder"` (div + section) strict-mode violation.
- Both belong to the UI lane; the only `src/` file modified by the concurrent
  track (`src/app/api/public/scrapy-ingest/route.ts`) cannot cause either.

## 9. Out-of-scope residuals

- Quarterly index-level series remains operator-supplied
  (`FHFA_HPI_SERIES_PATH`); not publicly published by FHFA.
- `county-market-benchmarks.json` (2 NJ counties, ETL-produced) still lacks a
  provenance envelope; deferred.
- 18 DB-gated suites require `DISCOVERY_TEST_DATABASE_URL`.
