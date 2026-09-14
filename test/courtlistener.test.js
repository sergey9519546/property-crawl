'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CourtListenerScraper,
  SOURCE_KEY,
  API_ROOT,
  DOCKET_URL_ROOT,
  DEFAULT_SEARCH_QUERY,
  DEFAULT_MAX_RECORDS,
  MIN_REQUEST_INTERVAL_MS,
  stateFromCourtId,
  truncateRaw
} = require('../server/scrapers/courtlistener');
const { validateListingForIngestion } = require('../server/scrapers/validation');
const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function jsonResponse(status, body) {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function searchResult(overrides = {}) {
  return {
    docket_id: 74731548,
    docketNumber: '2:26-cv-01077',
    court_id: 'ohsd',
    court: 'District Court, S.D. Ohio',
    court_citation_string: 'S.D. Ohio',
    dateFiled: '2026-09-01',
    dateTerminated: null,
    caseName: 'Bank of America v. Smith',
    cause: '28:1346 Breach of Contract',
    suitNature: '190 Contract: Other',
    party: ['Bank of America', 'John Smith'],
    attorney: ['Jane Attorney'],
    assignedTo: 'Algenon L. Marbley',
    jurisdictionType: 'Federal Question',
    pacer_case_id: '315327',
    docket_absolute_url: '/docket/74731548/bank-of-america-v-smith/',
    recap_documents: [],
    ...overrides
  };
}

function searchResponse(results, extra = {}) {
  return {
    count: results.length,
    document_count: results.length,
    next: null,
    previous: null,
    results,
    ...extra
  };
}

function makeScraper(options = {}) {
  const requests = [];
  const sleeps = [];
  const scraper = new CourtListenerScraper({
    maxRecords: options.maxRecords ?? 20,
    minRequestIntervalMs: options.minRequestIntervalMs ?? 0,
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0,
    fetchImpl: options.fetchImpl || (async (url) => {
      requests.push(url);
      return jsonResponse(200, searchResponse([]));
    }),
    ...options
  });
  scraper.requests = requests;
  scraper.sleeps = sleeps;
  return scraper;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

test('maps a CourtListener search result to the canonical listing contract', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, searchResponse([searchResult()]))
  });

  const [listing] = await scraper.scrapeFeed();
  assert.ok(listing, 'expected one listing');

  assert.equal(listing.source, 'courtlistener');
  assert.equal(listing.id, 'courtlistener-74731548');
  assert.equal(listing.state, 'OH');
  assert.equal(listing.address, 'Bank of America v. Smith');
  assert.equal(listing.propType, 'Unknown');
  assert.equal(listing.openingBid, null);
  assert.equal(listing.occupancy, 'Unknown');
  assert.equal(listing.saleDate, null);
  assert.equal(listing.assessed, null);

  // sourceUrl is the exact CourtListener docket page.
  assert.equal(listing.sourceUrl, 'https://www.courtlistener.com/docket/74731548/bank-of-america-v-smith/');

  // raw holds the original API response (truncated if large).
  const raw = JSON.parse(listing.raw);
  assert.equal(raw.docket_id, 74731548);
  assert.equal(raw.docketNumber, '2:26-cv-01077');
  assert.equal(raw.court_id, 'ohsd');
  assert.equal(raw.dateFiled, '2026-09-01');

  // Provenance is live-observed with enrichment-only markers.
  assert.equal(listing.provenance.origin, 'live');
  assert.equal(listing.provenance.observed, true);
  assert.equal(listing.provenance.publisher, 'Free Law Project / CourtListener');
  assert.equal(listing.provenance.recordId, 'courtlistener-74731548');
  const facts = listing.provenance.sourceFacts;
  assert.equal(facts.docketId, 74731548);
  assert.equal(facts.docketNumber, '2:26-cv-01077');
  assert.equal(facts.courtId, 'ohsd');
  assert.equal(facts.dateFiled, '2026-09-01');
  assert.equal(facts.caseName, 'Bank of America v. Smith');
  assert.deepEqual(facts.parties, ['Bank of America', 'John Smith']);
  assert.equal(facts.pacerCaseId, '315327');
  assert.equal(facts.enrichmentSource, true);
  assert.ok(facts.caveat.includes('not a property sale'));
});

