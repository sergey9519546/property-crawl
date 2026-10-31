'use strict';

/**
 * test/texas-tax-sale-wiring.test.js
 *
 * Unit tests verifying wiring of the Texas Delinquent Tax Sale adapter
 * (server/scrapers/adapters/texas-tax-sale.js) into live scraper execution in
 * server/scrapers/sheriff.js and allowlisting in server/scrapers/source-policy.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { SOURCE_HOSTS, inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
const {
  SheriffSaleScraper,
  DEFAULT_OH_COUNTIES,
  DEFAULT_FL_COUNTIES,
  DEFAULT_TX_COUNTIES,
  TEXAS_TAX_SALE_COUNTIES,
  parseTexasTaxSaleHtml,
  parseTexasTaxSaleCard,
  getNextTexasTaxSaleDate,
  normalizeCountyInput,
} = require('../server/scrapers/sheriff');
const { createRunReport } = require('../server/scrapers/run-report');

// ---------------------------------------------------------------------------
// 1. Source Policy Allowlist & Record URL Inspection
// ---------------------------------------------------------------------------

test('SOURCE_HOSTS.sheriff contains all required Texas tax office and firm counsel domains', () => {
  const expectedDomains = [
    'hctax.net',
    'dallascounty.org',
    'tarrantcountytx.gov',
    'bexar.org',
    'traviscountytx.gov',
    'collincountytx.gov',
    'dentoncounty.gov',
    'epcounty.com',
    'fortbendcountytx.gov',
    'mctx.org',
    'wilco.org',
    'lgbs.com',
    'mvbalaw.com',
    'pbfcm.com',
  ];

  for (const domain of expectedDomains) {
    assert.ok(
      SOURCE_HOSTS.sheriff.includes(domain),
      `SOURCE_HOSTS.sheriff must include ${domain}`
    );
  }
});

test('inspectSourceRecordUrl accepts valid Texas tax sale listing URLs on allowlisted domains', () => {
  const harrisUrl = 'https://www.hctax.net/Property/TaxSales?case=2024-TX-08912';
  assert.equal(inspectSourceRecordUrl('sheriff', harrisUrl).isValid, true);

  const dallasUrl = 'https://www.dallascounty.org/departments/pubworks/property-division.php?case=2024-TX-001';
  assert.equal(inspectSourceRecordUrl('sheriff', dallasUrl).isValid, true);

  const tarrantUrl = 'https://www.tarrantcountytx.gov/en/constables/constable-3/delinquent-tax-sales.html?case=TX-24-100';
  assert.equal(inspectSourceRecordUrl('sheriff', tarrantUrl).isValid, true);

  const bexarUrl = 'https://www.bexar.org/DocumentCenter/View/41852/Bexar-County-Resale-Properties-Distribution-List';
  assert.equal(inspectSourceRecordUrl('sheriff', bexarUrl).isValid, true);

  const linebargerUrl = 'https://www.lgbs.com/tax-sales?case=2024-TX-5511';
  assert.equal(inspectSourceRecordUrl('sheriff', linebargerUrl).isValid, true);

  // Unallowlisted host must be rejected
  const fakeUrl = 'https://unauthorized-texas-host.net/Property/TaxSales?case=123';
  assert.equal(inspectSourceRecordUrl('sheriff', fakeUrl).isValid, false);
});

// ---------------------------------------------------------------------------
// 2. County Catalog & Scraper Wiring Invariants
// ---------------------------------------------------------------------------

test('DEFAULT_TX_COUNTIES is exported and covers all 11 registered Texas jurisdictions', () => {
  assert.ok(Array.isArray(DEFAULT_TX_COUNTIES), 'DEFAULT_TX_COUNTIES must be an array');
  assert.equal(DEFAULT_TX_COUNTIES.length, 11);

  const keys = DEFAULT_TX_COUNTIES.map((c) => c.key);
  assert.ok(keys.includes('harris'));
  assert.ok(keys.includes('dallas'));
  assert.ok(keys.includes('tarrant'));
  assert.ok(keys.includes('bexar'));
  assert.ok(keys.includes('travis'));
  assert.ok(keys.includes('collin'));
  assert.ok(keys.includes('denton'));
  assert.ok(keys.includes('el_paso'));
  assert.ok(keys.includes('fort_bend'));
  assert.ok(keys.includes('montgomery'));
  assert.ok(keys.includes('williamson'));

  for (const c of DEFAULT_TX_COUNTIES) {
    assert.equal(c.state, 'TX');
    assert.ok(c.name, `County ${c.key} must have name`);
    assert.ok(c.domain, `County ${c.key} must have domain`);
    assert.ok(c.url, `County ${c.key} must have url`);
  }
});

test('SheriffSaleScraper instance enrolls Texas counties by default', () => {
  const scraper = new SheriffSaleScraper();
  assert.ok(scraper.counties.length >= 30, 'Should include OH, FL, and TX counties');

  const txCounties = scraper.counties.filter((c) => c.state === 'TX');
  assert.equal(txCounties.length, 11);
  assert.ok(txCounties.some((c) => c.name === 'Harris'));
  assert.ok(txCounties.some((c) => c.name === 'Dallas'));
  assert.ok(txCounties.some((c) => c.name === 'Tarrant'));
});

test('isTexasCounty correctly identifies Texas county objects and strings', () => {
  const scraper = new SheriffSaleScraper({ counties: [] });

  assert.equal(scraper.isTexasCounty({ name: 'Harris', state: 'TX' }), true);
  assert.equal(scraper.isTexasCounty({ name: 'Cuyahoga', state: 'OH' }), false);
  assert.equal(scraper.isTexasCounty({ name: 'Miami-Dade', state: 'FL' }), false);
  assert.equal(scraper.isTexasCounty({ domain: 'hctax.net' }), true);
  assert.equal(scraper.isTexasCounty({ domain: 'dallascounty.org' }), true);
  assert.equal(scraper.isTexasCounty('harris'), true);
  assert.equal(scraper.isTexasCounty('dallas'), true);
  assert.equal(scraper.isTexasCounty('cuyahoga'), false);
});

// ---------------------------------------------------------------------------
// 3. Docket Parsing & Standardization via scrapeCounty
// ---------------------------------------------------------------------------

test('SheriffSaleScraper.scrapeCounty parses and standardizes Texas tax sale docket', async () => {
  const scraper = new SheriffSaleScraper({ counties: [] });
  const report = createRunReport('sheriff', { counties: ['Harris,TX'] });

  const mockHarrisHtml = `
    <div class="tax-sale-docket">
      <tr class="listing-row">
        <td>Suit No: 2024-TX-08912</td>
        <td>Precinct 4 Constable</td>
        <td>Account: 041-892-001-0024</td>
        <td>Harris County, City of Houston vs. James E. Martinez</td>
        <td>Property: 8912 Willow Run Dr, Houston, TX 77088</td>
        <td>Legal: Lot 12, Block 4, Willow Run Sec 2</td>
        <td>Adjudged Value: $195,000.00</td>
        <td>Minimum Bid: $42,500.00</td>
        <td>Sale Date: November 03, 2026</td>
      </tr>
      <tr class="listing-row">
        <td>Cause No: 2024-TX-09941</td>
        <td>Precinct 1 Constable</td>
        <td>CAD: 041-994-002-0010</td>
        <td>Harris County vs. Sarah Jenkins (Residence Homestead)</td>
        <td>Property: 4501 Memorial Dr, Houston, TX 77007</td>
        <td>Adjudged Value: $310,000.00</td>
        <td>Minimum Bid: $68,000.00</td>
        <td>Sale Date: November 03, 2026</td>
      </tr>
    </div>
  `;

  const listings = await scraper.scrapeCounty(
    { name: 'Harris', state: 'TX', key: 'harris' },
    report,
    { html: mockHarrisHtml }
  );

  assert.equal(listings.length, 2, 'Should parse both valid records');

  // Verify runReport updated
  assert.ok(report.statesSucceeded.includes('Harris,TX'));

  // Test Non-Homestead Record (180 days redemption)
  const nonHomestead = listings[0];
  assert.equal(nonHomestead.state, 'TX');
  assert.equal(nonHomestead.county, 'Harris');
  assert.equal(nonHomestead.city, 'Houston');
  assert.equal(nonHomestead.address, '8912 Willow Run Dr');
  assert.equal(nonHomestead.openingBid, 42500);
  assert.equal(nonHomestead.assessed, 195000);
  assert.equal(nonHomestead.saleDate, '2026-11-03');
  assert.equal(nonHomestead.auctionProgram, 'tax_deed');
  assert.equal(nonHomestead.redemptionDays, 180);
  assert.match(nonHomestead.redemptionWarning, /Tex\. Tax Code § 34\.21\(e\)/);

  // Provenance and publisher record
  assert.equal(nonHomestead.provenance.origin, 'live');
  assert.equal(nonHomestead.provenance.observed, true);
  assert.equal(nonHomestead.provenance.platform, 'texas-tax-sale');

  const rawRecord = scraper.getRawPublisherRecord(nonHomestead);
  assert.ok(rawRecord, 'Pre-normalization publisher record must be preserved');
  assert.equal(rawRecord.sourceFacts.causeNumber, '2024-TX-08912');
  assert.equal(rawRecord.sourceFacts.constablePrecinct, 4);
  assert.equal(rawRecord.sourceFacts.bidderCertificateRequired, true);

  // Test Homestead Record (730 days redemption)
  const homestead = listings[1];
  assert.equal(homestead.state, 'TX');
  assert.equal(homestead.county, 'Harris');
  assert.equal(homestead.address, '4501 Memorial Dr');
  assert.equal(homestead.openingBid, 68000);
  assert.equal(homestead.assessed, 310000);
  assert.equal(homestead.auctionProgram, 'tax_deed');
  assert.equal(homestead.redemptionDays, 730);
  assert.match(homestead.redemptionWarning, /Tex\. Tax Code § 34\.21\(a\)/);

  const rawHomestead = scraper.getRawPublisherRecord(homestead);
  assert.ok(rawHomestead);
  assert.equal(rawHomestead.sourceFacts.isHomestead, true);
  assert.equal(rawHomestead.sourceFacts.statutoryRedemptionDays, 730);
});

// ---------------------------------------------------------------------------
// 4. ScrapeFeed Integration with Mocked Texas County
// ---------------------------------------------------------------------------

test('SheriffSaleScraper.scrapeFeed runs end-to-end with Texas counties', async () => {
  const mockDallasHtml = `
    <div class="tax-sale-docket">
      <tr class="listing-row">
        <td>Cause No: 2024-TX-010</td>
        <td>Precinct 1 Constable</td>
        <td>CAD: 010-100-001-0010</td>
        <td>Dallas County vs. Delinquent Asset LLC</td>
        <td>Address: 1200 Commerce St, Dallas, TX 75201</td>
        <td>Adjudged Value: $250,000.00</td>
        <td>Minimum Bid: $55,000.00</td>
        <td>Sale Date: 2026-11-03</td>
      </tr>
    </div>
  `;

  const scraper = new SheriffSaleScraper({
    counties: [
      {
        name: 'Dallas',
        state: 'TX',
        key: 'dallas',
        html: mockDallasHtml,
      },
    ],
  });

  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);

  const listing = listings[0];
  assert.equal(listing.state, 'TX');
  assert.equal(listing.county, 'Dallas');
  assert.equal(listing.address, '1200 Commerce St');
  assert.equal(listing.openingBid, 55000);
  assert.equal(listing.assessed, 250000);
  assert.equal(listing.auctionProgram, 'tax_deed');
  assert.equal(listing.redemptionDays, 180);

  assert.equal(scraper.lastRunReport.outcome, 'success');
  assert.equal(scraper.lastRunReport.recordsEmitted, 1);
  assert.equal(scraper.lastRunReport.recordsRejected, 0);
  assert.ok(scraper.lastRunReport.statesSucceeded.includes('Dallas,TX'));
});
