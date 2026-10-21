'use strict';

// test/db/listings-sort-tie-break.test.js
//
// Every Postgres sort in db/client.js ends in `id ASC`:
//
//   ORDER BY deal_score DESC NULLS LAST, id ASC
//
// The in-memory path implements the same five sorts without that tie-break.
// That is not a cosmetic difference: a total order is what makes offset
// paging safe. With ties broken arbitrarily, two pages can overlap or skip a
// row depending on how the engine happened to place equal keys.
//
// It matters right now because the auction calendar reads the whole store in
// pages of 1,000 (see server/routes/auction-calendar.js). Against Postgres it
// is correct. Against the in-memory provider it could silently drop or repeat
// auctions, and nothing would report it.

const assert = require('node:assert/strict');
const test = require('node:test');

const { DatabaseClient } = require('../../server/db/client');

function memoryDbWith(listings) {
  const db = new DatabaseClient({
    env: { NODE_ENV: 'test' },
    liveCachePath: null,
    workspaceStorePath: null
  });
  db.inMemoryData.listings = listings;
  return db;
}

function listing(id, extra = {}) {
  return {
    id,
    source: 'treasury',
    state: 'TX',
    status: 'active',
    images: [],
    dealScore: 70,
    equity: 1000,
    openingBid: 5000,
    saleDate: '2026-10-01',
    ...extra
  };
}

// Insertion order deliberately disagrees with id order: a correct tie-break
// has to actively reorder these, not merely preserve what came in.
const TIED = [
  listing('C-civilview-3'),
  listing('A-treasury-1'),
  listing('B-hud-2')
];

const SORTS = [
  ['score', { dealScore: 70 }],
  ['equity', { equity: 1000 }],
  ['bid-asc', { openingBid: 5000 }],
  ['date', { saleDate: '2026-10-01' }],
  ['images', { images: [] }],
  ['triage', { triagePriority: null }]
];

for (const [sort, shared] of SORTS) {
  test(`getListings (memory): sort="${sort}" breaks ties on id ascending`, async () => {
    const db = memoryDbWith(TIED.map((l) => listing(l.id, shared)));
    const { listings } = await db.getListings({ sort });
    assert.deepEqual(
      listings.map((l) => l.id),
      ['A-treasury-1', 'B-hud-2', 'C-civilview-3'],
      `sort="${sort}" left tied rows in insertion order; Postgres returns id ASC`
    );
  });
}

test('getListings (memory): sort="triage" ranks known priorities above unknowns with the id tie-break', async () => {
  // triage_priority is a Postgres write-through cache (migration 025 + 026);
  // the in-memory provider computes none. Any carried value must still rank
  // above unknowns, and unknowns must not read as zeros.
  const db = memoryDbWith([
    listing('C-unknown-3'),
    listing('A-low-1', { triagePriority: 12 }),
    listing('D-unknown-4'),
    listing('B-high-2', { triagePriority: 64 })
  ]);
  const { listings } = await db.getListings({ sort: 'triage' });
  assert.deepEqual(
    listings.map((l) => l.id),
    ['B-high-2', 'A-low-1', 'C-unknown-3', 'D-unknown-4'],
    'known priorities must rank first (desc), unknowns last with the id tie-break'
  );
});

test('getListings (Postgres): sort="triage" is guarded by the refreshed_at staleness window', () => {
  // Source-text pin: the ORDER BY must rank only rows refreshed inside the
  // staleness window and must keep the id ASC tie-break. A stale score is a
  // time-dependent value (a confirmed sale date passes; observations
  // accumulate) and must never read as a fresh ranking.
  const source = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../server/db/client.js'), 'utf8'
  );
  const match = source.match(/else if \(sort === 'triage'\) sql \+= ` ORDER BY \(CASE WHEN triage_priority_refreshed_at >= NOW\(\) - INTERVAL '\$\{TRIAGE_PRIORITY_STALE_DAYS\} days' THEN triage_priority END\) DESC NULLS LAST, id ASC`;/);
  assert.ok(match, 'sort="triage" must order by the staleness-guarded column with the id tie-break');
});

test('getListings (memory): offset paging over tied rows covers the set exactly once', async () => {
  // 25 rows, all tied on every sort key. Paged 10 at a time.
  const rows = Array.from({ length: 25 }, (_, i) =>
    listing(`row-${String(i).padStart(2, '0')}`, { dealScore: 70 }));
  // Shuffle into an order that is neither id order nor reverse-id order.
  const shuffled = [...rows].reverse();
  const db = memoryDbWith(shuffled);

  const seen = [];
  for (let offset = 0; offset < 25; offset += 10) {
    const page = await db.getListings({ sort: 'score', limit: 10, offset });
    seen.push(...page.listings.map((l) => l.id));
  }

  assert.equal(seen.length, 25, 'paging lost or repeated rows');
  assert.equal(new Set(seen).size, 25, 'a row appeared on two pages');
  assert.deepEqual(
    [...seen].sort(),
    rows.map((l) => l.id).sort(),
    'paging did not cover the same set the single-page query returns'
  );
});

test('getListings (memory): a single page is a prefix of the paged walk', async () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    listing(`row-${String(i).padStart(2, '0')}`, { dealScore: 70 }));
  const db = memoryDbWith([...rows].reverse());

  const oneShot = await db.getListings({ sort: 'score', limit: 10, offset: 0 });
  const walked = [];
  for (let offset = 0; offset < 25; offset += 10) {
    const page = await db.getListings({ sort: 'score', limit: 10, offset });
    walked.push(...page.listings);
  }

  assert.deepEqual(
    oneShot.listings.map((l) => l.id),
    walked.slice(0, 10).map((l) => l.id),
    'page 1 of a walk differs from a one-shot page 1 when ties are unstable'
  );
});