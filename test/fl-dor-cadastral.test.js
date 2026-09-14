'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FlDorCadastralScraper,
  DOR_COUNTY_BY_CODE,
  SERVICE_ROOT,
  classifyDorUse,
  acreageFromAttributes,
  countyFromDorCode
} = require('../server/scrapers/fl-dor-cadastral');
const { validateListingForIngestion } = require('../server/scrapers/validation');
const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
const { buildParcelKey, normalizeApn } = require('../server/scrapers/normalization');

function arcgisResponse(features, extra = {}) {
  return {
    objectIdFieldName: 'OBJECTID',
    uniqueIdField: { name: 'OBJECTID', isSystemMaintained: true },
    globalIdFieldName: '',
    geometryType: 'esriGeometryPolygon',
    spatialReference: { wkid: 3086, latestWkid: 3086 },
    fields: [],
    features,
    ...extra
  };
}

function feature(overrides = {}) {
  return {
    attributes: {
      OBJECTID: 100001,
      CO_NO: 48,
      PARCEL_ID: '12-34-56-789-0000-0000',
      PARCELNO: null,
      ASMNT_YR: 2025,
      DOR_UC: '0100',
      PA_UC: '01',
      JV: 250000,
      AV_SD: 25000,
      AV_NSD: 0,
      TV_SD: 25000,
      LND_VAL: 50000,
      LND_SQFOOT: 8712,
      LND_UNTS_C: '1',
      NO_LND_UNT: 0.2,
      NO_RES_UNT: 1,
      TOT_LVG_AR: 1850,
      EFF_YR_BLT: 1998,
      ACT_YR_BLT: 1998,
      OWN_NAME: 'SMITH JOHN A',
      OWN_ADDR1: '100 MAIN ST',
      OWN_ADDR2: null,
      OWN_CITY: 'ORLANDO',
      OWN_STATE: 'FLORIDA',
      OWN_STATE_: 'FL',
      OWN_ZIPCD: 32801,
      PHY_ADDR1: '456 OAK AVENUE',
      PHY_ADDR2: null,
      PHY_CITY: 'ORLANDO',
      PHY_ZIPCD: 32801,
      S_LEGAL: 'LT 1 BLK 2 PLAT',
      ALT_KEY: 'ALT123',
      STATE_PAR_: '12345678901234567',
      ...overrides.attributes
    },
    geometry: overrides.geometry ?? null
  };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function makeScraper(options = {}) {
  const requests = [];
  const scraper = new FlDorCadastralScraper({
    maxRecords: options.maxRecords ?? 100,
    pageSize: options.pageSize ?? 100,
    sleep: async () => {},
    random: () => 0,
    fetchImpl: options.fetchImpl || (async (url) => {
      requests.push(url);
      return jsonResponse(200, arcgisResponse([]));
    }),
    ...options
  });
  scraper.requests = requests;
  return scraper;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

test('maps an ArcGIS feature to the canonical camelCase listing contract', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, arcgisResponse([feature()]))
  });

  const [listing] = await scraper.scrapeFeed();
  assert.ok(listing, 'expected one listing');

  assert.equal(listing.source, 'fl-dor-cadastral');
  assert.equal(listing.state, 'FL');
  assert.equal(listing.county, 'Orange');
  assert.equal(listing.city, 'ORLANDO');
  assert.equal(listing.zip, '32801');
  assert.equal(listing.address, '456 OAK AVENUE, ORLANDO, FL 32801');
  assert.equal(listing.assessed, 250000);
  assert.equal(listing.sqft, 1850);
  assert.equal(listing.year, 1998);
  assert.equal(listing.propType, 'Single Family');

  // sourceUrl is the exact feature URL, not the service root.
  assert.equal(listing.sourceUrl, `${SERVICE_ROOT}/100001`);
  assert.notEqual(listing.sourceUrl, SERVICE_ROOT);

  // raw holds the original ArcGIS feature JSON.
  const raw = JSON.parse(listing.raw);
  assert.equal(raw.attributes.OBJECTID, 100001);
  assert.equal(raw.attributes.OWN_NAME, 'SMITH JOHN A');

  // Provenance is live-observed with the exact query URL and field names.
  assert.equal(listing.provenance.origin, 'live');
  assert.equal(listing.provenance.observed, true);
  assert.equal(listing.provenance.publisher, 'Florida Department of Revenue Property Tax Oversight');
  assert.equal(listing.provenance.recordId, 'FLDOR-100001');
  assert.equal(listing.provenance.countyFips, '12095');
  const facts = listing.provenance.sourceFacts;
  assert.match(facts.queryUrl, /\/FeatureServer\/0\/query\?/);
  assert.match(facts.queryUrl, /resultOffset=0/);
  assert.ok(Array.isArray(facts.arcgisFieldNames));
  assert.ok(facts.arcgisFieldNames.includes('PARCEL_ID'));
  assert.ok(facts.arcgisFieldNames.includes('OWN_NAME'));
  assert.equal(facts.ownerName, 'SMITH JOHN A');
  assert.equal(facts.dorUseCode, '0100');
  assert.equal(facts.assessmentYear, 2025);
  assert.ok(facts.mailingAddress.formatted.includes('100 MAIN ST'));
  assert.ok(Math.abs(facts.acreage - 0.2) < 0.001);

  // Validation accepts the mapped listing.
  const validation = validateListingForIngestion(listing, { expectedSource: 'fl-dor-cadastral' });
  assert.equal(validation.isValid, true, validation.errors.join(', '));
});

