'use strict';

// test/audit/property-image-routing-helpers.test.js
//
// Direct unit coverage for server/audit/property-image-routing.js. The
// audit runs offline, deterministic checks against each property-image
// route input: is the address geocodable, is the state a real USPS code,
// do coords fall inside the state's bounding rectangle, does the source
// host match the publisher, and does the photo URL match the listing
// URL. Silent drift in any of these would silently let the wrong
// imagery get pulled for a listing.
//
//   - auditListing: per-listing verdict + result flags
//   - runAudit: aggregate fail rate + by_check / by_source summary
//   - threshold (above_threshold flag) and pass / fail / skipped counters
//   - address_geocodable special-case for positive_land_evidence
//   - state_valid, zip_valid boundary regex behavior
//   - coords_in_state: outside-bbox detection, territories skipped
//   - publisher_host_consistent: exact + suffix match, host mismatch
//   - photo_provenance_consistent: hash-stripping, URL mismatch flag

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  auditListing,
  runAudit,
  CHECK_ORDER,
  PUBLISHER_HOSTS,
  STATE_BBOX,
} = require('../../server/audit/property-image-routing');

// --- CHECK_ORDER and PUBLISHER_HOSTS structural pins -------------------

test('CHECK_ORDER: runs all six published checks in deterministic order', () => {
  assert.deepEqual(CHECK_ORDER, [
    'address_geocodable',
    'state_valid',
    'zip_valid',
    'coords_in_state',
    'publisher_host_consistent',
    'photo_provenance_consistent',
  ]);
});

test('PUBLISHER_HOSTS: each publisher has at least one expected host suffix', () => {
  for (const [publisher, hosts] of Object.entries(PUBLISHER_HOSTS)) {
    assert.ok(Array.isArray(hosts) && hosts.length > 0, `${publisher} has no expected hosts`);
  }
});

test('STATE_BBOX: every entry has south, north, west, east', () => {
  for (const [code, bbox] of Object.entries(STATE_BBOX)) {
    for (const field of ['south', 'north', 'west', 'east']) {
      assert.ok(typeof bbox[field] === 'number', `${code} missing ${field}`);
    }
    assert.ok(bbox.north > bbox.south, `${code} north <= south`);
    assert.ok(bbox.east > bbox.west, `${code} east <= west`);
  }
});

// --- auditListing: well-formed listing passes all checks ---------------

test('auditListing: well-formed USDA listing passes all six checks', () => {
  const listing = {
    id: 'L1',
    source: 'usda',
    state: 'OH',
    city: 'Cleveland',
    zip: '44113',
    lat: 41.5,
    lng: -81.7,
    sourceUrl: 'https://resales.usda.gov/property/123',
    address: '123 Main St, Cleveland, OH 44113',
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.id, 'L1');
  assert.equal(result.source, 'usda');
  assert.equal(result.fail, 0);
  // 5 pass + 1 skipped (photo_absent_skipped) = 6 checks
  assert.equal(result.pass, 5);
  assert.equal(result.skipped, 1);
  for (const check of CHECK_ORDER) {
    assert.equal(result.results[check].ok, true, `${check} should pass`);
  }
});

test('auditListing: positive_land_evidence qualification makes address_geocodable pass without an address', () => {
  const listing = {
    id: 'L1',
    source: 'irs',
    state: 'TX',
    zip: '75001',
    sourceUrl: 'https://irsauctions.gov/x',
    provenance: {
      publisher: 'Internal Revenue Service',
      sourceFacts: { addressQualification: 'positive_land_evidence' },
    },
  };
  const result = auditListing(listing);
  assert.equal(result.results.address_geocodable.ok, true);
  assert.match(result.results.address_geocodable.reason, /land_without_housenumber/);
});

// --- state_valid / zip_valid --------------------------------------------

test('auditListing: invalid state code -> state_valid fails', () => {
  const listing = {
    id: 'L1',
    sourceUrl: 'https://resales.usda.gov/x',
    state: 'ZZ',
    zip: '44113',
    address: '123 Main St, Cleveland, ZZ 44113',
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.state_valid.ok, false);
  assert.match(result.results.state_valid.reason, /^state_invalid:/);
});

