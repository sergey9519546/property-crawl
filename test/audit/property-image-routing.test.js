'use strict';

// audit/property-image-routing.test.js
//
// Tests for the upstream data-quality audit used by
// `scripts/audit-property-image-routing.cjs`. These tests verify each
// individual check's verdict on constructed listing fixtures, plus the
// aggregate runAudit() reporting.

const assert = require('node:assert/strict');
const test = require('node:test');

const { auditListing, runAudit, CHECK_ORDER, STATE_BBOX, PUBLISHER_HOSTS } = require('../../server/audit/property-image-routing');

function listing(overrides = {}) {
  return {
    id: 'TEST-001',
    source: 'treasury',
    address: '112 North Avenue E',
    city: 'Bruni',
    state: 'TX',
    zip: '78344',
    lat: 27.45,
    lng: -98.88,
    sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/112bruni.shtml',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'U.S. Department of the Treasury',
      recordId: '26-66-189',
    },
    ...overrides,
  };
}

test('CHECK_ORDER covers the documented checks in stable order', () => {
  assert.deepEqual(CHECK_ORDER, [
    'address_geocodable',
    'state_valid',
    'zip_valid',
    'coords_in_state',
    'publisher_host_consistent',
    'photo_provenance_consistent',
  ]);
});

test('auditListing: a fully valid treasury listing passes every check', () => {
  const row = auditListing(listing());
  assert.equal(row.fail, 0, JSON.stringify(row.results));
  assert.ok(row.pass >= 4, 'expected at least 4 hard passes');
});

test('auditListing: address that does not parse for geocoding fails address_geocodable', () => {
  const row = auditListing(listing({ address: '', city: '', zip: '' }));
  assert.equal(row.results.address_geocodable.ok, false);
  assert.match(row.results.address_geocodable.reason, /address_missing_or_unparseable/);
});

test('auditListing: apartment-style address is rejected by address_geocodable', () => {
  // The route's sourceObservedAddress() rejects "Lot X", "Parcel X", "P.O. Box",
  // and any address that lacks a leading housenumber. The audit mirrors that.
  const row = auditListing(listing({ address: 'Lot 14, Sunrise Estates' }));
  assert.equal(row.results.address_geocodable.ok, false);
});

test('auditListing: invalid state fails state_valid', () => {
  const row = auditListing(listing({ state: 'ZZ' }));
  assert.equal(row.results.state_valid.ok, false);
});

test('auditListing: invalid zip fails zip_valid', () => {
  const row = auditListing(listing({ zip: 'ABCDE' }));
  assert.equal(row.results.zip_valid.ok, false);
});

test('auditListing: coords outside the state bbox fail coords_in_state', () => {
  // Listing says TX, coords in Maine — this is exactly the kind of mismatch
  // the audit is designed to catch.
  const row = auditListing(listing({ lat: 44.95, lng: -68.65 }));
  assert.equal(row.results.coords_in_state.ok, false);
  assert.match(row.results.coords_in_state.reason, /coords_outside_state_bbox/);
});

test('auditListing: missing coords are skipped, not failed', () => {
  const row = auditListing(listing({ lat: null, lng: null }));
  assert.equal(row.results.coords_in_state.ok, true);
  assert.equal(row.results.coords_in_state.reason, 'coords_absent_skipped');
});

test('auditListing: zero/null coords are skipped', () => {
  const row = auditListing(listing({ lat: 0, lng: 0 }));
  assert.equal(row.results.coords_in_state.ok, true);
  assert.equal(row.results.coords_in_state.reason, 'coords_absent_skipped');
});

test('auditListing: wrong publisher host fails publisher_host_consistent', () => {
  const row = auditListing(listing({
    sourceUrl: 'https://example.com/treasury-record.html',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'U.S. Department of the Treasury',
      recordId: '26-66-189',
    },
  }));
  assert.equal(row.results.publisher_host_consistent.ok, false);
  assert.match(row.results.publisher_host_consistent.reason, /host_mismatch/);
});

test('auditListing: unknown publisher is skipped, not failed', () => {
  const row = auditListing(listing({
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'Some Future Publisher',
      recordId: '999',
    },
  }));
  assert.equal(row.results.publisher_host_consistent.ok, true);
  assert.match(row.results.publisher_host_consistent.reason, /publisher_unknown/);
});

test('auditListing: photo provenance binding matches', () => {
  const photoUrl = 'https://www.treasury.gov/auctions/treasury/rp/112bruni.shtml';
  const row = auditListing(listing({
    sourceUrl: photoUrl,
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'U.S. Department of the Treasury',
      recordId: '26-66-189',
      media: {
        photo: {
          sourceRecordUrl: photoUrl,
          url: 'https://www.treasury.gov/auctions/treasury/rp/images/112bruni01.gif',
          origin: 'publisher_record',
          verification: 'source_extracted',
        },
      },
    },
  }));
  assert.equal(row.results.photo_provenance_consistent.ok, true);
});

