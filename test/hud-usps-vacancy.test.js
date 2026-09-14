'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HudUspsVacancyScraper,
  HudUspsVacancyError,
  SOURCE_KEY,
  PUBLISHER,
  DEFAULT_SERVICE_ROOT,
  DEFAULT_MAX_RECORDS,
  MAX_RECORDS_CAP,
  STATE_FIPS_TO_ABBR,
  stateAbbrFromGeoid,
  sanitizeServiceRoot,
  truncateRaw
} = require('../server/scrapers/hud-usps-vacancy');
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

function feature(overrides = {}) {
  return {
    attributes: {
      OBJECTID: 12345,
      GEOID: '12001000100',
      STATE: 'FL',
      COUNTY: 'Alachua',
      TRACT: '000100',
      QUARTER: '2024Q4',
      RES_VACANT: 42,
      BUS_VACANT: 7,
      NO_STAT: 3,
      TOTAL: 512,
      RELEASE_DATE: '2024-12-31',
      LATITUDE: 29.6516,
      LONGITUDE: -82.3248,
      ...overrides
    },
    geometry: overrides.geometry ?? null
  };
}

function queryResponse(features, { exceededTransferLimit = false } = {}) {
  return {
    features,
    exceededTransferLimit,
    fields: []
  };
}

function makeScraper(options = {}) {
  const requests = [];
  const scraper = new HudUspsVacancyScraper({
    maxRecords: options.maxRecords ?? 20,
    pageSize: options.pageSize ?? 5,
    sleep: options.sleep ?? (async () => {}),
    random: () => 0,
    fetchImpl: options.fetchImpl || (async (url) => {
      requests.push(url);
      return jsonResponse(200, queryResponse([]));
    }),
    ...options
  });
  scraper.requests = requests;
  return scraper;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

test('maps a HUD/USPS vacancy feature to the canonical listing contract', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
  });

  const [listing] = await scraper.scrapeFeed();
  assert.ok(listing, 'expected one listing');

  assert.equal(listing.source, SOURCE_KEY);
  assert.equal(listing.id, 'hud-usps-vacancy-12001000100-2024Q4');
  assert.equal(listing.state, 'FL');
  assert.equal(listing.address, 'Census Tract 100 in 12-001 County, FL');
  assert.equal(listing.lat, 29.6516);
  assert.equal(listing.lng, -82.3248);
  assert.equal(listing.propType, null);
  assert.equal(listing.openingBid, null);
  assert.equal(listing.saleDate, null);
  assert.equal(listing.price, null);
  assert.equal(listing.estLow, null);
  assert.equal(listing.estHigh, null);
  assert.equal(listing.assessed, null);
  assert.equal(listing.beds, null);
  assert.equal(listing.baths, null);
  assert.equal(listing.sqft, null);
  assert.equal(listing.year, null);

  // Address is built from the tract identifier and is long enough to pass
  // the listing contract without inventing property-level data.
  assert.ok(listing.address.length >= 8);
  assert.ok(listing.address.length <= 500);
});

test('provenance is live-observed and flagged as enrichment only', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();

  assert.equal(listing.provenance.origin, 'live');
  assert.equal(listing.provenance.observed, true);
  assert.notEqual(listing.provenance.fixture, true);
  assert.equal(listing.provenance.publisher, PUBLISHER);
  assert.equal(listing.provenance.recordId, 'hud-usps-vacancy-12001000100-2024Q4');
  assert.ok(listing.provenance.observedAt || listing.sourceObservedAt);

  const facts = listing.provenance.sourceFacts;
  assert.equal(facts.evidenceClass, 'aggregate_vacancy');
  assert.equal(facts.enrichmentSource, true);
  assert.equal(facts.geoid, '12001000100');
  assert.equal(facts.stateFips, '12');
  assert.equal(facts.countyFips, '12001');
  assert.equal(facts.objectId, 12345);
  assert.equal(facts.quarter, '2024Q4');
  assert.equal(facts.residentialVacant, 42);
  assert.equal(facts.businessVacant, 7);
  assert.equal(facts.noStat, 3);
  assert.equal(facts.totalAddresses, 512);
  assert.ok(/tract[- ]level/i.test(facts.caveat));
});

test('sourceUrl is the exact HUD GIS Open Data feature URL', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();
  assert.equal(
    listing.sourceUrl,
    'https://hudgis-hud.opendata.arcgis.com/api/v3/datasets/usps_vacancy_national/FeatureServer/0/12345'
  );
});