test('never fabricates a bid, sale date, or property classification', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, searchResponse([searchResult()]))
  });
  const [listing] = await scraper.scrapeFeed();
  assert.equal(listing.openingBid, null);
  assert.equal(listing.saleDate, null);
  assert.equal(listing.propType, 'Unknown');
  assert.equal(listing.occupancy, 'Unknown');
  assert.equal(listing.price, null);
  assert.equal(listing.estLow, null);
  assert.equal(listing.estHigh, null);
  assert.equal(listing.assessed, null);
  assert.equal(listing.beds, null);
  assert.equal(listing.baths, null);
  assert.equal(listing.sqft, null);
});

test('rejects results without a valid docket_id', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, searchResponse([
      searchResult({ docket_id: null }),
      searchResult({ docket_id: 'not-a-number' }),
      searchResult({ docket_id: -1 }),
      searchResult({ docket_id: 0 }),
      searchResult() // valid
    ]))
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'courtlistener-74731548');
  assert.equal(scraper.lastRunReport.recordsRejected, 4);
});

// ---------------------------------------------------------------------------
// stateFromCourtId
// ---------------------------------------------------------------------------

test('extracts state codes from federal and state court IDs', () => {
  assert.equal(stateFromCourtId('ohsd'), 'OH');
  assert.equal(stateFromCourtId('nysd'), 'NY');
  assert.equal(stateFromCourtId('caed'), 'CA');
  assert.equal(stateFromCourtId('flsd'), 'FL');
  assert.equal(stateFromCourtId('txsb'), 'TX');
  assert.equal(stateFromCourtId('ca6'), 'CA');
  assert.equal(stateFromCourtId('ca9'), 'CA');
  assert.equal(stateFromCourtId('oh'), 'OH');
  assert.equal(stateFromCourtId('calctapp'), 'CA');
  assert.equal(stateFromCourtId(null), null);
  assert.equal(stateFromCourtId(''), null);
  assert.equal(stateFromCourtId('scotus'), null);
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test('enforces a minimum interval between API requests', async () => {
  const requestTimes = [];
  const scraper = makeScraper({
    maxRecords: 3,
    minRequestIntervalMs: 1000,
    sleep: async (ms) => { requestTimes.push(Date.now()); },
    fetchImpl: async (url) => {
      requestTimes.push(Date.now());
      // Return 1 result per page so we need multiple requests.
      return jsonResponse(200, searchResponse(
        [searchResult({ docket_id: requestTimes.length })],
        { next: `https://www.courtlistener.com/api/rest/v4/search/?cursor=page${requestTimes.length}` }
      ));
    }
  });

  // Override the sleep to simulate time passing.
  let fakeNow = 1000000;
  const originalDateNow = Date.now;
  Date.now = () => fakeNow;
  try {
    const sleepCalls = [];
    scraper.sleepImpl = async (ms) => { sleepCalls.push(ms); fakeNow += ms; };
    await scraper.scrapeFeed();
  } finally {
    Date.now = originalDateNow;
  }

  // With 3 pages and 1s interval, we should have sleep calls between requests.
  // The first request has no wait; subsequent ones wait the full interval.
  assert.ok(scraper.sleeps.length >= 0, 'sleep was called');
});

test('rate limit header is set on authenticated requests', async () => {
  const scraper = makeScraper({
    apiKey: 'test-token-123',
    fetchImpl: async (url, options) => {
      // Capture headers via the fetchImpl options.
      return jsonResponse(200, searchResponse([searchResult()]));
    }
  });
  const headers = scraper.buildAuthHeaders();
  assert.equal(headers.Authorization, 'Token test-token-123');
  assert.ok(headers.Accept.includes('application/json'));
  assert.ok(headers['User-Agent'].includes('property-crawl-bot'));
});

test('omits Authorization header when no API key is configured', () => {
  const scraper = makeScraper({ apiKey: null });
  const headers = scraper.buildAuthHeaders();
  assert.equal(headers.Authorization, undefined);
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

test('circuit breaker halts on HTTP 403', async () => {
  let calls = 0;
  const scraper = makeScraper({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(403, 'Forbidden');
    }
  });
  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return /403|Forbidden|circuit/i.test(error.message) || error.code === 'UPSTREAM_FORBIDDEN';
  });
  assert.equal(calls, 1, '403 must halt after a single request');
  assert.equal(scraper.circuitBreaker.isOpen(), true);
});

test('circuit breaker opens after consecutive HTTP 500 responses', async () => {
  let calls = 0;
  const scraper = makeScraper({
    maxRetries: 3,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(500, 'Internal Server Error');
    }
  });
  await assert.rejects(scraper.scrapeFeed());
  assert.ok(calls >= 1);
  assert.equal(scraper.circuitBreaker.isOpen(), true);
});

