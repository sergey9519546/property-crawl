const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectImageUrl, inspectPublisherPhoto, extractDetailImages } = require('../server/scrapers/media-policy');
const { standardizeListingRecord } = require('../server/scrapers/normalization');
const { ScraperTelemetry } = require('../server/scrapers/telemetry');
const { TreasuryForfeitureScraper } = require('../server/scrapers/treasury');
const { IrsSeizedScraper } = require('../server/scrapers/irs');
const db = require('../server/db/client');
const { seedProvenance } = require('../server/db/seed-provenance');

test('restarting from a persisted observed record preserves its evidence, while legacy fixtures stay demo', () => {
  const listing = standardizeListingRecord(record({ raw: 'Exact source property record for this address.' }));
  assert.equal(seedProvenance(listing).origin, 'live');
  assert.equal(seedProvenance(listing).observedAt, listing.provenance.observedAt);
  assert.equal(seedProvenance({ ...listing, sourceUrl: 'https://www.resales.usda.gov/' }).observed, false);
  assert.equal(seedProvenance({ ...listing, provenance: undefined }).recordKind, 'demo');
});

function record(overrides = {}) {
  return {
    id: 'USDA-MEDIA-1', source: 'usda', address: '100 Main Street', state: 'OH',
    sourceUrl: 'https://www.resales.usda.gov/resales/public/SFHPropertyDetail?id=12345',
    provenance: { origin: 'live', observed: true, publisher: 'USDA', recordId: '12345' },
    ...overrides,
  };
}

test('publisher image aliases survive normalization with record evidence', () => {
  for (const field of ['photo', 'photoUrl', 'imageUrl']) {
    const listing = standardizeListingRecord(record({ [field]: 'https://www.resales.usda.gov/property/12345.jpg' }));
    assert.equal(listing.photo, 'https://www.resales.usda.gov/property/12345.jpg');
    assert.equal(inspectPublisherPhoto(listing).accepted, true);
    assert.equal(listing.provenance.media.photo.extraction.field, field);
  }
});

test('stock houses, map tiles, placeholders, documents, and private URLs never become publisher photos', () => {
  const invalid = [
    'https://images.unsplash.com/photo-house.jpg',
    'https://www.resales.usda.gov/No_Image.jpg',
    'https://www.resales.usda.gov/12345.pdf',
    'https://www.resales.usda.gov/12345.docx',
    'https://www.resales.usda.gov/logo.png',
    'https://server.arcgisonline.com/MapServer/export?format=jpg',
    'https://127.0.0.1/front.jpg', 'https://localhost/front.jpg',
    'https://user:password@publisher.example/front.jpg',
  ];
  for (const photo of invalid) {
    assert.equal(inspectImageUrl(photo).accepted, false, photo);
    const listing = standardizeListingRecord(record({ photo }));
    assert.equal(listing.photo, null, photo);
    assert.equal(listing.provenance.media.photoStatus.state, 'rejected');
  }
});

test('mismatched record evidence cannot certify an image', () => {
  const listing = standardizeListingRecord(record({ photo: 'https://www.resales.usda.gov/property/12345.jpg' }));
  listing.provenance.media.photo.sourceRecordUrl = listing.sourceUrl.replace('12345', '99999');
  assert.equal(inspectPublisherPhoto(listing).reason, 'image_record_mismatch');
  assert.equal(standardizeListingRecord(listing).photo, null);
});

test('Treasury extracts the address-matched image and ignores site artwork and other houses', async () => {
  const scraper = new TreasuryForfeitureScraper();
  scraper.fetchText = async () => `<title>177 Angel Ridge Lane, Sherman, Texas 75090</title>
    <img src="images/type_land_dwelling.gif" width="500" height="50" alt="Land with Dwelling">
    <img width="271" alt="177 Angel Ridge Lane, Sherman, Texas 75090" src="images/177angelridge02.gif">
    <img src="images/other.jpg" alt="178 Angel Ridge Lane, Sherman, Texas 75090">
    <img src="images/spacerblue.jpg" width="1" height="1">Starting Bid: $435,000`;
  const listing = scraper.standardizeListing(await scraper.fetchDetail('177angelridge.shtml'));
  assert.equal(listing.photo, 'https://www.treasury.gov/auctions/treasury/rp/images/177angelridge02.gif');
  assert.equal(listing.provenance.media.gallery.length, 1);
  assert.equal(inspectPublisherPhoto(listing).accepted, true);
});

test('IRS extracts only the property asset gallery, including lazy-loaded images', async () => {
  const scraper = new IrsSeizedScraper();
  scraper.fetchText = async () => `<img src="/themes/irs-logo.svg">
    <div class="photoswipe-gallery field--name-field-asset-photos">
    <img loading="lazy" src="/system/files/styles/card/private/2026-05/front.jpg?h=123&amp;itok=456" width="700" height="410">
    <img data-src="/system/files/back.jpg" src="/placeholder.jpg" width="700" height="410"></div>
    <div class="field--name-field-asset-description">Asset Description</div><div class="field__item">Single family home</div>
    <address>1164 Naamans Creek Road<br>Marcus Hook, 19342 PA<br>United States</address>
    <img src="/unrelated-property.jpg">`;
  const listing = scraper.standardizeListing(await scraper.fetchDetail('judicial-sale-single-family-home-19-acres'));
  assert.match(listing.photo, /\/front.jpg\?h=123&itok=456$/);
  assert.equal(listing.provenance.media.gallery.length, 2);
  assert.equal(inspectPublisherPhoto(listing).accepted, true);
});

test('GSA gallery selection tolerates attribute order while enforcing a property detail page', () => {
  const html = '<img src="https://media.cloudfront.net/front.jpg" class="hero slide-img" width="700"><img class="unrelated" src="https://media.cloudfront.net/other.jpg">';
  assert.equal(extractDetailImages({ source: 'gsa', html, sourceUrl: 'https://realestatesales.gov/asset-details/?property_id=123' }).length, 1);
  assert.deepEqual(extractDetailImages({ source: 'gsa', html, sourceUrl: 'https://realestatesales.gov/our-listing' }), []);
});

test('a fresh observed absence clears a previous publisher photo in persistence', async () => {
  const listing = standardizeListingRecord(record({ photo: 'https://www.resales.usda.gov/property/12345.jpg' }));
  await db.createListing(listing);
  const refreshed = await db.createListing(standardizeListingRecord(record({ photo: null })));
  assert.equal(refreshed.photo, null);
  assert.equal(refreshed.provenance.media.photo, null);
});

test('media telemetry counts accepted images and reports rejected candidates', () => {
  const telemetry = new ScraperTelemetry();
  const photo = standardizeListingRecord(record({ photo: 'https://www.resales.usda.gov/property/12345.jpg' }));
  const rejected = standardizeListingRecord(record({ photo: 'https://images.unsplash.com/house.jpg' }));
  telemetry.recordRun('media-test', [photo, rejected]);
  const report = telemetry.getHealthReport().details['media-test'];
  assert.equal(report.yieldMetrics.photoYieldPct, '50%');
  assert.equal(report.media.reasons.stock_image, 1);
});