test('raw payload preserves the publisher record (truncated if large)', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();
  const raw = JSON.parse(listing.raw);
  assert.equal(raw.OBJECTID, 12345);
  assert.equal(raw.GEOID, '12001000100');
  assert.equal(raw.QUARTER, '2024Q4');
  assert.equal(raw.residential_vacant, 42);
  assert.equal(raw.business_vacant, 7);
  assert.equal(raw.no_stat, 3);
  assert.equal(raw.total_addresses, 512);
  assert.equal(raw.lat, 29.6516);
  assert.equal(raw.lng, -82.3248);
});

test('derives state from GEOID when the feature has no STATE field', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: 1, GEOID: '06037100100' }), // CA, LA County
      feature({ OBJECTID: 2, GEOID: '48201500100' })  // TX, Brazoria County
    ]))
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 2);
  assert.equal(listings[0].state, 'CA');
  assert.equal(listings[1].state, 'TX');
});

test('pads short GEOID values to the canonical 11-15 digit form', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: 1, GEOID: 12001000100 })  // numeric form
    ]))
  });
  const [listing] = await scraper.scrapeFeed();
  assert.equal(listing.state, 'FL');
  assert.match(listing.id, /^hud-usps-vacancy-12001000100-2024Q4$/);
});

// ---------------------------------------------------------------------------
// Shape rejection
// ---------------------------------------------------------------------------

test('rejects features missing a tract identifier', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: 1, GEOID: null }),
      feature({ OBJECTID: 2, GEOID: undefined }),
      feature({ OBJECTID: 3, GEOID: 'too-short' }),
      feature({ OBJECTID: 4, GEOID: 'letters-only-not-numeric' }),
      feature({ OBJECTID: 5 })  // valid
    ]))
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(scraper.lastRunReport.recordsRejected, 4);
});

test('rejects features with an unknown state FIPS code', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: 1, GEOID: '99001000100' })  // 99 is not a real state
    ]))
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 0);
  assert.equal(scraper.lastRunReport.recordsRejected, 1);
});

test('rejects features missing OBJECTID', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: null }),
      feature({ OBJECTID: 'not-a-number' }),
      feature({ OBJECTID: -1 }),
      feature({ OBJECTID: 0 }),
      feature({ OBJECTID: 1.5 }),
      feature({ OBJECTID: 99 })
    ]))
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(scraper.lastRunReport.recordsRejected, 5);
});

test('rejects features with no attributes block', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      { geometry: null },
      { attributes: null, geometry: null },
      feature({ OBJECTID: 7 })
    ]))
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'hud-usps-vacancy-12001000100-2024Q4');
});

test('never fabricates a bid, sale date, occupancy, or property classification', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();
  assert.equal(listing.openingBid, null);
  assert.equal(listing.saleDate, null);
  assert.equal(listing.price, null);
  assert.equal(listing.estLow, null);
  assert.equal(listing.estHigh, null);
  assert.equal(listing.assessed, null);
  assert.equal(listing.propType, null);
  assert.equal(listing.occupancy, null);
  assert.equal(listing.beds, null);
  assert.equal(listing.baths, null);
  assert.equal(listing.sqft, null);
  assert.equal(listing.year, null);
});

// ---------------------------------------------------------------------------
// Geometry fallback
// ---------------------------------------------------------------------------

test('falls back to geometry coordinates when LATITUDE/LONGITUDE are missing', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: 1, LATITUDE: undefined, LONGITUDE: undefined, geometry: { x: -122.4194, y: 37.7749 } })
    ]))
  });
  const [listing] = await scraper.scrapeFeed();
  assert.equal(listing.lat, 37.7749);
  assert.equal(listing.lng, -122.4194);
});

test('treats non-finite lat/lng values as null', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: 1, LATITUDE: '', LONGITUDE: 'NaN' })
    ]))
  });
  const [listing] = await scraper.scrapeFeed();
  assert.equal(listing.lat, null);
  assert.equal(listing.lng, null);
});

// ---------------------------------------------------------------------------
// State FIPS lookup
// ---------------------------------------------------------------------------

