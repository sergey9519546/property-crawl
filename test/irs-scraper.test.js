'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { IrsSeizedScraper } = require('../server/scrapers/irs');
function detail(address, description = '') { return `<address>${address}</address><div>Asset Description</div><div class="field__item">${description}</div>`; }

test('accepts both observed agricultural land shapes through positive evidence', async () => {
  const scraper = new IrsSeizedScraper();
  scraper.fetchText = async url => url.includes('7863-acres')
    ? detail('PARCEL ID Number R7288700<br>Bass Rd off of Community Rd (second lot on the right).<br>Abbeville, 70510 LA<br>United States', '7.863 acres of agricultural land')
    : detail('Old Springfield Road<br>South Charleston, 45368 OH<br>United States', 'Agricultural land of about 100.420 acres');
  const cases = [
    ['7863-acres-more-or-less-seized-agricultural-land-sale-abbeville-louisiana', '7.863 acres, more or less of Seized Agricultural Land is for Sale'],
    ['agricultural-land-about-100420-acres-south-charleston-oh', 'Agricultural land of about 100.420 acres'],
  ];
  for (const [slug, title] of cases) {
    const listing = await scraper.fetchDetail(slug, title);
    assert.ok(listing);
    assert.equal(listing.propType, 'Land');
    assert.equal(listing.provenance.recordId, slug);
    assert.equal(listing.provenance.sourceFacts.publisherTitle, title);
    assert.equal(listing.provenance.sourceFacts.addressQualification, 'positive_land_evidence');
  }
  assert.equal((await scraper.fetchDetail(cases[0][0], cases[0][1])).provenance.sourceFacts.publisherParcelLabel, 'PARCEL ID Number R7288700');
});

test('rejects generic non-property and malformed locality shapes', async () => {
  const scraper = new IrsSeizedScraper();
  scraper.fetchText = async () => detail('Convention Center<br>Las Vegas, 89101 NV', 'Auction event');
  assert.equal(await scraper.fetchDetail('generic-auction', 'Generic auction'), null);
  scraper.fetchText = async () => detail('Unnamed tract<br>malformed locality', 'Agricultural land of 10 acres');
  assert.equal(await scraper.fetchDetail('malformed-land', 'Agricultural land'), null);
});

test('does not use unrelated page text as land evidence or classify a home on acreage as land', async () => {
  const scraper = new IrsSeizedScraper();
  scraper.fetchText = async url => url.includes('house')
    ? `${detail('12 Farm Road<br>Austin, 78701 TX', 'Single family home on 5 acres')}<footer>Vacant land listings</footer>`
    : `${detail('Convention Center<br>Las Vegas, 89101 NV', 'Auction event')}<footer>Agricultural land of 10 acres</footer>`;
  const house = await scraper.fetchDetail('house-on-acreage', 'Residential house');
  assert.equal(house.propType, 'Single Family');
  assert.equal(house.provenance.sourceFacts.addressQualification, 'numbered_street');
  assert.equal(await scraper.fetchDetail('unknown-card', 'Generic auction'), null);
});

// The live /auction/items page is served as a static S3 snapshot whose markup is
// minified: attributes are unquoted and each card is an <li ... data-asset-type=N>
// wrapper holding the article and the /ad/<slug> anchor.
function liveCard(slug, title, assetTypeId) {
  return `<li class="item-list auction-item" data-auction-lifecycle-card data-auction-datetime=2026-11-10T16:00:00Z data-asset-type=${assetTypeId} data-sale-type=7>`
    + `<article id=node-${slug} class="irs-ad usa-card__container"><div class="usa-card__header">`
    + `<h3 class="usa-card__heading margin-0"><a href=/ad/${slug} rel=bookmark>`
    + `<span class=treas-page-title>${title}</span></a></h3></div></article></li>`;
}

