'use strict';

// test/scrapers/hud-documents.test.js
//
// Verifies that the HUD scraper surfaces documents in provenance.sourceFacts
// only for URLs it actually observed during the scrape — never fabricated
// per-listing detail URLs the scraper did not visit.
//
// The document-evidence pipeline (server/intelligence/document-evidence.js)
// reads provenance.sourceFacts.documents and presents each entry as a
// publisher-backed link. Surfacing an unobserved URL there would mislead the
// pipeline into telling the UI "this listing has a detail page at X"
// when X was never verified.

const assert = require('node:assert/strict');
const test = require('node:test');

const { HudHomeScraper } = require('../../server/scrapers/hud');

function scraper({ baseUrl = 'https://www.hudhomestore.gov' } = {}) {
  return new HudHomeScraper({
    baseUrl,
    inventoryUrl: null, // disable ArcGIS path for these tests
    states: ['CA'],
    maxStates: 1,
    maxPagesPerState: 1,
    pageSize: 50,
    random: () => 0.5,
    sleep: () => Promise.resolve(),
  });
}

test('HUD mapJsonItem surfaces only the publisher-provided p.url as detail, never the constructed PropertyDetails URL', () => {
  const s = scraper();
  const observedPageUrl = 'https://www.hudhomestore.gov/Home/DataGrid?state=CA&pageNo=1&pageSize=50';
  const listing = s.mapJsonItem(
    {
      caseNumber: '123-456789',
      address: '500 Test St, Sacramento, CA 95814',
      url: '/Property/PropertyDetails?caseNumber=123-456789',
    },
    'CA',
    { pageUrl: observedPageUrl }
  );
  assert.ok(listing);
  const docs = listing.provenance.sourceFacts.documents;
  assert.equal(docs.length, 2, `expected page + per-listing docs, got ${docs.length}`);
  // The DataGrid page is observed.
  assert.equal(docs[0].kind, 'parcel');
  assert.equal(docs[0].url, observedPageUrl);
  // The publisher's per-listing URL is observed (from the JSON payload), and
  // it is resolved to an absolute URL on the publisher's host.
  assert.equal(docs[1].kind, 'detail');
  assert.equal(docs[1].url, 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=123-456789');
  // Crucially: documents must not invent a per-listing URL when the payload
  // didn't include one — that's the fabrication the rule forbids.
  assert.equal(listing.provenance.sourceFacts.hasDocuments, true);
});

test('HUD mapJsonItem omits the detail document when the payload has no per-listing URL', () => {
  const s = scraper();
  const observedPageUrl = 'https://www.hudhomestore.gov/Home/DataGrid?state=CA&pageNo=1&pageSize=50';
  const listing = s.mapJsonItem(
    {
      caseNumber: '123-456789',
      address: '500 Test St, Sacramento, CA 95814',
    },
    'CA',
    { pageUrl: observedPageUrl }
  );
  assert.ok(listing);
  const docs = listing.provenance.sourceFacts.documents;
  // Only the page-level doc survives; no fabricated per-listing URL.
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'parcel');
  assert.equal(docs[0].url, observedPageUrl);
  // The sourceUrl falls back to the constructed PropertyDetails URL — that
  // is the listing's record URL, NOT surfaced as a document.
  assert.equal(listing.sourceUrl, 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=123-456789');
  assert.equal(listing.provenance.sourceFacts.hasDocuments, true);
});

test('HUD mapJsonItem with no observed page URL still surfaces the publisher-supplied per-listing URL', () => {
  const s = scraper();
  // The page URL is omitted by the caller, but the publisher's JSON
  // payload still includes a per-listing URL. That URL was observed — it's
  // right there in the fetched response body — so surfacing it as a
  // document is honest provenance, not fabrication.
  const listing = s.mapJsonItem(
    {
      caseNumber: '123-456789',
      address: '500 Test St, Sacramento, CA 95814',
      url: 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=123-456789',
    },
    'CA'
  );
  assert.ok(listing);
  const docs = listing.provenance.sourceFacts.documents || [];
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'detail');
  assert.equal(docs[0].url, 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=123-456789');
  assert.equal(listing.provenance.sourceFacts.hasDocuments, true);
});

test('HUD mapJsonItem rejects non-hudhomestore per-listing URLs (a publisher-supplied link must not bypass the host check)', () => {
  const s = scraper();
  // p.url resolves to a foreign host — must be dropped, not surfaced.
  const listing = s.mapJsonItem(
    {
      caseNumber: '123-456789',
      address: '500 Test St, Sacramento, CA 95814',
      url: 'https://attacker.example/Property/PropertyDetails?caseNumber=123-456789',
    },
    'CA',
    { pageUrl: 'https://www.hudhomestore.gov/Home/DataGrid?state=CA&pageNo=1&pageSize=50' }
  );
  assert.ok(listing);
  // The sourceUrl is still the publisher-shaped fallback; the foreign URL
  // is not promoted into sourceUrl or documents.
  assert.equal(listing.sourceUrl, 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=123-456789');
  const docs = listing.provenance.sourceFacts.documents || [];
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'parcel');
  assert.equal(docs[0].url, 'https://www.hudhomestore.gov/Home/DataGrid?state=CA&pageNo=1&pageSize=50');
});

test('HUD mapArcGisFeature surfaces the per-page ArcGIS query as a parcel document', () => {
  const s = new HudHomeScraper({
    baseUrl: 'https://www.hudhomestore.gov',
    inventoryUrl: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1',
    states: ['CA'],
    maxStates: 1,
    maxPagesPerState: 1,
    pageSize: 50,
  });
  const observedPageUrl = 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query?where=CASE_STEP_NUMBER%3D6+AND+STATE_CODE%3D%27CA%27&outFields=*&f=pjson';
  const feature = {
    attributes: {
      OBJECTID: 42,
      CASE_STEP_NUMBER: 6,
      CASE_NUM: '123-456789',
      ADDRESS: '500 Test St',
      CITY: 'Sacramento',
      STATE_CODE: 'CA',
      DISPLAY_ZIP_CODE: '95814',
      MAP_LATITUDE: 38.5816,
      MAP_LONGITUDE: -121.4944,
    },
    geometry: { x: -121.4944, y: 38.5816 }
  };
  const listing = s.mapArcGisFeature(feature, 'CA', { pageUrl: observedPageUrl });
  assert.ok(listing);
  const docs = listing.provenance.sourceFacts.documents;
  // ArcGIS path: only the visited per-page query is surfaced.
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'parcel');
  assert.equal(docs[0].url, observedPageUrl);
  // hasDocuments flag follows the documents list, never lies.
  assert.equal(listing.provenance.sourceFacts.hasDocuments, true);
});

