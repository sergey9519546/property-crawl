'use strict';

// test/sources/catalog-access-policy.test.js
//
// Tests for the catalog-driven access policy that backs the GSA scraper's
// URL gate. The catalog is the source of truth: robotsExclusion is kept for
// backward compatibility, but allowedPaths, disallowedPaths, and
// inventoryPaths in accessPolicy make the policy explicit and enforceable.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateAccessForAdapter,
  getAccessPolicyForAdapter,
  getRobotsExclusionForAdapter,
  isPathExcludedForAdapter,
  SOURCE_CATALOG,
} = require('../../server/sources/catalog');

test('GSA catalog entry declares accessPolicy with allowedPaths, disallowedPaths, inventoryPaths', () => {
  const entry = SOURCE_CATALOG.find((s) => s.id === 'gsa-real-estate-sales');
  assert.ok(entry);
  const policy = entry.accessPolicy;
  assert.ok(policy);
  assert.deepEqual(policy.disallowedPaths, ['/our-listing', '/login', '/register', '/about', '/news', '/contact', '/search', '/faqs']);
  assert.equal(policy.allowedPaths.length, 1);
  assert.equal(policy.allowedPaths[0].path, '/asset-details');
  assert.equal(policy.allowedPaths[0].queryPattern, 'property_id=\\d+');
  // inventoryPaths is normalized to { path } objects by the catalog.
  assert.deepEqual(policy.inventoryPaths, [{ path: '/asset-details' }]);
});

test('validateAccessForAdapter: GSA /asset-details with numeric property_id is allowed', () => {
  const r = validateAccessForAdapter('gsa', 'https://realestatesales.gov/asset-details/?property_id=27');
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'allowed_by_policy');
  assert.equal(r.matchedPolicy, '/asset-details');
});

test('validateAccessForAdapter: GSA /asset-details without property_id is refused (queryPattern gate)', () => {
  const r = validateAccessForAdapter('gsa', 'https://realestatesales.gov/asset-details/');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'path_not_in_allowed_list');
});

test('validateAccessForAdapter: GSA /asset-details with non-numeric property_id is refused', () => {
  const r = validateAccessForAdapter('gsa', 'https://realestatesales.gov/asset-details/?property_id=abc');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'path_not_in_allowed_list');
});

test('validateAccessForAdapter: GSA /our-listing is refused by disallowedPaths', () => {
  const r = validateAccessForAdapter('gsa', 'https://realestatesales.gov/our-listing');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'path_disallowed');
  assert.equal(r.matchedPolicy, '/our-listing');
});

test('validateAccessForAdapter: GSA /our-listing/page/2 is also refused (prefix match)', () => {
  const r = validateAccessForAdapter('gsa', 'https://realestatesales.gov/our-listing/page/2');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'path_disallowed');
  assert.equal(r.matchedPolicy, '/our-listing');
});

test('validateAccessForAdapter: GSA login-walled paths are refused without needing robots.txt', () => {
  // /login is in disallowedPaths (login-walled), not robotsExclusion.
  const r = validateAccessForAdapter('gsa', 'https://realestatesales.gov/login?next=/our-listing');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'path_disallowed');
  assert.equal(r.matchedPolicy, '/login');
});

test('validateAccessForAdapter: GSA browsing artifacts (/about, /news, /contact) are refused', () => {
  for (const path of ['/about', '/news', '/contact', '/search', '/faqs']) {
    const r = validateAccessForAdapter('gsa', `https://realestatesales.gov${path}`);
    assert.equal(r.allowed, false, `${path} should be refused`);
    assert.equal(r.reason, 'path_disallowed');
  }
});

test('validateAccessForAdapter: respectRobots=false permits disallowed paths (operator override)', () => {
  const r = validateAccessForAdapter('gsa', 'https://realestatesales.gov/our-listing', { respectRobots: false });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'robots_override_active');
  assert.equal(r.override, true);
});

