'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crawlOnboardingSource, inspectCrawlUrl, scopeFor, isValidContentHash } = require('../server/crawlers/onboarding-spider');

function cache() { return fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-spider-')); }
function response(status, body, headers = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: (key) => normalized.get(String(key).toLowerCase()) || null }, body: null, text: async () => body };
}
const robotsAllowed = { isAllowed: () => true };
const quiet = { sleep: async () => {}, random: () => 0 };

test('discovers exact listing and PDF candidates with provenance and deduplicates links', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const start = 'https://realestatesales.gov/our-listing';
  const next = 'https://realestatesales.gov/our-listing?page=2';
  const listing = 'https://realestatesales.gov/asset-details?property_id=1234';
  const document = 'https://realestatesales.gov/notices/1234.pdf';
  const parsed = new Map([
    [start, { engineVersion: '0.4.15', contentSha256: 'a'.repeat(64), links: [{ href: listing, text: 'Property' }, { href: listing, text: 'Duplicate' }, { href: document, text: 'Notice', document: true }, { href: next, text: 'Next' }] }],
    [next, { engineVersion: '0.4.15', contentSha256: 'b'.repeat(64), links: [] }],
  ]);
  const result = await crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 3 }, {
    cacheRoot, robots: robotsAllowed, fetchImpl: async (url, options) => { assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); return response(200, '<html>ok</html>'); },
    extractWithScrapling: async (profile, input) => { assert.equal(profile, 'page-links'); return parsed.get(input.url); }, ...quiet,
  });
  assert.equal(result.complete, true);
  assert.equal(result.visited.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.type), ['listing', 'document']);
  assert.equal(result.candidates[0].pageContentSha256, 'a'.repeat(64));
  assert.equal(result.candidates[0].parserEngineVersion, '0.4.15');
  assert.equal(result.candidates[0].discoveredFrom, start);
});

test('page budget checkpoints pending work and resumes under the same scope', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const start = 'https://realestatesales.gov/our-listing';
  const next = 'https://realestatesales.gov/more';
  const extractWithScrapling = async (_profile, input) => ({ engineVersion: 'test', contentSha256: input.url === start ? '1'.repeat(64) : '2'.repeat(64), links: input.url === start ? [{ href: next, text: 'More' }] : [] });
  const dependencies = { cacheRoot, robots: robotsAllowed, fetchImpl: async () => response(200, '<html>ok</html>'), extractWithScrapling, ...quiet };
  const paused = await crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 1, maxDepth: 2 }, dependencies);
  assert.equal(paused.complete, false);
  assert.equal(paused.nextAction, 'resume_with_more_pages');
  assert.deepEqual(paused.pending, [{ url: next, depth: 1 }]);
  const resumed = await crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 3, maxDepth: 2 }, dependencies);
  assert.equal(resumed.complete, true);
  assert.equal(resumed.visited.length, 2);
  assert.equal(paused.scopeHash, resumed.scopeHash);
  assert.equal(scopeFor('gsa', start, 2), resumed.scopeHash);
});

test('challenge response halts without parser fallback and leaves the failed page pending', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  let parsed = false;
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed, fetchImpl: async () => response(200, '<title>Just a moment...</title><div class="cf-challenge">Checking your browser</div>'),
    extractWithScrapling: async () => { parsed = true; }, ...quiet,
  });
  assert.equal(result.complete, false);
  assert.equal(result.pending.length, 1);
  assert.match(result.halted.code, /BOT_CHALLENGE/);
  assert.equal(parsed, false);
});

test('robots disallow prevents page fetch and records the decision', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  let fetched = false;
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: { isAllowed: () => false }, fetchImpl: async () => { fetched = true; }, extractWithScrapling: async () => { throw new Error('must not parse'); }, ...quiet,
  });
  assert.equal(fetched, false);
  assert.equal(result.complete, false);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.visited[0].status, 'robots_disallowed');
});

