'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');

const {
  NJ_COUNTY_MAP,
  PA_COUNTY_MAP,
  analyzeCivilViewStatusHistory,
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

test('CivilView adapter maps Pennsylvania counties including York and Lancaster', () => {
  assert.equal(PA_COUNTY_MAP[62].county, 'York');
  assert.equal(PA_COUNTY_MAP[62].state, 'PA');
  assert.equal(PA_COUNTY_MAP[49].county, 'Lancaster');
  assert.equal(PA_COUNTY_MAP[48].county, 'Cumberland');
  assert.equal(PA_COUNTY_MAP[54].county, 'Monroe');
  assert.equal(PA_COUNTY_MAP[60].county, 'Philadelphia');
});

test('CivilView analyzeCivilViewStatusHistory tracks statutory adjournments and stay exhaustion', () => {
  const history = [
    { status: 'Scheduled', date: '2026-01-10' },
    { status: 'Adjourned by Debtor', date: '2026-02-10' },
    { status: 'Adjourned - Defendant Stay', date: '2026-03-10' },
  ];
  const analysis = analyzeCivilViewStatusHistory(history);
  assert.equal(analysis.priorPostponements, 2);
  assert.equal(analysis.debtorAdjournments, 2);
  assert.equal(analysis.statutoryStayExhausted, true);
  assert.equal(analysis.latestStatus, 'Adjourned - Defendant Stay');

  const fresh = analyzeCivilViewStatusHistory([{ status: 'Scheduled', date: '2026-01-10' }]);
  assert.equal(fresh.statutoryStayExhausted, false);
  assert.equal(fresh.priorPostponements, 0);
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

test('AcclaimWeb parses multi-line alias grantors and tag-wrapped recording labels without truncation', () => {
  const multiLineHtml = `
    <tr class="search-result-row">
      <td class="col-inst"><b>Instrument:</b> 20261009:008899</td>
      <td class="col-date"><b>Recorded:</b> 10/09/2026</td>
      <td class="col-type"><b>Doc Type:</b> NOTICE OF TRUSTEE SALE</td>
      <td class="col-grantor"><b>Grantor:</b> Martinez, David<br>AKA David M Martinez<br>Martinez David J</td>
      <td class="col-grantee"><b>Grantee:</b> Western Title Trustee Services</td>
      <td class="col-apn"><b>APN:</b> 139-22-310-001</td>
      <td class="col-desc"><b>Legal Desc:</b> Lot 12 Block 3 Green Valley</td>
    </tr>
  `;

  const parsed = parseAcclaimRecordRow(multiLineHtml, 'clark');
  assert.ok(parsed);
  assert.equal(parsed.instrumentNumber, '20261009:008899');
  assert.equal(parsed.recordedDate, '10/09/2026');
  assert.equal(parsed.docType, 'NOTICE OF TRUSTEE SALE');
  assert.equal(parsed.distressStage, 'SCHEDULED_AUCTION');
  assert.equal(parsed.grantor, 'Martinez, David');
  assert.equal(parsed.grantee, 'Western Title Trustee Services');
  assert.equal(parsed.apn, '139-22-310-001');
  assert.equal(parsed.legalDescription, 'Lot 12 Block 3 Green Valley');

  // Verify generic table row parsing in parseAcclaimSearchHtml
  const genericTableHtml = `
    <table id="tblSearchResults">
      <tr>
        <td class="col-inst">Doc #: 2026-9901</td>
        <td class="col-date">10/11/2026</td>
        <td class="col-type">NOTICE OF DEFAULT</td>
        <td class="col-grantor">Taylor, Robert</td>
        <td class="col-apn">163-12-101-005</td>
      </tr>
    </table>
  `;
  const filings = parseAcclaimSearchHtml(genericTableHtml, 'washoe');
  assert.equal(filings.length, 1);
  assert.equal(filings[0].county, 'Washoe');
  assert.equal(filings[0].instrumentNumber, '2026-9901');
  assert.equal(filings[0].grantor, 'Taylor, Robert');
  assert.equal(filings[0].apn, '163-12-101-005');
});


test('AcclaimWeb ignores search-form tables, column headers, and UI placeholder text', () => {
  const searchFormHtml = `
    <form action="/AcclaimWeb/search/SearchTypeDocType">
      <table>
        <tr>
          <th class="col-inst">Instrument</th>
          <th>Record Date</th>
          <th>Doc Type</th>
          <th>Grantor</th>
        </tr>
        <tr>
          <td><label>Record Type</label><select name="docType"><option value="LP">Lis Pendens</option></select></td>
          <td><input name="grantor" title="Enter grantor name, such as a trust or corporation name." /></td>
        </tr>
      </table>
      <div>Doc: Clerk File Number</div>
    </form>
  `;
  assert.deepEqual(parseAcclaimSearchHtml(searchFormHtml, 'brevard'), []);
  assert.equal(parseAcclaimRecordRow('<tr><td>Record Date</td><td>Clerk File Number</td></tr>', 'duval'), null);
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

const {
  TEXAS_TAX_SALE_COUNTIES,
  getFirstTuesdayOfMonth,
  getNextTexasTaxSaleDate,
  getTexasTaxSaleRedemption,
  parseTexasTaxSaleCard,
  parseTexasTaxSaleHtml,
} = require('../server/scrapers/adapters/texas-tax-sale');

test('Texas Tax Sale adapter covers major Texas counties with statutory precincts', () => {
  assert.ok(TEXAS_TAX_SALE_COUNTIES.harris, 'Harris county must be registered');
  assert.ok(TEXAS_TAX_SALE_COUNTIES.dallas, 'Dallas county must be registered');
  assert.ok(TEXAS_TAX_SALE_COUNTIES.tarrant, 'Tarrant county must be registered');
  assert.ok(TEXAS_TAX_SALE_COUNTIES.bexar, 'Bexar county must be registered');
  assert.ok(TEXAS_TAX_SALE_COUNTIES.travis, 'Travis county must be registered');

  assert.equal(TEXAS_TAX_SALE_COUNTIES.harris.state, 'TX');
  assert.equal(TEXAS_TAX_SALE_COUNTIES.harris.fips, '48201');
  assert.deepEqual(TEXAS_TAX_SALE_COUNTIES.harris.precincts, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('getFirstTuesdayOfMonth calculates exact statutory First Tuesday dates per Tex. Tax Code § 34.01', () => {
  assert.equal(getFirstTuesdayOfMonth(2026, 11), '2026-11-03'); // Nov 1 is Sun -> Tue is Nov 3
  assert.equal(getFirstTuesdayOfMonth(2026, 12), '2026-12-01'); // Dec 1 is Tue -> Tue is Dec 1
  assert.equal(getFirstTuesdayOfMonth(2027, 1), '2027-01-05');  // Jan 1 is Fri -> Tue is Jan 5
  assert.equal(getFirstTuesdayOfMonth(2027, 2), '2027-02-02');  // Feb 1 is Mon -> Tue is Feb 2
  assert.equal(getFirstTuesdayOfMonth(2027, 3), '2027-03-02');  // Mar 1 is Mon -> Tue is Mar 2
});

test('getTexasTaxSaleRedemption applies statutory 180-day non-homestead and 730-day homestead terms', () => {
  const investor = getTexasTaxSaleRedemption({ isHomestead: false });
  assert.equal(investor.redemptionDays, 180);
  assert.equal(investor.penaltyRatePct, 25);
  assert.match(investor.statutoryCitation, /Tex\. Tax Code § 34\.21\(e\)/);

  const homestead = getTexasTaxSaleRedemption({ isHomestead: true });
  assert.equal(homestead.redemptionDays, 730);
  assert.equal(homestead.penaltyRatePct, 25);
  assert.match(homestead.statutoryCitation, /Tex\. Tax Code § 34\.21\(a\)/);
});

test('parseTexasTaxSaleCard extracts cause number, CAD APN, adjudged value, opening bid, and constable precinct', () => {
  const rowHtml = `
    <tr>
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
  `;

  const listing = parseTexasTaxSaleCard(rowHtml, 'harris', { zip: '77088' });
  assert.ok(listing, 'Listing must be parsed');
  assert.equal(listing.state, 'TX');
  assert.equal(listing.county, 'Harris');
  assert.equal(listing.city, 'Houston');
  assert.equal(listing.zip, '77088');
  assert.equal(listing.address, '8912 Willow Run Dr');
  assert.equal(listing.openingBid, 42500);
  assert.equal(listing.assessedValue, 195000);
  assert.equal(listing.apn, '041-892-001-0024');
  assert.equal(listing.saleDate, '2026-11-03');

  // Zero-fabrication guarantees
  assert.equal(listing.dealScore, null);
  assert.equal(listing.estLow, null);
  assert.equal(listing.estHigh, null);
  assert.equal(listing.arv, null);

  // Operational facts on sourceFacts
  assert.equal(listing.sourceFacts.causeNumber, '2024-TX-08912');
  assert.equal(listing.sourceFacts.constablePrecinct, 4);
  assert.equal(listing.sourceFacts.plaintiff, 'Harris County, City of Houston');
  assert.equal(listing.sourceFacts.defendant, 'James E. Martinez');
  assert.equal(listing.sourceFacts.statutoryRedemptionDays, 180);
  assert.equal(listing.sourceFacts.penaltyRatePct, 25);
  assert.equal(listing.sourceFacts.bidderCertificateRequired, true);
});

test('parseTexasTaxSaleHtml extracts multi-record Texas Constable auction docket', () => {
  const docketHtml = `
    <div class="tax-sale-docket">
      <tr class="listing-row">
        <td>Cause No: 2024-TX-001</td>
        <td>Precinct 1 Constable</td>
        <td>CAD: 010-100-001-0010</td>
        <td>Dallas County vs. John Carter</td>
        <td>100 Elm St, Dallas, TX 75201</td>
        <td>Adjudged Value: $140,000.00</td>
        <td>Minimum Bid: $28,000.00</td>
      </tr>
      <tr class="listing-row">
        <td>Cause No: 2024-TX-002</td>
        <td>Precinct 3 Constable</td>
        <td>CAD: 010-100-001-0020</td>
        <td>Dallas County vs. Mary Higgins (Residence Homestead)</td>
        <td>200 Oak St, Dallas, TX 75202</td>
        <td>Adjudged Value: $210,000.00</td>
        <td>Minimum Bid: $35,000.00</td>
      </tr>
    </div>
  `;

  const listings = parseTexasTaxSaleHtml(docketHtml, 'dallas', { saleDate: '2026-11-03' });
  assert.equal(listings.length, 2);

  assert.equal(listings[0].county, 'Dallas');
  assert.equal(listings[0].openingBid, 28000);
  assert.equal(listings[0].sourceFacts.statutoryRedemptionDays, 180);

  assert.equal(listings[1].county, 'Dallas');
  assert.equal(listings[1].openingBid, 35000);
  assert.equal(listings[1].sourceFacts.isHomestead, true);
  assert.equal(listings[1].sourceFacts.statutoryRedemptionDays, 730); // 2 years for homestead
});

test('parseTexasTaxSaleCard captures trailing docket subdivision suffixes across Texas jurisdictions', () => {
  const cardWithSuffix = `
    <div class="tax-card">
      <div>Cause No: 2024-TX-104-A</div>
      <div>Precinct 4 Constable</div>
      <div>Account: 041-892-001-0022</div>
      <div>Situs Address: 1420 Post Oak Blvd, Houston, TX 77056</div>
      <div>Adjudged Value: $385,000.00</div>
      <div>Minimum Bid: $42,500.00</div>
    </div>
  `;
  const parsed = parseTexasTaxSaleCard(cardWithSuffix, 'harris');
  assert.ok(parsed);
  assert.equal(parsed.sourceFacts.causeNumber, '2024-TX-104-A');
  assert.equal(parsed.id, 'tx-tax-harris-2024-tx-104-a');
  assert.equal(parsed.openingBid, 42500);

  const cardWithSlashSuffix = `
    <div class="tax-card">
      <div>Suit #: TX-22-12345-1</div>
      <div>Precinct 2</div>
      <div>Address: 500 Main St, Fort Worth, TX 76102</div>
      <div>Minimum Bid: $19,000</div>
    </div>
  `;
  const parsedTarrant = parseTexasTaxSaleCard(cardWithSlashSuffix, 'tarrant');
  assert.ok(parsedTarrant);
  assert.equal(parsedTarrant.sourceFacts.causeNumber, 'TX-22-12345-1');
  assert.equal(parsedTarrant.id, 'tx-tax-tarrant-tx-22-12345-1');
});

test('Bid4Assets extractAuctionJsonRecords parses nested JSON, braces in titles, and leading metadata', () => {
  const { extractAuctionJsonRecords } = require('../server/scrapers/bid4assets');

  const pageHtml = `
    <html>
      <script>
        var item1 = {
          "storefront": "berks",
          "AuctionID": 104928,
          "Asset_Title": "Berks County, PA Sheriff Sale: 123 MAIN ST {UNIT #2} \\"DUPLEX\\"",
          "ActualCloseTime": "11/20/2026",
          "MinimumBid": 45000,
          "CurrentBid": 50000,
          "DebtAmount": 95000,
          "ParcelID": "08-123-456",
          "nestedMeta": {
            "lienPriority": "first",
            "statutoryType": "judicial"
          }
        };
      </script>
      <script>
        var item2 = {
          "AuctionID": 104929,
          "Asset_Title": "Berks County, PA Sheriff Sale: 456 OAK AVE",
          "ActualCloseTime": "11/20/2026",
          "MinimumBid": 20000,
          "CurrentBid": 25000
        };
      </script>
    </html>
  `;

  const records = extractAuctionJsonRecords(pageHtml);
  assert.equal(records.length, 2);
  assert.equal(records[0].AuctionID, 104928);
  assert.match(records[0].Asset_Title, /123 MAIN ST \{UNIT #2\}/);
  assert.equal(records[0].nestedMeta.lienPriority, 'first');
  assert.equal(records[1].AuctionID, 104929);
});

test('Option B Multi-County Platform Expansion: CivilView nationwide, RealAuction 25 OH + multi-state, AcclaimWeb + Cook/Miami-Dade Trustee integration', async () => {
  const { ALL_COUNTY_MAP, NATIONWIDE_COUNTY_MAP } = require('../server/scrapers/adapters/civilview');
  const { REALAUCTION_MULTI_STATE_PORTALS } = require('../server/scrapers/adapters/realauction');
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const trustee = require('../server/scrapers/trustee');

  // 1. CivilView nationwide map covers 15+ states (AR, AZ, CO, DE, FL, GA, IA, ID, IL, KS, LA, MN, NJ, OH, OR, PA, TX, WA)
  assert.ok(Object.keys(NATIONWIDE_COUNTY_MAP).length >= 60);
  assert.equal(ALL_COUNTY_MAP[47].state, 'AZ');
  assert.equal(ALL_COUNTY_MAP[47].county, 'Maricopa');
  assert.equal(ALL_COUNTY_MAP[93].state, 'TX');
  assert.equal(ALL_COUNTY_MAP[93].county, 'Dallas');
  assert.equal(ALL_COUNTY_MAP[26].state, 'WA');
  assert.equal(ALL_COUNTY_MAP[26].county, 'Snohomish');

  // 2. RealAuction 25 Ohio counties + multi-state portals
  assert.equal(REALAUCTION_OHIO_COUNTIES.length, 25);
  for (const extraOh of ['portage', 'union', 'wayne', 'miami', 'greene']) {
    assert.ok(REALAUCTION_OHIO_COUNTIES.includes(extraOh), `REALAUCTION_OHIO_COUNTIES missing ${extraOh}`);
  }
  assert.equal(
    getRealAuctionUrl('denver', 'CO', { mode: 'foreclosure', auctionId: '701' }),
    'https://denver.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=701',
  );
  assert.equal(
    getRealAuctionUrl('maricopa', 'AZ', { mode: 'taxlien', auctionId: '802' }),
    'https://maricopa.realtaxlien.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=802',
  );
  assert.equal(inspectSourceRecordUrl('sheriff', 'https://maricopa.realtaxlien.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=802').isValid, true);
  assert.ok(REALAUCTION_MULTI_STATE_PORTALS['co:denver:foreclosure']);

  // SheriffSaleScraper deduplicates counties when SHERIFF_EXTRA_COUNTIES overlaps DEFAULT_OH_COUNTIES
  const prevExtra = process.env.SHERIFF_EXTRA_COUNTIES;
  try {
    process.env.SHERIFF_EXTRA_COUNTIES = 'Portage:portage.sheriffsaleauction.ohio.gov:OH,Union:union.sheriffsaleauction.ohio.gov:OH';
    const sheriffScraper = new SheriffSaleScraper();
    const portageEntries = sheriffScraper.counties.filter((c) => c.domain === 'portage.sheriffsaleauction.ohio.gov');
    assert.equal(portageEntries.length, 1, 'SheriffSaleScraper must deduplicate overlapping county domains');
  } finally {
    if (prevExtra === undefined) delete process.env.SHERIFF_EXTRA_COUNTIES;
    else process.env.SHERIFF_EXTRA_COUNTIES = prevExtra;
  }

  // 3. AcclaimWeb multi-state jurisdictions + Cook & Miami-Dade wiring in TrusteeSaleScraper
  assert.equal(DEFAULT_JURISDICTIONS.collin.state, 'TX');
  assert.equal(DEFAULT_JURISDICTIONS.duval.state, 'FL');
  assert.equal(DEFAULT_JURISDICTIONS.arapahoe.state, 'CO');
  assert.equal(
    inspectSourceRecordUrl('trustee', 'https://collin.tx.publicsearch.us/AcclaimWeb/details?id=2026-009182').isValid,
    true,
  );
  assert.equal(
    inspectSourceRecordUrl('trustee', 'https://recording.cookcountyclerkil.gov/details?id=2419823412').isValid,
    true,
  );
  assert.equal(
    inspectSourceRecordUrl('trustee', 'https://onrecords.miamidadeclerk.gov/details?id=2026R044812').isValid,
    true,
  );

  const cookHtml = `
    <table class="search-results">
      <tr class="cook-record-row">
        <td class="col-doc">Doc #: 2419823412<a href="https://recording.cookcountyclerkil.gov/details?id=2419823412"></a></td>
        <td class="col-date">10/18/2026</td>
        <td class="col-type">SHERIFF SALE NOTICE</td>
        <td class="col-case">2024-CH-04821</td>
        <td class="col-pin">17-10-305-012-0000</td>
        <td class="col-plaintiff">WELLS FARGO BANK, N.A.</td>
        <td class="col-defendant">MARTINEZ, CARLOS</td>
        <td class="col-legal">LOT 14 IN BLOCK 2 IN WEST CHICAGO ADDITION</td>
      </tr>
    </table>
  `;
  const miamiHtml = `
    <table class="search-results">
      <tr class="miamidade-record-row">
        <td class="col-cfn">CFN: 2026R044812<a href="https://onrecords.miamidadeclerk.gov/details?id=2026R044812"></a></td>
        <td class="col-date">10/19/2026</td>
        <td class="col-type">NOTICE OF SALE</td>
        <td class="col-grantor">GOMEZ, ELENA</td>
        <td class="col-grantee">US BANK TRUST NA</td>
        <td>Folio: 30-4018-001-0120</td>
        <td class="col-legal">CORAL GABLES SEC 4 LOT 12 BLK 3</td>
      </tr>
    </table>
  `;

  const origFetch = trustee.fetchText;
  try {
    trustee.fetchText = async (url) => {
      if (url.includes('cookcountyclerkil.gov')) return cookHtml;
      if (url.includes('miamidadeclerk.gov')) return miamiHtml;
      return '';
    };
    const combined = await trustee.scrapeFeed({
      jurisdictions: ['cook', 'miami-dade'],
      docType: 'NOTICE OF SALE',
    });
    assert.equal(combined.length, 2);
    const cookItem = combined.find((l) => l.state === 'IL');
    const miamiItem = combined.find((l) => l.state === 'FL');
    assert.ok(cookItem);
    assert.equal(cookItem.id, 'TRUSTEE-IL-COO-2419823412');
    assert.equal(cookItem.openingBid, null, 'Zero-Fabrication: Cook recorder notice never fabricates openingBid');
    assert.equal(cookItem.parcelKey, '17031-17103050120000');
    assert.ok(miamiItem);
    assert.equal(miamiItem.id, 'TRUSTEE-FL-MIA-2026R044812');
    assert.equal(miamiItem.openingBid, null, 'Zero-Fabrication: Miami-Dade clerk notice never fabricates openingBid');
    assert.equal(miamiItem.parcelKey, '12086-3040180010120');
  } finally {
    trustee.fetchText = origFetch;
  }
});

test('RealAuction fetchCountyRealauction accumulates listings across candidate dates via ColdFusion AJAX', async () => {
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const initialHtml = `
    <html>
      <body>
        <div class="BLHeaderNext"><a href="/index.cfm?zaction=AUCTION&AuctionDate=11/20/2026">Next</a></div>
        <div class="BLHeaderToday"><a href="/index.cfm?zaction=AUCTION&AuctionDate=11/13/2026">Today</a></div>
      </body>
    </html>
  `;
  const ajaxResponseDate1 = JSON.stringify({
    retHTML: '<tr class="DataRow"><td>Auction ID: 101</td><td>Case #: 2026-CV-01</td><td>Parcel ID: 01-100-20</td><td>Address: 100 Main St, Columbus, OH 43215</td><td>Opening Bid: $50,000</td></tr>'
  });
  const ajaxResponseDate2 = JSON.stringify({
    retHTML: '<tr class="DataRow"><td>Auction ID: 102</td><td>Case #: 2026-CV-02</td><td>Parcel ID: 01-100-21</td><td>Address: 200 Broad St, Columbus, OH 43215</td><td>Opening Bid: $75,000</td></tr>'
  });

  const scraper = new SheriffSaleScraper();
  scraper.requestText = async () => initialHtml;
  let callCount = 0;
  scraper.fetchImpl = async (url) => {
    callCount++;
    if (url.includes('AuctionDate=')) {
      return { ok: true, text: async () => 'ok' };
    }
    if (url.includes('PageDir=0') && url.includes('AREA=W')) {
      const resp = callCount < 5 ? ajaxResponseDate1 : ajaxResponseDate2;
      return { ok: true, text: async () => resp };
    }
    return { ok: true, text: async () => JSON.stringify({ retHTML: '' }) };
  };

  const results = await scraper.fetchCountyRealauction({ name: 'Franklin', domain: 'franklin.sheriffsaleauction.ohio.gov', state: 'OH' });
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'SHERIFF-OH-FRA-2026-CV-01');
  assert.equal(results[1].id, 'SHERIFF-OH-FRA-2026-CV-02');
});

test('SheriffSaleScraper emits completedCounties atomically across multi-portal FL counties while keeping slice cursor exact', async () => {
  const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
  const scraper = new SheriffSaleScraper({
    maxCounties: 2,
    countyOffset: 0,
    counties: [
      { name: 'Cuyahoga', state: 'OH', domain: 'cuyahoga.sheriffsaleauction.ohio.gov' },
      { name: 'Hillsborough', state: 'FL', domain: 'hillsborough.realforeclose.com' },
      { name: 'Hillsborough', state: 'FL', domain: 'hillsborough.realtaxdeed.com' },
      { name: 'Franklin', state: 'OH', domain: 'franklin.sheriffsaleauction.ohio.gov' },
    ],
  });

  // First slice (offset 0, maxCounties 2) spans Cuyahoga and the first portal of Hillsborough;
  // expansion must include BOTH Hillsborough portals atomically while advancing nextContinuationToken to '2'.
  const visitedDomains = [];
  scraper.fetchCountyRealauction = async (county) => {
    visitedDomains.push(county.domain);
    const id = county.state === 'OH'
      ? `SHERIFF-OH-CUY-CV-26-001`
      : (county.domain.includes('realforeclose') ? 'SHERIFF-FL-HIL-FORE-1' : 'SHERIFF-FL-HIL-DEED-2');
    return [{
      id,
      state: county.state,
      county: county.name,
      address: county.domain.includes('realforeclose') ? '100 Tampa Bay Ave, Tampa, FL 33602' : '200 Public Sq, Cleveland, OH 44114',
      openingBid: 50000,
      sourceUrl: `https://${county.domain}/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=1`,
      raw: 'valid',
      provenance: { origin: 'live', observed: true, publisher: `${county.name} Sheriff`, recordId: id },
    }];
  };

  const out = await scraper.scrapeFeed();
  assert.equal(out.length, 3);
  assert.deepEqual(visitedDomains, [
    'cuyahoga.sheriffsaleauction.ohio.gov',
    'hillsborough.realforeclose.com',
    'hillsborough.realtaxdeed.com',
  ]);
  assert.equal(out.nextContinuationToken, '2', 'rotation offset advances strictly by sliceCount (2), not expanded sibling length');
  assert.equal(scraper.lastRunReport.partialSweep, true);
  assert.equal(scraper.lastRunReport.completedCounties.length, 2);
  const hil = scraper.lastRunReport.completedCounties.find((c) => c.county === 'Hillsborough' && c.state === 'FL');
  assert.ok(hil);
  assert.deepEqual(hil.seenIds.sort(), ['SHERIFF-FL-HIL-DEED-2', 'SHERIFF-FL-HIL-FORE-1']);

  // If one portal of a multi-portal FL county fails, Hillsborough must NOT be emitted in completedCounties.
  const partialFailScraper = new SheriffSaleScraper({
    maxCounties: 2,
    countyOffset: 0,
    counties: [
      { name: 'Cuyahoga', state: 'OH', domain: 'cuyahoga.sheriffsaleauction.ohio.gov' },
      { name: 'Hillsborough', state: 'FL', domain: 'hillsborough.realforeclose.com' },
      { name: 'Hillsborough', state: 'FL', domain: 'hillsborough.realtaxdeed.com' },
    ],
  });
  partialFailScraper.fetchCountyRealauction = async (county) => {
    if (county.domain.includes('realtaxdeed')) {
      throw new Error('Upstream 503');
    }
    const id = county.state === 'OH' ? 'SHERIFF-OH-CUY-CV-26-009' : 'SHERIFF-FL-HIL-FORE-9';
    return [{
      id,
      state: county.state,
      county: county.name,
      address: '300 Bayshore Blvd, Tampa, FL 33606',
      openingBid: 75000,
      sourceUrl: `https://${county.domain}/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&aid=9`,
      raw: 'valid',
      provenance: { origin: 'live', observed: true, publisher: `${county.name} Sheriff`, recordId: id },
    }];
  };
  await partialFailScraper.scrapeFeed();
  assert.deepEqual(
    partialFailScraper.lastRunReport.completedCounties.map((c) => c.county),
    ['Cuyahoga'],
    'Hillsborough must not reconcile absence when one of its portals failed',
  );
});

