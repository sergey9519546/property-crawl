'use strict';

// test/discovery/onboarding-pass-helpers.test.js
//
// Pins the env clamps and the operator-visible resolver contract.
// resolveSpiderSourceKey stays private. A resolved key is observed as
// spiderKey plus failed (halted page fetch) or skipped (unsupported_source).
// Numeric env values clamp to the spider floor/ceiling. Non-numeric values
// still fall back to the pass default.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  runOnboardingSource,
  runOnboardingPass,
  defaultMaxPages,
  defaultMaxDepth,
  defaultTimeoutMs,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_TIMEOUT_MS
} = require('../../server/discovery/onboarding-pass');

const { SOURCE_CATALOG } = require('../../server/sources/catalog');

const FAKE_CONTENT_SHA256 = 'a'.repeat(64);
const QUIET = { sleep: async () => {}, random: () => 0 };

test('DEFAULT_MAX_PAGES: pinned at 3', () => {
  assert.equal(DEFAULT_MAX_PAGES, 3);
});

test('DEFAULT_MAX_DEPTH: pinned at 1', () => {
  assert.equal(DEFAULT_MAX_DEPTH, 1);
});

test('DEFAULT_TIMEOUT_MS: pinned at 30 seconds', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
});

function makeEnv(overrides) {
  return { ...process.env, ...overrides };
}

test('defaultMaxPages: honors values in [1,50]', () => {
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '1' })), 1);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '3' })), 3);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '50' })), 50);
});

test('defaultMaxPages: clamps out of range to the spider ceiling and non-integers to default', () => {
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '0' })), 1);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '51' })), 50);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '-1' })), 1);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: 'abc' })), 3);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '' })), 3);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: undefined })), 3);
  // parseInt quirks that are part of the current contract
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '12abc' })), 12);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: '1e2' })), 1);
  assert.equal(defaultMaxPages(makeEnv({ ONBOARDING_MAX_PAGES: ' 7 ' })), 7);
});

test('defaultMaxDepth: honors values in [0,5]', () => {
  assert.equal(defaultMaxDepth(makeEnv({ ONBOARDING_MAX_DEPTH: '0' })), 0);
  assert.equal(defaultMaxDepth(makeEnv({ ONBOARDING_MAX_DEPTH: '1' })), 1);
  assert.equal(defaultMaxDepth(makeEnv({ ONBOARDING_MAX_DEPTH: '5' })), 5);
});

test('defaultMaxDepth: clamps out of range to the spider ceiling', () => {
  assert.equal(defaultMaxDepth(makeEnv({ ONBOARDING_MAX_DEPTH: '6' })), 5);
  assert.equal(defaultMaxDepth(makeEnv({ ONBOARDING_MAX_DEPTH: '-1' })), 0);
  assert.equal(defaultMaxDepth(makeEnv({ ONBOARDING_MAX_DEPTH: 'foo' })), 1);
});

test('defaultTimeoutMs: honors values in [1000,120000]', () => {
  assert.equal(defaultTimeoutMs(makeEnv({ ONBOARDING_TIMEOUT_MS: '1000' })), 1000);
  assert.equal(defaultTimeoutMs(makeEnv({ ONBOARDING_TIMEOUT_MS: '30000' })), 30000);
  assert.equal(defaultTimeoutMs(makeEnv({ ONBOARDING_TIMEOUT_MS: '120000' })), 120000);
});

test('defaultTimeoutMs: clamps out of range to the spider bounds', () => {
  assert.equal(defaultTimeoutMs(makeEnv({ ONBOARDING_TIMEOUT_MS: '999' })), 1000);
  assert.equal(defaultTimeoutMs(makeEnv({ ONBOARDING_TIMEOUT_MS: '0' })), 1000);
  assert.equal(defaultTimeoutMs(makeEnv({ ONBOARDING_TIMEOUT_MS: '120001' })), 120000);
  assert.equal(defaultTimeoutMs(makeEnv({ ONBOARDING_TIMEOUT_MS: 'abc' })), 30000);
});

// Robots are stubbed so the throw happens on the page fetch. The spider
// catches that and returns halted. The pass must report failed, not empty.
const THROWING_FETCH = async () => {
  const e = new Error('test-crawl-failure');
  e.code = 'TEST_CRAWL_FAILURE';
  throw e;
};
const ALLOW_ROBOTS = { isAllowed: () => true };

function findCatalog(id) {
  const entry = SOURCE_CATALOG.find((e) => e.id === id);
  assert.ok(entry, `catalog entry ${id} not found`);
  return entry;
}

function tempCache() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-helpers-'));
}

function htmlResponse() {
  return {
    status: 200,
    ok: true,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/html' : null) },
    text: async () => '<html></html>'
  };
}

const MARSHALS_ENTRY = {
  id: 'us-marshals',
  adapterKey: 'marshals',
  status: 'DISCOVERY_ONLY',
  access: 'public',
  discoveryUrl: 'https://usmarshals.gov/what-we-do/asset-forfeiture'
};

