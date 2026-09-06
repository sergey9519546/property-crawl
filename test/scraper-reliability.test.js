const assert = require('node:assert/strict');
const test = require('node:test');

const BaseScraper = require('../server/scrapers/base');
const { ScraperCircuitBreaker, ScraperResponseError } = require('../server/scrapers/circuit-breaker');
const {
  DEFAULT_REQUEST_TIMEOUT_MS,
  crawlJitter,
  fetchTextWithPolicy,
  mapWithConcurrency,
  normalizeRequestTimeout,
  randomJitterMs
} = require('../server/scrapers/http');
const schedulerModule = require('../server/scrapers/scheduler');
const { IrsSeizedScraper } = require('../server/scrapers/irs');
const { TreasuryForfeitureScraper } = require('../server/scrapers/treasury');
const { standardizeListingRecord } = require('../server/scrapers/normalization');
const { ScraperTelemetry } = require('../server/scrapers/telemetry');
const { validateListingForIngestion } = require('../server/scrapers/validation');
const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
const buildData = require('../scripts/build-data');

const OBSERVED_AT = '2026-09-04T12:00:00.000Z';

test('Treasury follows every discovered property, not an arbitrary eight-record sample', async () => {
  const scraper = new TreasuryForfeitureScraper({ sleep: async () => {} });
  scraper.fetchText = async () => Array.from({ length: 12 }, (_, index) => `<a href="${1000 + index}main.shtml">Property</a>`).join('');
  const seen = [];
  scraper.fetchDetail = async (slug) => { seen.push(slug); return null; };
  await scraper.scrapeFeed();
  assert.equal(seen.length, 12);
});

test('Treasury and IRS honor configured request budgets instead of four-second overrides', async () => {
  for (const Collector of [TreasuryForfeitureScraper, IrsSeizedScraper]) {
    const scraper = new Collector({ timeoutMs: 15000 });
    scraper.requestText = async (_, options) => options.timeoutMs;
    assert.equal(await scraper.fetchText('https://publisher.example'), 15000);
  }
});

function response(status, body) {
  return {
    status,
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => body
  };
}

function validListing(overrides = {}) {
  return {
    id: 'B4A-123456',
    source: 'bid4assets',
    state: 'OH',
    county: 'Cuyahoga',
    city: 'Cleveland',
    zip: '44113',
    address: '100 Test Ave, Cleveland, OH 44113',
    lat: null,
    lng: null,
    openingBid: 42_000,
    estLow: null,
    estHigh: null,
    sourceUrl: 'https://www.bid4assets.com/auction/123456',
    raw: 'Jdgmt: $4S,OOO; county foreclosure auction notice.',
    sourceObservedAt: OBSERVED_AT,
    provenance: {
      origin: 'live',
      observed: true,
      observedAt: OBSERVED_AT,
      publisher: 'County sheriff',
      recordId: '1'
    },
    ...overrides
  };
}

