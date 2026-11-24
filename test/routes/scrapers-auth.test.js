'use strict';

// test/routes/scrapers-auth.test.js
//
// Direct unit coverage for the two pure auth helpers exported by
// server/routes/scrapers.js. They back the `requireWorkspaceIdentity` gate
// that fronts every workspace route, so silent behavior drift here
// (different header casing, different Bearer regex, token comparison that
// short-circuits on length) would silently let unauthorized callers
// through. Pin the contract.

const assert = require('node:assert/strict');
const test = require('node:test');

const scrapersRoute = require('../../server/routes/scrapers');
const { presentedRunToken, tokensMatch } = scrapersRoute;

// --- presentedRunToken ------------------------------------------------

test('presentedRunToken: reads from x-scraper-token header', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': 'abc123' } }), 'abc123');
});

test('presentedRunToken: returns trimmed value (whitespace stripped)', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': '   token   ' } }), 'token');
});

test('presentedRunToken: returns empty string when x-scraper-token is missing', () => {
  assert.equal(presentedRunToken({ headers: {} }), '');
});

test('presentedRunToken: returns empty string when x-scraper-token is whitespace-only', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': '   ' } }), '');
});

test('presentedRunToken: reads Bearer token from authorization header', () => {
  assert.equal(presentedRunToken({ headers: { authorization: 'Bearer secret-token-xyz' } }), 'secret-token-xyz');
});

test('presentedRunToken: Bearer regex is case-insensitive', () => {
  assert.equal(presentedRunToken({ headers: { authorization: 'bearer mixed-case' } }), 'mixed-case');
  assert.equal(presentedRunToken({ headers: { authorization: 'BEARER UPPER' } }), 'UPPER');
});

test('presentedRunToken: ignores non-Bearer authorization headers', () => {
  assert.equal(presentedRunToken({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }), '');
  assert.equal(presentedRunToken({ headers: { authorization: 'token-without-scheme' } }), '');
});

test('presentedRunToken: x-scraper-token takes precedence over authorization', () => {
  assert.equal(
    presentedRunToken({ headers: { 'x-scraper-token': 'primary', authorization: 'Bearer secondary' } }),
    'primary'
  );
});

test('presentedRunToken: handles lowercase header key', () => {
  // Headers may come in as lowercase depending on the server; the helper
  // already case-insensitive-looks up the value via headerValue().
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': 'lowercase-key' } }), 'lowercase-key');
});

test('presentedRunToken: returns the first value when header is an array', () => {
  assert.equal(presentedRunToken({ headers: { 'x-scraper-token': ['first', 'second'] } }), 'first');
});

// --- tokensMatch ------------------------------------------------------

test('tokensMatch: returns false when either side is empty', () => {
  assert.equal(tokensMatch('', 'expected'), false);
  assert.equal(tokensMatch('presented', ''), false);
  assert.equal(tokensMatch('', ''), false);
  assert.equal(tokensMatch(null, 'expected'), false);
  assert.equal(tokensMatch('presented', undefined), false);
});

test('tokensMatch: returns true for identical tokens', () => {
  assert.equal(tokensMatch('abc123', 'abc123'), true);
});

test('tokensMatch: returns false for different tokens of the same length', () => {
  assert.equal(tokensMatch('abc123', 'abc124'), false);
  assert.equal(tokensMatch('a-token', 'b-token'), false);
});

test('tokensMatch: returns false for tokens of different lengths (hash, not raw, compare)', () => {
  // The helper SHA-256s both sides before comparing, so length differences
  // cannot early-return — both hashes are fixed-length and the comparison
  // runs end-to-end. A short token vs a long token must always fail.
  assert.equal(tokensMatch('short', 'a-much-longer-credential'), false);
});

test('tokensMatch: treats numeric-coerced strings consistently with the underlying hash', () => {
  // String coercion protects against numeric token types from headers.
  assert.equal(tokensMatch(12345, '12345'), true);
  assert.equal(tokensMatch(12345, 12345), true);
});

