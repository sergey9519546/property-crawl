const test = require('node:test');
const assert = require('node:assert/strict');
const { HudHomeScraper, HUD_REO_LAYER } = require('../server/scrapers/hud');
const { standardizeListingRecord } = require('../server/scrapers/normalization');

function response(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), headers: new Headers() };
}

test('HUD live adapter queries official eGIS inventory for only publicly listed step 6 records', async () => {
  const requests = [];
  const scraper = new HudHomeScraper({
    states: ['CA'], maxPagesPerState: 2, pageSize: 1, inventoryUrl: HUD_REO_LAYER,
    fetchImpl: async (url) => {
      requests.push(new URL(url));
      if (requests.length === 1) return response({ exceededTransferLimit: true, features: [{ attributes: { OBJECTID: 7, CASE_NUM: '045-641868', CASE_STEP_NUMBER: 6, ADDRESS: '306 PINE ST ', CITY: 'SHAFTER', STATE_CODE: 'CA', DISPLAY_ZIP_CODE: 93263, MAP_LATITUDE: 35.503524, MAP_LONGITUDE: -119.26258 } }] });
      return response({ exceededTransferLimit: false, features: [] });
    },
    sleepImpl: async () => {},
  });

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'HUD-045-641868');
  assert.match(listings[0].sourceUrl, /^https:\/\/egis\.hud\.gov\/.*where=CASE_NUM\+%3D\+%27045-641868%27/);
  assert.equal(listings[0].provenance.caseStepNumber, 6);
  assert.equal(listings[0].auctionProgram, 'HUD REO');
  assert.equal(listings[0].lifecycleStatus, 'publicly_listed');
  assert.equal(listings[0].transactionOutcome, null);
  assert.equal(listings[0].hasDocuments, null);
  assert.deepEqual(
    { lat: listings[0].provenance.coordinates.lat, lng: listings[0].provenance.coordinates.lng, origin: listings[0].provenance.coordinates.origin, verification: listings[0].provenance.coordinates.verification },
    { lat: 35.503524, lng: -119.26258, origin: 'publisher_record', verification: 'source_extracted' }
  );
  assert.equal(listings[0].provenance.coordinates.sourceRecordUrl, listings[0].sourceUrl);
  assert.equal(requests[0].searchParams.get('where'), "CASE_STEP_NUMBER = 6 AND STATE_CODE = 'CA'");
  assert.equal(requests[1].searchParams.get('resultOffset'), '1');
  assert.equal(scraper.lastRunReport.complete, true);
  assert.equal(scraper.lastRunReport.sourceRows, 1);
  assert.equal(scraper.lastRunReport.malformedRows, 0);
  assert.equal(scraper.lastRunReport.scope.endpoint, `${HUD_REO_LAYER}/query`);
});

test('HUD live adapter counts and rejects malformed or null-coordinate features', async () => {
  const scraper = new HudHomeScraper({
    states: ['CA'], inventoryUrl: HUD_REO_LAYER,
    fetchImpl: async () => response({ features: [{ attributes: { OBJECTID: 8, CASE_NUM: 'bad', CASE_STEP_NUMBER: 6, ADDRESS: 'Unknown', STATE_CODE: 'CA', MAP_LATITUDE: null, MAP_LONGITUDE: null } }] }),
    sleepImpl: async () => {},
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 0);
  assert.equal(scraper.lastRunReport.sourceRows, 1);
  assert.equal(scraper.lastRunReport.malformedRows, 1);
});

test('HUD live adapter rejects ArcGIS service errors instead of treating them as empty inventory', async () => {
  const scraper = new HudHomeScraper({
    states: ['CA'], maxPagesPerState: 1, inventoryUrl: HUD_REO_LAYER,
    fetchImpl: async () => response({ error: { code: 400, message: 'Invalid query' } }),
    sleepImpl: async () => {}, retryAttempts: 1,
  });
  await assert.rejects(() => scraper.scrapeFeed(), (error) => {
    assert.equal(error.code, 'HUD_UPSTREAM_UNAVAILABLE');
    assert.equal(error.report.statesFailed, 1);
    return true;
  });
});

test('shared normalization preserves explicit discovery fields and document tri-state', () => {
  const base = { id: 'x', source: 'hud', state: 'CA', address: '1 Main St', sourceUrl: "https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query?where=CASE_NUM%20%3D%20%27045-641868%27&outFields=*&f=pjson", provenance: { publisher: 'HUD eGIS', recordId: '045-641868' } };
  const explicit = standardizeListingRecord({ ...base, auctionProgram: 'HUD REO', lifecycleStatus: 'publicly_listed', transactionOutcome: null, hasDocuments: false });
  assert.equal(explicit.auctionProgram, 'HUD REO');
  assert.equal(explicit.lifecycleStatus, 'publicly_listed');
  assert.equal(explicit.transactionOutcome, null);
  assert.equal(explicit.hasDocuments, false);
  assert.equal(standardizeListingRecord(base).hasDocuments, null);
});