test('request timeout is centrally capped at 30 seconds', () => {
  assert.equal(normalizeRequestTimeout(undefined), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(normalizeRequestTimeout(60_000), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(normalizeRequestTimeout(4_000), 4_000);
  const scraper = new BaseScraper({ name: 'TimeoutTest', sourceKey: 'test', timeoutMs: 90_000 });
  assert.equal(scraper.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
});

test('crawl jitter stays within 250-750ms and supports deterministic tests', async () => {
  assert.equal(randomJitterMs({ random: () => 0 }), 250);
  assert.equal(randomJitterMs({ random: () => 1 }), 750);
  const observed = [];
  const result = await crawlJitter({ random: () => 0.5, sleep: async (ms) => observed.push(ms) });
  assert.equal(result, observed[0]);
  assert.ok(result >= 250 && result <= 750);
});

test('an in-flight success cannot close a circuit opened by a concurrent 403', async () => {
  const breaker = new ScraperCircuitBreaker({ failureThreshold: 10 });
  let releaseSuccess;
  const successGate = new Promise((resolve) => { releaseSuccess = resolve; });
  const successRequest = fetchTextWithPolicy('https://upstream.example/success', {
    circuitBreaker: breaker,
    fetchImpl: async () => {
      await successGate;
      return response(200, '<html>valid source record payload</html>');
    }
  });
  const successRejected = assert.rejects(
    successRequest,
    (error) => error instanceof ScraperResponseError && error.code === 'SCRAPER_CIRCUIT_OPEN'
  );

  await assert.rejects(
    fetchTextWithPolicy('https://upstream.example/blocked', {
      circuitBreaker: breaker,
      fetchImpl: async () => response(403, '<html>Forbidden response body</html>')
    }),
    (error) => error instanceof ScraperResponseError && error.code === 'UPSTREAM_FORBIDDEN'
  );
  releaseSuccess();
  await successRejected;
  assert.equal(breaker.isOpen(), true);
});

test('shared concurrency helper preserves order and caps work in flight', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 4));
    inFlight--;
    return value * 10;
  });
  assert.equal(maxInFlight, 2);
  assert.deepEqual(results.map((result) => result.value), [10, 20, 30, 40]);
});

for (const scenario of [
  { label: '403', status: 403, body: '<html>Forbidden response body</html>', code: 'UPSTREAM_FORBIDDEN' },
  { label: 'empty payload', status: 200, body: '', code: 'UPSTREAM_EMPTY_PAYLOAD' },
  { label: 'challenge wall', status: 200, body: '<html><title>Just a moment...</title><div class="cf-challenge">Checking your browser</div></html>', code: 'UPSTREAM_BOT_CHALLENGE' }
]) {
  test(`${scenario.label} responses immediately open the circuit`, async () => {
    const breaker = new ScraperCircuitBreaker({ failureThreshold: 10 });
    await assert.rejects(
      fetchTextWithPolicy('https://upstream.example/feed', {
        circuitBreaker: breaker,
        fetchImpl: async () => response(scenario.status, scenario.body)
      }),
      (error) => error instanceof ScraperResponseError && error.code === scenario.code
    );
    assert.equal(breaker.isOpen(), true);
  });
}

test('ingestion validation preserves provenance, normalizes OCR, and accepts explicit unknown enrichment', () => {
  const result = validateListingForIngestion(validListing(), { expectedSource: 'bid4assets' });
  assert.equal(result.isValid, true, result.errors.join(', '));
  assert.equal(result.listing.estLow, null);
  assert.equal(result.listing.lat, null);
  assert.equal(result.listing.provenance.publisher, 'County sheriff');
  assert.equal(result.listing.provenance.recordId, '1');
  assert.equal(result.listing.provenance.observed, true);
  assert.match(result.listing.raw, /Judgment: \$45,000/);
});

test('source URL policy accepts publisher record URLs and rejects lookalike hosts', () => {
  const examples = {
    bid4assets: 'https://www.bid4assets.com/auction/1294288',
    civilview: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    fannie: 'https://www.homepath.fanniemae.com/property-details/6039182',
    freddie: 'https://www.homesteps.com/property/882194',
    gsa: 'https://realestatesales.gov/asset-details/?property_id=12345',
    hud: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=095-551029',
    irs: 'https://www.irsauctions.gov/ad/915-e-stewart-ave',
    landbank: 'https://www.landbanksearch.com/p/f3bf5719-91ab-437f-9d1a-2cbb4621e110',
    marshals: 'https://www.reallook.com/usms-inventory/property-109482',
    treasury: 'https://www.cwsmarketing.com/?p=10921',
    usda: 'https://www.resales.usda.gov/resales/public/SFHPropertyDetail?id=7712',
    va: 'https://vrmproperties.com/property/VA-31-55291',
  };
  for (const [source, sourceUrl] of Object.entries(examples)) {
    assert.equal(inspectSourceRecordUrl(source, sourceUrl).isValid, true, `${source} exact URL should pass`);
  }
  assert.equal(
    inspectSourceRecordUrl('civilview', 'https://salesweb.civilview.com.attacker.example/Sales/SaleDetails?PropertyId=2128964683').error,
    'source_host_mismatch',
  );
});