test('HUD mapArcGisFeature with no observed page URL surfaces zero documents (defensive)', () => {
  const s = new HudHomeScraper({
    baseUrl: 'https://www.hudhomestore.gov',
    inventoryUrl: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1',
    states: ['CA'],
    maxStates: 1,
    maxPagesPerState: 1,
    pageSize: 50,
  });
  const feature = {
    attributes: {
      OBJECTID: 42,
      CASE_STEP_NUMBER: 6,
      CASE_NUM: '123-456789',
      ADDRESS: '500 Test St',
      CITY: 'Sacramento',
      STATE_CODE: 'CA',
      DISPLAY_ZIP_CODE: '95814',
      MAP_LATITUDE: 38.5816,
      MAP_LONGITUDE: -121.4944,
    },
    geometry: { x: -121.4944, y: 38.5816 }
  };
  const listing = s.mapArcGisFeature(feature, 'CA');
  assert.ok(listing);
  // No page URL observed: no documents, no fabricated per-listing link.
  assert.equal((listing.provenance.sourceFacts.documents || []).length, 0);
  assert.equal(listing.provenance.sourceFacts.hasDocuments, false);
});

test('HUD parseHtmlCardsNative surfaces the observed Index page URL as a parcel document per listing', () => {
  const s = scraper();
  const observedIndexUrl = 'https://www.hudhomestore.gov/Home/Index?state=CA';
  const html = '<tr class="property-row"><td>Case#: 123-456789</td><td class="prop-address">500 Test St, Sacramento, CA 95814</td><td>$250000</td></tr>';
  const listings = s.parseHtmlCardsNative(html, 'CA', observedIndexUrl);
  assert.equal(listings.length, 1);
  const docs = listings[0].provenance.sourceFacts.documents;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'parcel');
  assert.equal(docs[0].url, observedIndexUrl);
  // The constructed PropertyDetails URL lives in sourceUrl but is NOT promoted
  // into documents — that would be fabrication.
  assert.equal(listings[0].sourceUrl, 'https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=123-456789');
  const surfacedUrls = new Set(docs.map((d) => d.url));
  assert.equal(surfacedUrls.has(listings[0].sourceUrl), false, 'the constructed PropertyDetails URL must not appear in documents');
});

test('HUD parseHtmlCardsNative with no observed URL surfaces zero documents', () => {
  const s = scraper();
  const html = '<tr class="property-row"><td>Case#: 123-456789</td><td class="prop-address">500 Test St</td><td>$250000</td></tr>';
  const listings = s.parseHtmlCardsNative(html, 'CA', null);
  assert.equal(listings.length, 1);
  assert.equal((listings[0].provenance.sourceFacts.documents || []).length, 0);
  assert.equal(listings[0].provenance.sourceFacts.hasDocuments, false);
});

test('HUD mapScraplingCard surfaces the observed source URL as a parcel document', () => {
  const s = scraper();
  const observedUrl = 'https://www.hudhomestore.gov/Home/Index?state=CA';
  const listing = s.mapScraplingCard(
    { caseNumber: '123-456789', address: '500 Test St', currentBid: 250000 },
    'CA',
    observedUrl
  );
  assert.ok(listing);
  const docs = listing.provenance.sourceFacts.documents;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'parcel');
  assert.equal(docs[0].url, observedUrl);
  assert.equal(listing.provenance.sourceFacts.hasDocuments, true);
});

test('HUD mapScraplingCard with no observed URL surfaces zero documents', () => {
  const s = scraper();
  const listing = s.mapScraplingCard(
    { caseNumber: '123-456789', address: '500 Test St', currentBid: 250000 },
    'CA',
    null
  );
  assert.ok(listing);
  assert.equal((listing.provenance.sourceFacts.documents || []).length, 0);
  assert.equal(listing.provenance.sourceFacts.hasDocuments, false);
});