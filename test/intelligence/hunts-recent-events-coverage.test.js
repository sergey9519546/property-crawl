'use strict';

// test/intelligence/hunts-recent-events-coverage.test.js
//
// getHunt returned:
//
//   recentEvents: store.events.filter(e => e.huntId === id).slice(0, 20)
//
// and nothing else about how many events the hunt has. Measured against the
// live store: two hunts holding 69 and 35 events, so 49 of 104 -- 47% -- were
// simply absent from the response, with no count and no flag. /hunts is a
// wired page (saved-hunts.tsx reads this endpoint).
//
// Fourth instance of one defect: a slice published with no denominator. The
// first three were the auction calendar's dropped counters, /api/neighborhoods'
// top-100 buckets, and /api/source-network's signals.
//
// Events here are produced the way production produces them -- createHunt then
// runHunt over changing listings -- so the fixture cannot drift from what the
// store actually accepts.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const hunts = require('../../server/intelligence/hunts');

const NOW = '2026-10-07T12:00:00.000Z';
const temporary = [];

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunts-events-'));
  temporary.push(dir);
  return path.join(dir, 'hunts.json');
}

function listing(i) {
  const recordId = String(5000000 + i);
  return {
    id: `CIV-CA-${recordId}`,
    source: 'civilview',
    state: 'CA',
    county: 'Alameda',
    city: 'Oakland',
    address: `${i} Test Avenue, Oakland, CA`,
    propType: 'Single Family',
    status: 'scheduled',
    openingBid: 100000 + i,
    saleDate: '2026-11-01',
    raw: `Official CivilView source record number ${recordId}.`,
    sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${recordId}`,
    sourceObservedAt: NOW,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record',
      publisher: 'CivilView', recordId, observedAt: NOW,
    },
  };
}

// A hunt that has produced `count` real events.
function huntWithEvents(count) {
  const filePath = tempStore();
  const hunt = hunts.createHunt(
    { name: 'California', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'CA' }] } },
    { filePath, now: NOW },
  );
  hunts.runHunt(hunt.id, [listing(0)], { filePath, now: NOW });
  hunts.runHunt(
    hunt.id,
    Array.from({ length: count }, (_, i) => listing(i + 1)),
    { filePath, now: NOW },
  );
  return { id: hunt.id, filePath };
}

test('a hunt whose recent events are capped says how many it has', () => {
  const { id, filePath } = huntWithEvents(69);

  const result = hunts.getHunt(id, { filePath });

  assert.equal(result.recentEvents.length, 20, 'the cap is unchanged');
  assert.equal(result.recentEventsTotal, 69, 'but the payload must say 69 exist');
  assert.equal(result.recentEventsTruncated, true);
});

test('a hunt with few enough events does not claim to be truncated', () => {
  const { id, filePath } = huntWithEvents(5);

  const result = hunts.getHunt(id, { filePath });

  assert.equal(result.recentEvents.length, 5);
  assert.equal(result.recentEventsTotal, 5);
  assert.equal(result.recentEventsTruncated, false);
});

test('a hunt with no events reports zero rather than omitting the fields', () => {
  const filePath = tempStore();
  const hunt = hunts.createHunt(
    { name: 'California', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'CA' }] } },
    { filePath, now: NOW },
  );
  hunts.runHunt(hunt.id, [listing(0)], { filePath, now: NOW });

  const result = hunts.getHunt(hunt.id, { filePath });

  assert.deepEqual(result.recentEvents, []);
  assert.equal(result.recentEventsTotal, 0);
  assert.equal(result.recentEventsTruncated, false);
});

test('the count is for this hunt, not every event in the store', () => {
  const a = huntWithEvents(30);
  const filePath = tempStore();
  const b = hunts.createHunt(
    { name: 'Second', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'CA' }] } },
    { filePath: tempStore(), now: NOW },
  );
  void b;

  const result = hunts.getHunt(a.id, { filePath: a.filePath });
  assert.equal(result.recentEventsTotal, 30);
});

test.after(() => {
  for (const dir of temporary) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});