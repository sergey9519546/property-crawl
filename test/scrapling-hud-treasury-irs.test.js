'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HudHomeScraper } = require('../server/scrapers/hud');
const { TreasuryForfeitureScraper } = require('../server/scrapers/treasury');
const { IrsSeizedScraper } = require('../server/scrapers/irs');
const {
  isScraplingEnabled,
  PROFILES
} = require('../server/scrapers/scrapling-bridge');

function env(overrides, body) {
  const names = Object.keys(overrides);
  const previous = names.map((name) => [name, process.env[name]]);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try { return body(); }
  finally {
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const original = previous[i][1];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  }
}

test('PROFILES exposes the three new HUD/Treasury/IRS profiles', () => {
  assert.ok(PROFILES.has('hud-cards'));
  assert.ok(PROFILES.has('treasury-detail'));
  assert.ok(PROFILES.has('irs-detail'));
});

test('HUD scraper useScrapling matches isScraplingEnabled("hud") when no override is given', () => {
  env({ SCRAPLING_SOURCES: 'hud' }, () => {
    assert.equal(new HudHomeScraper().useScrapling, true);
  });
  env({ SCRAPLING_SOURCES: undefined }, () => {
    assert.equal(new HudHomeScraper().useScrapling, false);
  });
});

test('Treasury scraper useScrapling matches isScraplingEnabled("treasury") when no override is given', () => {
  env({ SCRAPLING_SOURCES: 'treasury' }, () => {
    assert.equal(new TreasuryForfeitureScraper().useScrapling, true);
  });
  env({ SCRAPLING_SOURCES: undefined }, () => {
    assert.equal(new TreasuryForfeitureScraper().useScrapling, false);
  });
});

test('IRS scraper useScrapling matches isScraplingEnabled("irs") when no override is given', () => {
  env({ SCRAPLING_SOURCES: 'irs' }, () => {
    assert.equal(new IrsSeizedScraper().useScrapling, true);
  });
  env({ SCRAPLING_SOURCES: undefined }, () => {
    assert.equal(new IrsSeizedScraper().useScrapling, false);
  });
});

test('HUD mapScraplingCard produces a listing in the existing parseHtmlCards shape', () => {
  const scraper = new HudHomeScraper({ useScrapling: false });
  const listing = scraper.mapScraplingCard(
    { caseNumber: '123-456789', address: '100 Main St', currentBid: 250000 },
    'RI',
    'https://www.hudhomestore.gov/Home/Index?state=RI'
  );
  assert.equal(listing.id, 'HUD-123-456789');
  assert.equal(listing.state, 'RI');
  assert.equal(listing.address, '100 Main St');
  assert.equal(listing.openingBid, 250000);
  assert.equal(listing.provenance.recordId, '123-456789');
  assert.equal(listing.provenance.sourceFacts.extractedFromUrl, 'https://www.hudhomestore.gov/Home/Index?state=RI');
});

test('HUD mapScraplingCard returns null when caseNumber is missing', () => {
  const scraper = new HudHomeScraper();
  assert.equal(scraper.mapScraplingCard({ address: '100 Main St' }, 'RI', 'https://example.test'), null);
});

test('HUD parseCardsWithScrapling maps a Scrapling-evidence payload to listings', async () => {
  const scraper = new HudHomeScraper({
    useScrapling: true,
    extractImpl: async () => ({
      items: [
        { caseNumber: '111-111111', address: '111 First St', currentBid: 100000 },
        { caseNumber: '222-222222', address: '222 Second St', currentBid: null }
      ]
    })
  });
  const listings = await scraper.parseCardsWithScrapling('<html></html>', 'CA', 'https://example.test/x');
  assert.equal(listings.length, 2);
  assert.equal(listings[0].id, 'HUD-111-111111');
  assert.equal(listings[1].openingBid, null);
});

test('HUD parseCardsWithScrapling returns empty array when extractImpl throws', async () => {
  const scraper = new HudHomeScraper({
    useScrapling: true,
    extractImpl: async () => { throw new Error('venv down'); }
  });
  const listings = await scraper.parseCardsWithScrapling('<html></html>', 'CA', 'https://example.test/x');
  assert.deepEqual(listings, []);
});

test('HUD parseCardsWithScrapling returns empty array for empty HTML', async () => {
  const scraper = new HudHomeScraper({ useScrapling: true });
  assert.deepEqual(await scraper.parseCardsWithScrapling('', 'CA', 'https://example.test/x'), []);
});

