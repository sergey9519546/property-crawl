'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');

const {
  NJ_COUNTY_MAP,
  getCivilViewUrl,
  parseCivilViewRow,
  parseCivilViewHtml,
} = require('../server/scrapers/adapters/civilview');

const {
  REALAUCTION_OHIO_COUNTIES,
  REALAUCTION_FLORIDA_COUNTIES,
  getRealAuctionUrl,
  parseRealAuctionCard,
  parseRealAuctionDocketHtml,
} = require('../server/scrapers/adapters/realauction');

const {
  RECORD_DOC_TYPES,
  DEFAULT_JURISDICTIONS,
  getAcclaimSearchUrl,
  parseAcclaimRecordRow,
  parseAcclaimSearchHtml,
} = require('../server/scrapers/adapters/acclaimweb');

// ---------------------------------------------------------
// CivilView Platform Adapter Tests
// ---------------------------------------------------------

test('CivilView adapter maps New Jersey counties and builds URLs', () => {
  assert.equal(NJ_COUNTY_MAP[1].county, 'Bergen');
  assert.equal(NJ_COUNTY_MAP[2].county, 'Essex');
  assert.equal(NJ_COUNTY_MAP[4].county, 'Camden');
  assert.equal(getCivilViewUrl(1), 'https://salesweb.civilview.com/Sales/SalesSearch?countyId=1');
  assert.equal(getCivilViewUrl(4), 'https://salesweb.civilview.com/Sales/SalesSearch?countyId=4');
});

test('CivilView parses HTML table rows into structured listings', () => {
  const html = `
    <table>
      <tr class="header"><th>Sheriff #</th><th>Case #</th><th>Sale Date</th><th>Address</th><th>Judgment</th><th>Plaintiff</th><th>Defendant</th></tr>
      <tr>
        <td>F-240012</td>
        <td>F-014522-23</td>
        <td>10/28/2026</td>
        <td>142 Palisade Ave, Garfield, NJ 07026</td>
        <td>$285,000.00</td>
        <td>Wells Fargo Bank, N.A.</td>
        <td>Johnathan Smith</td>
      </tr>
      <tr>
        <td>F-240013</td>
        <td>F-009841-24</td>
        <td>11/04/2026</td>
        <td>88 Main St, Hackensack, NJ 07601</td>
        <td>$340,000.00</td>
        <td>Freedom Mortgage Corp</td>
        <td>Maria Rodriguez</td>
      </tr>
    </table>
  `;

  const listings = parseCivilViewHtml(html, 1);
  assert.equal(listings.length, 2);

  const first = listings[0];
  assert.equal(first.source, 'civilview');
  assert.equal(first.county, 'Bergen');
  assert.equal(first.state, 'NJ');
  assert.equal(first.sheriffNumber, 'F-240012');
  assert.equal(first.caseNumber, 'F-014522-23');
  assert.equal(first.openingBid, 285000);
  assert.match(first.address, /142 Palisade Ave/);
  assert.equal(first.zip, '07026');
  assert.equal(first.plaintiff, 'Wells Fargo Bank, N.A.');
});

// ---------------------------------------------------------
// RealAuction Platform Adapter Tests
// ---------------------------------------------------------

test('RealAuction adapter covers major Ohio and Florida counties', () => {
  assert.ok(REALAUCTION_OHIO_COUNTIES.includes('cuyahoga'));
  assert.ok(REALAUCTION_OHIO_COUNTIES.includes('franklin'));
  assert.ok(REALAUCTION_OHIO_COUNTIES.includes('hamilton'));

  assert.ok(REALAUCTION_FLORIDA_COUNTIES.includes('miamidade'));
  assert.ok(REALAUCTION_FLORIDA_COUNTIES.includes('palmbeach'));

  assert.equal(
    getRealAuctionUrl('cuyahoga', 'OH'),
    'https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&Zmethod=PREVIEW'
  );
  assert.equal(
    getRealAuctionUrl('palmbeach', 'FL'),
    'https://palmbeach.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW'
  );
});