test('validateAccessForAdapter: allowOverride is a master switch that permits any URL on the adapter host', () => {
  // /about is in disallowedPaths AND not in allowedPaths; without override
  // it is refused. With allowOverride the function returns allowed=true
  // and labels the reason so run reports can flag operator overrides.
  const denied = validateAccessForAdapter('gsa', 'https://realestatesales.gov/about');
  assert.equal(denied.allowed, false);
  const allowed = validateAccessForAdapter('gsa', 'https://realestatesales.gov/about', { allowOverride: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'operator_override');
  assert.equal(allowed.override, true);
});

test('validateAccessForAdapter: allowOverride still refuses unsafe URLs (host mismatch, non-https)', () => {
  // Master switch permits any catalog-policy-decision but the safety
  // checks (host allow-list, protocol, userinfo) come first.
  const r = validateAccessForAdapter('gsa', 'https://attacker.example/about', { allowOverride: true });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'host_not_allowed');
  const r2 = validateAccessForAdapter('gsa', 'http://realestatesales.gov/about', { allowOverride: true });
  assert.equal(r2.allowed, false);
  assert.equal(r2.reason, 'unsafe_url');
});

test('validateAccessForAdapter: non-https URL is refused', () => {
  const r = validateAccessForAdapter('gsa', 'http://realestatesales.gov/asset-details/?property_id=27');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'unsafe_url');
});

test('validateAccessForAdapter: userinfo in URL is refused', () => {
  const r = validateAccessForAdapter('gsa', 'https://attacker:password@realestatesales.gov/asset-details/?property_id=27');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'unsafe_url');
});

test('validateAccessForAdapter: foreign host (even with valid path) is refused', () => {
  const r = validateAccessForAdapter('gsa', 'https://attacker.example/asset-details/?property_id=27');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'host_not_allowed');
});

test('validateAccessForAdapter: unknown adapter is refused', () => {
  const r = validateAccessForAdapter('nonexistent-adapter', 'https://example.com/foo');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'unknown_adapter');
});

test('validateAccessForAdapter: empty / non-string URL is refused', () => {
  for (const bad of ['', null, undefined, 42, {}]) {
    const r = validateAccessForAdapter('gsa', bad);
    assert.equal(r.allowed, false, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('validateAccessForAdapter: unparseable URL is refused', () => {
  const r = validateAccessForAdapter('gsa', 'not a url');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'url_unparseable');
});

test('validateAccessForAdapter: adapters without an accessPolicy keep permissive default for legacy paths', () => {
  // Find an adapter without accessPolicy; on its own host, the helper
  // should fall through to "no_allow_list_declared" with allowed=true so
  // legacy scrapers keep working.
  const candidate = SOURCE_CATALOG.find((s) => s.adapterKey && (!s.accessPolicy));
  if (!candidate) return; // every adapter has a policy now
  const { SOURCE_HOSTS } = require('../../server/scrapers/source-policy');
  const host = SOURCE_HOSTS[candidate.adapterKey][0];
  const r = validateAccessForAdapter(candidate.adapterKey, `https://${host}/some-path`);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'no_allow_list_declared');
});

test('validateAccessForAdapter: legacy robotsExclusion still works when no accessPolicy.disallowedPaths is declared', () => {
  // For adapters with ONLY legacy robotsExclusion (no accessPolicy yet),
  // disallowed paths should still be refused via the legacy field.
  const excluded = SOURCE_CATALOG
    .filter((s) => Array.isArray(s.robotsExclusion) && s.robotsExclusion.length && !s.accessPolicy)
    .map((s) => ({ key: s.adapterKey, path: s.robotsExclusion[0] }))
    .find((entry) => entry.key);
  if (!excluded) return; // every adapter with robotsExclusion now has accessPolicy
  const r = validateAccessForAdapter(excluded.key, `https://example.com${excluded.path}`);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'path_disallowed');
});

test('isPathExcludedForAdapter still works for GSA /our-listing (backward compat)', () => {
  // The legacy helper must keep working so any caller that uses it
  // directly continues to see the publisher-declared exclusion.
  assert.equal(isPathExcludedForAdapter('gsa', '/our-listing'), true);
  assert.equal(isPathExcludedForAdapter('gsa', '/our-listing/page/2'), true);
  assert.equal(isPathExcludedForAdapter('gsa', '/asset-details'), false);
});

test('getRobotsExclusionForAdapter returns the union of robotsExclusion and accessPolicy.disallowedPaths for GSA', () => {
  const r = getRobotsExclusionForAdapter('gsa');
  assert.ok(r);
  assert.ok(r.includes('/our-listing'));
});

test('getAccessPolicyForAdapter returns the policy for known adapters and null otherwise', () => {
  assert.ok(getAccessPolicyForAdapter('gsa'));
  assert.equal(getAccessPolicyForAdapter('nonexistent'), null);
});