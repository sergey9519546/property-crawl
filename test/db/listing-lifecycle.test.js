'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyListing } = require('../../server/db/listing-lifecycle');

// A fixed instant so "passed" is a fact about the fixture, not about today.
const NOW = Date.parse('2026-10-05T12:00:00Z');
const auction = (endDate) => JSON.stringify({ auctionRun: { endDate, startDate: '2026-09-01T00:00:00Z' } });

test('a publisher status that says the event finished is conclusive', () => {
  for (const status of [
    'Auction is Closed',
    'Status: Cancelled',
    'Status: Auctioned - Reverted to Beneficiary',
    'Status: Auctioned - Sold to 3rd Party',
    'Status: Auctioned - Pending Results',
    'Status: Rescinded',
  ]) {
    const d = classifyListing({ lifecycle_status: status }, NOW);
    assert.equal(d.concluded, true, `${status} must be conclusive`);
  }
});

test('a publisher event date in the past is conclusive', () => {
  const d = classifyListing({
    lifecycle_status: 'Auction Begins: Sep 08, 2026',
    raw_notice: auction('2026-09-08T17:58:16Z'),
  }, NOW);
  assert.equal(d.concluded, true);
  assert.equal(d.verdict, 'publisher_date_passed');
  assert.match(d.label, /2026-09-08/);
});

test('a publisher event date in the future is kept - the opportunity is still open', () => {
  const d = classifyListing({
    lifecycle_status: 'Auction Begins: Nov 02, 2026',
    raw_notice: auction('2026-11-02T17:58:16Z'),
  }, NOW);
  assert.equal(d.concluded, false);
});

test('a postponed record carrying a past date is KEPT, not deleted', () => {
  // The stored date is the pre-postponement date; the rescheduled date is not in
  // the record. Deleting on the date alone would throw away a live auction.
  const d = classifyListing({
    lifecycle_status: 'Status: Active - Postponed',
    raw_notice: auction('2026-09-08T17:58:16Z'),
  }, NOW);
  assert.equal(d.concluded, false);
  assert.equal(d.verdict, 'postponed_after_past_date');
  assert.ok(d.note, 'the conflict must be recorded, not silently resolved');
});

test('live wording is never conclusive, however old the observation', () => {
  for (const status of ['Status: Active', 'Status: Active - Outbid Period', 'Coming Soon', 'publicly_listed']) {
    const d = classifyListing({
      lifecycle_status: status,
      source_observed_at: '2026-09-04T00:00:00Z',
      raw_notice: auction('2026-12-02T00:00:00Z'),
    }, NOW);
    assert.equal(d.concluded, false, `${status} must be kept`);
  }
});

test('a past sale_date alone is not proof the opportunity ended', () => {
  // For parcel and docket evidence the date is the record's subject, not a
  // closing. Keeping these costs a stale row; deleting them risks a live lead.
  const d = classifyListing({
    source: 'fl-dor-cadastral', lifecycle_status: 'publicly_listed', sale_date: '2026-09-10',
  }, NOW);
  assert.equal(d.concluded, false);
  assert.equal(d.verdict, 'sale_date_passed');
});

test('unparseable or absent raw payloads are kept, never guessed at', () => {
  for (const raw of [null, '', 'not json at all', '{}']) {
    const d = classifyListing({ lifecycle_status: 'Status: Active', raw_notice: raw }, NOW);
    assert.equal(d.concluded, false, `raw_notice=${JSON.stringify(raw)} must be kept`);
  }
});

test('a canonical sold/cancelled written by the canonicaliser is still conclusive', () => {
  // canonicalStatus() maps publisher wording to these at write time; a record
  // can therefore carry the verdict with no date left in the payload.
  assert.equal(classifyListing({ status: 'sold' }, NOW).concluded, true);
  assert.equal(classifyListing({ status: 'cancelled' }, NOW).concluded, true);
  assert.equal(classifyListing({ status: 'active' }, NOW).concluded, false);
  assert.equal(classifyListing({ status: 'postponed' }, NOW).concluded, false);
});

test('an unrecognised status is kept rather than guessed at', () => {
  const d = classifyListing({ lifecycle_status: 'Status: We Invented This Later', raw_notice: null }, NOW);
  assert.equal(d.concluded, false);
  assert.equal(d.verdict, 'no_conclusive_signal');
});