test('rejects features without a usable situs address or parcel id', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, arcgisResponse([
      feature({ attributes: { OBJECTID: 2, PHY_ADDR1: null, PHY_CITY: null, PHY_ZIPCD: null } }),
      feature({ attributes: { OBJECTID: 3, PARCEL_ID: null, PARCELNO: null } }),
      feature({ attributes: { OBJECTID: 4, CO_NO: 99 } }),
      feature()
    ]))
  });

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].provenance.sourceFacts.objectId, 100001);
  assert.equal(scraper.lastRunReport.recordsRejected, 3);
});

test('classifies DOR use codes and computes acreage from land square footage', () => {
  assert.equal(classifyDorUse('0100'), 'Single Family');
  assert.equal(classifyDorUse('0000'), 'Land');
  assert.equal(classifyDorUse('0400'), 'Coop');
  assert.equal(classifyDorUse('0300'), 'Condo');
  assert.equal(classifyDorUse('1100'), 'Commercial');
  assert.equal(classifyDorUse('6000'), 'Agricultural');
  assert.equal(classifyDorUse(null), null);

  // 8712 sqft = 0.2 acres
  assert.equal(acreageFromAttributes({ LND_SQFOOT: 8712 }), 0.2);
  // Falls back to NO_LND_UNT when LND_UNTS_C indicates acres.
  assert.equal(acreageFromAttributes({ LND_SQFOOT: null, LND_UNTS_C: '1', NO_LND_UNT: 5 }), 5);
  assert.equal(acreageFromAttributes({}), null);
});

test('maps every Florida DOR county code to a valid 5-digit FIPS', () => {
  assert.equal(Object.keys(DOR_COUNTY_BY_CODE).length, 67);
  for (const [code, info] of Object.entries(DOR_COUNTY_BY_CODE)) {
    assert.match(info.fips, /^12\d{3}$/, `county ${code} FIPS`);
    assert.ok(info.name && info.name.length > 2, `county ${code} name`);
  }
  assert.equal(countyFromDorCode(48).fips, '12095');
  assert.equal(countyFromDorCode(1).name, 'Alachua');
  assert.equal(countyFromDorCode(67).fips, '12133');
  assert.equal(countyFromDorCode(99), null);
});