test('POST /api/scrapers/run action=ai-prewarm respects auth, limit, ai_cache, and budget', async () => {
  const crypto = require('node:crypto');
  const { createScrapersHandler } = scrapersRoute;
  const { buildEvidenceSummary } = require('../../server/routes/enrich');

  const listings = [
    { id: 'L-1', address: '1 First St', openingBid: 40000, source: 'sheriff', status: 'scheduled' },
    { id: 'L-2', address: '2 Second St', openingBid: 60000, source: 'sheriff', status: 'scheduled' },
    { id: 'L-3', address: '3 Third St', openingBid: 80000, source: 'sheriff', status: 'scheduled' },
    { id: 'L-4', address: '4 Fourth St', openingBid: 90000, source: 'sheriff', status: 'sold' },
  ];

  // Pre-seed ai_cache for L-1 using the exact free Gateway prompt hash
  const cacheMap = new Map();
  const promptL1 = [
    'Write a concise operator briefing summarizing ONLY the observed facts and explicitly stating all verification-required gaps below.',
    'Zero-Fabrication Rule: Never invent ARV, repair cost, title status, lien clearance, occupancy, or bidding advice not present in the evidence summary.',
    '',
    buildEvidenceSummary(listings[0]),
  ].join('\n');
  const hashL1 = crypto
    .createHash('sha256')
    .update(`nvidia/nemotron-3.5-lightning-free:${promptL1.trim()}`)
    .digest('hex');
  cacheMap.set(hashL1, {
    contentHash: hashL1,
    model: 'nvidia/nemotron-3.5-lightning-free',
    responseText: 'Pre-cached briefing for 1 First St at $40,000.',
  });

  const mockDb = {
    async getListings() {
      return { total: listings.length, listings };
    },
    async getAiCache(hash) {
      return cacheMap.get(hash) || null;
    },
    async setAiCache(record) {
      cacheMap.set(record.contentHash, record);
    },
  };

  let fetchCalls = 0;
  let seenOidc = null;
  const handler = createScrapersHandler({
    env: { SCRAPER_ADMIN_TOKEN: 'prewarm-secret' },
    database: mockDb,
    fetchFn: async (_url, init) => {
      fetchCalls += 1;
      seenOidc = init.headers.Authorization;
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Observed opening bid is $60,000; title and condition remain unverified.' },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 30 },
        }),
      };
    },
  });

  // Unauthenticated request fails closed (401)
  let unauthStatus = null;
  await handler(
    { method: 'POST', url: '/api/scrapers/run', headers: {}, body: { action: 'ai-prewarm', limit: 1 } },
    { status(c) { unauthStatus = c; return this; }, json() {} }
  );
  assert.equal(unauthStatus, 401);

  // Limit=1 warms 1 uncached active listing (L-2), skips cached (L-1), ignores sold (L-4), stops before L-3
  let okStatus = 200;
  let payload = null;
  await handler(
    {
      method: 'POST',
      url: '/api/scrapers/run',
      headers: {
        authorization: 'Bearer prewarm-secret',
        'x-vercel-oidc-token': 'prewarm-oidc-tok',
      },
      body: { action: 'ai-prewarm', limit: 1 },
    },
    { status(c) { okStatus = c; return this; }, json(p) { payload = p; } }
  );
  assert.equal(okStatus, 200);
  assert.equal(seenOidc, 'Bearer prewarm-oidc-tok');
  assert.equal(fetchCalls, 1);
  assert.deepEqual(payload, {
    ok: true,
    action: 'ai-prewarm',
    attempted: 1,
    warmed: 1,
    skippedCached: 1,
    rejectedUngrounded: 0,
    failed: 0,
    totalCostUsd: 0,
    modelsUsed: ['nvidia/nemotron-3.5-lightning-free'],
  });
  assert.equal(cacheMap.size, 2);
});