test('robots challenge page opens the source circuit and halts before crawling', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  let calls = 0;
  await assert.rejects(
    crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
      cacheRoot,
      fetchImpl: async (_url, options) => {
        calls += 1;
        assert.equal(options.headers['user-agent'], 'property-crawl-onboarding');
        return response(200, '<title>Just a moment...</title><div class="cf-challenge">Checking your browser</div>');
      },
      extractWithScrapling: async () => { throw new Error('must not parse'); },
      ...quiet,
    }),
    /challenge/i,
  );
  assert.equal(calls, 1);
});

test('tampered checkpoint cross-origin URL is rejected before fetch', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const start = 'https://realestatesales.gov/our-listing';
  const dependencies = {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async () => response(200, '<html>ok</html>'),
    extractWithScrapling: async () => ({ engineVersion: 'test', contentSha256: 'a'.repeat(64), links: [{ href: '/next', text: 'Next' }] }),
    ...quiet,
  };
  const paused = await crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 1 }, dependencies);
  const checkpoint = JSON.parse(fs.readFileSync(paused.statePath, 'utf8'));
  checkpoint.pending = [{ url: 'https://attacker.example/private', depth: 1 }];
  fs.writeFileSync(paused.statePath, JSON.stringify(checkpoint));
  let fetched = false;
  const resumed = await crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 3 }, {
    ...dependencies,
    fetchImpl: async () => { fetched = true; return response(200, '<html>bad</html>'); },
  });
  assert.equal(fetched, false);
  assert.equal(resumed.complete, false);
  assert.equal(resumed.halted.code, 'CHECKPOINT_URL_REJECTED');
  assert.equal(resumed.nextAction, 'resume_after_halt');
});

test('redirects halt and remain pending', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed, fetchImpl: async () => response(302, ''), extractWithScrapling: async () => { throw new Error('must not parse'); }, ...quiet,
  });
  assert.equal(result.complete, false);
  assert.equal(result.halted.code, 'UPSTREAM_REDIRECT_REJECTED');
  assert.equal(result.pending.length, 1);
});

test('transport retry is bounded to one retry and a failed page remains pending', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  let calls = 0;
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed, fetchImpl: async () => { calls += 1; const error = new Error('reset'); error.code = 'ECONNRESET'; throw error; },
    circuitBreaker: new (require('../server/scrapers/circuit-breaker').ScraperCircuitBreaker)({ failureThreshold: 3 }), extractWithScrapling: async () => { throw new Error('must not parse'); }, ...quiet,
  });
  assert.equal(calls, 2);
  assert.equal(result.complete, false);
  assert.equal(result.pending.length, 1);
});

test('rejects unsafe URLs, source mismatches, arbitrary subdomains and secret queries', () => {
  for (const [url, error] of [
    ['http://realestatesales.gov/our-listing', 'unsafe_url'],
    ['https://127.0.0.1/our-listing', 'unsafe_url'],
    ['https://realestatesales.gov.attacker.example/our-listing', 'source_host_mismatch'],
    ['https://tenant.realestatesales.gov/our-listing', 'source_host_mismatch'],
    ['https://realestatesales.gov/our-listing?api_key=secret', 'secret_query_parameter'],
  ]) assert.equal(inspectCrawlUrl('gsa', url).error, error, url);
  assert.equal(inspectCrawlUrl('irs', 'https://realestatesales.gov/our-listing').error, 'source_host_mismatch');
});

test('rejects IPv4-mapped IPv6 private addresses', () => {
  // Node normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1 (hex form)
  assert.equal(inspectCrawlUrl('gsa', 'https://[::ffff:127.0.0.1]/our-listing').error, 'unsafe_url');
  assert.equal(inspectCrawlUrl('gsa', 'https://[::ffff:7f00:1]/our-listing').error, 'unsafe_url');
  assert.equal(inspectCrawlUrl('gsa', 'https://[::ffff:10.0.0.1]/x').error, 'unsafe_url');
  assert.equal(inspectCrawlUrl('gsa', 'https://[::ffff:a00:1]/x').error, 'unsafe_url');
});