test('shared normalization never fabricates unknown property or valuation facts', () => {
  const result = standardizeListingRecord({
    id: 'OBSERVED-1',
    source: 'county',
    state: 'NJ',
    address: '10 Observed Ave, Newark, NJ 07102',
    sourceUrl: 'https://county.example/detail/OBSERVED-1',
    raw: 'Jdgmt: $4S,OOO; published county notice.',
    provenance: { publisher: 'County sheriff' }
  }, { sourceKey: 'county' });

  for (const field of ['openingBid', 'estLow', 'estHigh', 'mid', 'ratio', 'equity', 'dealScore', 'lat', 'lng', 'beds', 'baths', 'sqft', 'year', 'saleDate', 'judgment', 'occupancy', 'deposit', 'photo']) {
    assert.equal(result[field], null, `${field} must remain unknown`);
  }
  assert.match(result.raw, /Judgment: \$45,000/);
  assert.equal(result.provenance.publisher, 'County sheriff');
  assert.equal(result.provenance.derivedFields.redemption.model, 'state-statutory-rule-lookup-v1');
});

test('shared normalization derives deal metrics only from a complete observed range', () => {
  const result = standardizeListingRecord(validListing({ estLow: 80_000, estHigh: 100_000 }));
  assert.equal(result.mid, 90_000);
  assert.equal(result.equity, 48_000);
  assert.ok(result.ratio > 0);
  assert.ok(result.dealScore > 0);
  assert.equal(result.provenance.derivedFields.valuationMetrics.model, 'observed-valuation-range-v1');
});

test('shared normalization keeps only HTTPS publisher imagery and records its provenance', () => {
  const observed = standardizeListingRecord(validListing({
    photo: 'https://media.bid4assets.com/property/123456/front.jpg#crop',
  }));
  assert.equal(observed.photo, 'https://media.bid4assets.com/property/123456/front.jpg');
  assert.equal(observed.provenance.media.photo.origin, 'publisher_record');
  assert.equal(observed.provenance.media.photo.verification, 'source_extracted');
  assert.equal(observed.provenance.media.photo.sourceRecordUrl, validListing().sourceUrl);
  assert.equal(observed.provenance.media.photo.observedAt, OBSERVED_AT);

  const insecure = standardizeListingRecord(validListing({ photo: 'http://images.example/front.jpg' }));
  assert.equal(insecure.photo, null);
  assert.equal(insecure.provenance.media.photo, null);
  assert.equal(insecure.provenance.media.photoStatus.reason, 'unsafe_image_url');

  const credentialed = standardizeListingRecord(validListing({ photo: 'https://user:pass@images.example/front.jpg' }));
  assert.equal(credentialed.photo, null);
});

test('ingestion validation rejects source mismatches and challenge payloads', () => {
  const mismatch = validateListingForIngestion(validListing({ source: 'other-source' }), { expectedSource: 'bid4assets' });
  assert.ok(mismatch.errors.includes('source_mismatch'));
  const poisoned = validateListingForIngestion(validListing({ raw: 'Cloudflare cf-challenge: verify you are human' }), { expectedSource: 'test-source' });
  assert.ok(poisoned.errors.includes('challenge_payload'));

  const unrelatedHost = validateListingForIngestion(validListing({
    sourceUrl: 'https://attacker.example/auction/123456'
  }));
  assert.ok(unrelatedHost.errors.includes('source_host_mismatch'));

  const missingEvidenceIdentity = validateListingForIngestion(validListing({
    provenance: { origin: 'live', observed: true, observedAt: OBSERVED_AT }
  }));
  assert.ok(missingEvidenceIdentity.errors.includes('missing_provenance_publisher'));
  assert.ok(missingEvidenceIdentity.errors.includes('missing_provenance_record_id'));
});

