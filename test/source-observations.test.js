'use strict';

// test/source-observations.test.js
//
// The observation pipeline's pure vocabulary — acceptedLiveListings,
// snapshot, classifyStatusActivity, compareSnapshots — plus the ingest-gate
// semantics recordSourceRun (Postgres, migrations 025 + 027) inherits. The
// bounded JSON file store these tests once exercised was retired after its
// history was imported; the PG write/read paths have their own suites in
// test/db/observations-cutover.test.js and test/observations-persistence.test.js.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  acceptedLiveListings,
  classifyStatusActivity,
  compareSnapshots,
  snapshot,
} = require('../server/sources/observations');

const NOW = '2026-09-05T18:00:00.000Z';

function listing(overrides = {}) {
  const observedAt = overrides.sourceObservedAt || '2026-09-05T17:00:00.000Z';
  return {
    id: 'CIV-NJ-7-2128964683',
    source: 'civilview',
    state: 'NJ',
    county: 'Bergen',
    city: 'Park Ridge',
    zip: '07656',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    openingBid: 100000,
    saleDate: '2026-10-01',
    status: 'scheduled',
    deposit: 5000,
    raw: 'Official CivilView source record for sheriff sale 2128964683.',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record',
      publisher: 'CivilView', recordId: '2128964683', observedAt,
    },
    ...overrides,
  };
}

// --- ingest gate (shared by the Postgres write path) --------------------

test('observations reject fixtures and future captures rather than treating them as inventory', () => {
  const fixture = listing({
    id: 'CIV-FIXTURE-1',
    provenance: { origin: 'fixture', observed: false, fixture: true, publisher: 'Fixture', recordId: 'fixture-1' },
  });
  const future = listing({ id: 'CIV-FUTURE-1', sourceObservedAt: '2026-09-06T18:00:00.000Z' });
  future.provenance = { ...future.provenance, recordId: 'future-1', observedAt: future.sourceObservedAt };

  const accepted = acceptedLiveListings('civilview', {
    listings: [fixture, future], error: null, rejectedCount: 0, durationMs: 10,
  }, NOW);
  assert.equal(accepted.length, 0);
});

test('a failed run produces no snapshots — a failed request is never evidence', () => {
  const accepted = acceptedLiveListings('civilview', {
    listings: [listing()], error: 'WAF challenge', rejectedCount: 0, durationMs: 10,
  }, NOW);
  assert.equal(accepted.length, 0, 'error runs must not be ingested as observations');
});

test('accepted listings arrive in observation order so in-run advances are deterministic', () => {
  const earlier = listing({ sourceObservedAt: '2026-09-05T16:00:00.000Z', id: 'CIV-EARLY', provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'EARLY', observedAt: '2026-09-05T16:00:00.000Z' } });
  const later = listing({ sourceObservedAt: '2026-09-05T17:00:00.000Z', id: 'CIV-LATE', provenance: { origin: 'live', observed: true, publisher: 'CivilView', recordId: 'LATE', observedAt: '2026-09-05T17:00:00.000Z' } });
  const accepted = acceptedLiveListings('civilview', { listings: [later, earlier], error: null }, NOW);
  assert.deepEqual(accepted.map((item) => item.id), ['CIV-EARLY', 'CIV-LATE']);
});

// --- snapshot shape ------------------------------------------------------

test('snapshot preserves the exact tracked fields and hashes the raw notice', () => {
  const snap = snapshot(listing());
  assert.equal(snap.recordId, '2128964683');
  assert.equal(snap.listingId, 'CIV-NJ-7-2128964683');
  assert.equal(snap.state, 'NJ');
  assert.equal(snap.county, 'Bergen');
  assert.equal(snap.fields.openingBid, 100000);
  assert.equal(snap.fields.status, 'scheduled');
  assert.match(snap.noticeSha256, /^[a-f0-9]{64}$/);
  assert.ok(snap.noticeExcerpt.startsWith('Official CivilView source record'));
});

// --- real production status vocabulary -----------------------------------
//
// The anchored ^enum$ classifier matched 0 of 1,526 real status transitions
// because publisher statuses are prose. These tests pin the exact strings
// observed in the live store so the classifier can never silently regress
// to enum-only matching.

test('classifyStatusActivity normalizes real publisher status prose', () => {
  // The exact strings counted across 10,285 live records:
  assert.equal(classifyStatusActivity('Status: Active - Postponed'), 'inactive', '950 live listings carry this status');
  assert.equal(classifyStatusActivity('Status: Cancelled'), 'inactive');
  assert.equal(classifyStatusActivity('Status: Auctioned - Reverted to Beneficiary'), 'inactive');
  assert.equal(classifyStatusActivity('Status: Withdrawn'), 'inactive');
  assert.equal(classifyStatusActivity('Auction Ends: Oct 07, 2026'), 'active');
  assert.equal(classifyStatusActivity('Status: Active'), 'active');
  assert.equal(classifyStatusActivity('Status: Active - Accepting Bids'), 'active');
  assert.equal(classifyStatusActivity('Re-Scheduled'), 'inactive');
  assert.equal(classifyStatusActivity(''), 'unknown');
  assert.equal(classifyStatusActivity(null), 'unknown');
  // An inactive marker wins over an "Active" prefix: "Active - Postponed"
  // means the sale is currently postponed.
  assert.equal(classifyStatusActivity('ACTIVE - POSTPONED'), 'inactive');
});

test('compareSnapshots classifies real-vocabulary returned-to-market transitions', () => {
  const base = { observedAt: '2026-10-01T00:00:00.000Z', fields: {} };
  const next = { observedAt: '2026-10-05T00:00:00.000Z', fields: {} };

  // The relist event that matters most in production: a property auctioned
  // off and reverted to the beneficiary, later posted active again.
  const reverted = { ...base, fields: { status: 'Status: Auctioned - Reverted to Beneficiary' } };
  const activeAgain = { ...next, fields: { status: 'Status: Active' } };
  const relist = compareSnapshots(reverted, activeAgain).find((c) => c.field === 'status');
  assert.equal(relist.kind, 'returned_to_market');

  // Postponed -> new auction date is a return to the active schedule.
  const postponed = { ...base, fields: { status: 'Status: Active - Postponed' } };
  const rescheduled = { ...next, fields: { status: 'Auction Ends: Oct 21, 2026' } };
  const relist2 = compareSnapshots(postponed, rescheduled).find((c) => c.field === 'status');
  assert.equal(relist2.kind, 'returned_to_market');

  // Active -> cancelled is a status change, not a relist.
  const cancel = compareSnapshots(
    { ...base, fields: { status: 'Status: Active' } },
    { ...next, fields: { status: 'Status: Cancelled' } },
  ).find((c) => c.field === 'status');
  assert.equal(cancel.kind, 'status_changed');

  // Staying postponed is not a relist either.
  const still = compareSnapshots(postponed, { ...next, fields: { status: 'Status: Active - Postponed until November' } })
    .find((c) => c.field === 'status');
  assert.equal(still.kind, 'status_changed');
});
