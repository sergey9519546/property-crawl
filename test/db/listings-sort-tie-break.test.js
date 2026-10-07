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
  ['images', { images: [] }]
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