test('ingestion accepts an unpublished bid but rejects invalid known bids and fixture provenance', () => {
  const missingBid = validateListingForIngestion(validListing({ openingBid: null }));
  assert.equal(missingBid.isValid, true, missingBid.errors.join(', '));
  const invalidBid = validateListingForIngestion(validListing({ openingBid: -1 }));
  assert.ok(invalidBid.errors.includes('invalid_opening_bid'));

  const scraper = new BaseScraper({ name: 'FixtureMarker', sourceKey: 'bid4assets' });
  const [fixture] = scraper.markFixtureInventory([validListing()], 'unit-test-demo');
  const rejected = validateListingForIngestion(fixture, { expectedSource: 'bid4assets' });
  assert.ok(rejected.errors.includes('fixture_record_not_ingestible'));
  assert.equal(fixture.provenance.origin, 'fixture');
  assert.equal(fixture.provenance.observed, false);
});

test('fixture-only collectors are excluded before scrape execution', async () => {
  let scrapeCalled = false;
  const runs = [];
  const isolatedScheduler = new schedulerModule.IngestionScheduler({
    realScrapers: [{
      name: 'FixtureOnlyCollector',
      sourceKey: 'fixture-only',
      fixtureOnly: true,
      async scrapeFeed() { scrapeCalled = true; return [validListing()]; }
    }],
    database: { async createListing() { throw new Error('must not persist fixtures'); } },
    telemetry: { recordRun(...args) { runs.push(args); } },
    networkEnabled: true
  });

  const result = await isolatedScheduler.runAll();
  assert.equal(result.totalIngested, 0);
  assert.equal(scrapeCalled, false);
  assert.equal(runs[0][3].code, 'FIXTURE_ONLY_SCRAPER');
  assert.equal(schedulerModule.realScrapers?.some?.((scraper) => scraper.fixtureOnly), false);
});

test('historical-only collectors are excluded from live opportunity ingestion', async () => {
  let scrapeCalled = false;
  const runs = [];
  const isolatedScheduler = new schedulerModule.IngestionScheduler({
    realScrapers: [{
      name: 'HistoricalCollector',
      sourceKey: 'historical',
      historicalOnly: true,
      async scrapeFeed() { scrapeCalled = true; return [validListing()]; }
    }],
    database: { async createListing() { throw new Error('must not persist historical rows'); } },
    telemetry: { recordRun(...args) { runs.push(args); } },
    networkEnabled: true
  });

  const result = await isolatedScheduler.runAll();
  assert.equal(result.totalIngested, 0);
  assert.equal(scrapeCalled, false);
  assert.equal(runs[0][3].code, 'HISTORICAL_ONLY_SCRAPER');
  assert.equal(schedulerModule.realScrapers?.some?.((scraper) => scraper.historicalOnly), false);
});

test('build-data live normalization keeps nullable bids and rejects fixtures or generic source pages', () => {
  const liveRecord = validListing({
    id: 'HUD-OBSERVED-1',
    source: 'hud',
    openingBid: null,
    sourceUrl: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=411-123456'
  });
  const fixtureRecord = {
    ...liveRecord,
    id: 'HUD-FIXTURE-1',
    provenance: { origin: 'fixture', observed: false, fixtureName: 'embedded-demo' }
  };
  const genericRecord = {
    ...liveRecord,
    id: 'HUD-GENERIC-1',
    sourceUrl: 'https://www.hudhomestore.gov'
  };

  const normalized = buildData.normalize([fixtureRecord, genericRecord, liveRecord], { live: true });
  assert.deepEqual(normalized.map((record) => record.id), ['HUD-OBSERVED-1']);
  assert.equal(normalized[0].openingBid, null);
});

