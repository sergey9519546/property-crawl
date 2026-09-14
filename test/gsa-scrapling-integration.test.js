const test = require('node:test');
const assert = require('node:assert/strict');
const { GsaSurplusScraper } = require('../server/scrapers/gsa');

const detail = `<input value='125 Test Street' name='tour_property_address'>
<input value='Warwick' name='tour_property_city'>
<input value='Rhode Island' name='tour_property_state'>
<input value='02889' name='tour_property_zipcode'>
<p>Sale Number: FIXTURE123. Vacant land.</p>`;

test('Scrapling integration tolerates reordered attributes while retaining canonical truth', async () => {
  const scraper = new GsaSurplusScraper({useScrapling:true});
  scraper.fetchText = async () => detail;
  const record = await scraper.fetchDetail('27', 100000);
  assert.equal(record.address, '125 Test Street, Warwick, RI 02889');
  assert.equal(record.id, 'GSA-FIXTURE123');
  assert.equal(record.openingBid, null);
  assert.equal(record.provenance.sourceFacts.currentBid, 100000);
  assert.equal(record.provenance.extraction.engine, 'scrapling');
  assert.equal(record.provenance.extraction.engineVersion, '0.4.15');
  assert.match(record.provenance.extraction.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.provenance.extraction.adaptiveIdentityMatching, false);
});

test('enabled parser failure cannot silently use a native parser or fixture inventory', async () => {
  const scraper = new GsaSurplusScraper({useScrapling:true,extractImpl:async()=>{throw new Error('parser unavailable');}});
  scraper.fetchText = async () => detail;
  await assert.rejects(scraper.fetchDetail('27', null), /parser unavailable/);
});

test('index discovery feeds current bids only to their own publisher records', async () => {
  const scraper = new GsaSurplusScraper({useScrapling:true});
  scraper.fetchText = async () => `<main>
    <article><a href='/asset-details/?property_id=27'>First property</a></article>
    <article><a href='/asset-details/?property_id=28'>Second property</a><span class='property-price'>Current Bid: $250,000</span></article>
  </main>`;
  const seen=[];
  scraper.fetchDetail = async (id,bid) => {
    seen.push({id,bid});
    return {id:`GSA-${id}`,source:'gsa',address:`${id} Test Street`,state:'RI',sourceUrl:`https://realestatesales.gov/asset-details/?property_id=${id}`,openingBid:null};
  };
  scraper.crawlJitter = async () => {};
  await scraper.scrapeFeed();
  assert.deepEqual(seen,[{id:'27',bid:0},{id:'28',bid:250000}]);
  assert.equal(scraper.lastRunReport.extraction.engine,'scrapling');
  assert.equal(scraper.lastRunReport.complete,true);
});