test('RealAuction parses preview docket card into canonical format', () => {
  const cardHtml = `
    <div class="AUCTION_ITEM" id="Auction_104921">
      <div class="item_row">Auction ID: 104921</div>
      <div class="item_row">Case #: CV-24-991201</div>
      <div class="item_row">Parcel ID: 012-34-567</div>
      <div class="item_row">Property Address: 4928 Broadview Rd, Cleveland, OH 44109</div>
      <div class="item_row">Opening Bid: $65,000.00</div>
      <div class="item_row">Final Judgment: $148,000.00</div>
      <div class="item_row">Appraised Value: $115,000.00</div>
      <div class="item_row">Auction Date: 11/04/2026</div>
    </div>
  `;

  const parsed = parseRealAuctionCard(cardHtml, 'cuyahoga', 'OH');
  assert.ok(parsed);
  assert.equal(parsed.source, 'sheriff');
  assert.equal(parsed.platform, 'realauction');
  assert.equal(parsed.county, 'Cuyahoga');
  assert.equal(parsed.state, 'OH');
  assert.equal(parsed.auctionId, '104921');
  assert.equal(parsed.caseNumber, 'CV-24-991201');
  assert.equal(parsed.parcelId, '012-34-567');
  assert.equal(parsed.openingBid, 65000);
  assert.equal(parsed.judgment, 148000);
  assert.equal(parsed.assessed, 115000);
  assert.equal(parsed.saleDate, '11/04/2026');
  assert.match(parsed.address, /4928 Broadview Rd/);
  assert.equal(parsed.zip, '44109');
  assert.equal(parsed.sourceUrl, 'https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=104921');
  assert.equal(inspectSourceRecordUrl('sheriff', parsed.sourceUrl).isValid, true);

  const cardWithCaseOnly = '<div class="AUCTION_ITEM">Case #: CV-24-991201<br>Property Address: 4928 Broadview Rd, Cleveland, OH 44109</div>';
  const parsedCaseOnly = parseRealAuctionCard(cardWithCaseOnly, 'cuyahoga', 'OH');
  assert.equal(parsedCaseOnly.sourceUrl, 'https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&case=CV-24-991201');
  assert.equal(inspectSourceRecordUrl('sheriff', parsedCaseOnly.sourceUrl).isValid, true);

  const flCard = '<div class="AUCTION_ITEM">Item: 777<br>Property Address: 10 Biscayne Blvd, Miami, FL 33132</div>';
  const parsedFl = parseRealAuctionCard(flCard, 'miamidade', 'FL');
  assert.equal(parsedFl.sourceUrl, 'https://miamidade.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=777');
  assert.equal(inspectSourceRecordUrl('sheriff', parsedFl.sourceUrl).isValid, true);
});

test('RealAuction parses complete multi-property preview page', () => {
  const docketHtml = `
    <div class="Auction_W">
      <table class="tbl_list_data">
        <tr><td>Auction ID: 501</td><td>Case #: 24-CV-111</td><td>Property Address: 124 Main St, Columbus, OH 43215</td><td>Opening Bid: $50,000</td></tr>
      </table>
      <table class="tbl_list_data">
        <tr><td>Auction ID: 502</td><td>Case #: 24-CV-222</td><td>Property Address: 789 High St, Columbus, OH 43215</td><td>Opening Bid: $75,000</td></tr>
      </table>
    </div>
  `;

  const listings = parseRealAuctionDocketHtml(docketHtml, 'franklin', 'OH');
  assert.equal(listings.length, 2);
  assert.equal(listings[0].auctionId, '501');
  assert.equal(listings[1].auctionId, '502');
  assert.equal(listings[0].openingBid, 50000);
  assert.equal(listings[1].openingBid, 75000);
});

// ---------------------------------------------------------
// AcclaimWeb Platform Adapter Tests
// ---------------------------------------------------------

test('AcclaimWeb adapter defines doc types and builds search URLs', () => {
  assert.equal(RECORD_DOC_TYPES.LIS_PENDENS, 'LIS PENDENS');
  assert.equal(RECORD_DOC_TYPES.NOTICE_OF_DEFAULT, 'NOTICE OF DEFAULT');
  assert.equal(RECORD_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE, 'NOTICE OF TRUSTEE SALE');

  const clarkConfig = DEFAULT_JURISDICTIONS.clark;
  assert.equal(clarkConfig.county, 'Clark');
  assert.equal(clarkConfig.state, 'NV');

  const url = getAcclaimSearchUrl('clark', 'NOTICE_OF_TRUSTEE_SALE');
  assert.match(url, /recorder\.clarkcountynv\.gov/);
  assert.match(url, /SearchTypeDocType/);
});