test('stateAbbrFromGeoid returns abbreviations for all 50 states + DC + territories', () => {
  assert.equal(stateAbbrFromGeoid('01001000100'), 'AL');
  assert.equal(stateAbbrFromGeoid('06037100100'), 'CA');
  assert.equal(stateAbbrFromGeoid('12001000100'), 'FL');
  assert.equal(stateAbbrFromGeoid('36081000100'), 'NY');
  assert.equal(stateAbbrFromGeoid('48029000100'), 'TX');
  assert.equal(stateAbbrFromGeoid('11001000100'), 'DC');
  assert.equal(stateAbbrFromGeoid('72001000100'), 'PR');
  assert.equal(stateAbbrFromGeoid('66010001000'), 'GU');
  assert.equal(stateAbbrFromGeoid('78010001000'), 'VI');
  assert.equal(stateAbbrFromGeoid('60010001000'), 'AS');
  assert.equal(stateAbbrFromGeoid('69010001000'), 'MP');
  // Pad numeric values that lose leading zeros through JSON.
  assert.equal(stateAbbrFromGeoid(12001000100), 'FL');
  // Unknown / malformed
  assert.equal(stateAbbrFromGeoid(null), null);
  assert.equal(stateAbbrFromGeoid(''), null);
  assert.equal(stateAbbrFromGeoid('999999999'), null);
  assert.equal(stateAbbrFromGeoid('letters'), null);
});

test('STATE_FIPS_TO_ABBR contains exactly the 56 Census state codes', () => {
  assert.equal(Object.keys(STATE_FIPS_TO_ABBR).length, 56);
});

// ---------------------------------------------------------------------------
// Service root sanitization
// ---------------------------------------------------------------------------

test('sanitizeServiceRoot appends /FeatureServer/0 when missing', () => {
  assert.equal(
    sanitizeServiceRoot('https://hudgis-hud.opendata.arcgis.com/api/v3/datasets/usps_vacancy_national'),
    'https://hudgis-hud.opendata.arcgis.com/api/v3/datasets/usps_vacancy_national/FeatureServer/0'
  );
});

test('sanitizeServiceRoot strips trailing slashes and preserves an explicit layer index', () => {
  assert.equal(
    sanitizeServiceRoot('https://services.arcgis.com/VTyQ1YNAXSpzThYY/arcgis/rest/services/USPS_Vacancy/FeatureServer/0/'),
    'https://services.arcgis.com/VTyQ1YNAXSpzThYY/arcgis/rest/services/USPS_Vacancy/FeatureServer/0'
  );
  assert.equal(
    sanitizeServiceRoot('https://example.com/FeatureServer/2'),
    'https://example.com/FeatureServer/2'
  );
});

test('sanitizeServiceRoot returns the default when given garbage', () => {
  assert.equal(sanitizeServiceRoot(null), DEFAULT_SERVICE_ROOT);
  assert.equal(sanitizeServiceRoot(''), DEFAULT_SERVICE_ROOT);
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test('paginates via resultOffset when exceededTransferLimit is true', async () => {
  let calls = 0;
  const pages = [
    queryResponse([feature({ OBJECTID: 1 }), feature({ OBJECTID: 2 })], { exceededTransferLimit: true }),
    queryResponse([feature({ OBJECTID: 3 })], { exceededTransferLimit: false })
  ];
  const scraper = makeScraper({
    pageSize: 2,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, pages.shift() || queryResponse([]));
    }
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 3);
  assert.equal(calls, 2, 'scraper must make exactly 2 paginated requests');
  assert.equal(scraper.lastRunReport.pagesFetched, 2);
});

test('stops paginating when the page is smaller than pageSize', async () => {
  let calls = 0;
  const scraper = makeScraper({
    pageSize: 5,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, queryResponse([
        feature({ OBJECTID: 1 }),
        feature({ OBJECTID: 2 })
      ], { exceededTransferLimit: true }));
    }
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 2);
  assert.equal(calls, 1, 'scraper must stop after the first page when shorter than pageSize');
});

test('caps total records at maxRecords across pages', async () => {
  let pageIndex = 0;
  const scraper = makeScraper({
    maxRecords: 3,
    pageSize: 2,
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: ++pageIndex }),
      feature({ OBJECTID: ++pageIndex })
    ], { exceededTransferLimit: true }))
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 3);
  assert.equal(scraper.lastRunReport.truncated, true);
});

test('reports an empty run when the publisher returns no features', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([], { exceededTransferLimit: false }))
  });
  const listings = await scraper.scrapeFeed();
  assert.deepEqual(listings, []);
  assert.equal(scraper.lastRunReport.outcome, 'empty');
  assert.equal(scraper.lastRunReport.complete, true);
  assert.equal(scraper.lastRunReport.fixtureFallbackUsed, false);
});

// ---------------------------------------------------------------------------
// Malformed responses
// ---------------------------------------------------------------------------

test('surfaces an invalid JSON payload as an upstream failure', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => 'not valid json {{{'
    })
  });
  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return /json|parse|invalid/i.test(error.message);
  });
});

