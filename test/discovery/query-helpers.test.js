'use strict';

// test/discovery/query-helpers.test.js
//
// Direct unit coverage for the query-param parsers exported from
// server/discovery/query.js. parseBbox is the geo filter guard on every
// discovery query — silent drift would either accept malformed input
// or reject legitimate queries on the wrong shape. (parseBool and
// parseDate are private to the module — only parseBbox is exported.)
//
// The facet sections below cover the two facet allowlists in that module.
// They are separate six-field lists (accessors in memory, SQL in Postgres),
// and they drifted once already: the workbench requested occupancy and
// freshness, neither list served them, and both dropdowns rendered with only
// their "All…" option — unreachable controls. The drift guard is the point.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  parseBbox,
  queryFromUrl,
  search,
  pgWhere,
  matches,
} = require('../../server/discovery/query');

const ROOT = path.resolve(__dirname, '..', '..');

// The facets the workbench actually asks for, read from the client rather than
// hardcoded here, so adding a control there without a matching allowlist entry
// fails this file instead of shipping a dead dropdown.
const CLIENT_FACETS = (() => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'listings', 'discovery-workbench.tsx'),
    'utf8',
  );
  const match = src.match(/facets:\s*"([^"]+)"/);
  assert.ok(match, 'the workbench must request facets from a literal `facets:` string');
  return match[1].split(',');
})();

const url = (query) => new URL(`http://localhost/api/listings?${query}`);

// 'b' carries a blank occupancy and a non-live provenance origin, which is the
// pair that decides whether the two paths agree on the unknown sentinel.
const ROWS = [
  {
    id: 'a',
    state: 'CA',
    county: 'Alameda',
    source: 'hud',
    propType: 'Land',
    auctionProgram: 'TPS',
    lifecycleStatus: 'active',
    occupancy: 'vacant',
    provenance: { origin: 'live' },
    dealScore: 90,
    sourceObservedAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'b',
    state: 'CA',
    county: 'Alameda',
    source: 'hud',
    propType: '',
    auctionProgram: '',
    lifecycleStatus: '',
    occupancy: '',
    provenance: { origin: 'seeded' },
    dealScore: 10,
    sourceObservedAt: '2026-09-01T00:00:00Z',
  },
];

const memoryDatabase = {
  isPg: false,
  getListings: async () => ({ total: ROWS.length, listings: ROWS }),
};

// Minimal Postgres stand-in: records every statement so the tests can assert
// on the SQL the facet builder actually emits.
function fakePg() {
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('AS revision')) return { rows: [{ revision: 'rev-1' }] };
      if (sql.includes('"cursorValue"'))
        return { rows: [{ id: 'a', deal_score: 90, cursorValue: 90 }] };
      if (sql.includes('GROUP BY 1'))
        return { rows: [{ value: 'observed', count: 2 }] };
      return { rows: [{ count: 2 }] };
    },
  };
  return { database: { isPg: true, pool, listingSelect: 'id,state' }, queries };
}

const facetSql = (queries) => queries.find((sql) => sql.includes('GROUP BY 1'));

// --- facets -----------------------------------------------------------

test('in-memory facets count occupancy and freshness instead of dropping them', async () => {
  const result = await search(
    memoryDatabase,
    queryFromUrl(url(`facets=${CLIENT_FACETS.join(',')}`)),
  );
  // Blank occupancy is the "unknown" sentinel, not a literal a publisher wrote.
  assert.deepEqual(result.facets.occupancy, [
    { value: 'unknown', count: 1 },
    { value: 'vacant', count: 1 },
  ]);
  assert.deepEqual(result.facets.freshness, [
    { value: 'observed', count: 1 },
    { value: 'unverified', count: 1 },
  ]);
});

test('every facet the in-memory path serves is also facet-able on the Postgres path', async () => {
  const inMemory = await search(
    memoryDatabase,
    queryFromUrl(url(`facets=${CLIENT_FACETS.join(',')}`)),
  );
  const { database } = fakePg();
  const pg = await search(database, queryFromUrl(url(`facets=${CLIENT_FACETS.join(',')}`)));

  assert.deepEqual(
    Object.keys(pg.facets).sort(),
    Object.keys(inMemory.facets).sort(),
    'the two facet allowlists drifted: a field one path can facet, the other cannot',
  );
  for (const field of ['occupancy', 'freshness'])
    assert.ok(pg.facets[field], `the Postgres path dropped the ${field} facet`);
});

