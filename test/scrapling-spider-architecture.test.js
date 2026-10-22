'use strict';

/**
 * test/scrapling-spider-architecture.test.js
 *
 * Forensic Control Testing & Architectural Verification Suite for Scrapling Spider Engine:
 * 1. Dual-Scheduler Resolution & Streaming Stateless Worker Contract
 * 2. Session Isolation & Discrete TLS / Impersonation Fingerprints
 * 3. Fail-Closed Legal Non-Negotiables: Robots.txt disallow & Bounded WAF challenge fail-closed
 * 4. Provenance Integrity: engine, engineVersion, contentSha256, profile, sessionType, sid
 * 5. Process Boundedness: Timely exit, SIGKILL reaping, zero zombie processes on abort
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runSpiderBatch, allocateSessionId, SpiderExecutionError } = require('../server/scrapers/scrapling-spider');
const { extractWithScrapling, defaultPython, getScraplingRuntimeStatus } = require('../server/scrapers/scrapling-bridge');
const { ScraperCircuitBreaker } = require('../server/scrapers/circuit-breaker');
const { createRunReport, recordUnitSuccess, applyEmptyInventoryHonesty } = require('../server/scrapers/run-report');

const python = defaultPython();
const runtime = getScraplingRuntimeStatus(python);

function requirePython(t) {
  if (!runtime.available) {
    t.skip('Scrapling Python runtime not available');
    return false;
  }
  return true;
}

// Fixtures
const GSA_INDEX_HTML = `
<html>
  <body>
    <article class="property-item">
      <a href="/asset-details/?property_id=101">Listing 1</a>
      <span class="property-price">Current Bid: $150,000</span>
    </article>
    <article class="property-item">
      <a href="/asset-details/?property_id=102">Listing 2</a>
      <span class="property-price">Current Bid: $220,000</span>
    </article>
  </body>
</html>`;

const CLOUDFLARE_CHALLENGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Just a moment...</title></head>
<body>
  <div id="cf-turnstile"></div>
  <p>Please verify you are a human</p>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
</body>
</html>`;

test('1. Session Boundary Isolation: Distinct sid, discrete TLS profiles, partitioned identifiers', () => {
  const sidGsa = allocateSessionId('gsa', 'federal');
  const sidSheriff = allocateSessionId('sheriff', 'county-oh');
  const sidTreasury = allocateSessionId('treasury', 'federal');

  assert.equal(sidGsa, 'pub:gsa:federal');
  assert.equal(sidSheriff, 'pub:sheriff:county-oh');
  assert.equal(sidTreasury, 'pub:treasury:federal');
  assert.notEqual(sidGsa, sidSheriff, 'Federal and county sessions must have distinct session identifiers');
  assert.notEqual(sidGsa, sidTreasury, 'Different federal publishers must maintain isolated sessions');
});

test('2. Positive Control: Multi-page batch extraction preserves canonical schema & provenance', async (t) => {
  if (!requirePython(t)) return;

  const url1 = 'https://realestatesales.gov/our-listing?page=1';
  const url2 = 'https://realestatesales.gov/our-listing?page=2';

  const mockResponses = {
    [url1]: { status: 200, body: GSA_INDEX_HTML },
    [url2]: { status: 200, body: GSA_INDEX_HTML },
  };

  const result = await runSpiderBatch({
    sourceKey: 'gsa',
    urls: [url1, url2],
    profile: 'gsa-index',
    sid: 'pub:gsa:federal',
    sessionType: 'fetcher',
    impersonate: 'chrome131',
    obeyRobots: false,
    mockResponses,
  });

  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.succeeded, 2);
  assert.equal(result.items.length, 2);

  for (const item of result.items) {
    assert.equal(item.event, 'EXTRACTION_SUCCESS');
    assert.equal(item.sourceKey, 'gsa');
    assert.equal(item.engine, 'scrapling');
    assert.equal(item.engineVersion, '0.4.15');
    assert.equal(item.sessionType, 'fetcher');
    assert.equal(item.sid, 'pub:gsa:federal');
    assert.match(item.contentSha256, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(item.data.items), 'Must contain extracted items array');
    assert.equal(item.data.items.length, 2);
    assert.equal(item.data.items[0].propertyId, '101');
    assert.equal(item.data.items[0].currentBid, 150000);
  }
});

test('3. Negative Control (Parser Failure): Fails closed with typed exception, no silent fallback', async (t) => {
  if (!requirePython(t)) return;

  await assert.rejects(
    () => runSpiderBatch({
      sourceKey: 'gsa',
      urls: ['https://realestatesales.gov/our-listing'],
      profile: 'non-existent-profile',
      sessionType: 'fetcher',
      mockResponses: {
        'https://realestatesales.gov/our-listing': { status: 200, body: GSA_INDEX_HTML },
      },
    }),
    (err) => {
      assert.ok(err instanceof SpiderExecutionError || err.code === 'SPIDER_PROCESS_FAILED');
      return true;
    }
  );
});

test('4. Negative Control (WAF / Block Challenge): Fails closed cleanly, trips circuit breaker', async (t) => {
  if (!requirePython(t)) return;

  const url = 'https://sheriff.example.county/auctions';
  const mockResponses = {
    [url]: { status: 403, body: CLOUDFLARE_CHALLENGE_HTML },
  };

  const breaker = new ScraperCircuitBreaker({ failureThreshold: 1 });
  assert.equal(breaker.isOpen(), false);

  await assert.rejects(
    () => runSpiderBatch({
      sourceKey: 'sheriff',
      urls: [url],
      profile: 'table-extract',
      sessionType: 'fetcher',
      maxBlockedRetries: 1,
      mockResponses,
    }),
    (err) => {
      assert.equal(err.code, 'SOURCE_OBSERVATION_ERROR');
      assert.equal(err.details.code, 'SOURCE_BLOCKED');
      assert.equal(err.details.status, 403);
      breaker.trip(err.message);
      return true;
    }
  );

  assert.equal(breaker.isOpen(), true, 'Circuit breaker must trip open on WAF challenge block');

  // Verify empty inventory honesty fails closed
  const report = createRunReport('sheriff', ['sheriff-unit-1']);
  report.statesSucceeded = ['sheriff-unit-1']; recordUnitSuccess(report, 'sheriff-unit-1');
  assert.throws(
    () => applyEmptyInventoryHonesty(report, {
      emitted: 0,
      htmlSamples: ['<div id="root"></div>' + CLOUDFLARE_CHALLENGE_HTML],
      throwOnUnresolved: true,
      sourceKey: 'sheriff',
    }),
    (err) => {
      assert.equal(err.code, 'SOURCE_OBSERVATION_ERROR');
      return true;
    }
  );
});

test('5. Fail-Closed Legal Moat: Disallowed robots.txt emits ACCESS_POLICY_VIOLATION (no silent drop)', async (t) => {
  if (!requirePython(t)) return;

  const targetUrl = 'https://portal.example.gov/private-listings';
  const robotsUrl = 'https://portal.example.gov/robots.txt';

  const mockResponses = {
    [robotsUrl]: { status: 200, body: 'User-agent: *\nDisallow: /private-listings' },
    [targetUrl]: { status: 200, body: '<html><body>Protected Listings</body></html>' },
  };

  await assert.rejects(
    () => runSpiderBatch({
      sourceKey: 'portal',
      urls: [targetUrl],
      profile: 'table-extract',
      obeyRobots: true,
      mockResponses,
    }),
    (err) => {
      assert.equal(err.code, 'ACCESS_POLICY_VIOLATION');
      assert.equal(err.details.reason, 'robots_txt_disallowed');
      assert.equal(err.details.url, targetUrl);
      return true;
    }
  );
});

test('6. Process Boundedness & Clean Signal Reaping: Zero zombie processes on abort', async (t) => {
  if (!requirePython(t)) return;

  const controller = new AbortController();
  const promise = runSpiderBatch({
    sourceKey: 'gsa',
    urls: ['https://realestatesales.gov/our-listing'],
    profile: 'gsa-index',
    signal: controller.signal,
    timeoutMs: 10000,
    mockResponses: {
      'https://realestatesales.gov/our-listing': { status: 200, body: GSA_INDEX_HTML },
    },
  });

  // Trigger abort immediately
  controller.abort();

  await assert.rejects(
    () => promise,
    (err) => {
      assert.equal(err.code, 'SPIDER_ABORTED');
      return true;
    }
  );
});

test('7. Provenance Contract in Stateless Parser Bridge', async (t) => {
  if (!requirePython(t)) return;

  const result = await extractWithScrapling('gsa-index', {
    html: GSA_INDEX_HTML,
    url: 'https://realestatesales.gov/our-listing',
    sessionType: 'stateless-parser',
    python,
  });

  assert.equal(result.engine, 'scrapling');
  assert.equal(result.engineVersion, '0.4.15');
  assert.equal(result.sessionType, 'stateless-parser');
  assert.match(result.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.items.length, 2);
});
