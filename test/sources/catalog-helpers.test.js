'use strict';

// test/sources/catalog-helpers.test.js
//
// Direct unit coverage for the pure helpers exported from
// server/sources/catalog.js. The catalog is the single source of truth
// for every scraper's role / access / adapterKey / status / robots /
// accessPolicy — silent drift in any of these would silently change how
// every source is treated by the system.
//
//   - getSource: id normalization (lowercase + trim), missing id
//   - summarizeCatalog: by_role / by_category / by_status aggregates
//   - isPrivateIpv4: RFC1918 ranges (10/8, 172.16-31, 192.168, 127, 0, 169.254)
//   - validateJurisdictionDiscoveryUrl: https-only, no localhost / private IPs,
//     no credentials / port / hash
//   - getRobotsExclusionForAdapter / isPathExcludedForAdapter: catalog-driven
//     robots gating

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SOURCE_CATALOG,
  getSource,
  summarizeCatalog,
  validateJurisdictionDiscoveryUrl,
  getRobotsExclusionForAdapter,
  isPathExcludedForAdapter,
} = require('../../server/sources/catalog');

// isPrivateIpv4 is private; exercise through validateJurisdictionDiscoveryUrl.

// --- getSource --------------------------------------------------------

test('getSource: returns the entry whose id matches', () => {
  const entry = getSource('servicelink');
  assert.ok(entry);
  assert.equal(entry.id, 'servicelink');
});

test('getSource: lowercases and trims the id', () => {
  assert.equal(getSource('SERVICELINK').id, 'servicelink');
  assert.equal(getSource('  servicelink  ').id, 'servicelink');
});

test('getSource: missing / empty / unknown id -> null', () => {
  assert.equal(getSource(null), null);
  assert.equal(getSource(''), null);
  assert.equal(getSource('not-a-real-source'), null);
});

// --- summarizeCatalog --------------------------------------------------

test('summarizeCatalog: returns byRole / byCategory / byStatus aggregates', () => {
  const summary = summarizeCatalog();
  assert.ok(summary.byRole);
  assert.ok(summary.byCategory);
  assert.ok(summary.byStatus);
  assert.ok(Array.isArray(summary.scheduledAdapterKeys));
  assert.ok(summary.total >= 1);
});

test('summarizeCatalog: byRole counts include the published source roles', () => {
  const summary = summarizeCatalog();
  assert.ok(summary.byRole.opportunity >= 1);
  assert.ok(summary.byRole.evidence >= 1);
  assert.ok(summary.byRole.discovery >= 1);
});

test('summarizeCatalog: scheduledAdapterKeys are sorted and unique', () => {
  const summary = summarizeCatalog();
  const keys = summary.scheduledAdapterKeys;
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(keys).size, keys.length);
});

// --- validateJurisdictionDiscoveryUrl ----------------------------------

test('validateJurisdictionDiscoveryUrl: valid public https URL -> isValid true', () => {
  const out = validateJurisdictionDiscoveryUrl('https://example.gov/path?x=1');
  assert.equal(out.isValid, true);
  assert.equal(out.error, null);
  assert.match(out.url, /^https:\/\/example\.gov\/path/);
});

test('validateJurisdictionDiscoveryUrl: rejects non-https', () => {
  assert.equal(validateJurisdictionDiscoveryUrl('http://example.com/x').error, 'https_required');
});

test('validateJurisdictionDiscoveryUrl: rejects localhost and private IPs', () => {
  assert.equal(validateJurisdictionDiscoveryUrl('https://localhost/x').error, 'private_or_local_host');
  assert.equal(validateJurisdictionDiscoveryUrl('https://app.localhost/x').error, 'private_or_local_host');
  assert.equal(validateJurisdictionDiscoveryUrl('https://127.0.0.1/x').error, 'private_or_local_host');
  assert.equal(validateJurisdictionDiscoveryUrl('https://10.0.0.1/x').error, 'private_or_local_host');
  assert.equal(validateJurisdictionDiscoveryUrl('https://192.168.1.1/x').error, 'private_or_local_host');
});

test('validateJurisdictionDiscoveryUrl: rejects credentials / port / hash', () => {
  assert.equal(validateJurisdictionDiscoveryUrl('https://user:pass@example.com/x').error, 'unsafe_url_component');
  assert.equal(validateJurisdictionDiscoveryUrl('https://example.com:8443/x').error, 'unsafe_url_component');
  assert.equal(validateJurisdictionDiscoveryUrl('https://example.com/x#frag').error, 'unsafe_url_component');
});

test('validateJurisdictionDiscoveryUrl: rejects malformed URLs', () => {
  assert.equal(validateJurisdictionDiscoveryUrl('not a url').error, 'invalid_url');
  assert.equal(validateJurisdictionDiscoveryUrl('').error, 'invalid_url');
});

// --- getRobotsExclusionForAdapter / isPathExcludedForAdapter ----------

test('getRobotsExclusionForAdapter: returns a fresh copy of the exclusion list', () => {
  const a = getRobotsExclusionForAdapter('gsa');
  assert.ok(Array.isArray(a));
  assert.ok(a.includes('/our-listing'));
  a.push('/hacked');
  const b = getRobotsExclusionForAdapter('gsa');
  assert.ok(!b.includes('/hacked'));
});

test('getRobotsExclusionForAdapter: unknown adapter -> null', () => {
  assert.equal(getRobotsExclusionForAdapter('not-an-adapter'), null);
});

test('isPathExcludedForAdapter: exact match returns true', () => {
  assert.equal(isPathExcludedForAdapter('gsa', '/our-listing'), true);
});

test('isPathExcludedForAdapter: prefix match returns true', () => {
  assert.equal(isPathExcludedForAdapter('gsa', '/our-listing/page/2'), true);
});

test('isPathExcludedForAdapter: unrelated path returns false', () => {
  assert.equal(isPathExcludedForAdapter('gsa', '/asset-details'), false);
});

test('isPathExcludedForAdapter: invalid input returns false', () => {
  assert.equal(isPathExcludedForAdapter(null, '/x'), false);
  assert.equal(isPathExcludedForAdapter('gsa', null), false);
});

// --- SOURCE_CATALOG structure -----------------------------------------

test('SOURCE_CATALOG: contains the published primary sources', () => {
  const ids = SOURCE_CATALOG.map((e) => e.id);
  for (const required of ['servicelink', 'treasury-forfeiture', 'irs-auctions', 'usda-resales', 'hud-homestore']) {
    assert.ok(ids.includes(required), `catalog missing ${required}`);
  }
});