test('auditListing: bad zip format -> zip_valid fails', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: 'ABCDE',
    sourceUrl: 'https://resales.usda.gov/x',
    address: '123 Main St',
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.zip_valid.ok, false);
});

test('auditListing: ZIP+4 is accepted', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113-1234',
    sourceUrl: 'https://resales.usda.gov/x',
    address: '123 Main St, Cleveland, OH 44113-1234',
    lat: 41.5,
    lng: -81.7,
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.zip_valid.ok, true);
});

// --- coords_in_state ----------------------------------------------------

test('auditListing: coords outside state bbox -> coords_in_state fails', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    lat: 30.0,  // way south of Ohio (south=38.40)
    lng: -81.7,
    sourceUrl: 'https://resales.usda.gov/x',
    address: '123 Main St',
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.coords_in_state.ok, false);
  assert.match(result.results.coords_in_state.reason, /^coords_outside_state_bbox/);
});

test('auditListing: coords inside Ohio bbox -> coords_in_state passes', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    lat: 41.5,
    lng: -81.7,
    sourceUrl: 'https://resales.usda.gov/x',
    address: '123 Main St',
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.coords_in_state.ok, true);
});

test('auditListing: zero-zero coords are skipped, not failed', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    lat: 0,
    lng: 0,
    sourceUrl: 'https://resales.usda.gov/x',
    address: '123 Main St',
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.coords_in_state.ok, true);
  assert.match(result.results.coords_in_state.reason, /coords_absent_skipped/);
});

test('auditListing: PR state (valid USPS, no bbox) skips coord check', () => {
  const listing = {
    id: 'L1',
    state: 'PR',
    zip: '00601',
    lat: 18.2,
    lng: -66.6,
    sourceUrl: 'https://example.com/x',
    address: 'Some address',
    provenance: { publisher: 'unknown-publisher' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.coords_in_state.ok, true);
  assert.match(result.results.coords_in_state.reason, /bbox_unknown/);
});

// --- publisher_host_consistent -----------------------------------------

test('auditListing: treasury publisher on non-treasury host -> host mismatch', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: 'https://example.com/x',
    address: '123 Main St',
    provenance: { publisher: 'U.S. Department of the Treasury' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.publisher_host_consistent.ok, false);
  assert.match(result.results.publisher_host_consistent.reason, /host_mismatch/);
});

test('auditListing: treasury publisher on treasury.gov -> passes (exact match)', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: 'https://www.treasury.gov/auction/x',
    address: '123 Main St',
    provenance: { publisher: 'U.S. Department of the Treasury' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.publisher_host_consistent.ok, true);
});

test('auditListing: HUD publisher on subdomain of expected host -> passes', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: 'https://egis.hud.gov/listing/x',
    address: '123 Main St',
    provenance: { publisher: 'HUD eGIS — Single Family REO' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.publisher_host_consistent.ok, true);
});

test('auditListing: unknown publisher -> skipped (not failed)', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: 'https://example.com/x',
    address: '123 Main St',
    provenance: { publisher: 'Made Up Publisher' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.publisher_host_consistent.ok, true);
  assert.match(result.results.publisher_host_consistent.reason, /publisher_unknown/);
});

test('auditListing: missing publisher -> failed', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: 'https://example.com/x',
    address: '123 Main St',
    provenance: {},
  };
  const result = auditListing(listing);
  assert.equal(result.results.publisher_host_consistent.ok, false);
  assert.match(result.results.publisher_host_consistent.reason, /publisher_missing/);
});

// --- photo_provenance_consistent ---------------------------------------

test('auditListing: photo source URL matches listing URL -> passes (hash ignored)', () => {
  const url = 'https://resales.usda.gov/listing/123';
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: url,
    address: '123 Main St',
    provenance: {
      publisher: 'USDA Rural Development',
      media: { photo: { sourceRecordUrl: `${url}#section-1` } },
    },
  };
  const result = auditListing(listing);
  assert.equal(result.results.photo_provenance_consistent.ok, true);
});

test('auditListing: photo source URL differs from listing URL -> fails', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: 'https://resales.usda.gov/listing/123',
    address: '123 Main St',
    provenance: {
      publisher: 'USDA Rural Development',
      media: { photo: { sourceRecordUrl: 'https://resales.usda.gov/listing/456' } },
    },
  };
  const result = auditListing(listing);
  assert.equal(result.results.photo_provenance_consistent.ok, false);
  assert.match(result.results.photo_provenance_consistent.reason, /photo_source_record_mismatch/);
});