test('HUD parseHtmlCards still falls back to the native regex when useScrapling is false', () => {
  const scraper = new HudHomeScraper({ useScrapling: false });
  const html = `<table><tr class="property-row"><td>Case#: 555-555555</td><td class="prop-address">555 Fifth Ave</td><td>$650,000</td></tr></table>`;
  const listings = scraper.parseHtmlCards(html, 'NY');
  assert.equal(listings.length, 1);
  assert.equal(listings[0].address, '555 Fifth Ave');
  assert.equal(listings[0].id, 'HUD-555-555555');
  assert.equal(listings[0].openingBid, 650000);
});

test('Treasury fetchDetail prefers Scrapling values when useScrapling is true', async () => {
  const scraper = new TreasuryForfeitureScraper({
    useScrapling: true,
    extractImpl: async () => ({
      property: {
        startingBid: 175000,
        livingArea: 2200,
        yearBuilt: 1985,
        siteAcres: 0.6,
        deposit: '$17,500',
        auctionDate: '2026-12-01 10:00 AM',
        parcelNumber: '555-PQR',
        saleNumber: 'TRSY-DELTA',
        beds: 4,
        baths: 3
      }
    })
  });
  scraper.fetchText = async () => `<html><head><title>123 Big Sky Lane, Billings, Montana 59101</title></head><body></body></html>`;
  const listing = await scraper.fetchDetail('1234.shtml');
  assert.equal(listing.address, '123 Big Sky Lane, Billings, Montana 59101');
  assert.equal(listing.openingBid, 175000);
  assert.equal(listing.sqft, 2200);
  assert.equal(listing.year, 1985);
  assert.equal(listing.beds, 4);
  assert.equal(listing.baths, 3);
  assert.equal(listing.provenance.sourceFacts.parcelNumber, '555-PQR');
});

test('Treasury fetchDetail falls back to regex when Scrapling returns null', async () => {
  const scraper = new TreasuryForfeitureScraper({
    useScrapling: true,
    extractImpl: async () => ({ property: {} })
  });
  scraper.fetchText = async () => `<html><head><title>999 Outback Road, Bozeman, Montana 59715</title></head>
<body>Starting Bid: $99,000 Living Area: 1,234 sq ft Year Built: 2001
Site Area: 0.33 acres Deposit: $10,000
Auction Date and Time: 2027-01-15 09:00 AM
Parcel No: 999-XYZ Sale Number: TRSY-OMEGA 2 bedrooms 1 baths</body></html>`;
  const listing = await scraper.fetchDetail('5678.shtml');
  assert.equal(listing.openingBid, 99000);
  assert.equal(listing.sqft, 1234);
  assert.equal(listing.beds, 2);
  assert.equal(listing.baths, 1);
});

test('Treasury fetchDetail does not invoke extractImpl when useScrapling is false', async () => {
  let extractCalled = false;
  const scraper = new TreasuryForfeitureScraper({
    useScrapling: false,
    extractImpl: async () => { extractCalled = true; return { property: {} }; }
  });
  scraper.fetchText = async () => `<html><head><title>111 Plain St, Reno, Nevada 89501</title></head><body>Sale Number: TRSY-PLAIN</body></html>`;
  await scraper.fetchDetail('plain.shtml');
  assert.equal(extractCalled, false);
});

test('IRS fetchDetail prefers Scrapling address/city/state/zip when useScrapling is true', async () => {
  const scraper = new IrsSeizedScraper({
    useScrapling: true,
    extractImpl: async () => ({
      property: {
        address: '424 Override Avenue',
        city: 'Overrideville',
        state: 'PA',
        zip: '19111',
        minimumBid: 222000,
        saleDate: '2027-03-01',
        beds: 5,
        baths: 3,
        sqft: 2500,
        yearBuilt: 1990
      }
    })
  });
  scraper.fetchText = async () => `<html><body>
<address>424 Override Avenue<br>Overrideville, 19111 PA</address>
<div content="100.00" class="field__item">100.00</div>
<time datetime="2026-01-01T10:00:00Z">Jan 1</time>
<div class="field--name-field-asset-description">ignored</div>
</body></html>`;
  const listing = await scraper.fetchDetail('test-1', '');
  assert.equal(listing.address, '424 Override Avenue, Overrideville, PA 19111');
  assert.equal(listing.openingBid, 222000);
  assert.equal(listing.saleDate, '2027-03-01');
  assert.equal(listing.beds, 5);
  assert.equal(listing.baths, 3);
  assert.equal(listing.sqft, 2500);
  assert.equal(listing.year, 1990);
});

