'use strict';
// test/discovery/refresh-known.test.js
//
// Refreshing a record we already hold is the only way to learn whether it is
// still live, because absence from a publisher's index is what a sold, withdrawn
// or merely-out-of-budget record looks like. That makes it the place where a
// false "still there" would do real damage: the record would be marked fresh on
// no evidence.
//
// These tests pin the three outcomes separately - refreshed, no longer served,
// and could not tell - because collapsing the last two would let a network fault
// or an unparseable id masquerade as a dead record.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  refreshKnownRecord,
  refreshKnownRecords,
  classifyRefresh,
  isStale,
} = require('../../server/discovery/refresh-known');

function scraperReturning(detail) {
  return {
    fetchDetail: async () => detail,
    standardizeListing: (record) => ({ ...record, provenance: { origin: 'live', recordKind: 'source_record' } }),
  };
}

const TREASURY_RECORD = {
  id: 'TRSY-27-66-801',
  sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/266moore.shtml',
};

test('a record the publisher still serves comes back refreshed, normalized by the collector', async () => {
  const detail = {
    id: 'TRSY-27-66-801',
    state: 'TN',
    address: '266 Moore Drive, Kodak, Tennessee 37764',
    openingBid: 50000,
  };
  const result = await refreshKnownRecord(scraperReturning(detail), 'treasury', TREASURY_RECORD);
  assert.equal(result.verdict, 'refreshed');
  assert.equal(result.listing.id, 'TRSY-27-66-801');
  assert.equal(result.listing.address, detail.address);
  // Standardized by the collector's own normalizer, so a refreshed record is
  // indistinguishable from one an index sweep found.
  assert.equal(result.listing.provenance.origin, 'live');
  assert.equal(result.listing.provenance.recordKind, 'source_record');
});

test('a 200 response that carries no record is NOT_SERVED - the soft-404 trap', async () => {
  // Exactly what CivilView returns for a property id it no longer publishes:
  // a request that succeeded and a body with none of the record in it.
  const result = await refreshKnownRecord(scraperReturning(null), 'treasury', TREASURY_RECORD);
  assert.equal(result.verdict, 'not_served');
  assert.equal(result.listing, undefined);
});

test('a fault or an unaddressable record is an error, never a dead record', async () => {
  const throwing = { fetchDetail: async () => { throw new Error('ECONNRESET'); } };
  const faulted = await refreshKnownRecord(throwing, 'treasury', TREASURY_RECORD);
  assert.equal(faulted.verdict, 'error');
  assert.match(faulted.detail, /ECONNRESET/);

  // No usable key: the collector cannot ask, so it must not answer.
  const unaddressable = await refreshKnownRecord(scraperReturning({ address: 'x' }), 'treasury', {
    id: 'TRSY-27-66-801', sourceUrl: null,
  });
  assert.equal(unaddressable.verdict, 'error');

  // A source with no per-record detail method must say so rather than guess.
  const unsupported = await refreshKnownRecord({}, 'courtlistener', { id: 'CL-1', sourceUrl: 'https://x/1' });
  assert.equal(unsupported.verdict, 'error');
  assert.match(unsupported.detail, /no per-record detail method/);
});

test('classifyRefresh keeps the three verdicts apart', () => {
  assert.equal(classifyRefresh({ listing: { address: 'a' } }), 'refreshed');
  assert.equal(classifyRefresh({ listing: null }), 'not_served');
  assert.equal(classifyRefresh({ error: 'boom' }), 'error');
  assert.equal(classifyRefresh({ listing: { address: '' } }), 'not_served');
});

test('a batch separates the three buckets and never retires anything', async () => {
  const live = { id: 'A', sourceUrl: 'https://treasury.gov/x/a.shtml' };
  const dead = { id: 'B', sourceUrl: 'https://treasury.gov/x/b.shtml' };
  const scraper = {
    fetchDetail: async (slug) => (slug === 'a.shtml'
      ? { id: 'A', state: 'TN', address: '1 Lane' }
      : null),
    standardizeListing: (record) => record,
  };
  const result = await refreshKnownRecords({ source: 'treasury', scraper, records: [live, dead] });
  assert.equal(result.attempted, 2);
  assert.deepEqual(result.refreshed.map((r) => r.id), ['A']);
  assert.deepEqual(result.notServed.map((r) => r.id), ['B']);
  assert.equal(result.errored.length, 0);
  // The batch carries listings to merge and names the missing ones. It exposes
  // no "retire this" output at all - that decision is not a script's to make.
  assert.equal(Object.keys(result).includes('retire'), false);
  assert.equal(Object.keys(result).includes('retired'), false);
});

test('only records the publisher has not re-observed count as stale', () => {
  assert.equal(isStale({ sourceFreshness: { status: 'stale' } }), true);
  assert.equal(isStale({ sourceFreshness: { status: 'current' } }), false);
  assert.equal(isStale({}), true);
});