test('the Postgres freshness facet emits only buckets parseFreshness accepts', async () => {
  const { database, queries } = fakePg();
  await search(database, queryFromUrl(url('facets=freshness')));

  // Read the literals back out of the generated SQL rather than restating them,
  // so renaming a bucket in the CASE fails here instead of in the browser.
  const literals = [
    ...facetSql(queries).matchAll(/THEN '([^']+)' ELSE '([^']+)'/g),
  ].flatMap(([, whenTrue, whenFalse]) => [whenTrue, whenFalse]);
  assert.deepEqual(literals, ['observed', 'unverified']);

  for (const literal of literals)
    assert.equal(
      queryFromUrl(url(`freshness=${literal}`)).freshness,
      literal,
      'a value the facet offers must round-trip through the URL parser',
    );

  const inMemory = await search(memoryDatabase, queryFromUrl(url('facets=freshness')));
  assert.deepEqual(
    [...literals].sort(),
    inMemory.facets.freshness.map((f) => f.value).sort(),
    'the two paths must bucket freshness identically',
  );
  // Why the CASE above must be total: the unknown sentinel is not a freshness
  // bucket, so a facet that emitted it would offer an option that 400s.
  assert.throws(
    () => queryFromUrl(url('freshness=unknown')),
    (err) => err.status === 400,
  );
});

test('the Postgres occupancy facet folds blanks into unknown, and unknown is selectable', async () => {
  const { database, queries } = fakePg();
  await search(database, queryFromUrl(url('occupancy=unknown&facets=occupancy')));

  const sql = facetSql(queries);
  assert.match(sql, /coalesce\(nullif\(occupancy,''\)::text,'unknown'\) AS value/);
  // Selecting the sentinel has to return the records it describes, not an
  // empty set, or the dropdown is a dead end.
  assert.match(sql, /WHERE coalesce\(occupancy,''\)=''/);
});

// --- parseBbox -------------------------------------------------------

test('parseBbox: returns null for null / undefined / empty', () => {
  assert.equal(parseBbox(null), null);
  assert.equal(parseBbox(undefined), null);
  assert.equal(parseBbox(''), null);
});

test('parseBbox: parses a valid west,south,east,north bbox', () => {
  const out = parseBbox('-81.7,41.4,-81.6,41.5');
  assert.deepEqual(out, [-81.7, 41.4, -81.6, 41.5]);
});

test('parseBbox: rejects bboxes with the wrong number of values', () => {
  assert.throws(() => parseBbox('-81.7,41.4,-81.6'), (err) => err.status === 400);
  assert.throws(() => parseBbox('-81.7,41.4,-81.6,41.5,0'), (err) => err.status === 400);
});

test('parseBbox: rejects bboxes containing non-finite numbers', () => {
  assert.throws(() => parseBbox('not,41.4,-81.6,41.5'), (err) => err.status === 400);
  assert.throws(() => parseBbox('NaN,41.4,-81.6,41.5'), (err) => err.status === 400);
});

test('parseBbox: rejects lat outside [-90, 90]', () => {
  // south lat > 90
  assert.throws(() => parseBbox('-81.7,91,-81.6,41.5'), (err) => err.status === 400);
  // south lat < -90
  assert.throws(() => parseBbox('-81.7,-91,-81.6,41.5'), (err) => err.status === 400);
  // north lat > 90
  assert.throws(() => parseBbox('-81.7,41.4,-81.6,91'), (err) => err.status === 400);
});

test('parseBbox: rejects lng outside [-180, 180]', () => {
  assert.throws(() => parseBbox('181,41.4,-81.6,41.5'), (err) => err.status === 400);
  assert.throws(() => parseBbox('-181,41.4,-81.6,41.5'), (err) => err.status === 400);
  assert.throws(() => parseBbox('-81.7,41.4,181,41.5'), (err) => err.status === 400);
});

test('parseBbox: rejects south >= north (inverted latitude range)', () => {
  // south (41.5) is not less than north (41.4).
  assert.throws(() => parseBbox('-81.7,41.5,-81.6,41.4'), (err) => err.status === 400);
  // Equal latitudes also rejected (south === north).
  assert.throws(() => parseBbox('-81.7,41.5,-81.6,41.5'), (err) => err.status === 400);
});

test('parseBbox: rejects west === east (zero-width longitude range)', () => {
  // west and east must differ so the bbox is a 2D area.
  assert.throws(() => parseBbox('-81.7,41.4,-81.7,41.5'), (err) => err.status === 400);
});

