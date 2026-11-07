'use strict';

// test/fhfa_hpi_valuation.test.js
//
// FHFA HPI honesty contract after the macro-valuation removal
// (docs/COMPLETION_CHECKLIST.md: an index is not a per-house dollar band;
// AGENTS.md §10: never impute estLow/estHigh from an index).
//
// The hand-written US_NATIONAL_HPI / STATE_HPI_WEIGHTS tables that minted a
// per-property dollar valuation band are deleted. This file pins:
//   - require() of the deleted modules fails closed with MODULE_NOT_FOUND;
//   - server/enrichment/hpi.js only serves explicitly observed series (no
//     DEFAULT_CURRENT_PERIOD fallback exists);
//   - server/enrichment/fhfa-state-hpi.js re-hashes the embedded publisher
//     bytes and fails closed on any provenance mismatch;
//   - observed statewide values come from the offline fixture snapshot
//     (never pinned to committed-file values, which are re-ingestible);
//   - bid_to_value_ratio no longer consults a macro housing index: an
//     explicit assessed basis alone stays unresolved, while a direct
//     publisher estLow/estHigh band still yields a calculated_ratio signal.

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hpi = require('../server/enrichment/hpi');
const stateHpi = require('../server/enrichment/fhfa-state-hpi');

const NOW = Date.UTC(2026, 0, 15);
const FIXED_RETRIEVED_AT = '2026-01-05T00:00:00.000Z';
const FIXED_SOURCE_URL = 'https://www.fhfa.gov/hpi-state/csv';

// --- offline observed-snapshot fixture (no network) ---------------------

function buildFixtureCsv() {
  const lines = ['State,Rank,"1 Quarter","1 Year","5 Year","Since 1991"'];
  const explicitYoy = { OH: '4.41', AK: '8.30', CA: '-0.20' };
  let index = 0;
  for (const [name, code] of Object.entries(stateHpi.STATE_NAME_TO_CODE)) {
    index += 1;
    const yoy = explicitYoy[code] !== undefined
      ? explicitYoy[code]
      : (index / 10 - 3).toFixed(2); // deterministic, distinct per state
    const quarterPct = ((index % 5) * 0.2).toFixed(2);
    const fiveYearPct = (index * 1.1).toFixed(2);
    const since1991Pct = (100 + index * 2).toFixed(2);
    lines.push(`${name},${index},${quarterPct},${yoy},${fiveYearPct},${since1991Pct}`);
  }
  return lines.join('\n');
}

const FIXTURE_SNAPSHOT = stateHpi.buildStateHpiSnapshot({
  sourceUrl: FIXED_SOURCE_URL,
  retrievedAt: FIXED_RETRIEVED_AT,
  csvText: buildFixtureCsv(),
});

let fixtureDirectory = null;
let previousEnvValue;

before(() => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fhfa-hpi-valuation-fixture-'));
  const fixturePath = path.join(fixtureDirectory, 'fhfa-state-hpi.json');
  fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE_SNAPSHOT), 'utf8');
  previousEnvValue = process.env.FHFA_STATE_HPI_PATH;
  process.env.FHFA_STATE_HPI_PATH = fixturePath;
  stateHpi.invalidateStateHpiCache();
});