test('declared real-estate scope is enforced from the publisher per-card asset type', async () => {
  const scraper = new IrsSeizedScraper();
  scraper.executeWithRetry = operation => operation();
  scraper.crawlJitter = async () => {};
  const requested = [];
  scraper.fetchText = async url => {
    requested.push(url);
    // Asset types observed live on one snapshot: 8 = Real-Estate, 9 = Vehicles,
    // 11 = Seeking Guaranteed Bids, 516 = Personal Property. Only 8 is in scope.
    // (The 516 card on that snapshot is titled "2012 HRD 32 trailer", so the
    // title gate excludes it first and it is covered by the test below.)
    return liveCard('half-interest-house-acreage', 'Half interest in a house and acreage', '8')
      + liveCard('2002-red-kenworth-w90-heavy-duty-truck', '2002 Red Kenworth W90 heavy duty truck', '9')
      + liveCard('seeking-guaranteed-bidder-lakeville-mn-home', 'Seeking Guaranteed Bidder for Lakeville, MN home', '11');
  };
  scraper.fetchDetail = async slug => ({ id: `IRS-${slug}` });

  await scraper.scrapeFeed();

  // The index is a static snapshot: query parameters provably do not filter it,
  // so the request must stay unparameterized and the scope is enforced per record.
  assert.deepEqual(requested, ['https://www.irsauctions.gov/auction/items']);
  const report = scraper.lastRunReport;
  assert.equal(report.recordsDiscovered, 1);
  assert.equal(report.recordsEmitted, 1);
  assert.equal(report.recordsExcluded, 2);
  assert.deepEqual(report.exclusions.map(e => [e.slug, e.reason, e.publisherAssetTypeId]), [
    ['2002-red-kenworth-w90-heavy-duty-truck', 'publisher_asset_type_not_real_estate', '9'],
    ['seeking-guaranteed-bidder-lakeville-mn-home', 'publisher_asset_type_not_real_estate', '11']
  ]);
  assert.equal(report.scope.filters.assetClass, 'real_estate');
  assert.equal(report.scope.filters.publisherAssetTypeId, '8');
  assert.equal(report.scope.filters.appliedBy, 'client_side_publisher_asset_type');
  assert.deepEqual(report.scopeUnverified, []);
});

test('cards the publisher leaves without an asset type stay in scope but are reported unverified', async () => {
  const scraper = new IrsSeizedScraper();
  scraper.executeWithRetry = operation => operation();
  scraper.crawlJitter = async () => {};
  scraper.fetchText = async () => '<a href="/ad/legacy-card" rel="bookmark"><span class="treas-page-title">Vacant lot sale</span></a>';
  scraper.fetchDetail = async () => ({ id: 'IRS-LEGACY' });

  await scraper.scrapeFeed();

  const report = scraper.lastRunReport;
  assert.equal(report.recordsDiscovered, 1);
  assert.equal(report.recordsExcluded, 0);
  assert.deepEqual(report.scopeUnverified, ['legacy-card']);
});

test('parser rejection makes a sweep incomplete and personal property is explicitly excluded', async () => {
  const scraper = new IrsSeizedScraper();
  scraper.executeWithRetry = operation => operation();
  scraper.crawlJitter = async () => {};
  scraper.fetchText = async () => '<a href="/ad/land" rel="bookmark"><span class="treas-page-title">Agricultural land</span></a><a href="/ad/bad" rel="bookmark"><span class="treas-page-title">Generic auction</span></a><a href="/ad/boat" rel="bookmark"><span class="treas-page-title">Seized boat</span></a>';
  scraper.fetchDetail = async slug => slug === 'land' ? { id: 'land' } : null;
  await scraper.scrapeFeed();
  assert.equal(scraper.lastRunReport.recordsDiscovered, 2);
  assert.equal(scraper.lastRunReport.recordsExcluded, 1);
  assert.equal(scraper.lastRunReport.exclusions[0].reason, 'explicit_personal_property_title');
  assert.equal(scraper.lastRunReport.recordsRejected, 1);
  assert.equal(scraper.lastRunReport.complete, false);
  assert.equal(scraper.lastRunReport.fullSweepComplete, false);
  assert.equal(scraper.lastRunReport.outcome, 'partial_failure');
});
