'use strict';

// Pins the spider ceilings to the onboarding pass clamps.
// A requested depth above 2 and a page budget above 20 must be honored.
// Timeouts above 30s must not be silently cut back to 30s.
// Out-of-range env values clamp to the same floor and ceiling as the spider.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  crawlOnboardingSource,
  resolveCrawlTimeoutMs,
  MAX_PAGE_BUDGET,
  MAX_DEPTH,
  MAX_TIMEOUT_MS
} = require('../../server/crawlers/onboarding-spider');
const {
  defaultMaxPages,
  defaultMaxDepth,
  defaultTimeoutMs
} = require('../../server/discovery/onboarding-pass');

const FAKE_CONTENT_SHA256 = 'c'.repeat(64);
const QUIET = { sleep: async () => {}, random: () => 0 };

function htmlFetch() {
  return async () => ({
    status: 200,
    ok: true,
    headers: { get: (key) => (String(key).toLowerCase() === 'content-type' ? 'text/html' : null) },
    text: async () => '<html></html>'
  });
}

test('spider ceilings match the onboarding pass clamps', () => {
  assert.equal(MAX_PAGE_BUDGET, 50);
  assert.equal(MAX_DEPTH, 5);
  assert.equal(MAX_TIMEOUT_MS, 120_000);
  assert.equal(resolveCrawlTimeoutMs(45_000), 45_000);
  assert.equal(resolveCrawlTimeoutMs(120_000), 120_000);
  assert.equal(resolveCrawlTimeoutMs(120_001), 120_000);
  assert.equal(resolveCrawlTimeoutMs(500), 1_000);
  assert.equal(resolveCrawlTimeoutMs(undefined), 30_000);
  assert.equal(defaultMaxPages({ ONBOARDING_MAX_PAGES: '51' }), MAX_PAGE_BUDGET);
  assert.equal(defaultMaxPages({ ONBOARDING_MAX_PAGES: '0' }), 1);
  assert.equal(defaultMaxDepth({ ONBOARDING_MAX_DEPTH: '6' }), MAX_DEPTH);
  assert.equal(defaultMaxDepth({ ONBOARDING_MAX_DEPTH: '-1' }), 0);
  assert.equal(defaultTimeoutMs({ ONBOARDING_TIMEOUT_MS: '120001' }), MAX_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs({ ONBOARDING_TIMEOUT_MS: '999' }), 1_000);
});

test('maxDepth above the old silent cap of 2 is honored', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-depth-'));
  const start = 'https://realestatesales.gov/our-listing';
  const a = 'https://realestatesales.gov/section-a';
  const b = 'https://realestatesales.gov/section-b';
  const c = 'https://realestatesales.gov/section-c';
  const pages = new Map([
    [start, [{ href: a, text: 'a' }]],
    [a, [{ href: b, text: 'b' }]],
    [b, [{ href: c, text: 'c' }]],
    [c, []]
  ]);
  try {
    const result = await crawlOnboardingSource(
      { source: 'gsa', url: start, maxPages: 10, maxDepth: 4, timeoutMs: 45_000 },
      {
        cacheRoot,
        robots: { isAllowed: () => true },
        fetchImpl: htmlFetch(),
        extractWithScrapling: async (_profile, input) => ({
          contentSha256: FAKE_CONTENT_SHA256,
          links: pages.get(input.url) || []
        }),
        ...QUIET
      }
    );
    assert.equal(result.pagesProcessed, 4);
    assert.ok(result.visited.some((page) => page.url === c && page.depth === 3));
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('page budget above the old silent cap of 20 is honored', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-pages-'));
  const start = 'https://realestatesales.gov/our-listing';
  const links = [];
  for (let i = 1; i <= 20; i += 1) {
    links.push({ href: `https://realestatesales.gov/section-${i}`, text: `section ${i}` });
  }
  try {
    const result = await crawlOnboardingSource(
      { source: 'gsa', url: start, maxPages: 21, maxDepth: 1, timeoutMs: 45_000 },
      {
        cacheRoot,
        robots: { isAllowed: () => true },
        fetchImpl: htmlFetch(),
        extractWithScrapling: async (_profile, input) => ({
          contentSha256: FAKE_CONTENT_SHA256,
          links: input.url === start ? links : []
        }),
        ...QUIET
      }
    );
    assert.equal(result.pagesProcessed, 21);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});
