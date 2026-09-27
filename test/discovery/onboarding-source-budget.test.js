'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOnboardingSource } = require('../../server/discovery/onboarding-pass');

const ENTRY = {
  id: 'hud-homestore',
  adapterKey: 'hud',
  label: 'HUD',
  access: 'public',
  status: 'SCOPE_LIMITED',
  discoveryUrl: 'https://www.hudhomestore.gov/listing'
};

function htmlWithNext() {
  return '<html><body><a href="https://www.hudhomestore.gov/listing/2">next</a></body></html>';
}

function countingFetch(fetches) {
  return async (url) => {
    fetches.push(String(url));
    return { ok: true, status: 200, text: async () => htmlWithNext() };
  };
}

function freshCache() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-budget-'));
}

test('runOnboardingSource honors ONBOARDING_MAX_PAGES when maxPages is omitted', async () => {
  const fetches = [];
  const result = await runOnboardingSource(ENTRY, {
    persist: false,
    cacheRoot: freshCache(),
    env: { ONBOARDING_MAX_PAGES: '1', ONBOARDING_MAX_DEPTH: '2' },
    fetchImpl: countingFetch(fetches),
    robots: { check: async () => ({ allowed: true }) }
  });
  // A next-link alone is not a candidate, so one page is an empty crawl.
  // The proof is that the env ceiling stopped the spider from following it.
  assert.equal(result.outcome, 'empty');
  assert.equal(result.pagesProcessed, 1);
  assert.equal(fetches.length, 1);
});

test('an explicit maxPages wins over ONBOARDING_MAX_PAGES', async () => {
  const fetches = [];
  const result = await runOnboardingSource(ENTRY, {
    persist: false,
    cacheRoot: freshCache(),
    maxPages: 2,
    maxDepth: 1,
    env: { ONBOARDING_MAX_PAGES: '1' },
    fetchImpl: countingFetch(fetches),
    robots: { check: async () => ({ allowed: true }) }
  });
  assert.equal(result.pagesProcessed, 2);
  assert.equal(fetches.length, 2);
});