test('auditListing: photo missing entirely -> skipped (not failed)', () => {
  const listing = {
    id: 'L1',
    state: 'OH',
    zip: '44113',
    sourceUrl: 'https://resales.usda.gov/listing/123',
    address: '123 Main St',
    provenance: { publisher: 'USDA Rural Development' },
  };
  const result = auditListing(listing);
  assert.equal(result.results.photo_provenance_consistent.ok, true);
  assert.match(result.results.photo_provenance_consistent.reason, /photo_absent_skipped/);
});

// --- runAudit: aggregate summary ---------------------------------------

test('runAudit: empty listing set returns zero fail rate', () => {
  const summary = runAudit([], { threshold: 0.5 });
  assert.equal(summary.total, 0);
  assert.equal(summary.rows_with_fail, 0);
  assert.equal(summary.fail_rate, 0);
  assert.equal(summary.above_threshold, false);
});

test('runAudit: aggregates pass/fail/skipped per check', () => {
  const listings = [
    // Well-formed listing
    {
      id: 'L1', source: 'usda', state: 'OH', city: 'Cleveland', zip: '44113', lat: 41.5, lng: -81.7,
      sourceUrl: 'https://resales.usda.gov/x', address: '123 Main St, Cleveland, OH 44113',
      provenance: { publisher: 'USDA Rural Development' },
    },
    // Failing listing (invalid state)
    {
      id: 'L2', source: 'usda', state: 'ZZ', city: 'Cleveland', zip: '44113',
      sourceUrl: 'https://resales.usda.gov/y', address: '123 Main St, Cleveland, ZZ 44113',
      provenance: { publisher: 'USDA Rural Development' },
    },
  ];
  const summary = runAudit(listings, { threshold: 1.0 });
  assert.equal(summary.total, 2);
  assert.equal(summary.rows_with_fail, 1);
  assert.equal(summary.fail_rate, 0.5);
  assert.equal(summary.above_threshold, false);  // 0.5 < 1.0
  assert.ok(summary.by_check.state_valid);
  assert.equal(summary.by_check.state_valid.fail, 1);
  assert.equal(summary.by_source.usda.total, 2);
  assert.equal(summary.by_source.usda.with_fail, 1);
});

test('runAudit: above_threshold flag flips when fail_rate exceeds threshold', () => {
  const listings = [
    {
      id: 'L1', state: 'ZZ', city: 'X', zip: '44113',
      sourceUrl: 'https://example.com/x', address: '123 Main St, X, ZZ 44113',
      provenance: { publisher: 'Made Up' },
    },
    {
      id: 'L2', state: 'OH', city: 'Cleveland', zip: '44113',
      sourceUrl: 'https://example.com/x', address: '123 Main St, Cleveland, OH 44113',
      provenance: { publisher: 'Made Up' },
    },
  ];
  const summary = runAudit(listings, { threshold: 0.1 });
  assert.equal(summary.fail_rate, 0.5);
  assert.equal(summary.above_threshold, true);
});

test('runAudit: per-source fail_rate pinned', () => {
  const listings = [
    { id: 'a', source: 'usda', state: 'OH', city: 'Cleveland', zip: '44113', sourceUrl: 'https://example.com/x', address: '123 Main St, Cleveland, OH 44113', provenance: { publisher: 'USDA' } },
    { id: 'b', source: 'irs', state: 'ZZ', city: 'X', zip: '44113', sourceUrl: 'https://example.com/x', address: '123 Main St, X, ZZ 44113', provenance: { publisher: 'Made Up' } },
    { id: 'c', source: 'irs', state: 'OH', city: 'Cleveland', zip: '44113', sourceUrl: 'https://example.com/x', address: '123 Main St, Cleveland, OH 44113', provenance: { publisher: 'Made Up' } },
  ];
  const summary = runAudit(listings, { threshold: 1.0 });
  assert.equal(summary.by_source.usda.fail_rate, 0);
  assert.equal(summary.by_source.irs.fail_rate, 0.5);
});