test('parseBbox: accepts boundary values (lng=-180, lat=90, lat=-90)', () => {
  // -180 / 90 / -90 are valid bounds; the parser should accept them.
  const out = parseBbox('-180,-90,180,90');
  assert.deepEqual(out, [-180, -90, 180, 90]);
});

// queryFromUrl normalises every filter value through text() - trim, then
// lowercase - and the in-memory matcher lowercases the row too, so the
// in-memory backend has always found "Maricopa" from county=maricopa.
// pgWhere compared that lowercased parameter against the case-preserved
// column, so on Postgres - the backend production actually runs on - every
// filter whose stored values contain an uppercase letter matched nothing.
//
// Measured against the live store, clicking a facet the app itself rendered:
//
//   type      "Single Family Home"   5,661 -> 0
//   program   "TPS"                  4,533 -> 0
//   lifecycle "Status: Active"       2,239 -> 0
//   occupancy "Vacant"               2,044 -> 0
//   county    "Maricopa"               186 -> 0
//
// Only state (uppercased back) and source (already lowercase) survived, which
// is why the breakage looked like a lifecycle-only problem at first.
test('every text facet filter compares case-insensitively, like the in-memory matcher', () => {
  const filter = queryFromUrl(new URL(
    'http://localhost/api/listings?county=Maricopa&type=Single%20Family%20Home'
    + '&program=TPS&lifecycle=Status%3A%20Active&occupancy=Vacant&state=AZ&source=HUD',
  ));
  const where = pgWhere(filter);
  for (const column of ['county', 'prop_type', 'occupancy', 'state', 'source_key']) {
    assert.match(where.sql, new RegExp(`lower\\(${column}\\)=\\$\\d+`),
      `${column} must be compared with lower() against the normalised filter value`);
  }
  // Program and lifecycle are derived, so the SQL has to carry the same
  // fallback matches() reads - a row whose value lives only in provenance must
  // not be invisible to the database path. Program's nullif wrapper is the
  // blank-fold that keeps the 'unknown' sentinel on the same literal the
  // facet allowlist groups by.
  assert.match(where.sql, /lower\(nullif\(coalesce\(auction_program, provenance->'sourceFacts'->>'auctionProgram'\),''\)\)=\$\d+/);
  assert.match(where.sql, /lower\(coalesce\(nullif\(lifecycle_status,''\), status\)\)=\$\d+/);
  // The memory matcher already agreed with the normalised value; this pins that
  // the two backends are answering the same question.
  const row = {
    id: 'A', source: 'hud', state: 'AZ', county: 'Maricopa', address: '1 Main St',
    propType: 'Single Family Home', status: 'Status: Active', lat: 33, lng: -112,
    dealScore: 50, sourceObservedAt: '2026-10-01T00:00:00.000Z', provenance: { origin: 'live' },
    auctionProgram: 'TPS', occupancy: 'Vacant',
  };
  assert.equal(matches(row, filter), true,
    'the in-memory matcher lowercases both sides, so it must still accept these');
});

// The facet and the filter must bucket on the SAME expression, or the workbench
// advertises a count that selecting it cannot reproduce.
//
// This was live, twice. pgWhere was changed to filter lifecycle and program on
// their derived values (lifecycle_status falling back to status; auction_program
// falling back to provenance.sourceFacts.auctionProgram) so they would agree
// with matches(), while the facets kept grouping by the bare columns. Records
// whose derived value is present landed in the facet's 'unknown' bucket, so
// /listings offered "unknown (207)" and selecting it returned 0.
//
// Both sides are one string literal in this module, so assert they are the same
// literal rather than standing up a database to compare every bucket.
test('every derived facet and its filter name the same expression', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/discovery/query.js'), 'utf8');
  const derived = [
    { field: 'lifecycle', predicate: /\[\s*"([^"]+)",\s*f\.lifecycle\s*\]/ },
    { field: 'program', predicate: /\[\s*"([^"]+)",\s*f\.program\s*\]/ },
  ];
  for (const { field, predicate } of derived) {
    const facet = source.match(new RegExp(`^\\s*${field}:\\s*"([^"]+)",`, 'm'));
    const filter = source.match(predicate);
    assert.ok(facet, `the facet allowlist must declare ${field}`);
    assert.ok(filter, `pgWhere must filter ${field} through a declared expression`);
    assert.equal(
      facet[1],
      filter[1],
      `the ${field} facet buckets on a different expression than the filter uses, so its count cannot be reproduced by selecting it`,
    );
  }
});
