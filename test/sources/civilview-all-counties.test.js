'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NJ_COUNTIES,
  PA_COUNTIES,
  ALL_COUNTIES,
  getCivilViewSearchUrl,
  getCivilViewDetailUrl,
  getCounty,
  getNJCounties,
  getPACounties,
  parseSalesTable,
} = require('../../server/sources/civilview');
const { inspectSourceRecordUrl } = require('../../server/scrapers/source-policy');
const {
  CivilViewScraper,
  parseCountyOffset,
  collectCivilView,
} = require('../../server/scrapers/civilview');

const EXPECTED_21_NJ_COUNTIES = [
  'Atlantic',
  'Bergen',
  'Burlington',
  'Camden',
  'Cape May',
  'Cumberland',
  'Essex',
  'Gloucester',
  'Hudson',
  'Hunterdon',
  'Mercer',
  'Middlesex',
  'Monmouth',
  'Morris',
  'Ocean',
  'Passaic',
  'Salem',
  'Somerset',
  'Sussex',
  'Union',
  'Warren',
];

test('registry defines exactly 21 New Jersey counties with verified IDs and state codes', () => {
  const njList = getNJCounties();
  assert.equal(njList.length, 21, 'Must contain all 21 New Jersey counties');

  const names = njList.map((c) => c.name).sort();
  const expectedSorted = [...EXPECTED_21_NJ_COUNTIES].sort();
  assert.deepEqual(names, expectedSorted, 'All 21 county names must match expected list');

  for (const county of njList) {
    assert.equal(county.state, 'NJ');
    assert.ok(county.id && /^\d+$/.test(county.id), `County ${county.name} must have numeric id`);
    assert.ok(county.fullName.includes('NJ'));
  }
});

test('registry defines Pennsylvania counties hosted on salesweb.civilview.com', () => {
  const paList = getPACounties();
  assert.ok(paList.length >= 3, 'Must support multiple PA counties');

  const paNames = paList.map((c) => c.name);
  assert.ok(paNames.includes('Lehigh'));
  assert.ok(paNames.includes('Montgomery'));
  assert.ok(paNames.includes('Philadelphia'));

  for (const county of paList) {
    assert.equal(county.state, 'PA');
    assert.ok(county.id && /^\d+$/.test(county.id), `PA county ${county.name} must have numeric id`);
    assert.ok(county.fullName.includes('PA'));
  }
});

test('getCounty finds counties by id, legacyId, or name', () => {
  const atlantic = getCounty('Atlantic');
  assert.ok(atlantic);
  assert.equal(atlantic.id, '25');
  assert.equal(atlantic.state, 'NJ');

  const bergen = getCounty('1'); // legacy id
  assert.ok(bergen);
  assert.equal(bergen.name, 'Bergen');

  const montgomery = getCounty('23', 'PA');
  assert.ok(montgomery);
  assert.equal(montgomery.name, 'Montgomery');
  assert.equal(montgomery.state, 'PA');
});