test('rejects non-HTML content-type', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async () => response(200, '{"data":true}', { 'content-type': 'application/json' }),
    extractWithScrapling: async () => { throw new Error('must not parse'); }, ...quiet,
  });
  assert.equal(result.complete, false);
  assert.match(result.halted.code, /UPSTREAM_NON_HTML/);
});

test('rejects content exceeding 4 MB budget', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async () => response(200, 'x'.repeat(5 * 1024 * 1024), { 'content-length': String(5 * 1024 * 1024) }),
    extractWithScrapling: async () => { throw new Error('must not parse'); }, ...quiet,
  });
  assert.equal(result.complete, false);
  assert.match(result.halted.code, /UPSTREAM_PAYLOAD_TOO_LARGE/);
});

test('halts when parser returns invalid content hash', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async () => response(200, '<html>ok</html>'),
    extractWithScrapling: async () => ({ engineVersion: 'test', contentSha256: 'not-a-hash', links: [] }),
    ...quiet,
  });
  assert.equal(result.complete, false);
  assert.equal(result.halted.code, 'INVALID_CONTENT_HASH');
});

test('halts when parser returns null/missing content hash', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const result = await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async () => response(200, '<html>ok</html>'),
    extractWithScrapling: async () => ({ engineVersion: 'test', contentSha256: null, links: [] }),
    ...quiet,
  });
  assert.equal(result.complete, false);
  assert.equal(result.halted.code, 'INVALID_CONTENT_HASH');
});

test('checkpoint scope mismatch is detected', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const start = 'https://realestatesales.gov/our-listing';
  const dependencies = {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async () => response(200, '<html>ok</html>'),
    extractWithScrapling: async () => ({ engineVersion: 'test', contentSha256: 'a'.repeat(64), links: [] }),
    ...quiet,
  };
  const result = await crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 1 }, dependencies);
  const checkpoint = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
  checkpoint.version = 999;
  fs.writeFileSync(result.statePath, JSON.stringify(checkpoint));
  await assert.rejects(
    crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 3 }, dependencies),
    /scope mismatch/i,
  );
});

test('start URL cannot be a PDF or binary file', async () => {
  await assert.rejects(
    crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/doc.pdf' }, {}),
    /HTML page/,
  );
  await assert.rejects(
    crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/style.css' }, {}),
    /HTML page/,
  );
});

test('maxDepth of 0 means no links are followed beyond the start page', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const start = 'https://realestatesales.gov/our-listing';
  const result = await crawlOnboardingSource({ source: 'gsa', url: start, maxPages: 5, maxDepth: 0 }, {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async () => response(200, '<html>ok</html>'),
    extractWithScrapling: async () => ({ engineVersion: 'test', contentSha256: 'a'.repeat(64), links: [{ href: 'https://realestatesales.gov/next', text: 'Next' }] }),
    ...quiet,
  });
  assert.equal(result.visited.length, 1);
  assert.equal(result.pending.length, 0);
  assert.equal(result.complete, true);
});

test('isValidContentHash validates hex strings of correct length', () => {
  assert.equal(isValidContentHash('a'.repeat(64)), true);
  assert.equal(isValidContentHash('A'.repeat(64)), true);
  assert.equal(isValidContentHash('a'.repeat(63)), false);
  assert.equal(isValidContentHash('a'.repeat(65)), false);
  assert.equal(isValidContentHash('g'.repeat(64)), false);
  assert.equal(isValidContentHash(null), false);
  assert.equal(isValidContentHash(undefined), false);
  assert.equal(isValidContentHash(123), false);
});

test('fetchPage sends Accept header for HTML', async (t) => {
  const cacheRoot = cache(); t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  let acceptHeader = null;
  await crawlOnboardingSource({ source: 'gsa', url: 'https://realestatesales.gov/our-listing' }, {
    cacheRoot, robots: robotsAllowed,
    fetchImpl: async (_url, options) => { acceptHeader = options.headers.accept; return response(200, '<html>ok</html>'); },
    extractWithScrapling: async () => ({ engineVersion: 'test', contentSha256: 'a'.repeat(64), links: [] }),
    ...quiet,
  });
  assert.equal(acceptHeader, 'text/html,application/xhtml+xml');
});