test('build-data failure fallback retains only timestamped observed records', async () => {
  const observed = validListing({ id: 'HUD-OBSERVED-OLD', source: 'hud' });
  const fixture = {
    ...validListing({ id: 'HUD-DEMO-OLD', source: 'hud' }),
    sourceObservedAt: null,
    provenance: { origin: 'snapshot', observed: false, recordKind: 'demo' }
  };
  const result = await buildData.gather({
    registry: [{ key: 'hud', mod: 'unavailable-hud', real: true }],
    runReal: true,
    existingListings: [fixture, observed],
    loadScraper() { throw new Error('collector module unavailable'); }
  });

  assert.deepEqual(result.all.map((record) => record.id), ['HUD-OBSERVED-OLD']);
  assert.equal(result.counts.hud.mode, 'preserved_observed_load_error');
});

test('build-data excludes fixture and historical collectors before execution', async () => {
  let calls = 0;
  const collectors = {
    fixture: { fixtureOnly: true, scrapeFeed: async () => { calls++; return []; } },
    historical: { historicalOnly: true, scrapeFeed: async () => { calls++; return []; } }
  };
  const result = await buildData.gather({
    registry: [
      { key: 'fixture', mod: 'fixture', real: true },
      { key: 'historical', mod: 'historical', real: true }
    ],
    runReal: true,
    existingListings: [],
    loadScraper(modulePath) { return collectors[modulePath]; }
  });

  assert.equal(calls, 0);
  assert.equal(result.counts.fixture.mode, 'fixture_only_excluded');
  assert.equal(result.counts.historical.mode, 'historical_only_excluded');
});

for (const scenario of [
  {
    label: 'Treasury',
    Collector: TreasuryForfeitureScraper,
    listHtml: ['alpha', 'bravo', 'charlie', 'delta']
      .map((slug) => `<a href="${slug}.shtml">${slug}</a>`)
      .join(''),
    source: 'treasury'
  },
  {
    label: 'IRS',
    Collector: IrsSeizedScraper,
    listHtml: ['alpha', 'bravo', 'charlie', 'delta']
      .map((slug) => `<a href="/ad/${slug}" rel="bookmark"><span class="treas-page-title">Real estate ${slug}</span></a>`)
      .join(''),
    source: 'irs'
  }
]) {
  test(`${scenario.label} detail requests use bounded concurrency and 250-750ms pacing`, async () => {
    const delays = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const collector = new scenario.Collector({
      detailConcurrency: 2,
      random: () => 0.5,
      sleep: async (ms) => delays.push(ms)
    });
    collector.fetchText = async () => scenario.listHtml;
    collector.fetchDetail = async (slug) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 4));
      inFlight--;
      return {
        id: `${scenario.source.toUpperCase()}-${slug}`,
        state: 'OH',
        address: `100 ${slug} Ave, Cleveland, OH 44113`,
        openingBid: 42_000,
        sourceUrl: `https://upstream.example/${slug}`,
        raw: `Observed public auction record for ${slug}.`
      };
    };

    const listings = await collector.scrapeFeed();
    assert.equal(listings.length, 4);
    assert.equal(maxInFlight, 2);
    assert.equal(delays.length, 4);
    assert.ok(delays.every((delay) => delay >= 250 && delay <= 750));
    assert.ok(listings.every((listing) => listing.source === scenario.source));
  });
}

test('Treasury and IRS propagate live collection failure instead of substituting demo inventory', async () => {
  for (const Collector of [TreasuryForfeitureScraper, IrsSeizedScraper]) {
    let fixtureRead = false;
    const collector = new Collector({ random: () => 0, sleep: async () => {} });
    collector.fetchText = async () => { throw new Error('upstream unavailable'); };
    collector.getVerifiedInventory = () => { fixtureRead = true; return [validListing()]; };
    await assert.rejects(collector.scrapeFeed(), /upstream unavailable/);
    assert.equal(fixtureRead, false);
  }
});

