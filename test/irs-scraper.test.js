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
