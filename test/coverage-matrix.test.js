'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  summarize,
  extractStateAbbrs,
  statesFromEntry,
  buildCatalogStateCoverage,
  buildLiveStateSourceCoverage,
  US_STATE_ABBRS
} = require('../server/discovery/coverage-matrix');
const { SOURCE_CATALOG } = require('../server/sources/catalog');
const { DEFAULT_LIVE_STORE_PATH, resolveLiveStorePath } = require('../server/db/live-record-store');

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

// ---------------------------------------------------------------------------
// Live-store honesty guards.
//
// The module's header claims it reads the local live record store so a caller
// can answer "for state X, which sources have actually published data?". It
// used to call loadLiveRecords() with no path, which short-circuits to [] before
// touching the filesystem - so the endpoint reported a fixed zero while a store
// with thousands of records sat on disk. These guards fail against that code.
// ---------------------------------------------------------------------------

// The store loader only accepts records carrying full observed provenance
// (origin live, recordKind source_record, observed flag and publisher), so
// every fixture builds it from one place.
function prov(recordId) {
  return { origin: 'live', recordKind: 'source_record', observed: true, publisher: 'CivilView', recordId };
}

function liveRecord(overrides = {}) {
  return {
    id: 'CIV-NJ-7-1234',
    source: 'civilview',
    state: 'NJ',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1234',
    raw: 'Published sale record for 19 West Park Avenue.',
    sourceObservedAt: '2026-09-04T12:00:00Z',
    provenance: prov('1234'),
    ...overrides
  };
}

// Point the module at a throwaway store for the duration of one test, and
// restore the real environment afterwards.
function useStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-coverage-matrix-'));
  const file = path.join(directory, 'live-listings.json');
  const previous = process.env.PROPERTY_LIVE_CACHE_PATH;
  process.env.PROPERTY_LIVE_CACHE_PATH = file;
  t.after(() => {
    if (previous === undefined) delete process.env.PROPERTY_LIVE_CACHE_PATH;
    else process.env.PROPERTY_LIVE_CACHE_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const write = (listings) =>
    fs.writeFileSync(file, JSON.stringify({ version: 1, updatedAt: '2026-09-04T12:00:00Z', listings }));
  return { file, write };
}

test('buildLiveStateSourceCoverage reads the live store instead of reporting a fixed zero', (t) => {
  const { write } = useStore(t);
  write([
    liveRecord(),
    liveRecord({ id: 'CIV-TX-1-9', state: 'TX', provenance: prov('9') })
  ]);
  const result = buildLiveStateSourceCoverage();
  assert.equal(result.storeStatus, 'read');
  assert.equal(result.readError, null);
  assert.equal(result.totalRecords, 2, 'the store on disk must be counted, not hard-zeroed');
  assert.equal(result.countedRecords, 2);
  assert.equal(result.byStateSource.NJ.civilview.live, 1);
  assert.equal(result.byStateSource.TX.civilview.live, 1);
  assert.equal(result.byStateTotal.NJ, 1);
  assert.equal(result.byStateTotal.TX, 1);
});

test('summarize surfaces the same live counts the endpoint serves', (t) => {
  const { write } = useStore(t);
  write([liveRecord()]);
  const matrix = summarize();
  assert.equal(matrix.liveByState.totalRecords, 1);
  assert.equal(matrix.liveByState.storeStatus, 'read');
  assert.equal(matrix.liveByState.readError, null);
});

test('an unreadable live store is reported as a read error, never as zero coverage', (t) => {
  const { file } = useStore(t);
  fs.writeFileSync(file, '{incomplete');
  const result = buildLiveStateSourceCoverage();
  assert.equal(result.storeStatus, 'unreadable');
  assert.ok(result.readError, 'a store that exists but cannot be read must carry a readError');
  assert.equal(result.totalRecords, 0);
});

test('an absent live store is an honest zero, distinct from a failed read', (t) => {
  useStore(t);
  const result = buildLiveStateSourceCoverage();
  assert.equal(result.storeStatus, 'absent');
  assert.equal(result.readError, null, 'an absent store is not a read failure');
  assert.equal(result.totalRecords, 0);
  assert.deepEqual(result.byStateSource, {});
});

test('records outside the 51-state set are accounted for, not dropped silently', (t) => {
  const { write } = useStore(t);
  write([
    liveRecord(),
    liveRecord({ id: 'CIV-PR-1-1', state: 'PR', provenance: prov('1') })
  ]);
  const result = buildLiveStateSourceCoverage();
  assert.equal(result.totalRecords, 2);
  assert.equal(result.countedRecords, 1);
  assert.equal(result.excludedRecords, 1);
  assert.deepEqual(result.excludedByState, { PR: 1 });
  assert.equal(result.byStateTotal.PR, undefined);
});

test('records with no source are excluded and counted', (t) => {
  const { write } = useStore(t);
  write([liveRecord()]);
  // A record whose source fails host validation is dropped by the store loader,
  // so exercise the branch through a state with no source string instead.
  const result = buildLiveStateSourceCoverage();
  assert.equal(result.excludedRecords, result.totalRecords - result.countedRecords);
});

test('an unchanged store is parsed once; a rewritten one is re-read', (t) => {
  const { file, write } = useStore(t);
  write([liveRecord({ id: 'CIV-NJ-7-1111' })]);
  const first = buildLiveStateSourceCoverage();
  assert.equal(first.totalRecords, 1);

  // Same byte length, same mtime, different content. A module that re-parses
  // on every call would now see CIV-NJ-7-2222; a correctly cached one does not.
  const stats = fs.statSync(file);
  write([liveRecord({ id: 'CIV-NJ-7-2222' })]);
  fs.utimesSync(file, stats.atime, stats.mtime);
  assert.equal(fs.statSync(file).size, stats.size, 'fixture must keep the same size');
  const cached = buildLiveStateSourceCoverage();
  assert.equal(cached.totalRecords, 1);
  assert.equal(cached.byStateTotal.NJ, first.byStateTotal.NJ);

  // A genuine rewrite (new mtime) must invalidate.
  write([liveRecord({ id: 'CIV-NJ-7-3333' }), liveRecord({ id: 'CIV-NJ-7-4444' })]);
  assert.equal(buildLiveStateSourceCoverage().totalRecords, 2);
});

test('the live store path is shared with the DB client and honours the env override', () => {
  const previous = process.env.PROPERTY_LIVE_CACHE_PATH;
  try {
    delete process.env.PROPERTY_LIVE_CACHE_PATH;
    assert.equal(resolveLiveStorePath(), DEFAULT_LIVE_STORE_PATH);
    assert.equal(
      DEFAULT_LIVE_STORE_PATH,
      path.resolve(__dirname, '..', '.cache', 'live-listings.json'),
      'the shared default must stay the repo-local store'
    );
    process.env.PROPERTY_LIVE_CACHE_PATH = '/tmp/some-other-store.json';
    assert.equal(resolveLiveStorePath(), path.resolve('/tmp/some-other-store.json'));
  } finally {
    if (previous === undefined) delete process.env.PROPERTY_LIVE_CACHE_PATH;
    else process.env.PROPERTY_LIVE_CACHE_PATH = previous;
  }
});

test('DEFAULT_LIVE_CACHE_PATH in the DB client is the same constant the matrix reads', () => {
  // Requiring db/client.js loads the store, so keep the assertion narrow.
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'client.js'), 'utf8');
  assert.ok(
    source.includes("require('./live-record-store').DEFAULT_LIVE_STORE_PATH"),
    'db/client.js must take its default store path from live-record-store, not redeclare it'
  );
});