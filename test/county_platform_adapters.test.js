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
  REALAUCTION_FLORIDA_TAXDEED_COUNTIES,
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
  assert.equal(parsed[0].provenance.publisher, 'Broward County Tax Deed');
  assert.deepEqual(parsed[0].sourceFacts, {
    appraisedValue: 210000,
    certificateNumber: '2023-4410',
  });
  assert.equal(inspectSourceRecordUrl('sheriff', parsed[0].sourceUrl).isValid, true);
});

test('RealAuction URL generation comprehensively covers all 32 Florida tax deed counties', () => {
  const expectedCounties = [
    'alachua', 'bay', 'brevard', 'broward', 'charlotte', 'citrus', 'clay', 'collier',
    'duval', 'escambia', 'hernando', 'hillsborough', 'indianriver', 'lake', 'lee',
    'manatee', 'marion', 'martin', 'miamidade', 'okaloosa', 'orange', 'osceola',
    'palmbeach', 'pasco', 'pinellas', 'polk', 'santarosa', 'sarasota', 'seminole',
    'stjohns', 'stlucie', 'volusia',
  ];

  assert.equal(REALAUCTION_FLORIDA_TAXDEED_COUNTIES.length, 32);
  assert.equal(REALAUCTION_FLORIDA_COUNTIES.length, 32);

  for (const county of expectedCounties) {
    assert.ok(REALAUCTION_FLORIDA_TAXDEED_COUNTIES.includes(county), `Missing tax deed county: ${county}`);
    assert.ok(REALAUCTION_FLORIDA_COUNTIES.includes(county), `Missing foreclosure county: ${county}`);

    // Verify tax deed preview URL generation
    const tdUrl = getRealAuctionUrl(county, 'FL', { mode: 'taxdeed' });
    assert.equal(tdUrl, `https://${county}.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW`);

    // Verify foreclosure preview URL generation
    const fcUrl = getRealAuctionUrl(county, 'FL', { mode: 'foreclosure' });
    assert.equal(fcUrl, `https://${county}.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW`);
  }

  // Verify DEFAULT_FL_COUNTIES maps all 32 counties for both foreclosure and tax deed domains (64 total)
  const { DEFAULT_FL_COUNTIES } = require('../server/scrapers/sheriff');
  assert.equal(DEFAULT_FL_COUNTIES.length, 64);
  for (const county of expectedCounties) {
    assert.ok(
      DEFAULT_FL_COUNTIES.some((c) => c.domain === `${county}.realtaxdeed.com`),
      `DEFAULT_FL_COUNTIES missing tax deed domain for ${county}`
    );
    assert.ok(
      DEFAULT_FL_COUNTIES.some((c) => c.domain === `${county}.realforeclose.com`),
      `DEFAULT_FL_COUNTIES missing foreclosure domain for ${county}`
    );
  }
});