test('IRS fetchDetail falls back to regex when Scrapling returns a partial record', async () => {
  const scraper = new IrsSeizedScraper({
    useScrapling: true,
    extractImpl: async () => ({ property: { address: '123 Regex St' } })
  });
  scraper.fetchText = async () => `<html><body>
<address>123 Regex St<br>Drexel Hill, 19026 PA</address>
<div content="50000.00" class="field__item">50,000.00</div>
<time datetime="2026-04-01T10:00:00Z">Apr 1</time>
Asset Description</div><div class="field__item">3 bedrooms, 2 bathrooms, 1500 sq ft. Built in 1970.</div>
</body></html>`;
  const listing = await scraper.fetchDetail('test-2', '');
  assert.equal(listing.address, '123 Regex St, Drexel Hill, PA 19026');
  assert.equal(listing.openingBid, 50000);
  assert.equal(listing.beds, 3);
  assert.equal(listing.baths, 2);
  assert.equal(listing.sqft, 1500);
  assert.equal(listing.year, 1970);
});

test('IRS fetchDetail does not invoke extractImpl when useScrapling is false', async () => {
  let extractCalled = false;
  const scraper = new IrsSeizedScraper({
    useScrapling: false,
    extractImpl: async () => { extractCalled = true; return { property: {} }; }
  });
  scraper.fetchText = async () => `<html><body>
<address>789 Plain St<br>Plaintown, 19000 PA</address>
<div content="1000.00" class="field__item">1,000.00</div>
</body></html>`;
  await scraper.fetchDetail('test-3', '');
  assert.equal(extractCalled, false);
});

test('HUD fetchDataGridPage awaits parseCardsWithScrapling when useScrapling is true', async () => {
  let parsedViaScrapling = false;
  const scraper = new HudHomeScraper({
    useScrapling: true,
    extractImpl: async () => {
      parsedViaScrapling = true;
      return { items: [{ caseNumber: '999-999999', address: '999 Scrapling Way', currentBid: 999000 }] };
    }
  });
  scraper.requestText = async () => '<html>not-json</html>';
  const page = await scraper.fetchDataGridPage('CA', 1);
  assert.equal(parsedViaScrapling, true);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 'HUD-999-999999');
  assert.equal(page.hasMore, false);
});

test('HUD fetchStateHtml awaits parseCardsWithScrapling when useScrapling is true', async () => {
  let parsedViaScrapling = false;
  const scraper = new HudHomeScraper({
    useScrapling: true,
    extractImpl: async () => {
      parsedViaScrapling = true;
      return { items: [{ caseNumber: '888-888888', address: '888 Fallback Lane', currentBid: 888000 }] };
    }
  });
  scraper.requestText = async () => '<html>fallback</html>';
  const listings = await scraper.fetchStateHtml('CA', new Error('primary down'));
  assert.equal(parsedViaScrapling, true);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'HUD-888-888888');
});

test('HUD fetchStateHtml uses native parseHtmlCards when useScrapling is false', async () => {
  let extractCalled = false;
  const scraper = new HudHomeScraper({
    useScrapling: false,
    extractImpl: async () => { extractCalled = true; return { items: [] }; }
  });
  scraper.requestText = async () => '<table><tr class="property-row"><td>Case#: 777-777777</td><td class="prop-address">777 Native Way</td></tr></table>';
  const listings = await scraper.fetchStateHtml('CA', new Error('primary down'));
  assert.equal(extractCalled, false);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'HUD-777-777777');
});

test('SCRAPLING_SOURCES=hud,treasury,irs enables all three sources together', () => {
  env({ SCRAPLING_SOURCES: 'hud,treasury,irs' }, () => {
    assert.equal(new HudHomeScraper().useScrapling, true);
    assert.equal(new TreasuryForfeitureScraper().useScrapling, true);
    assert.equal(new IrsSeizedScraper().useScrapling, true);
    // gsa remains disabled (not listed)
    const { GsaSurplusScraper } = require('../server/scrapers/gsa');
    assert.equal(new GsaSurplusScraper().useScrapling, false);
  });
});

test('env-gate precedence: useScrapling option > env var > default false', () => {
  env({ SCRAPLING_SOURCES: 'hud' }, () => {
    assert.equal(new HudHomeScraper({ useScrapling: false }).useScrapling, false);
    assert.equal(new HudHomeScraper({ useScrapling: true }).useScrapling, true);
    assert.equal(new HudHomeScraper().useScrapling, true);
  });
});