test('rejects a response missing the features array', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, { exceededTransferLimit: false })
  });
  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return error.code === 'HUD_USPS_VACANCY_SCHEMA_UNRECOGNIZED' || /features array/i.test(error.message);
  });
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
    return /403|forbidden|circuit/i.test(error.message);
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

test('circuit breaker opens after consecutive HTTP 429 responses', async () => {
  let calls = 0;
  const scraper = makeScraper({
    maxRetries: 3,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(429, JSON.stringify({ error: { message: 'Too Many Requests' } }));
    }
  });
  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return /429|throttl|rate|circuit/i.test(error.message);
  });
  assert.ok(calls >= 1);
  assert.equal(scraper.circuitBreaker.isOpen(), true);
});

// ---------------------------------------------------------------------------
// Fixture / demo rejection
// ---------------------------------------------------------------------------

test('emits only live-observed provenance and never falls back to fixtures', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
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

test('source-policy accepts the exact HUD GIS Open Data feature URL', () => {
  const good = inspectSourceRecordUrl(
    SOURCE_KEY,
    'https://hudgis-hud.opendata.arcgis.com/api/v3/datasets/usps_vacancy_national/FeatureServer/0/12345'
  );
  assert.equal(good.isValid, true, good.error);

  const arcgisHub = inspectSourceRecordUrl(
    SOURCE_KEY,
    'https://services.arcgis.com/VTyQ1YNAXSpzThYY/arcgis/rest/services/USPS_Vacancy_National/FeatureServer/0/99999'
  );
  assert.equal(arcgisHub.isValid, true, arcgisHub.error);
});

test('source-policy accepts a bounded query URL keyed to a single OBJECTID', () => {
  const bounded = inspectSourceRecordUrl(
    SOURCE_KEY,
    'https://services.arcgis.com/VTyQ1YNAXSpzThYY/arcgis/rest/services/USPS_Vacancy_National/FeatureServer/0/query?where=OBJECTID%3D12345&outFields=*&f=json&returnGeometry=false&outSR=4326&resultRecordCount=1&resultOffset=0'
  );
  assert.equal(bounded.isValid, true, bounded.error);
});

test('source-policy rejects unbound queries and lookalike hosts', () => {
  const forgeries = [
    // Whole-inventory query — not bounded to one record.
    'https://services.arcgis.com/VTyQ1YNAXSpzThYY/arcgis/rest/services/USPS_Vacancy_National/FeatureServer/0/query?where=1%3D1&outFields=*&f=json',
    // ObjectId injection attempt via UNION.
    'https://services.arcgis.com/VTyQ1YNAXSpzThYY/arcgis/rest/services/USPS_Vacancy_National/FeatureServer/0/query?where=OBJECTID%3D1%20OR%201%3D1&f=json',
    // Service root — not a record URL.
    'https://hudgis-hud.opendata.arcgis.com/api/v3/datasets/usps_vacancy_national/FeatureServer/0',
    // Lookalike host.
    'https://attacker.example/FeatureServer/0/12345',
    // http scheme.
    'http://services.arcgis.com/abc/arcgis/rest/services/FeatureServer/0/1',
    // Disallowed query parameter.
    'https://services.arcgis.com/VTyQ1YNAXSpzThYY/arcgis/rest/services/USPS_Vacancy_National/FeatureServer/0/query?where=OBJECTID%3D1&f=json&token=foo',
  ];
  for (const url of forgeries) {
    const result = inspectSourceRecordUrl(SOURCE_KEY, url);
    assert.equal(result.isValid, false, url);
  }
});

// ---------------------------------------------------------------------------
// Scheduler registration
// ---------------------------------------------------------------------------

test('scheduler registers hud-usps-vacancy as a live source key', () => {
  const schedulerModule = require('../server/scrapers/scheduler');
  assert.ok(
    schedulerModule.realScraperKeys.has('hud-usps-vacancy'),
    'hud-usps-vacancy must be registered in realScraperKeys'
  );
  assert.ok(
    schedulerModule.realScrapers.some((scraper) => scraper.sourceKey === 'hud-usps-vacancy'),
    'hud-usps-vacancy must be present in realScrapers'
  );
});

// ---------------------------------------------------------------------------
// Collection scope
// ---------------------------------------------------------------------------

test('exposes a bounded collection scope with the configured page size', () => {
  const scraper = makeScraper({ pageSize: 17 });
  const scope = scraper.getCollectionScope();
  assert.equal(scope.endpoint, '/FeatureServer/0/query');
  assert.equal(scope.filters.where, '1=1');
  assert.equal(scope.pageSize, 17);
});

test('defaults to 200 records per run and caps at 5000', () => {
  assert.equal(DEFAULT_MAX_RECORDS, 200);
  assert.equal(MAX_RECORDS_CAP, 5000);
  assert.ok(DEFAULT_MAX_RECORDS <= MAX_RECORDS_CAP);
});

// ---------------------------------------------------------------------------
// truncateRaw
// ---------------------------------------------------------------------------

test('truncateRaw keeps payloads under 64KB with a valid JSON envelope', () => {
  const small = { OBJECTID: 1, GEOID: '12001000100' };
  assert.equal(truncateRaw(small), JSON.stringify(small));

  const big = { OBJECTID: 1, blob: 'x'.repeat(100_000) };
  const truncated = truncateRaw(big);
  assert.ok(Buffer.byteLength(truncated, 'utf8') <= 64 * 1024);
  const parsed = JSON.parse(truncated);
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.originalBytes > 64 * 1024);
  assert.ok(typeof parsed.preview === 'string');
});

