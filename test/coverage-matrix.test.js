'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarize,
  extractStateAbbrs,
  statesFromEntry,
  buildCatalogStateCoverage,
  buildLiveStateSourceCoverage,
  US_STATE_ABBRS
} = require('../server/discovery/coverage-matrix');
const { SOURCE_CATALOG } = require('../server/sources/catalog');

test('module exports US_STATE_ABBRS as a 50-state + DC list', () => {
  assert.equal(US_STATE_ABBRS.length, 51);
  assert.ok(US_STATE_ABBRS.includes('CA'));
  assert.ok(US_STATE_ABBRS.includes('NY'));
  assert.ok(US_STATE_ABBRS.includes('DC'));
});

test('extractStateAbbrs returns empty array for non-string / empty input', () => {
  assert.deepEqual(extractStateAbbrs(''), []);
  assert.deepEqual(extractStateAbbrs(null), []);
  assert.deepEqual(extractStateAbbrs(undefined), []);
  assert.deepEqual(extractStateAbbrs(123), []);
  assert.deepEqual(extractStateAbbrs([]), []);
});

test('extractStateAbbrs finds US states mentioned in plain prose', () => {
  // "California" is prose, not the abbreviation CA - so this returns [].
  assert.deepEqual(extractStateAbbrs('Reviewed Alachua County case imports; California.'), []);
  assert.deepEqual(extractStateAbbrs('Coverage spans CA, NY, TX and FL.').sort(), ['CA','FL','NY','TX']);
});

test('extractStateAbbrs does not pick up abbreviations inside longer words', () => {
  // "Cabinet" should not match CA, "Maine" should not match ME, "code" should
  // not match DE.
  assert.deepEqual(extractStateAbbrs('Cabinet statement about Maine code'), []);
});

test('extractStateAbbrs uses word boundaries to avoid embedded hits', () => {
  // "MA in cabinet" -> MA after a space, not part of another word.
  assert.deepEqual(extractStateAbbrs('MA in cabinet').sort(), ['MA']);
});

test('extractStateAbbrs requires uppercase abbreviations (does not match prose like "in" or "me")', () => {
  // The regex is deliberately case-sensitive - state references must be
  // uppercase 2-letter tokens. Lowercase "in" / "me" / "ca" are prose,
  // not state references, and must be rejected.
  assert.deepEqual(extractStateAbbrs('coverage in ca and ny'), []);
});

test('extractStateAbbrs accepts uppercase abbreviations in mixed-case prose', () => {
  // The catalog coverage text is mixed case; the regex still finds the
  // uppercase abbreviations inside it. Note "California" (Ca, not CA)
  // and "Texas" are prose and are rejected.
  assert.deepEqual(extractStateAbbrs('Reviewed Alachua County; coverage in CA and NY.').sort(), ['CA','NY']);
});

test('extractStateAbbrs returns each state at most once', () => {
  assert.deepEqual(extractStateAbbrs('CA, CA, and California CA').sort(), ['CA']);
});

test('statesFromEntry reads coverage + notes', () => {
  const states = statesFromEntry({
    coverage: 'Reviewed Alachua County case imports',
    notes: 'TX is covered; NY OSC map for unclaimed surplus'
  });
  assert.ok(states.includes('TX'));
  assert.ok(states.includes('NY'));
});

test('buildCatalogStateCoverage iterates the entire SOURCE_CATALOG', () => {
  const result = buildCatalogStateCoverage();
  assert.ok(result.statesWithCoverage > 0);
  assert.ok(Array.isArray(result.states));
  assert.ok(result.states.includes('CA'));
  assert.ok(result.byState.CA);
  assert.ok(result.byState.CA.total > 0);
});

test('buildCatalogStateCoverage bucket keys match the SOURCE_STATUSES taxonomy', () => {
  const result = buildCatalogStateCoverage();
  const ca = result.byState.CA;
  // The seven SOURCE_STATUSES keys must be present (zeroed or counted).
  for (const key of ['VERIFIED_OFFICIAL','VERIFIED_FIRST_PARTY','SCOPE_LIMITED','LOCAL_ROUTE','DISCOVERY_ONLY','INCONCLUSIVE_BLOCKED','RETIRED']) {
    assert.ok(typeof ca[key] === 'number', `missing ${key} bucket`);
  }
  assert.equal(typeof ca.total, 'number');
  assert.ok(ca.total >= 1);
});