test('URL generation produces valid CivilView publisher URLs conforming to source-policy', () => {
  const searchUrl = getCivilViewSearchUrl(7);
  assert.equal(searchUrl, 'https://salesweb.civilview.com/Sales/SalesSearch?countyId=7');

  const detailUrl = getCivilViewDetailUrl('2128964683');
  assert.equal(detailUrl, 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683');

  const inspection = inspectSourceRecordUrl('civilview', detailUrl);
  assert.equal(inspection.isValid, true, 'Generated detail URL must be valid per source-policy');
  assert.equal(inspection.url, detailUrl);
});

test('parses standard New Jersey sales search results table into structured listings', () => {
  const njHtml = `
    <table class="table table-striped">
      <tr class="header">
        <th>Details</th>
        <th>Sheriff #</th>
        <th>Sale Date</th>
        <th>Plaintiff</th>
        <th>Defendant</th>
        <th>Address</th>
      </tr>
      <tr>
        <td><a href="/Sales/SaleDetails?PropertyId=987654321">View Details</a></td>
        <td>F-24005511</td>
        <td>11/18/2026</td>
        <td>M&T Bank</td>
        <td>Johnathan Miller</td>
        <td>342 Atlantic Ave, Atlantic City, NJ 08401</td>
      </tr>
      <tr>
        <td><a href="https://malicious.example/Sales/SaleDetails?PropertyId=666">View Details</a></td>
        <td>F-BAD</td>
        <td>11/19/2026</td>
        <td>Attacker</td>
        <td>Target</td>
        <td>1 Evil Way, Nowhere, NJ 07000</td>
      </tr>
    </table>
  `;

  const atlanticCounty = getCounty('Atlantic');
  const records = parseSalesTable(njHtml, atlanticCounty);

  assert.equal(records.length, 1, 'Cross-origin link must be filtered out');
  const rec = records[0];
  assert.equal(rec.source, 'civilview');
  assert.equal(rec.county, 'Atlantic');
  assert.equal(rec.state, 'NJ');
  assert.equal(rec.sheriffNumber, 'F-24005511');
  assert.equal(rec.saleDate, '11/18/2026');
  assert.equal(rec.plaintiff, 'M&T Bank');
  assert.equal(rec.defendant, 'Johnathan Miller');
  assert.equal(rec.address, '342 Atlantic Ave, Atlantic City, NJ 08401');
  assert.equal(rec.zip, '08401');
  assert.equal(rec.detailUrl, 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=987654321');
  assert.equal(rec.provenance.publisher, 'CivilView (Tyler Technologies)');
  assert.equal(rec.provenance.origin, 'live');
});

test('parses Pennsylvania docket table into structured listings', () => {
  const paHtml = `
    <table>
      <tr>
        <td><a href="/Sales/SaleDetails?PropertyId=554433221">View Details</a></td>
        <td>2024-04123</td>
        <td>12/02/2026</td>
        <td>PNC Bank, National Association</td>
        <td>Robert Zimmerman</td>
        <td>1500 Market St, Philadelphia, PA 19102</td>
      </tr>
    </table>
  `;

  const phillyCounty = getCounty('Philadelphia');
  const records = parseSalesTable(paHtml, phillyCounty);

  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.source, 'civilview');
  assert.equal(rec.county, 'Philadelphia');
  assert.equal(rec.state, 'PA');
  assert.equal(rec.sheriffNumber, '2024-04123');
  assert.equal(rec.address, '1500 Market St, Philadelphia, PA 19102');
  assert.equal(rec.zip, '19102');
  assert.equal(rec.detailUrl, 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=554433221');
});

test('CivilView cursor continuation parses options.cursor and options.countyOffset', () => {
  assert.equal(parseCountyOffset(0), 0);
  assert.equal(parseCountyOffset(5), 5);
  assert.equal(parseCountyOffset('5'), 5);
  assert.equal(parseCountyOffset({ cursor: '7' }), 7);
  assert.equal(parseCountyOffset({ countyOffset: 8 }), 8);
  assert.equal(parseCountyOffset({ continuationToken: '9' }), 9);
  assert.equal(parseCountyOffset({ nextCursor: '10' }), 10);
  assert.equal(parseCountyOffset('invalid'), null);
  assert.equal(parseCountyOffset(-1), null);
  assert.equal(parseCountyOffset(null), null);

  const scraper1 = new CivilViewScraper({ cursor: '3' });
  assert.equal(scraper1.countyRotationOffset, 3);

  const scraper2 = new CivilViewScraper({ countyOffset: 4 });
  assert.equal(scraper2.countyRotationOffset, 4);

  const scraper3 = new CivilViewScraper();
  scraper3.setCheckpoint({ cursor: '6' });
  assert.equal(scraper3.countyRotationOffset, 6);
  scraper3.setCheckpoint({ countyOffset: 7 });
  assert.equal(scraper3.countyRotationOffset, 7);
});

test('CivilView emits explicit partialSweep and nextCursor on bounded county caps vs full catalog sweep', async () => {
  const mockCounties = [
    { id: '7', name: 'Bergen', state: 'NJ', fullName: 'Bergen, NJ' },
    { id: '10', name: 'Essex', state: 'NJ', fullName: 'Essex, NJ' },
    { id: '8', name: 'Passaic', state: 'NJ', fullName: 'Passaic, NJ' },
    { id: '17', name: 'Hudson', state: 'NJ', fullName: 'Hudson, NJ' },
    { id: '2', name: 'Camden', state: 'NJ', fullName: 'Camden, NJ' },
    { id: '13', name: 'Middlesex', state: 'NJ', fullName: 'Middlesex, NJ' },
    { id: '21', name: 'Union', state: 'NJ', fullName: 'Union, NJ' },
  ];

  function makeMockScraper(options = {}) {
    const s = new CivilViewScraper({
      targetState: 'NJ',
      maxRetries: 1,
      random: () => 0,
      sleepImpl: async () => {},
      ...options,
    });
    s.fetchCounties = async () => mockCounties;
    s.fetchCountySummaries = async (county) => ({
      summaries: [{
        propertyId: `${county.id}01`,
        sheriffNumber: `F-${county.id}`,
        saleDateRaw: '12/01/2026',
        plaintiff: 'Bank',
        defendant: 'Borrower',
        addressRaw: '100 Main St, City, NJ 07000',
        county,
        countySearchUrl: `https://salesweb.civilview.com/Sales/SalesSearch?countyId=${county.id}`,
        detailUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${county.id}01`,
      }],
      sessionCookie: 'ASP.NET_SessionId=mock',
      pageUrl: `https://salesweb.civilview.com/Sales/SalesSearch?countyId=${county.id}`,
    });
    s.fetchText = async () => `
      <div class="sale-details-list">
        <div class="sale-detail-item"><div class="sale-detail-label">Sheriff #:</div><div class="sale-detail-value">F-100</div></div>
        <div class="sale-detail-item"><div class="sale-detail-label">Address:</div><div class="sale-detail-value">100 Main St, City, NJ 07000</div></div>
      </div>
    `;
    s.passesFilter = () => true;
    return s;
  }

  // Run 1: bounded county cap with maxCounties = 2 (out of 7 counties)
  const scraperRun1 = makeMockScraper({ maxCounties: 2 });
  const listingsRun1 = await scraperRun1.scrapeFeed();
  assert.equal(scraperRun1.lastRunReport.partialSweep, true, 'Run 1 bounded at 2 counties must be a partialSweep');
  assert.equal(scraperRun1.lastRunReport.nextCursor, '2', 'Run 1 nextCursor must point to next county offset');
  assert.equal(listingsRun1.partialSweep, true, 'Listings object must carry partialSweep metadata');
  assert.equal(listingsRun1.nextCursor, '2', 'Listings object must carry nextCursor metadata');

  // Run 2: resume using cursor '2'
  const scraperRun2 = makeMockScraper({ maxCounties: 2, cursor: scraperRun1.lastRunReport.nextCursor });
  const listingsRun2 = await scraperRun2.scrapeFeed();
  assert.equal(scraperRun2.lastRunReport.partialSweep, true, 'Run 2 bounded at 2 counties must be a partialSweep');
  assert.equal(scraperRun2.lastRunReport.nextCursor, '4', 'Run 2 nextCursor must advance to offset 4');
  assert.equal(listingsRun2.partialSweep, true);
  assert.equal(listingsRun2.nextCursor, '4');

  // Run 3: full catalog sweep with maxCounties = 10 (covering all 7 counties)
  const scraperFull = makeMockScraper({ maxCounties: 10 });
  const listingsFull = await scraperFull.scrapeFeed();
  assert.equal(scraperFull.lastRunReport.partialSweep, false, 'Full sweep must have partialSweep = false');
  assert.equal(scraperFull.lastRunReport.nextCursor, null, 'Full sweep must have nextCursor = null');
  assert.equal(scraperFull.lastRunReport.nextContinuationToken, null);
  assert.equal(listingsFull.partialSweep, false);
  assert.equal(listingsFull.nextCursor, null);
});