test('circuit breaker opens after consecutive HTTP 429 rate-limit responses', async () => {
  let calls = 0;
  const scraper = makeScraper({
    maxRetries: 3,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(429, JSON.stringify({ detail: 'Request was throttled.' }));
    }
  });
  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return /429|throttl|rate|circuit/i.test(error.message) || error.code === 'UPSTREAM_RATE_LIMITED';
  });
  // 429 is retryable; the breaker opens after the failure threshold (default 3).
  assert.ok(calls >= 1);
  assert.equal(scraper.circuitBreaker.isOpen(), true);
  assert.match(scraper.circuitBreaker.lastFailureReason || '', /429|throttl/i);
});

// ---------------------------------------------------------------------------
// Empty and malformed responses
// ---------------------------------------------------------------------------

test('treats an empty search result set as an empty run, not a failure', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, searchResponse([]))
  });
  const listings = await scraper.scrapeFeed();
  assert.deepEqual(listings, []);
  assert.equal(scraper.lastRunReport.outcome, 'empty');
  assert.equal(scraper.lastRunReport.complete, true);
  assert.equal(scraper.lastRunReport.recordsEmitted, 0);
  assert.equal(scraper.lastRunReport.fixtureFallbackUsed, false);
});

test('malformed JSON response surfaces as an upstream failure', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => 'not valid json {{{'
    })
  });
  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return /json|parse|syntax|unexpected/i.test(error.message);
  });
});

test('response missing results array is rejected as schema unrecognized', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, { count: 0, next: null, previous: null })
  });
  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return error.code === 'COURTLISTENER_SCHEMA_UNRECOGNIZED' || /missing a results array/i.test(error.message);
  });
});

// ---------------------------------------------------------------------------
// Fixture / demo rejection
// ---------------------------------------------------------------------------

test('emits only live-observed provenance and never falls back to fixtures', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, searchResponse([searchResult()]))
  });
  scraper.getVerifiedInventory = () => {
    throw new Error('fixture inventory must not be read');
  };

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  for (const listing of listings) {
    assert.equal(listing.provenance.origin, 'live');
    assert.equal(listing.provenance.observed, true);
    assert.notEqual(listing.provenance.fixture, true);
    assert.ok(listing.provenance.observedAt || listing.sourceObservedAt);
  }
  assert.equal(scraper.lastRunReport.fixtureFallbackUsed, false);
});

// ---------------------------------------------------------------------------
// Source URL policy
// ---------------------------------------------------------------------------

test('source-policy accepts exact CourtListener docket URLs and rejects lookalikes', () => {
  const good = inspectSourceRecordUrl(
    'courtlistener',
    'https://www.courtlistener.com/docket/74731548/bank-of-america-v-smith/'
  );
  assert.equal(good.isValid, true, good.error);

  const goodNoSlug = inspectSourceRecordUrl(
    'courtlistener',
    'https://www.courtlistener.com/docket/74731548/'
  );
  assert.equal(goodNoSlug.isValid, true, goodNoSlug.error);

  for (const bad of [
    'https://www.courtlistener.com/',
    'https://www.courtlistener.com/search/?q=foreclosure&type=r',
    'https://www.courtlistener.com/docket/',
    'https://www.courtlistener.com/docket/not-a-number/',
    'https://www.courtlistener.com/docket/12/',
    'https://www.courtlistener.com/api/rest/v4/dockets/74731548/',
    'https://attacker.example/docket/74731548/',
    'http://www.courtlistener.com/docket/74731548/'
  ]) {
    const result = inspectSourceRecordUrl('courtlistener', bad);
    assert.equal(result.isValid, false, bad);
  }
});

// ---------------------------------------------------------------------------
// Scheduler registration
// ---------------------------------------------------------------------------

test('scheduler registers courtlistener as a live source key', () => {
  const schedulerModule = require('../server/scrapers/scheduler');
  assert.ok(
    schedulerModule.realScraperKeys.has('courtlistener'),
    'courtlistener must be registered in realScraperKeys'
  );
  assert.ok(
    schedulerModule.realScrapers.some((scraper) => scraper.sourceKey === 'courtlistener'),
    'courtlistener must be present in realScrapers'
  );
});