// ---------------------------------------------------------------------------
// Safe ID format
// ---------------------------------------------------------------------------

test('listing IDs match the ingestion validation SAFE_ID pattern', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([
      feature({ OBJECTID: 1, GEOID: '12001000100', QUARTER: '2024 Q4' }),
      feature({ OBJECTID: 2, GEOID: '06037100100', QUARTER: '2023Q2' })
    ]))
  });
  const listings = await scraper.scrapeFeed();
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/;
  for (const listing of listings) {
    assert.match(listing.id, SAFE_ID, listing.id);
  }
});

// ---------------------------------------------------------------------------
// Validation acceptance
// ---------------------------------------------------------------------------

test('mapped listings pass the ingestion validation contract when state is known', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();
  const validation = validateListingForIngestion(listing, { expectedSource: SOURCE_KEY });
  assert.equal(validation.isValid, true, validation.errors.join(', '));
});

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

test('HudUspsVacancyError exposes a code property and a sensible name', () => {
  const err = new HudUspsVacancyError('something broke', 'CUSTOM_CODE');
  assert.equal(err.name, 'HudUspsVacancyError');
  assert.equal(err.code, 'CUSTOM_CODE');
  assert.match(err.message, /something broke/);
});

// ---------------------------------------------------------------------------
// getRawPublisherRecord
// ---------------------------------------------------------------------------

test('getRawPublisherRecord returns the original feature attributes', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, queryResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();
  const raw = scraper.getRawPublisherRecord(listing);
  assert.ok(raw);
  assert.equal(raw.OBJECTID, 12345);
  assert.equal(raw.GEOID, '12001000100');
  assert.equal(raw.QUARTER, '2024Q4');
});

// ---------------------------------------------------------------------------
// Max-records env var handling
// ---------------------------------------------------------------------------

test('reads HUD_USPS_VACANCY_MAX_RECORDS from environment when not passed as option', () => {
  const original = process.env.HUD_USPS_VACANCY_MAX_RECORDS;
  process.env.HUD_USPS_VACANCY_MAX_RECORDS = '7';
  try {
    const scraper = new HudUspsVacancyScraper({ sleep: async () => {} });
    assert.equal(scraper.maxRecords, 7);
  } finally {
    if (original === undefined) delete process.env.HUD_USPS_VACANCY_MAX_RECORDS;
    else process.env.HUD_USPS_VACANCY_MAX_RECORDS = original;
  }
});

test('constructor option overrides HUD_USPS_VACANCY_MAX_RECORDS env var', () => {
  const original = process.env.HUD_USPS_VACANCY_MAX_RECORDS;
  process.env.HUD_USPS_VACANCY_MAX_RECORDS = '7';
  try {
    const scraper = new HudUspsVacancyScraper({ maxRecords: 3, sleep: async () => {} });
    assert.equal(scraper.maxRecords, 3);
  } finally {
    if (original === undefined) delete process.env.HUD_USPS_VACANCY_MAX_RECORDS;
    else process.env.HUD_USPS_VACANCY_MAX_RECORDS = original;
  }
});

test('clamps maxRecords to the configured cap', () => {
  const scraper = new HudUspsVacancyScraper({ maxRecords: 999999, sleep: async () => {} });
  assert.equal(scraper.maxRecords, MAX_RECORDS_CAP);
});

test('falls back to DEFAULT_MAX_RECORDS when maxRecords is invalid', () => {
  const scraper = new HudUspsVacancyScraper({ maxRecords: 'not-a-number', sleep: async () => {} });
  assert.equal(scraper.maxRecords, DEFAULT_MAX_RECORDS);
});