test('runOnboardingSource resolves adapterKey for treasury-forfeiture', async () => {
  const entry = findCatalog('treasury-forfeiture');
  const cacheRoot = tempCache();
  try {
    const record = await runOnboardingSource(entry, {
      persist: false,
      cacheRoot,
      fetchImpl: THROWING_FETCH,
      robots: ALLOW_ROBOTS
    });
    assert.equal(record.outcome, 'failed');
    assert.equal(record.spiderKey, 'treasury');
    assert.equal(record.detail && record.detail.code, 'TEST_CRAWL_FAILURE');
    assert.equal(record.cacheFile, undefined);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource falls back to id when adapterKey is invalid', async () => {
  const entry = {
    id: 'marshals',
    adapterKey: 'not-a-registered-key',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'https://www.usmarshals.gov/what-we-do/asset-forfeiture'
  };
  const cacheRoot = tempCache();
  try {
    const record = await runOnboardingSource(entry, {
      persist: false,
      cacheRoot,
      fetchImpl: THROWING_FETCH,
      robots: ALLOW_ROBOTS
    });
    assert.equal(record.outcome, 'failed');
    assert.equal(record.spiderKey, 'marshals');
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource skips when no spider key resolves (fannie-homepath host mismatch)', async () => {
  const entry = findCatalog('fannie-homepath');
  let fetched = false;
  const record = await runOnboardingSource(entry, {
    persist: false,
    fetchImpl: async () => { fetched = true; throw new Error('should not fetch'); },
    robots: ALLOW_ROBOTS
  });
  assert.equal(record.outcome, 'skipped');
  assert.equal(record.reason, 'unsupported_source');
  assert.equal(record.spiderKey, undefined);
  assert.equal(fetched, false);
});

test('runOnboardingSource skips when adapterKey is null and id is not a spider host (fdic)', async () => {
  const entry = findCatalog('fdic-asset-sales');
  const record = await runOnboardingSource(entry, {
    persist: false,
    fetchImpl: THROWING_FETCH,
    robots: ALLOW_ROBOTS
  });
  assert.equal(record.outcome, 'skipped');
  assert.equal(record.reason, 'unsupported_source');
});

test('runOnboardingSource skips on unsafe URL even if key would otherwise match', async () => {
  const entry = {
    id: 'treasury-test',
    adapterKey: 'treasury',
    status: 'DISCOVERY_ONLY',
    access: 'public',
    discoveryUrl: 'http://www.treasury.gov/auctions/treasury/rp/realprop.shtml'
  };
  const record = await runOnboardingSource(entry, {
    persist: false,
    fetchImpl: THROWING_FETCH,
    robots: ALLOW_ROBOTS
  });
  assert.equal(record.outcome, 'skipped');
  assert.equal(record.reason, 'unsupported_source');
});

test('runOnboardingSource skips when discoveryUrl is missing', async () => {
  const entry = {
    id: 'treasury-test',
    adapterKey: 'treasury',
    status: 'DISCOVERY_ONLY',
    access: 'public'
  };
  const record = await runOnboardingSource(entry, {
    persist: false,
    fetchImpl: THROWING_FETCH,
    robots: ALLOW_ROBOTS
  });
  assert.equal(record.outcome, 'skipped');
  assert.equal(record.reason, 'unsupported_source');
});

test('runOnboardingSource counts type=document candidates', async () => {
  const cacheRoot = tempCache();
  try {
    const record = await runOnboardingSource({
      id: 'us-marshals',
      adapterKey: 'marshals',
      status: 'DISCOVERY_ONLY',
      access: 'public',
      discoveryUrl: 'https://usmarshals.gov/what-we-do/asset-forfeiture'
    }, {
      persist: false,
      cacheRoot,
      fetchImpl: async () => htmlResponse(),
      robots: ALLOW_ROBOTS,
      dependencies: {
        ...QUIET,
        extractWithScrapling: async () => ({
          contentSha256: FAKE_CONTENT_SHA256,
          links: [{
            href: 'https://usmarshals.gov/what-we-do/asset-forfeiture/notice.pdf',
            text: 'Notice',
            document: true
          }]
        })
      }
    });
    assert.equal(record.outcome, 'success');
    assert.equal(record.documentsCount, 1);
    assert.equal(record.candidatesCount, 1);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource reports a robots block instead of empty', async () => {
  const cacheRoot = tempCache();
  let fetched = false;
  try {
    const record = await runOnboardingSource(MARSHALS_ENTRY, {
      cacheRoot,
      fetchImpl: async () => { fetched = true; throw new Error('should not fetch'); },
      robots: { isAllowed: () => false },
      dependencies: QUIET
    });
    assert.equal(record.outcome, 'blocked');
    assert.equal(record.reason, 'robots_disallowed');
    assert.equal(record.detail && record.detail.code, 'ROBOTS_DISALLOWED');
    assert.ok(record.blockedCount >= 1);
    assert.equal(record.candidatesCount, 0);
    assert.equal(record.cacheFile, undefined);
    assert.equal(fetched, false);
    assert.equal(fs.existsSync(path.join(cacheRoot, MARSHALS_ENTRY.id, 'latest.json')), false);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource keeps candidates found before a halt', async () => {
  const cacheRoot = tempCache();
  let fetches = 0;
  try {
    const record = await runOnboardingSource(MARSHALS_ENTRY, {
      cacheRoot,
      maxDepth: 1,
      fetchImpl: async () => {
        fetches += 1;
        if (fetches > 1) {
          const error = new Error('test-crawl-failure');
          error.code = 'TEST_CRAWL_FAILURE';
          throw error;
        }
        return htmlResponse();
      },
      robots: ALLOW_ROBOTS,
      dependencies: {
        ...QUIET,
        extractWithScrapling: async () => ({
          contentSha256: FAKE_CONTENT_SHA256,
          links: [
            {
              href: 'https://usmarshals.gov/what-we-do/asset-forfeiture/real-property/case-1234',
              text: 'Case 1234'
            },
            {
              href: 'https://usmarshals.gov/what-we-do/asset-forfeiture/section',
              text: 'Section'
            }
          ]
        })
      }
    });
    assert.equal(record.outcome, 'failed');
    assert.equal(record.detail && record.detail.code, 'TEST_CRAWL_FAILURE');
    assert.equal(record.candidatesCount, 1);
    const saved = JSON.parse(fs.readFileSync(record.cacheFile, 'utf8'));
    assert.equal(saved.outcome, 'failed');
    assert.equal(saved.candidates.length, 1);
    assert.match(saved.candidates[0].url, /case-1234/);
    assert.equal(saved.halted && saved.halted.code, 'TEST_CRAWL_FAILURE');
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource does not write latest.json when a halt found nothing', async () => {
  const cacheRoot = tempCache();
  try {
    const record = await runOnboardingSource(MARSHALS_ENTRY, {
      cacheRoot,
      fetchImpl: THROWING_FETCH,
      robots: ALLOW_ROBOTS,
      dependencies: QUIET
    });
    assert.equal(record.outcome, 'failed');
    assert.equal(record.candidatesCount, 0);
    assert.equal(record.cacheFile, undefined);
    assert.equal(fs.existsSync(path.join(cacheRoot, MARSHALS_ENTRY.id, 'latest.json')), false);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource keeps a successful crawl that also hit a robots block', async () => {
  const cacheRoot = tempCache();
  try {
    const record = await runOnboardingSource(MARSHALS_ENTRY, {
      cacheRoot,
      maxDepth: 1,
      fetchImpl: async () => htmlResponse(),
      robots: { isAllowed: (url) => !String(url).includes('/section') },
      dependencies: {
        ...QUIET,
        extractWithScrapling: async () => ({
          contentSha256: FAKE_CONTENT_SHA256,
          links: [
            {
              href: 'https://usmarshals.gov/what-we-do/asset-forfeiture/real-property/case-1234',
              text: 'Case 1234'
            },
            {
              href: 'https://usmarshals.gov/what-we-do/asset-forfeiture/section',
              text: 'Section'
            }
          ]
        })
      }
    });
    assert.equal(record.outcome, 'success');
    assert.equal(record.candidatesCount, 1);
    assert.ok(record.blockedCount >= 1);
    const saved = JSON.parse(fs.readFileSync(record.cacheFile, 'utf8'));
    assert.equal(saved.blockedCount, record.blockedCount);
    assert.match(saved.candidates[0].url, /case-1234/);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingPass counts a robots block separately from empty', async () => {
  const cacheRoot = tempCache();
  try {
    const summary = await runOnboardingPass({
      sources: ['us-marshals'],
      cacheRoot,
      persist: false,
      fetchImpl: async () => { throw new Error('should not fetch'); },
      robots: { isAllowed: () => false },
      dependencies: QUIET
    });
    assert.equal(summary.totalTargets, 1);
    assert.equal(summary.records[0].outcome, 'blocked');
    assert.equal(summary.blocked, 1);
    assert.equal(summary.empty, 0);
    assert.equal(
      summary.success + summary.empty + summary.blocked + summary.failed + summary.skipped,
      summary.records.length
    );
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('runOnboardingSource keeps pass robots and cache when dependencies also set them', async () => {
  const cacheRoot = tempCache();
  const otherRoot = tempCache();
  let fetched = false;
  try {
    const record = await runOnboardingSource(MARSHALS_ENTRY, {
      cacheRoot,
      maxDepth: 0,
      fetchImpl: async () => {
        fetched = true;
        return htmlResponse();
      },
      robots: ALLOW_ROBOTS,
      dependencies: {
        ...QUIET,
        cacheRoot: otherRoot,
        robots: { isAllowed: () => false },
        extractWithScrapling: async () => ({
          contentSha256: FAKE_CONTENT_SHA256,
          links: [{
            href: 'https://usmarshals.gov/what-we-do/asset-forfeiture/real-property/case-1234',
            text: 'Case 1234'
          }]
        })
      }
    });
    assert.equal(fetched, true);
    assert.equal(record.outcome, 'success');
    assert.equal(record.candidatesCount, 1);
    assert.ok(String(record.cacheFile).startsWith(cacheRoot));
    assert.equal(fs.readdirSync(otherRoot).length, 0);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.rmSync(otherRoot, { recursive: true, force: true });
  }
});