test('buildCatalogStateCoverage returns 0 for states with no catalog coverage', () => {
  // Find a state that no entry mentions.
  const result = buildCatalogStateCoverage();
  const covered = new Set(result.states);
  const uncovered = US_STATE_ABBRS.find((s) => !covered.has(s));
  assert.ok(uncovered, 'expected at least one uncovered state for this assertion to be meaningful');
  assert.equal(result.byState[uncovered], undefined);
});

test('buildLiveStateSourceCoverage returns zeros when no live cache exists', () => {
  const result = buildLiveStateSourceCoverage();
  assert.ok(typeof result === 'object');
  assert.equal(typeof result.totalRecords, 'number');
  assert.equal(typeof result.byStateSource, 'object');
  assert.equal(typeof result.byStateTotal, 'object');
});

test('summarize combines catalog aggregate + state coverage + live coverage', () => {
  const result = summarize();
  assert.ok(result.catalog);
  assert.equal(result.catalog.total, SOURCE_CATALOG.length);
  assert.ok(result.catalog.byRole);
  assert.ok(result.catalog.byCategory);
  assert.ok(result.catalog.byStatus);
  assert.ok(result.catalogByState);
  assert.equal(result.catalogByState.statesWithCoverage >= 1, true);
  assert.ok(result.liveByState);
  assert.deepEqual(result.states, US_STATE_ABBRS);
  assert.ok(result.statusLabels);
  for (const status of ['VERIFIED_OFFICIAL','SCOPE_LIMITED','DISCOVERY_ONLY']) {
    assert.ok(status in result.statusLabels);
  }
});

test('summarize is safe to call with no live cache on disk', () => {
  // The module must never throw when loadLiveRecords throws or returns nothing.
  const result = summarize();
  assert.ok(result);
  assert.equal(typeof result.liveByState.totalRecords, 'number');
});

test('summarize is deterministic across repeated calls', () => {
  const a = JSON.stringify(summarize());
  const b = JSON.stringify(summarize());
  assert.equal(a, b);
});

test('catalog status totals match summarizeCatalog output', () => {
  const result = summarize();
  for (const status of Object.keys(result.catalog.byStatus)) {
    assert.ok(typeof result.catalog.byStatus[status] === 'number');
  }
  const sumOfByStatus = Object.values(result.catalog.byStatus).reduce((acc, n) => acc + n, 0);
  assert.equal(sumOfByStatus, result.catalog.total);
});

test('catalogByState total is the sum of per-status counts', () => {
  const result = summarize();
  for (const state of result.catalogByState.states) {
    const bucket = result.catalogByState.byState[state];
    const sum = bucket.VERIFIED_OFFICIAL + bucket.VERIFIED_FIRST_PARTY
      + bucket.SCOPE_LIMITED + bucket.LOCAL_ROUTE
      + bucket.DISCOVERY_ONLY + bucket.INCONCLUSIVE_BLOCKED
      + bucket.RETIRED;
    assert.equal(sum, bucket.total);
  }
});

test('extractStateAbbrs handles multi-line coverage text', () => {
  const text = `First line mentions CA.
                 Second line mentions NY and FL.
                 Third line mentions TX.`;
  assert.deepEqual(extractStateAbbrs(text).sort(), ['CA','FL','NY','TX']);
});

test('extractStateAbbrs handles multiple occurrences on the same line', () => {
  assert.deepEqual(extractStateAbbrs('CA and OR and CA again.').sort(), ['CA','OR']);
});

test('extractStateAbbrs returns state abbreviation at start of text', () => {
  assert.deepEqual(extractStateAbbrs('CA statewide records'), ['CA']);
});

test('extractStateAbbrs returns state abbreviation at end of text', () => {
  assert.deepEqual(extractStateAbbrs('statewide records in CA'), ['CA']);
});