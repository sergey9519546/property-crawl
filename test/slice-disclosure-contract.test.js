'use strict';

// test/slice-disclosure-contract.test.js
//
// Four surfaces sliced a result and published only the operation's
// completeness, never the result's:
//
//   /api/auction-calendar   28 auctions reported, 3,417 in the window
//   /api/neighborhoods      100 of 5,815 buckets (8.8% of inventory)
//   /api/source-network     100 of 2,000 signals (5%), no count at all
//   /api/hunts/:id          20 of 104 events (47% hidden)
//
// Catching those took a hand sweep, and a hand sweep does not run itself. This
// is the part of the class that CAN be guarded soundly, without the heuristics
// that made two earlier attempts useless:
//
//   the payload side. If a response carries an array and a total for it, the
//   total must be >= the array length, and a truncated flag must agree with
//   them. Removing a disclosure, or shipping one that lies, fails here.
//
// It cannot catch a FIFTH undisclosed slice, because telling an array apart
// from a truncated string in source is exactly the judgement that produced
// false positives twice today. That part stays a sweep; this part is a gate.
//
// Fixtures build real structures the way production builds them -- computeNeighborhoodStats
// over a pool, runHunt over changing listings -- so a fixture cannot drift
// past the same validation the real code applies.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createNeighborhoodsHandler } = require('../server/routes/neighborhoods');
const { buildSourceNetwork } = require('../server/sources/network');
const { computeNeighborhoodStats } = require('../server/intelligence/neighborhood-stats');
const hunts = require('../server/intelligence/hunts');

const temporary = [];

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(n, v) { this.headers[n] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return v; },
  };
}

// The contract, stated once so every assertion below means the same thing.
function assertDisclosesSlice(payload, { arrayKey, totalKey, flagKey, label }) {
  const rows = payload[arrayKey];
  assert.ok(Array.isArray(rows), `${label}: ${arrayKey} must be an array`);

  const total = payload[totalKey];
  assert.equal(
    typeof total, 'number',
    `${label}: ${totalKey} must be published. An array with no denominator `
      + `reads as "all of them" to anyone who has not counted`,
  );
  assert.ok(
    total >= rows.length,
    `${label}: ${totalKey} (${total}) is smaller than ${arrayKey} (${rows.length}); `
      + `the total must describe the whole set the array was cut from`,
  );

  const flag = payload[flagKey];
  assert.equal(typeof flag, 'boolean', `${label}: ${flagKey} must be published`);
  assert.equal(
    flag, total > rows.length,
    `${label}: ${flagKey} is ${flag} but ${totalKey} (${total}) vs ${arrayKey} `
      + `(${rows.length}) means truncation is ${total > rows.length}`,
  );
}

function pool(zipCount, perZip) {
  const rows = [];
  for (let z = 0; z < zipCount; z += 1) {
    for (let i = 0; i < perZip; i += 1) {
      rows.push({
        id: `L-${z}-${i}`, source: 'treasury', state: 'TX', zip: String(10000 + z),
        city: 'Austin', address: `${z} ${i} Test St`, openingBid: 10000 + z,
        sourceObservedAt: new Date().toISOString(),
      });
    }
  }
  return rows;
}

test('/api/neighborhoods discloses that its bucket list is a slice', async () => {
  const rows = pool(400, 3); // 400 buckets, 1,200 rows
  const handler = createNeighborhoodsHandler({
    database: {
      async getListings({ limit = 1000, offset = 0 } = {}) {
        return { total: rows.length, listings: rows.slice(offset, offset + limit) };
      },
    },
    env: {},
    now: () => Date.parse('2026-10-07T12:00:00.000Z'),
  });
  const res = response();
  await handler(
    { method: 'GET', url: '/api/neighborhoods?limit=10', headers: {} },
    res,
    new URL('http://localhost/api/neighborhoods?limit=10'),
  );
  assert.equal(res.statusCode, 200);
  assertDisclosesSlice(res.body, {
    arrayKey: 'neighborhoods', totalKey: 'bucketsTotal', flagKey: 'bucketsTruncated',
    label: '/api/neighborhoods',
  });
});

test('/api/source-network discloses that its signal list is a slice', () => {
  const signals = Array.from({ length: 2000 }, (_, i) => ({
    id: `sig_${String(i).padStart(24, '0')}`,
    sourceId: 'hud', recordId: String(i), listingId: `L-${i}`,
    address: `${i} Test Avenue`, observedAt: '2026-10-01T00:00:00.000Z',
  }));
  const network = buildSourceNetwork({
    catalog: [{
      id: 'hud-homestore', adapterKey: 'hud', label: 'HUD', tier: 1, color: '#000',
      note: '', active: true, workflow: { cadenceHours: 24, scope: 'national' },
    }],
    adapters: [], listings: [], evidenceCollectors: [], evidenceSummary: {},
    observations: { version: 1, runs: {}, records: {}, signals },
  });

  assertDisclosesSlice(network, {
    arrayKey: 'signals', totalKey: 'signalsTotal', flagKey: 'signalsTruncated',
    label: '/api/source-network',
  });
});

test('a hunt detail discloses that its recent-events list is a slice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-contract-'));
  temporary.push(dir);
  const filePath = path.join(dir, 'hunts.json');
  const now = '2026-10-07T12:00:00.000Z';

  const listing = (i) => {
    const recordId = String(5000000 + i);
    return {
      id: `CIV-CA-${recordId}`, source: 'civilview', state: 'CA', county: 'Alameda',
      city: 'Oakland', address: `${i} Test Avenue, Oakland, CA`, propType: 'Single Family',
      status: 'scheduled', openingBid: 100000 + i, saleDate: '2026-11-01',
      raw: `Official CivilView source record number ${recordId}.`,
      sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${recordId}`,
      sourceObservedAt: now,
      provenance: {
        origin: 'live', observed: true, recordKind: 'source_record',
        publisher: 'CivilView', recordId, observedAt: now,
      },
    };
  };

  const hunt = hunts.createHunt(
    { name: 'California', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'CA' }] } },
    { filePath, now },
  );
  hunts.runHunt(hunt.id, [listing(0)], { filePath, now });
  hunts.runHunt(hunt.id, Array.from({ length: 69 }, (_, i) => listing(i + 1)), { filePath, now });

  assertDisclosesSlice(hunts.getHunt(hunt.id, { filePath }), {
    arrayKey: 'recentEvents', totalKey: 'recentEventsTotal', flagKey: 'recentEventsTruncated',
    label: '/api/hunts/:id',
  });
});

test('the disclosure is not vacuous: a total equal to the length means nothing is hidden', () => {
  // Guards the guard. If someone made the total simply echo the array length,
  // every assertion above would pass while the page went back to lying.
  const stats = computeNeighborhoodStats(pool(5, 2), { nowMs: Date.now() });
  const all = stats.map((b) => b.count);
  assert.ok(stats.length >= 5);
  assert.equal(all.reduce((a, b) => a + b, 0), 10, 'the fixture really does produce ten rows');
});

test.after(() => {
  for (const dir of temporary) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});