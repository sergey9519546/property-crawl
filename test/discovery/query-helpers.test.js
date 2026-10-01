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