// ---------------------------------------------------------------------------
// parcelKey
// ---------------------------------------------------------------------------

test('computes parcelKey from county FIPS and normalized APN', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, arcgisResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();
  const expected = buildParcelKey({ apn: '12-34-56-789-0000-0000', countyFips: '12095' });
  assert.equal(listing.parcelKey, expected);
  assert.equal(listing.parcelKey, `12095-${normalizeApn('12-34-56-789-0000-0000')}`);
  assert.match(listing.parcelKey, /^12095-[0-9A-Z]+$/);
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test('paginates via resultOffset until the record budget is met', async () => {
  const page1 = arcgisResponse([
    feature({ attributes: { OBJECTID: 1, PARCEL_ID: 'P-1' } }),
    feature({ attributes: { OBJECTID: 2, PARCEL_ID: 'P-2' } })
  ]);
  const page2 = arcgisResponse([
    feature({ attributes: { OBJECTID: 3, PARCEL_ID: 'P-3' } }),
    feature({ attributes: { OBJECTID: 4, PARCEL_ID: 'P-4' } })
  ]);
  const page3 = arcgisResponse([
    feature({ attributes: { OBJECTID: 5, PARCEL_ID: 'P-5' } })
  ]);

  const offsets = [];
  const scraper = makeScraper({
    maxRecords: 5,
    pageSize: 2,
    fetchImpl: async (url) => {
      const offset = Number(new URL(url).searchParams.get('resultOffset'));
      offsets.push(offset);
      if (offset === 0) return jsonResponse(200, page1);
      if (offset === 2) return jsonResponse(200, page2);
      if (offset === 4) return jsonResponse(200, page3);
      return jsonResponse(200, arcgisResponse([]));
    }
  });

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 5);
  assert.deepEqual(offsets, [0, 2, 4]);
  assert.equal(scraper.lastRunReport.pagesFetched, 3);
  assert.equal(scraper.lastRunReport.truncated, true);
  assert.equal(scraper.lastRunReport.recordsEmitted, 5);
});

test('stops at the configured maxRecords even when more pages exist', async () => {
  const scraper = makeScraper({
    maxRecords: 3,
    pageSize: 2,
    fetchImpl: async (url) => {
      const offset = Number(new URL(url).searchParams.get('resultOffset'));
      const start = offset + 1;
      return jsonResponse(200, arcgisResponse([
        feature({ attributes: { OBJECTID: start, PARCEL_ID: `P-${start}` } }),
        feature({ attributes: { OBJECTID: start + 1, PARCEL_ID: `P-${start + 1}` } })
      ]));
    }
  });

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 3);
  assert.equal(scraper.lastRunReport.truncated, true);
  assert.equal(scraper.lastRunReport.complete, false);
});

test('treats an empty publisher page as an empty run, not a failure', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, arcgisResponse([]))
  });
  const listings = await scraper.scrapeFeed();
  assert.deepEqual(listings, []);
  assert.equal(scraper.lastRunReport.outcome, 'empty');
  assert.equal(scraper.lastRunReport.complete, true);
});

// ---------------------------------------------------------------------------
// Fixture / demo rejection
// ---------------------------------------------------------------------------

test('emits only live-observed provenance and never falls back to fixtures', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, arcgisResponse([feature()]))
  });
  // A fixture snapshot must not be consulted.
  scraper.getVerifiedInventory = () => {
    throw new Error('fixture inventory must not be read');
  };

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  for (const listing of listings) {
    assert.equal(listing.provenance.origin, 'live');
    assert.equal(listing.provenance.observed, true);
    assert.notEqual(listing.provenance.fixture, true);
    assert.ok(listing.provenance.observedAt);
  }
  assert.equal(scraper.lastRunReport.fixtureFallbackUsed, false);

  // The ingestion validator rejects fixture-shaped provenance for this source.
  const fixtureShaped = {
    ...listings[0],
    provenance: { ...listings[0].provenance, origin: 'fixture', observed: false, fixture: true }
  };
  const validation = validateListingForIngestion(fixtureShaped, { expectedSource: 'fl-dor-cadastral' });
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.includes('fixture_record_not_ingestible'));
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

