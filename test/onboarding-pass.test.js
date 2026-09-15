'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  runOnboardingPass,
  runOnboardingSource,
  isEligible,
  classifyCrawlError,
  listCachedSources,
  DEFAULT_CACHE_ROOT
} = require('../server/discovery/onboarding-pass');
const { SOURCE_CATALOG } = require('../server/sources/catalog');

// Valid 64-char hex string (the spider rejects any other shape via
// isValidContentHash). Production scrapling-bridge returns the real hash
// of the page HTML; tests just need a syntactically valid stub.
const FAKE_CONTENT_SHA256 = 'a'.repeat(64);

function withTempCacheRoot(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-pass-'));
  const originalRoot = DEFAULT_CACHE_ROOT;
  // Override via ONBOARDING_CACHE_ROOT env var in options (env-driven defaults
  // are read at call time, so we pass cacheRoot in options explicitly).
  try { return fn(tmp); }
  finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); }
    catch (_) { /* ignore cleanup failure */ }
  }
}

// Shared mock factories. The spider validates that every parser response
// carries a contentSha256, so every stub has to provide one. The fetch
// stub serves a one-byte HTML shell so the spider can read text() and
// route to the right content-type.
function htmlResponse(body) {
  return async () => ({
    status: 200, ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => body
  });
}

function extractStub(links) {
  return async () => ({
    contentSha256: FAKE_CONTENT_SHA256,
    links
  });
}

test('isEligible accepts DISCOVERY_ONLY entries with public access and a discoveryUrl', () => {
  assert.equal(isEligible({
    id: 'fannie-homepath',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'https://www.homepath.com/'
  }), true);
});

test('isEligible accepts SCOPE_LIMITED entries with public access', () => {
  assert.equal(isEligible({
    id: 'fl-dor-cadastral',
    status: 'SCOPE_LIMITED',
    access: 'public',
    discoveryUrl: 'https://services9.arcgis.com/...'
  }), true);
});

test('isEligible rejects VERIFIED_OFFICIAL entries', () => {
  assert.equal(isEligible({
    id: 'servicelink',
    status: 'VERIFIED_OFFICIAL',
    access: 'public',
    discoveryUrl: 'https://www.servicelinkauction.com/'
  }), false);
});

test('isEligible rejects INCONCLUSIVE_BLOCKED entries', () => {
  assert.equal(isEligible({
    id: 'blocked-x',
    status: 'INCONCLUSIVE_BLOCKED',
    access: 'public',
    discoveryUrl: 'https://example.test/'
  }), false);
});

test('isEligible rejects non-public access', () => {
  assert.equal(isEligible({
    id: 'private-y',
    status: 'DISCOVERY_ONLY',
    access: 'jurisdiction',
    discoveryUrl: 'https://example.test/'
  }), false);
});

test('isEligible rejects entries without a discoveryUrl', () => {
  assert.equal(isEligible({
    id: 'no-url',
    status: 'DISCOVERY_ONLY',
    access: 'public'
  }), false);
});

test('isEligible defaults to DISCOVERY_ONLY when status is omitted', () => {
  assert.equal(isEligible({
    id: 'no-status',
    access: 'public',
    discoveryUrl: 'https://example.test/'
  }), true);
});

test('classifyCrawlError returns crawl/unknown for generic errors', () => {
  const out = classifyCrawlError(new Error('something broke'));
  assert.equal(out.stage, 'crawl');
  assert.match(out.message, /something broke/);
});

test('classifyCrawlError recognizes robots disallowance', () => {
  const out = classifyCrawlError(new Error('robots.txt disallowed by /robots'));
  assert.equal(out.stage, 'robots');
  assert.equal(out.code, 'ROBOTS_DISALLOWED');
});

test('classifyCrawlError recognizes timeout messages', () => {
  const out = classifyCrawlError(new Error('request timeout after 30000ms'));
  assert.equal(out.stage, 'timeout');
  assert.equal(out.code, 'CRAWL_TIMEOUT');
});

test('classifyCrawlError preserves an explicit error code when present', () => {
  const error = new Error('Boom');
  error.code = 'MY_ERROR';
  const out = classifyCrawlError(error);
  assert.equal(out.code, 'MY_ERROR');
  assert.equal(out.stage, 'crawl');
});