test('RealAuction parses Florida tax deed docket card with certificate number, homestead, APN, and valuations', () => {
  const cardHtml = `
    <div class="AUCTION_ITEM" id="Auction_88201">
      <div class="item_row">Item: 42</div>
      <div class="item_row">Tax Cert #: 2024-8891</div>
      <div class="item_row">Parcel ID: 01-23-45-678-000</div>
      <div class="item_row">Property Address: 742 Evergreen Terr, Orlando, FL 32801</div>
      <div class="item_row">Opening Bid: $24,500.00</div>
      <div class="item_row">Assessed Value: $195,000.00</div>
      <div class="item_row">Homestead Exemption: Yes</div>
      <div class="item_row">Auction Date: 12/15/2026</div>
    </div>
  `;

  const parsed = parseRealAuctionCard(cardHtml, 'orange', 'FL', { mode: 'taxdeed' });
  assert.ok(parsed);
  assert.equal(parsed.source, 'sheriff');
  assert.equal(parsed.platform, 'realtaxdeed');
  assert.equal(parsed.county, 'Orange');
  assert.equal(parsed.state, 'FL');
  assert.equal(parsed.auctionId, '42');
  assert.equal(parsed.caseNumber, null, 'Case number is omitted and must be strictly null');
  assert.equal(parsed.certificateNumber, '2024-8891');
  assert.equal(parsed.homestead, true);
  assert.equal(parsed.parcelId, '01-23-45-678-000');
  assert.equal(parsed.openingBid, 24500);
  assert.equal(parsed.assessed, 195000);
  assert.equal(parsed.saleDate, '12/15/2026');
  assert.match(parsed.address, /742 Evergreen Terr/);
  assert.equal(parsed.zip, '32801');
  assert.equal(
    parsed.sourceUrl,
    'https://orange.realtaxdeed.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=42'
  );
  assert.equal(inspectSourceRecordUrl('sheriff', parsed.sourceUrl).isValid, true);

  // Test integration with SheriffSaleScraper.parseRealauctionHtml
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const scraper = new SheriffSaleScraper();
  const listings = scraper.parseRealauctionHtml(cardHtml, {
    name: 'Orange',
    domain: 'orange.realtaxdeed.com',
    state: 'FL',
  });
  assert.equal(listings.length, 1);
  const l = listings[0];
  assert.equal(l.id, 'SHERIFF-FL-ORA-2024-8891');
  assert.equal(l.apn, '01-23-45-678-000');
  assert.equal(l.openingBid, 24500);
  assert.equal(l.assessed, 195000);
  assert.equal(l.provenance.publisher, 'Orange County Tax Deed');
  assert.equal(l.provenance.platform, 'realtaxdeed');
  assert.deepEqual(l.sourceFacts, {
    appraisedValue: 195000,
    certificateNumber: '2024-8891',
    homestead: true,
  });
});

test('Zero-fabrication invariant: multi-item RealAuction docket does not bleed bids across cards', () => {
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const scraper = new SheriffSaleScraper();

  const multiCardDocketHtml = `
    <div class="Auction_W" id="Auction_1001">
      <table class="tbl_list_data">
        <tr>
          <td>Case #: 24-CV-111</td>
          <td>Property Address: 100 Main St, Columbus, OH 43215</td>
          <td>Opening Bid: $50,000.00</td>
          <td>Auction Date: 12/01/2026</td>
        </tr>
      </table>
    </div>
    <div class="Auction_W" id="Auction_1002">
      <table class="tbl_list_data">
        <tr>
          <td>Case #: 24-CV-222</td>
          <td>Property Address: 200 Broad St, Columbus, OH 43215</td>
          <td>Deposit: $5,000.00</td>
          <td>Auction Date: 12/01/2026</td>
        </tr>
      </table>
    </div>
  `;

  const results = scraper.parseRealauctionHtml(multiCardDocketHtml, {
    name: 'Franklin',
    domain: 'franklin.realforeclose.com',
    state: 'OH',
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].openingBid, 50000, 'Card 1 must have its own opening bid');
  assert.equal(results[1].openingBid, null, 'Card 2 without opening bid must remain strictly null (zero bleed)');
});