test('auditListing: photo provenance mismatch fails', () => {
  // The listing's sourceUrl points at one Treasury page, but its photo was
  // supposedly extracted from a different Treasury record. This is a real
  // cross-contamination hazard and must be flagged.
  const row = auditListing(listing({
    sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/112bruni.shtml',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'U.S. Department of the Treasury',
      recordId: '26-66-189',
      media: {
        photo: {
          sourceRecordUrl: 'https://www.treasury.gov/auctions/treasury/rp/999different.shtml',
          url: 'https://www.treasury.gov/auctions/treasury/rp/images/999different01.gif',
          origin: 'publisher_record',
          verification: 'source_extracted',
        },
      },
    },
  }));
  assert.equal(row.results.photo_provenance_consistent.ok, false);
  assert.match(row.results.photo_provenance_consistent.reason, /photo_source_record_mismatch/);
});

test('auditListing: a HUD listing is validated against egis.hud.gov', () => {
  const row = auditListing(listing({
    id: 'HUD-001',
    source: 'hud',
    sourceUrl: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query?where=CASE_NUM+%3D+%27011-462670%27',
    address: '500 Test Street',
    city: 'Detroit',
    state: 'MI',
    zip: '48201',
    lat: 42.33,
    lng: -83.05,
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'HUD eGIS — Single Family REO',
      recordId: '011-462670',
    },
  }));
  assert.equal(row.fail, 0, JSON.stringify(row.results));
});

test('STATE_BBOX covers the 50 states + DC', () => {
  const expectedKeys = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
    'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
    'VT','VA','WA','WV','WI','WY',
  ];
  for (const key of expectedKeys) {
    const bbox = STATE_BBOX[key];
    assert.ok(bbox, `missing bbox for ${key}`);
    assert.ok(bbox.south < bbox.north, `${key} south must be < north`);
    assert.ok(bbox.west < bbox.east, `${key} west must be < east`);
  }
});

test('PUBLISHER_HOSTS covers every publisher observed in the live DB', () => {
  // The 7 publishers the live data actually carries. If a new publisher
  // starts showing up, this test forces the maintainer to extend the map.
  const expected = [
    'USDA Rural Development',
    'U.S. Department of the Treasury',
    'Internal Revenue Service',
    'ServiceLink Auction',
    'HUD eGIS — Single Family REO',
    'General Services Administration',
    'CivilView',
  ];
  for (const pub of expected) {
    assert.ok(PUBLISHER_HOSTS[pub], `missing publisher host map: ${pub}`);
    assert.ok(Array.isArray(PUBLISHER_HOSTS[pub]) && PUBLISHER_HOSTS[pub].length > 0);
  }
});

test('runAudit: aggregate counts match per-listing results', () => {
  const rows = [
    listing(),
    listing({ id: 'TEST-002', address: '', city: '', zip: '' }),
    listing({ id: 'TEST-003', state: 'ZZ' }),
  ];
  const report = runAudit(rows);
  assert.equal(report.total, 3);
  assert.equal(report.rows_with_fail, 2);
  assert.equal(report.above_threshold, true);
  for (const name of CHECK_ORDER) {
    assert.ok(report.by_check[name], `by_check missing ${name}`);
    assert.equal(
      report.by_check[name].pass + report.by_check[name].fail + report.by_check[name].skipped,
      report.total,
      `by_check[${name}] counts do not sum to total`
    );
  }
});

test('runAudit: threshold gate works at the boundary', () => {
  // 1 of 20 listings failing → 5% fail rate. With threshold = 0.05 we
  // expect above_threshold=false (fail rate is not strictly greater than
  // the threshold); with threshold = 0.04 we expect above_threshold=true.
  const rows = Array.from({ length: 19 }, (_, i) => listing({ id: `OK-${i}` }));
  rows.push(listing({ id: 'BAD-1', address: '', city: '', zip: '' }));
  assert.equal(runAudit(rows, { threshold: 0.05 }).above_threshold, false);
  assert.equal(runAudit(rows, { threshold: 0.04 }).above_threshold, true);
});

test('runAudit: by_source aggregates per-source fail rate', () => {
  const rows = [
    listing({ id: 'TRE-OK', source: 'treasury' }),
    listing({ id: 'TRE-BAD', source: 'treasury', state: 'ZZ' }),
    listing({ id: 'HUD-OK', source: 'hud' }),
  ];
  const report = runAudit(rows);
  assert.equal(report.by_source.treasury.total, 2);
  assert.equal(report.by_source.treasury.with_fail, 1);
  assert.equal(report.by_source.hud.total, 1);
  assert.equal(report.by_source.hud.with_fail, 0);
});

test('runAudit: empty input returns a well-formed empty report', () => {
  const report = runAudit([]);
  assert.equal(report.total, 0);
  assert.equal(report.fail_rate, 0);
  assert.equal(report.above_threshold, false);
  assert.equal(report.rows_with_fail, 0);
});