test('classifyCrawlError tolerates non-Error inputs', () => {
  const out = classifyCrawlError('plain string');
  assert.match(out.message, /plain string/);
});

test('runOnboardingSource skips an entry whose discoveryUrl fails inspection', async () => {
  const entry = {
    id: 'invalid',
    adapterKey: 'invalid',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'not-a-url'
  };
  const record = await runOnboardingSource(entry, { persist: false });
  assert.equal(record.outcome, 'skipped');
  assert.ok(typeof record.reason === 'string' && record.reason.length > 0);
});

test('runOnboardingSource catches crawl errors and marks them failed', async () => {
  const entry = {
    id: 'us-marshals',
    adapterKey: 'marshals',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'https://usmarshals.gov/what-we-do/asset-forfeiture'
  };
  const record = await runOnboardingSource(entry, {
    persist: false,
    fetchImpl: async () => { const e = new Error('DNS failure'); e.haltScraper = true; throw e; },
    cacheRoot: path.join(os.tmpdir(), 'unused')
  });
  assert.equal(record.outcome, 'failed');
  assert.equal(record.candidatesCount, 0);
  assert.ok(record.detail);
});

test('runOnboardingSource maps a successful crawl to outcome=success', async () => {
  const entry = {
    id: 'us-marshals',
    adapterKey: 'marshals',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'https://usmarshals.gov/what-we-do/asset-forfeiture'
  };
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-ok-'));
  try {
    const record = await runOnboardingSource(entry, {
      fetchImpl: htmlResponse('<html><body><a href="/cases/1234">Case 1234</a></body></html>'),
      robots: { isAllowed: () => true },
      dependencies: { extractWithScrapling: extractStub([{ href: 'https://usmarshals.gov/what-we-do/asset-forfeiture/real-property/case-1234', text: 'Case 1234' }]) },
      cacheRoot
    });
    assert.equal(record.outcome, 'success');
    assert.equal(record.spiderKey, 'marshals');
    assert.ok(record.candidatesCount >= 1);
    assert.ok(record.cacheFile);
    assert.ok(fs.existsSync(record.cacheFile));
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource returns outcome=empty when the crawl surfaces no candidates', async () => {
  const entry = {
    id: 'us-marshals',
    adapterKey: 'marshals',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'https://usmarshals.gov/what-we-do/asset-forfeiture'
  };
  const record = await runOnboardingSource(entry, {
    persist: false,
    fetchImpl: htmlResponse('<html><body>no links</body></html>'),
    robots: { isAllowed: () => true },
    dependencies: { extractWithScrapling: extractStub([]) },
    cacheRoot: path.join(os.tmpdir(), 'unused-' + Date.now())
  });
  assert.equal(record.outcome, 'empty');
  assert.equal(record.candidatesCount, 0);
});

test('runOnboardingSource respects persist: false', async () => {
  const entry = {
    id: 'us-marshals',
    adapterKey: 'marshals',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'https://usmarshals.gov/what-we-do/asset-forfeiture'
  };
  const record = await runOnboardingSource(entry, {
    persist: false,
    fetchImpl: htmlResponse('<html><body><a href="/x">x</a></body></html>'),
    robots: { isAllowed: () => true },
    dependencies: { extractWithScrapling: extractStub([{ href: 'https://usmarshals.gov/x', text: 'x' }]) },
    cacheRoot: path.join(os.tmpdir(), 'unused')
  });
  assert.equal(record.cacheFile, null);
});

test('runOnboardingPass over the production SOURCE_CATALOG returns at least one eligible target', async () => {
  const summary = await runOnboardingPass({
    sources: null,
    persist: false,
    fetchImpl: htmlResponse('<html></html>'),
    robots: { isAllowed: () => true },
    dependencies: { extractWithScrapling: extractStub([]) }
  });
  assert.ok(summary.totalTargets >= 1);
  assert.ok(summary.runId.startsWith('onboarding-'));
  assert.equal(typeof summary.durationMs, 'number');
  for (const record of summary.records) {
    assert.ok(['success', 'empty', 'failed', 'skipped'].includes(record.outcome));
  }
});

test('runOnboardingPass runs only the requested sources when sources[] is given', async () => {
  const summary = await runOnboardingPass({
    sources: ['us-marshals'],
    persist: false,
    fetchImpl: htmlResponse('<html></html>'),
    robots: { isAllowed: () => true },
    dependencies: { extractWithScrapling: extractStub([]) }
  });
  assert.equal(summary.totalTargets, 1);
  assert.equal(summary.records[0].sourceId, 'us-marshals');
});

test('runOnboardingPass persists a latest-pass.json manifest when persist is not false', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-persist-'));
  const originalEnv = process.env.ONBOARDING_CACHE_ROOT;
  process.env.ONBOARDING_CACHE_ROOT = tmp;
  try {
    const summary = await runOnboardingPass({
      sources: ['us-marshals'],
      fetchImpl: htmlResponse('<html></html>'),
      robots: { isAllowed: () => true },
      dependencies: { extractWithScrapling: extractStub([]) }
    });
    assert.equal(summary.manifestFile, path.join(tmp, 'latest-pass.json'));
    assert.ok(fs.existsSync(summary.manifestFile));
  } finally {
    if (originalEnv === undefined) delete process.env.ONBOARDING_CACHE_ROOT;
    else process.env.ONBOARDING_CACHE_ROOT = originalEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runOnboardingPass honors sources: empty array by running all eligible', async () => {
  const summary = await runOnboardingPass({
    sources: [], persist: false,
    fetchImpl: htmlResponse('<html></html>'),
    robots: { isAllowed: () => true },
    dependencies: { extractWithScrapling: extractStub([]) }
  });
  assert.ok(summary.totalTargets >= 5);
});

test('runOnboardingPass summary counters add up to records.length', async () => {
  const summary = await runOnboardingPass({
    sources: ['us-marshals', 'va-vrm'], persist: false,
    fetchImpl: htmlResponse('<html></html>'),
    robots: { isAllowed: () => true },
    dependencies: { extractWithScrapling: extractStub([]) }
  });
  assert.equal(summary.success + summary.empty + summary.failed + summary.skipped, summary.records.length);
});

test('listCachedSources reads back the persisted manifests', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-list-'));
  const originalEnv = process.env.ONBOARDING_CACHE_ROOT;
  process.env.ONBOARDING_CACHE_ROOT = tmp;
  try {
    await runOnboardingPass({
      sources: ['us-marshals'],
      fetchImpl: htmlResponse('<html></html>'),
      robots: { isAllowed: () => true },
      dependencies: { extractWithScrapling: extractStub([]) }
    });
    const items = listCachedSources();
    assert.ok(items.find((it) => it.sourceId === 'us-marshals'));
  } finally {
    if (originalEnv === undefined) delete process.env.ONBOARDING_CACHE_ROOT;
    else process.env.ONBOARDING_CACHE_ROOT = originalEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listCachedSources returns empty array when the cache root does not exist', () => {
  const originalEnv = process.env.ONBOARDING_CACHE_ROOT;
  process.env.ONBOARDING_CACHE_ROOT = path.join(os.tmpdir(), 'onboarding-missing-' + Math.random().toString(36).slice(2));
  try {
    assert.deepEqual(listCachedSources(), []);
  } finally {
    if (originalEnv === undefined) delete process.env.ONBOARDING_CACHE_ROOT;
    else process.env.ONBOARDING_CACHE_ROOT = originalEnv;
  }
});

test('isEligible handles malformed entries safely', () => {
  assert.equal(isEligible(null), false);
  assert.equal(isEligible(undefined), false);
  assert.equal(isEligible({}), false);
  assert.equal(isEligible({ id: 'x' }), false);
});

test('isEligible recognizes RETIRED status as ineligible', () => {
  assert.equal(isEligible({
    id: 'old',
    status: 'RETIRED',
    access: 'public',
    discoveryUrl: 'https://example.test/'
  }), false);
});

test('production SOURCE_CATALOG has at least 5 DISCOVERY_ONLY + SCOPE_LIMITED public sources eligible for the spider', () => {
  const eligible = SOURCE_CATALOG.filter(isEligible);
  assert.ok(eligible.length >= 5);
  // Spot-check that all five known Tier A federal / county entries are
  // eligible, so the spider actually has work to do when wired in.
  const eligibleSet = new Set(eligible.map((e) => e.id));
  for (const id of ['fannie-homepath', 'freddie-homesteps', 'va-vrm', 'us-marshals', 'fdic-asset-sales']) {
    assert.ok(eligibleSet.has(id), `expected ${id} to be eligible`);
  }
});