test('scheduler persists only provenance-valid listings', async () => {
  const persisted = [];
  const runs = [];
  const scraper = {
    name: 'TestCollector',
    sourceKey: 'bid4assets',
    async scrapeFeed() {
      return [validListing(), validListing({ id: 'BAD-2', source: 'wrong-source' })];
    }
  };
  const scheduler = new schedulerModule.IngestionScheduler({
    realScrapers: [scraper],
    database: { async createListing(item) { persisted.push(item); } },
    telemetry: { recordRun(...args) { runs.push(args); } },
    networkEnabled: true
  });

  const result = await scheduler.runAll();
  assert.equal(result.totalIngested, 1);
  assert.equal(result.totalRejected, 1);
  assert.equal(persisted.length, 1);
  assert.equal(runs.length, 1);
});

test('scheduler is offline by default in tests and interval parsing cannot create a 1ms loop', async () => {
  let called = false;
  const scheduler = new schedulerModule.IngestionScheduler({
    realScrapers: [{ name: 'MustNotRun', sourceKey: 'test', async scrapeFeed() { called = true; return []; } }],
    database: { async createListing() {} },
    telemetry: { recordRun() {} },
    env: { NODE_ENV: 'test' }
  });
  const result = await scheduler.runAll();
  assert.equal(result.skipped, true);
  assert.equal(called, false);
  assert.equal(schedulerModule.parseScrapeIntervalHours('-1'), 6);
  assert.equal(schedulerModule.parseScrapeIntervalHours('0.00001'), 0.25);
  assert.equal(schedulerModule.parseScrapeIntervalHours('Infinity'), 6);
  assert.equal(schedulerModule.parseScrapeIntervalHours('9999'), 168);
});

test('scheduler enforces a configurable bounded source concurrency', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const scrapers = Array.from({ length: 6 }, (_, index) => ({
    name: `Collector${index}`,
    sourceKey: 'bid4assets',
    async scrapeFeed() {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return [validListing({
        id: `CONCURRENT-${index}`,
        source: 'bid4assets',
        sourceUrl: `https://www.bid4assets.com/auction/${200000 + index}`
      })];
    }
  }));
  const scheduler = new schedulerModule.IngestionScheduler({
    realScrapers: scrapers,
    database: { async createListing() {} },
    telemetry: { recordRun() {} },
    networkEnabled: true,
    concurrency: 2
  });
  const result = await scheduler.runAll();
  assert.equal(result.totalIngested, 6);
  assert.equal(maxInFlight, 2);
  assert.equal(schedulerModule.normalizeConcurrency(0), 3);
  assert.equal(schedulerModule.normalizeConcurrency(999), 8);
});

test('telemetry makes zero yield, rejection, and circuit causes observable', () => {
  const telemetry = new ScraperTelemetry();
  telemetry.recordRun('source', [validListing()], 10, null, { rejectedCount: 2 });
  telemetry.recordRun('source', [], 10, null);
  let state = telemetry.getHealthReport().details.source;
  assert.equal(state.zeroYieldRuns, 1);
  assert.equal(state.consecutiveZeroYieldRuns, 1);
  assert.equal(state.rejectedListings, 2);
  assert.equal(state.driftDetected, true);

  const error = new ScraperResponseError('WAF challenge', {
    code: 'UPSTREAM_BOT_CHALLENGE',
    haltScraper: true
  });
  telemetry.recordRun('blocked', [], 5, error, {
    circuitOpen: true,
    circuitReason: 'Cloudflare challenge'
  });
  state = telemetry.getHealthReport().details.blocked;
  assert.equal(state.circuitBreakerTripped, true);
  assert.equal(state.lastErrorCode, 'UPSTREAM_BOT_CHALLENGE');
  assert.equal(state.circuitBreakerReason, 'Cloudflare challenge');
});