test('AcclaimWeb parses recorder search result row', () => {
  const rowHtml = `
    <tr class="search-result-row">
      <td class="col-inst">Instrument: 20261008:009412</td>
      <td class="col-date">Recorded: 10/08/2026</td>
      <td class="col-type">Doc Type: NOTICE OF TRUSTEE SALE</td>
      <td class="col-grantor">Grantor: Martinez, David</td>
      <td class="col-grantee">Grantee: Quality Loan Service Corp</td>
      <td class="col-apn">APN: 162-23-410-008</td>
      <td class="col-desc">Legal Desc: Lot 4 Block 2 Paradise Valley</td>
    </tr>
  `;

  const parsed = parseAcclaimRecordRow(rowHtml, 'clark');
  assert.ok(parsed);
  assert.equal(parsed.source, 'recorder');
  assert.equal(parsed.platform, 'acclaimweb');
  assert.equal(parsed.county, 'Clark');
  assert.equal(parsed.state, 'NV');
  assert.equal(parsed.instrumentNumber, '20261008:009412');
  assert.equal(parsed.recordedDate, '10/08/2026');
  assert.equal(parsed.docType, 'NOTICE OF TRUSTEE SALE');
  assert.equal(parsed.distressStage, 'SCHEDULED_AUCTION');
  assert.equal(parsed.grantor, 'Martinez, David');
  assert.equal(parsed.grantee, 'Quality Loan Service Corp');
  assert.equal(parsed.apn, '162-23-410-008');
  assert.equal(parsed.sourceUrl, 'https://recorder.clarkcountynv.gov/AcclaimWeb/details?id=20261008%3A009412');
});

test('AcclaimWeb parses full search results container', () => {
  const html = `
    <div class="results-container">
      <div class="SearchResultItem">
        Instrument: 20261007:001111
        Recorded: 10/07/2026
        Doc Type: NOTICE OF DEFAULT
        Grantor: Henderson, Sarah
        APN: 139-11-201-002
      </div>
      <div class="SearchResultItem">
        Instrument: 20261007:002222
        Recorded: 10/07/2026
        Doc Type: LIS PENDENS
        Grantor: Apex Commercial LLC
        APN: 177-05-302-019
      </div>
    </div>
  `;

  const filings = parseAcclaimSearchHtml(html, 'clark');
  assert.equal(filings.length, 2);
  assert.equal(filings[0].instrumentNumber, '20261007:001111');
  assert.equal(filings[0].distressStage, 'PRE_FORECLOSURE');
  assert.equal(filings[1].instrumentNumber, '20261007:002222');
});


test('RealAuction tax-deed mode (.realtaxdeed.com) and SheriffSaleScraper docket bridge', () => {
  const { REALAUCTION_FLORIDA_TAXDEED_COUNTIES } = require('../server/scrapers/adapters/realauction');
  const { SheriffSaleScraper, DEFAULT_FL_COUNTIES } = require('../server/scrapers/sheriff');

  assert.ok(REALAUCTION_FLORIDA_TAXDEED_COUNTIES.includes('broward'));
  assert.ok(DEFAULT_FL_COUNTIES.some((c) => c.domain === 'broward.realtaxdeed.com'));

  const taxDeedUrl = getRealAuctionUrl('broward', 'FL', { mode: 'taxdeed', auctionId: '99812' });
  assert.equal(taxDeedUrl, 'https://broward.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=99812');
  assert.equal(inspectSourceRecordUrl('sheriff', taxDeedUrl).isValid, true);

  const scraper = new SheriffSaleScraper({ includeFlorida: true });
  assert.ok(scraper.counties.some((c) => c.domain === 'broward.realtaxdeed.com'));

  const docketHtml = `
    <div class="Auction_W">
      <table class="tbl_list_data">
        <tr>
          <td>Auction ID: 99812</td>
          <td>Certificate #: 2023-4410</td>
          <td>Parcel ID: 4942-10-01-0020</td>
          <td>Property Address: 500 E Broward Blvd, Fort Lauderdale, FL 33301</td>
          <td>Opening Bid: $18,450.00</td>
          <td>Assessed Value: $210,000.00</td>
          <td>Auction Date: 11/18/2026</td>
        </tr>
      </table>
    </div>
  `;
  const parsed = scraper.parseRealauctionHtml(docketHtml, {
    name: 'Broward',
    domain: 'broward.realtaxdeed.com',
    state: 'FL',
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'SHERIFF-FL-BRO-2023-4410');
  assert.equal(parsed[0].openingBid, 18450);
  assert.equal(parsed[0].assessed, 210000);
  assert.equal(parsed[0].apn, '4942-10-01-0020');
  assert.equal(parsed[0].saleDate, '2026-11-18');
  assert.equal(parsed[0].provenance.platform, 'realtaxdeed');
  assert.equal(inspectSourceRecordUrl('sheriff', parsed[0].sourceUrl).isValid, true);
});