test('circuit breaker halts immediately on HTTP 403', async () => {
  let calls = 0;
  const scraper = makeScraper({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(403, 'Forbidden');
    }
  });

  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return error.code === 'UPSTREAM_FORBIDDEN' || /403|Forbidden|circuit/i.test(error.message);
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
  assert.match(scraper.circuitBreaker.lastFailureReason || '', /500|HTTP/i);
});

test('ArcGIS error payloads are surfaced as upstream failures', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, {
      error: { code: 400, message: 'Invalid or missing input parameters.', details: [] }
    })
  });

  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return error.code === 'FL_DOR_QUERY_REJECTED' || /Invalid or missing input/.test(error.message);
  });
});

// ---------------------------------------------------------------------------
// Source URL policy
// ---------------------------------------------------------------------------

test('source-policy accepts the exact FDOR feature URL and rejects lookalikes', () => {
  const good = inspectSourceRecordUrl(
    'fl-dor-cadastral',
    `${SERVICE_ROOT}/100001`
  );
  assert.equal(good.isValid, true, good.error);
  assert.equal(good.url, `${SERVICE_ROOT}/100001`);

  for (const bad of [
    SERVICE_ROOT,
    `${SERVICE_ROOT}/`,
    `${SERVICE_ROOT}/query?where=1%3D1&f=json`,
    `${SERVICE_ROOT}/query?where=OBJECTID%3D100001+OR+1%3D1&f=json`,
    `${SERVICE_ROOT}/not-a-number`,
    'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Other_Layer/FeatureServer/0/100001',
    'https://attacker.example/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/100001',
    'http://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/100001'
  ]) {
    const result = inspectSourceRecordUrl('fl-dor-cadastral', bad);
    assert.equal(result.isValid, false, bad);
  }

  // A parcel-bound query URL is also accepted for property-lookup workflows.
  const queryUrl = `${SERVICE_ROOT}/query?where=OBJECTID%3D100001&outFields=*&f=json&returnGeometry=false`;
  const queryResult = inspectSourceRecordUrl('fl-dor-cadastral', queryUrl);
  assert.equal(queryResult.isValid, true, queryResult.error);
});

// ---------------------------------------------------------------------------
// Collection scope / registration
// ---------------------------------------------------------------------------

test('exposes a bounded collection scope for the discovery store', () => {
  const scraper = makeScraper();
  const scope = scraper.getCollectionScope();
  assert.equal(scope.endpoint, '/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query');
  assert.deepEqual(scope.filters.states, ['FL']);
  assert.equal(scope.pageSize, 100);
});

test('scheduler registers fl-dor-cadastral as a live source key', () => {
  // Require the scheduler module to inspect its default registry without
  // starting a cycle. The singleton exports the instance plus the class.
  const schedulerModule = require('../server/scrapers/scheduler');
  assert.ok(
    schedulerModule.realScraperKeys.has('fl-dor-cadastral'),
    'fl-dor-cadastral must be registered in realScraperKeys'
  );
  assert.ok(
    schedulerModule.realScrapers.some((scraper) => scraper.sourceKey === 'fl-dor-cadastral'),
    'fl-dor-cadastral must be present in realScrapers'
  );
});

test('raw publisher record is retained for discovery evidence ingestion', async () => {
  const scraper = makeScraper({
    fetchImpl: async () => jsonResponse(200, arcgisResponse([feature()]))
  });
  const [listing] = await scraper.scrapeFeed();
  const raw = scraper.getRawPublisherRecord(listing);
  assert.ok(raw);
  assert.equal(raw.attributes.OBJECTID, 100001);
  assert.equal(raw.attributes.PARCEL_ID, '12-34-56-789-0000-0000');
});