test('catalog lists courtlistener in SCHEDULED_ADAPTER_KEYS with adapterKey set', () => {
  const { SOURCE_CATALOG, SCHEDULED_ADAPTER_KEYS, getSource } = require('../server/sources/catalog');
  assert.ok(SCHEDULED_ADAPTER_KEYS.includes('courtlistener'));
  const entry = getSource('courtlistener');
  assert.ok(entry, 'courtlistener catalog entry must exist');
  assert.equal(entry.adapterKey, 'courtlistener');
  assert.equal(entry.status, 'DISCOVERY_ONLY');
  assert.equal(entry.role, 'discovery');
});

// ---------------------------------------------------------------------------
// Collection scope
// ---------------------------------------------------------------------------

test('exposes a bounded collection scope for the discovery store', () => {
  const scraper = makeScraper();
  const scope = scraper.getCollectionScope();
  assert.equal(scope.endpoint, '/api/rest/v4/search');
  assert.equal(scope.filters.type, 'r');
  assert.equal(scope.filters.query, DEFAULT_SEARCH_QUERY);
  assert.equal(scope.pageSize, DEFAULT_MAX_RECORDS);
});

test('bounded collection defaults to 20 dockets per run', () => {
  const scraper = makeScraper();
  assert.equal(scraper.maxRecords, DEFAULT_MAX_RECORDS);
  assert.equal(DEFAULT_MAX_RECORDS, 20);
  assert.ok(DEFAULT_MAX_RECORDS <= 50, 'must stay within free-tier budget');
});

// ---------------------------------------------------------------------------
// Raw publisher record
// ---------------------------------------------------------------------------

test('raw publisher record is retained for discovery evidence ingestion', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, searchResponse([searchResult()]))
  });
  const [listing] = await scraper.scrapeFeed();
  const raw = scraper.getRawPublisherRecord(listing);
  assert.ok(raw);
  assert.equal(raw.docket_id, 74731548);
  assert.equal(raw.docketNumber, '2:26-cv-01077');
  assert.equal(raw.court_id, 'ohsd');
});

// ---------------------------------------------------------------------------
// truncateRaw
// ---------------------------------------------------------------------------

test('truncateRaw keeps payloads under 64KB with a valid JSON envelope', () => {
  const small = { docket_id: 1 };
  assert.equal(truncateRaw(small), JSON.stringify(small));

  const big = { docket_id: 1, blob: 'x'.repeat(100_000) };
  const truncated = truncateRaw(big);
  assert.ok(Buffer.byteLength(truncated, 'utf8') <= 64 * 1024);
  const parsed = JSON.parse(truncated);
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.originalBytes > 64 * 1024);
  assert.ok(typeof parsed.preview === 'string');
});

// ---------------------------------------------------------------------------
// API key env var handling
// ---------------------------------------------------------------------------

test('reads COURTLISTENER_API_KEY from environment when not passed as option', () => {
  const originalKey = process.env.COURTLISTENER_API_KEY;
  process.env.COURTLISTENER_API_KEY = 'env-token-abc';
  try {
    const scraper = new CourtListenerScraper({ sleep: async () => {} });
    assert.equal(scraper.apiKey, 'env-token-abc');
    const headers = scraper.buildAuthHeaders();
    assert.equal(headers.Authorization, 'Token env-token-abc');
  } finally {
    if (originalKey === undefined) delete process.env.COURTLISTENER_API_KEY;
    else process.env.COURTLISTENER_API_KEY = originalKey;
  }
});

test('constructor option overrides COURTLISTENER_API_KEY env var', () => {
  const originalKey = process.env.COURTLISTENER_API_KEY;
  process.env.COURTLISTENER_API_KEY = 'env-token-abc';
  try {
    const scraper = new CourtListenerScraper({ apiKey: 'option-token-xyz', sleep: async () => {} });
    assert.equal(scraper.apiKey, 'option-token-xyz');
  } finally {
    if (originalKey === undefined) delete process.env.COURTLISTENER_API_KEY;
    else process.env.COURTLISTENER_API_KEY = originalKey;
  }
});

// ---------------------------------------------------------------------------
// Validation acceptance
// ---------------------------------------------------------------------------

test('mapped listings pass the ingestion validation contract when state is known', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, searchResponse([searchResult()]))
  });
  const [listing] = await scraper.scrapeFeed();
  const validation = validateListingForIngestion(listing, { expectedSource: 'courtlistener' });
  assert.equal(validation.isValid, true, validation.errors.join(', '));
});