after(() => {
  if (previousEnvValue === undefined) delete process.env.FHFA_STATE_HPI_PATH;
  else process.env.FHFA_STATE_HPI_PATH = previousEnvValue;
  stateHpi.invalidateStateHpiCache();
  if (fixtureDirectory) fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

// --- deletion controls ---------------------------------------------------

test('deletion controls: the hand-minted HPI valuation modules fail closed', () => {
  // assert.throws matches String(err), not err.code, so the code must be
  // asserted through a validation function (the message does not contain
  // the literal string MODULE_NOT_FOUND on Node 24).
  assert.throws(
    () => require('../server/intelligence/fhfa-hpi'),
    (error) => error.code === 'MODULE_NOT_FOUND'
  );
  assert.throws(
    () => require('../server/enrichment/macro-valuation'),
    (error) => error.code === 'MODULE_NOT_FOUND'
  );
});

// --- server/enrichment/hpi.js contract -----------------------------------

function observedSeries(overrides = {}) {
  return {
    version: 1,
    sourceUrl: 'https://www.fhfa.gov/hpi/quarterly',
    retrievedAt: FIXED_RETRIEVED_AT,
    datasetSha256: 'a'.repeat(64),
    values: { OH: { '2025Q1': 100, '2026Q1': 120 } },
    ...overrides,
  };
}

test('hpi.js: isObservedSeries rejects series without valid FHFA provenance', () => {
  assert.equal(hpi.isObservedSeries(observedSeries()), true, 'the valid fixture itself is observed');

  assert.equal(
    hpi.isObservedSeries(observedSeries({ sourceUrl: 'https://example.gov/hpi/quarterly' })),
    false,
    'a non-fhfa.gov sourceUrl is not observed'
  );
  assert.equal(
    hpi.isObservedSeries(observedSeries({ sourceUrl: 'http://www.fhfa.gov/hpi/quarterly' })),
    false,
    'a plain-http sourceUrl is not observed'
  );
  assert.equal(
    hpi.isObservedSeries(observedSeries({ datasetSha256: 'not-a-sha256' })),
    false,
    'a non-64-hex datasetSha256 is not observed'
  );
  assert.equal(
    hpi.isObservedSeries(observedSeries({ retrievedAt: undefined })),
    false,
    'a missing retrievedAt is not observed'
  );
  assert.equal(
    hpi.isObservedSeries(observedSeries({ retrievedAt: 'not-a-date' })),
    false,
    'an unparseable retrievedAt is not observed'
  );
  assert.equal(
    hpi.isObservedSeries(observedSeries({ version: 2 })),
    false,
    'a version other than 1 is not observed'
  );
  assert.equal(hpi.isObservedSeries(null), false);
  assert.equal(hpi.isObservedSeries(observedSeries({ values: undefined })), false);
});

test('hpi.js: DEFAULT_CURRENT_PERIOD is gone; indices need an observed series', () => {
  assert.ok(!('DEFAULT_CURRENT_PERIOD' in hpi), 'the implicit current-period fallback must not exist');
  assert.equal(hpi.DEFAULT_CURRENT_PERIOD, undefined);

  assert.equal(hpi.getHpiIndex('OH', '2026Q1', null), null, 'no series means no index');
  assert.equal(hpi.getHpiIndex('OH', '2026Q1', observedSeries({ version: 2 })), null, 'unobserved series means no index');
  assert.equal(hpi.getHpiIndex('OH', '2099Q4', observedSeries()), null, 'a missing period is null even on an observed series');
  assert.equal(hpi.getHpiIndex('OH', '2026Q1', observedSeries({ values: { OH: { '2026Q1': 0 } } })), null, 'a non-positive value is null');
  assert.equal(hpi.getHpiIndex('OH', '2026Q1', observedSeries()), 120, 'an observed series serves its explicit values');
  assert.equal(hpi.getAppreciationMultiplier('OH', '2025Q1', '2026Q1', observedSeries()), 1.2);
  assert.equal(hpi.getAppreciationMultiplier('OH', '2025Q1', '2026Q1', null), null);
});

test('hpi.js: getLatestObservedPeriod derives the max period from the series itself', () => {
  const series = observedSeries({
    values: {
      OH: { '2024Q2': 100, '2026Q1': 120, latest: 999 },
      FL: { '2025Q3': 90 },
    },
  });
  assert.equal(hpi.getLatestObservedPeriod(series), '2026Q1', 'lexicographic max across all states, /YYYYQ[1-4]/ only');
  assert.equal(hpi.getLatestObservedPeriod(null), null, 'no series means no period');
  assert.equal(hpi.getLatestObservedPeriod(observedSeries({ version: 2 })), null, 'unobserved series means no period');
});

// --- snapshot provenance (fhfa-state-hpi.js) -----------------------------

function fixtureSnapshot(overrides = {}) {
  return stateHpi.buildStateHpiSnapshot({
    sourceUrl: FIXED_SOURCE_URL,
    retrievedAt: FIXED_RETRIEVED_AT,
    csvText: buildFixtureCsv(),
    ...overrides,
  });
}

test('state HPI snapshot: tampering the embedded CSV fails the re-hash', () => {
  const tampered = { ...FIXTURE_SNAPSHOT, rawCsv: `${FIXTURE_SNAPSHOT.rawCsv}Tampered,1,2,3,4,5\n` };
  assert.equal(stateHpi.isObservedStateHpiSnapshot(tampered), false, 'an edited value cannot be served as observed');
});

test('state HPI snapshot: provenance must be https on an fhfa.gov host', () => {
  assert.equal(stateHpi.isObservedStateHpiSnapshot(fixtureSnapshot({ sourceUrl: 'http://www.fhfa.gov/hpi-state/csv' })), false);
  assert.equal(stateHpi.isObservedStateHpiSnapshot(fixtureSnapshot({ sourceUrl: 'https://example.com/hpi-state/csv' })), false);
  assert.equal(stateHpi.isObservedStateHpiSnapshot(fixtureSnapshot({ sourceUrl: 'not a url' })), false);
});

test('state HPI snapshot: a missing retrievedAt fails closed', () => {
  assert.equal(stateHpi.isObservedStateHpiSnapshot(fixtureSnapshot({ retrievedAt: undefined })), false);
});

test('state HPI snapshot: the valid fixture is observed with at least 50 state rows', () => {
  assert.equal(stateHpi.isObservedStateHpiSnapshot(FIXTURE_SNAPSHOT), true);
  const parsed = stateHpi.parseStateHpiCsv(FIXTURE_SNAPSHOT.rawCsv);
  assert.equal(parsed.hasMetrics, true);
  assert.ok(parsed.rowCount >= 50, `expected at least 50 state rows, got ${parsed.rowCount}`);
});

// --- observed differentiation from the fixture (not committed values) ----

test('state HPI observed values: fixture-specific YoY per state, null for unknown codes', () => {
  assert.equal(stateHpi.getStateHpiYoy('OH'), 4.41);
  assert.equal(stateHpi.getStateHpiYoy('AK'), 8.3);
  assert.equal(stateHpi.getStateHpiYoy('CA'), -0.2);
  assert.equal(stateHpi.getStateHpiYoy('XX'), null, 'placeholder state codes are never observed');
});

// --- committed snapshot smoke (shape only; no env override) ---------------

test('committed FHFA state snapshot: exists and validates as observed without value pinning', () => {
  const committedPath = path.resolve(__dirname, '../server/enrichment/data/fhfa-state-hpi.json');
  assert.equal(fs.existsSync(committedPath), true, 'the committed snapshot file must exist');

  const savedEnv = process.env.FHFA_STATE_HPI_PATH;
  delete process.env.FHFA_STATE_HPI_PATH;
  stateHpi.invalidateStateHpiCache();
  try {
    const loaded = stateHpi.loadObservedStateHpi();
    assert.ok(loaded, 'the committed snapshot must load and validate as observed');
    assert.equal(loaded.parsed.hasMetrics, true);
    assert.ok(loaded.parsed.rowCount >= 50, `committed snapshot row count: ${loaded.parsed.rowCount}`);
    assert.match(String(loaded.snapshot.datasetSha256), /^[a-f0-9]{64}$/);
    assert.match(String(loaded.snapshot.sourceUrl), /^https:\/\/(www\.)?fhfa\.gov\//);
  } finally {
    if (savedEnv === undefined) delete process.env.FHFA_STATE_HPI_PATH;
    else process.env.FHFA_STATE_HPI_PATH = savedEnv;
    stateHpi.invalidateStateHpiCache();
  }
});

// --- signals: the macro-index valuation branch is removed ----------------

function sheriffListing(overrides = {}) {
  return {
    id: 'SHERIFF-OH-CUY-1',
    state: 'OH',
    county: 'Cuyahoga',
    assessedValue: 120000,
    assessmentYear: 2020,
    openingBid: 80000,
    sourceUrl: 'https://sheriffsaleauction.ohio.gov/x/2024-CV-001',
    sourceObservedAt: '2026-01-10T00:00:00.000Z',
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'Test Sheriff',
      recordId: '1',
    },
    ...overrides,
  };
}

test('signals negative control: an explicit assessed basis alone never mints a macro-index valuation', () => {
  const { evaluateOpportunitySignals } = require('../server/intelligence/signals');
  const listing = sheriffListing(); // NO estLow/estHigh, no assessor parcel
  const result = evaluateOpportunitySignals(listing, { now: NOW });

  const ratioSig = result.signals.find((s) => s.key === 'bid_to_value_ratio');
  assert.ok(ratioSig, 'the bid_to_value_ratio signal must exist');
  assert.equal(ratioSig.status, 'unknown');
  assert.equal(ratioSig.evidenceClass, 'unresolved');
  assert.equal(ratioSig.valuationProvenance, undefined, 'an unresolved ratio carries no valuationProvenance');

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('macro_housing_index'), 'no signal may carry the macro_housing_index evidence class');
  assert.ok(!serialized.includes('fhfa_hpi_macro_trend'), 'no signal may carry the fhfa_hpi_macro_trend provenance');
});

test('signals positive control: a publisher estLow/estHigh band still yields a calculated_ratio signal', () => {
  const { evaluateOpportunitySignals } = require('../server/intelligence/signals');
  const listing = sheriffListing({ estLow: 100000, estHigh: 140000 });
  const result = evaluateOpportunitySignals(listing, { now: NOW });

  const ratioSig = result.signals.find((s) => s.key === 'bid_to_value_ratio');
  assert.ok(ratioSig, 'the bid_to_value_ratio signal must exist');
  assert.equal(ratioSig.status, 'supported');
  assert.equal(ratioSig.evidenceClass, 'calculated_ratio');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('macro_housing_index'));
  assert.ok(!serialized.includes('fhfa_hpi_macro_trend'));
});