test('Zero-fabrication invariant: multi-item Florida tax deed docket does not bleed values and sets omitted fields to null', () => {
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const scraper = new SheriffSaleScraper();

  const multiDocketHtml = `
    <div class="Auction_W" id="Auction_2001">
      <table class="tbl_list_data">
        <tr>
          <td>Certificate #: 2024-001</td>
          <td>Parcel ID: 10-20-30-001</td>
          <td>Property Address: 100 Palm Way, Tampa, FL 33601</td>
          <td>Opening Bid: $35,000.00</td>
          <td>Assessed Value: $180,000.00</td>
          <td>Homestead: Yes</td>
          <td>Auction Date: 12/01/2026</td>
        </tr>
      </table>
    </div>
    <div class="Auction_W" id="Auction_2002">
      <table class="tbl_list_data">
        <tr>
          <td>Certificate #: 2024-002</td>
          <td>Parcel ID: 10-20-30-002</td>
          <td>Property Address: 200 Bay St, Tampa, FL 33601</td>
          <td>Auction Date: 12/01/2026</td>
        </tr>
      </table>
    </div>
    <div class="Auction_W" id="Auction_2003">
      <table class="tbl_list_data">
        <tr>
          <td>Certificate #: 2024-003</td>
          <td>Property Address: 300 Gulf Blvd, Tampa, FL 33601</td>
          <td>Opening Bid: $42,000.00</td>
          <td>Homestead Exemption: False</td>
          <td>Auction Date: 12/01/2026</td>
        </tr>
      </table>
    </div>
  `;

  const results = scraper.parseRealauctionHtml(multiDocketHtml, {
    name: 'Hillsborough',
    domain: 'hillsborough.realtaxdeed.com',
    state: 'FL',
  });

  assert.equal(results.length, 3);

  // Card 1: All values populated
  assert.equal(results[0].openingBid, 35000);
  assert.equal(results[0].assessed, 180000);
  assert.equal(results[0].apn, '10-20-30-001');
  assert.deepEqual(results[0].sourceFacts, {
    appraisedValue: 180000,
    certificateNumber: '2024-001',
    homestead: true,
  });

  // Card 2: Opening bid, assessed value, homestead omitted -> strictly null, no bleed from Card 1
  assert.equal(results[1].openingBid, null, 'Card 2 opening bid must be strictly null (no bleed from Card 1)');
  assert.equal(results[1].assessed, null, 'Card 2 assessed value must be strictly null (no bleed from Card 1)');
  assert.equal(results[1].apn, '10-20-30-002');
  assert.deepEqual(results[1].sourceFacts, {
    certificateNumber: '2024-002',
  }, 'Card 2 sourceFacts must only contain certificateNumber; omitted fields not present');

  // Card 3: Opening bid populated, assessed omitted -> null; APN omitted -> null; homestead false
  assert.equal(results[2].openingBid, 42000);
  assert.equal(results[2].assessed, null, 'Card 3 assessed value must be strictly null');
  assert.equal(results[2].apn, null, 'Card 3 APN omitted must be strictly null');
  assert.deepEqual(results[2].sourceFacts, {
    certificateNumber: '2024-003',
    homestead: false,
  });
});

test('TrusteeSaleScraper AcclaimWeb recorder bridge parses non-judicial trustee notices', async () => {
  const trustee = require('../server/scrapers/trustee');
  const acclaimHtml = `
    <table id="searchResults">
      <tr class="search-row">
        <td>Doc #: 20261015-000492</td>
        <td>Recorded: 10/15/2026</td>
        <td>Type: NOTICE OF TRUSTEE SALE</td>
        <td>Grantor: Johnathan Doe</td>
        <td>Grantee: Quality Loan Service Corp</td>
        <td>APN: 162-23-410-001</td>
        <td>Address: 4820 Boulder Hwy, Las Vegas, NV 89121</td>
      </tr>
    </table>
  `;

  const searchUrl = trustee.getAcclaimSearchUrl('clark', 'NOTICE OF TRUSTEE SALE');
  assert.ok(searchUrl.includes('recorder.clarkcountynv.gov'));

  const rows = trustee.parseAcclaimSearchHtml(acclaimHtml, 'clark');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instrumentNumber, '20261015-000492');
  assert.equal(rows[0].distressStage, 'SCHEDULED_AUCTION');

  const originalFetchText = trustee.fetchText;
  try {
    trustee.fetchText = async () => acclaimHtml;
    const listings = await trustee.scrapeFeed({ jurisdiction: 'clark' });
    assert.equal(listings.length, 1);
    assert.equal(listings[0].id, 'TRUSTEE-NV-CLA-20261015-000492');
    assert.equal(listings[0].county, 'Clark');
    assert.equal(listings[0].state, 'NV');
    assert.equal(listings[0].openingBid, null, 'Statutory notice carries debt or none, openingBid must be null');
    assert.equal(listings[0].provenance.sourceFacts.apn, '162-23-410-001');
    assert.ok(listings[0].parcelKey, 'Parcel key should be attached from APN');
    assert.equal(listings[0].plaintiff, 'Quality Loan Service Corp');
    assert.equal(listings[0].defendant, 'Johnathan Doe');
    assert.equal(listings[0].provenance.platform, 'acclaimweb');
    assert.equal(inspectSourceRecordUrl('trustee', listings[0].sourceUrl).isValid, true);

    const multiListings = await trustee.scrapeFeed({ jurisdictions: ['clark', 'washoe'], docType: 'NOTICE OF TRUSTEE SALE' });
    assert.equal(multiListings.length, 2);
    assert.equal(multiListings[1].county, 'Washoe');
    assert.equal(trustee.lastRunReport.outcome, 'success');
  } finally {
    trustee.fetchText = originalFetchText;
  }
});

test('RealAuction trajectory & cancellation parsing extracts bankruptcy stay and postponements into sourceFacts', () => {
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const scraper = new SheriffSaleScraper({ counties: [{ name: 'Cuyahoga', domain: 'cuyahoga.sheriffsaleauction.ohio.gov', state: 'OH' }] });

  const stayedCardHtml = `
    <div class="AUCTION_ITEM" id="Auction_201991">
      <div class="item_row">Auction ID: 201991</div>
      <div class="item_row">Case #: CV-24-881122</div>
      <div class="item_row">Property Address: 742 Evergreen Terr, Cleveland, OH 44102</div>
      <div class="item_row">Plaintiff: US Bank Trust National Association</div>
      <div class="item_row">Defendant: Homer Simpson</div>
      <div class="item_row">Attorney: Manley Deas Kochalski LLC</div>
      <div class="item_row">Auction Status: Stayed - Chapter 13 Automatic Stay</div>
      <div class="item_row">Opening Bid: $80,000.00</div>
      <div class="item_row">Auction Date: 12/01/2026</div>
    </div>
  `;

  const postponedCardHtml = `
    <div class="AUCTION_ITEM" id="Auction_201992">
      <div class="item_row">Auction ID: 201992</div>
      <div class="item_row">Case #: CV-24-881133</div>
      <div class="item_row">Property Address: 123 Elm St, Cleveland, OH 44105</div>
      <div class="item_row">Auction Status: Postponed (2 times) to 01/15/2027</div>
      <div class="item_row">Opening Bid: $95,000.00</div>
      <div class="item_row">Auction Date: 01/15/2027</div>
    </div>
  `;

  const parsedStay = parseRealAuctionCard(stayedCardHtml, 'cuyahoga', 'OH');
  assert.equal(parsedStay.cancellationReason, 'Bankruptcy Stay');
  assert.equal(parsedStay.statutoryStayExhausted, false);
  assert.equal(parsedStay.plaintiff, 'US Bank Trust National Association');
  assert.equal(parsedStay.defendant, 'Homer Simpson');
  assert.equal(parsedStay.attorney, 'Manley Deas Kochalski LLC');

  const parsedPostpone = parseRealAuctionCard(postponedCardHtml, 'cuyahoga', 'OH');
  assert.equal(parsedPostpone.cancellationReason, 'Postponed');
  assert.equal(parsedPostpone.priorPostponements, 2);

  const listings = scraper.parseRealauctionHtml(stayedCardHtml, { name: 'Cuyahoga', domain: 'cuyahoga.sheriffsaleauction.ohio.gov', state: 'OH' });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].plaintiff, 'US Bank Trust National Association');
  assert.equal(listings[0].defendant, 'Homer Simpson');
  assert.equal(listings[0].attorney, 'Manley Deas Kochalski LLC');
  assert.equal(listings[0].sourceFacts.cancellationReason, 'Bankruptcy Stay');
  assert.equal(listings[0].sourceFacts.statutoryStayExhausted, false);
  assert.equal(listings[0].provenance.sourceFacts.statutoryStayExhausted, false);
});
