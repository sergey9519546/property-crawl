'use strict';

/**
 * test/county_recorders_and_gsa.test.js
 *
 * Comprehensive test suite for:
 * 1. Cook County, IL Pre-Foreclosure Recorder Adapter (cook-recorder.js)
 * 2. Miami-Dade County, FL Lis Pendens & RealTaxDeed Adapter (miami-dade-clerk.js)
 * 3. GSA Auctions Open-Data REST API Integration (adapters/gsa-api.js & gsa.js)
 * 4. Zero-Fabrication Underwriting Invariants (no imputed bids, no manufactured valuations)
 * 5. Robots.txt Compliance (bypasses prohibited /our-listing HTML route)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- 1. Cook County, IL Adapter ---
const {
  COOK_DOC_TYPES,
  COOK_RECORDER_BASE_URL,
  formatCookPin,
  extractCookPin,
  extractCookCaseNumber,
  identifyDistressStage: identifyCookDistressStage,
  cleanCellText: cleanCookText,
  getCookRecorderSearchUrl,
  parseCookRecordRow,
  parseCookSearchHtml,
} = require('../server/scrapers/adapters/cook-recorder');

// --- 2. Miami-Dade County, FL Adapter ---
const {
  MIAMI_DADE_DOC_TYPES,
  MIAMI_DADE_CLERK_BASE_URL,
  MIAMI_DADE_REALTAXDEED_BASE_URL,
  formatMiamiDadeFolio,
  extractMiamiDadeFolio,
  extractMiamiDadeCaseNumber,
  extractMiamiDadeCertificateNumber,
  parseOpeningBid: parseMiamiOpeningBid,
  identifyDistressStage: identifyMiamiDistressStage,
  cleanCellText: cleanMiamiText,
  getMiamiDadeClerkSearchUrl,
  getMiamiDadeTaxDeedUrl,
  parseMiamiDadeTaxDeedCard,
  parseMiamiDadeRecordRow,
  parseMiamiDadeSearchHtml,
} = require('../server/scrapers/adapters/miami-dade-clerk');

// --- 3. GSA Auctions Open-Data API ---
const {
  GSA_API_BASE_URL,
  GSA_API_ENDPOINT,
  GSA_DEFAULT_API_KEY,
  mapGsaPropertyType,
  parseGsaMoney,
  parseGsaClosingDate,
  parseGsaLocation,
  getGsaAuctionsApiUrl,
  standardizeGsaAuctionItem,
  parseGsaAuctionsApiResponse,
  GsaApiAdapter,
} = require('../server/scrapers/adapters/gsa-api');

const { GsaSurplusScraper } = require('../server/scrapers/gsa');

// ============================================================================
// PART 1: Cook County, IL Pre-Foreclosure Recorder Adapter Tests
// ============================================================================

test('Cook County Recorder: defines statutory document types and builds search URLs', () => {
  assert.equal(COOK_DOC_TYPES.LIS_PENDENS, 'LIS PENDENS');
  assert.equal(COOK_DOC_TYPES.LIS_PENDENS_FORECLOSURE, 'LIS PENDENS FORECLOSURE');
  assert.equal(COOK_DOC_TYPES.FORECLOSURE_CHANCERY, 'FORECLOSURE CHANCERY');
  assert.equal(COOK_DOC_TYPES.SHERIFF_SALE_NOTICE, 'SHERIFF SALE NOTICE');
  assert.equal(COOK_DOC_TYPES.SHERIFF_DEED, 'SHERIFF DEED');

  const defaultUrl = getCookRecorderSearchUrl();
  assert.ok(defaultUrl.startsWith(COOK_RECORDER_BASE_URL));
  assert.ok(defaultUrl.includes('docType=LIS%20PENDENS'));

  const pinUrl = getCookRecorderSearchUrl(COOK_DOC_TYPES.LIS_PENDENS_FORECLOSURE, {
    pin: '17-10-305-012-0000',
    caseNumber: '2024-CH-04821',
  });
  assert.ok(pinUrl.includes('docType=LIS%20PENDENS%20FORECLOSURE'));
  assert.ok(pinUrl.includes('pin=17-10-305-012-0000'));
  assert.ok(pinUrl.includes('caseNumber=2024-CH-04821'));

  // Disallows inferring record details from raw recording number without captured URL
  assert.throws(() => getCookRecorderSearchUrl(null, { recordingNumber: '2412345678' }), /captured publisher/);
});

test('Cook County Recorder: PIN formatting and extraction', () => {
  // 14 digits formatting: XX-XX-XXX-XXX-XXXX
  assert.equal(formatCookPin('17103050120000'), '17-10-305-012-0000');
  assert.equal(formatCookPin('17-10-305-012-0000'), '17-10-305-012-0000');
  assert.equal(formatCookPin('17.10.305.012.0000'), '17-10-305-012-0000');

  // 10 digits formatting: XX-XX-XXX-XXX
  assert.equal(formatCookPin('1710305012'), '17-10-305-012');
  assert.equal(formatCookPin('1710305012', { padUnit: true }), '17-10-305-012-0000');

  // Null & invalid handling
  assert.equal(formatCookPin(null), null);
  assert.equal(formatCookPin(undefined), null);
  assert.equal(formatCookPin(''), null);
  assert.equal(formatCookPin('12345'), null);

  // Extraction from prose / tables
  assert.equal(
    extractCookPin('Subject Parcel PIN: 17-10-305-012-0000 located in Chicago'),
    '17-10-305-012-0000'
  );
  assert.equal(
    extractCookPin('Permanent Index Number: 14201000150000'),
    '14-20-100-015-0000'
  );
  assert.equal(
    extractCookPin('Parcel ID 16-25-200-010 in Cook County'),
    '16-25-200-010'
  );
  assert.equal(extractCookPin('No parcel number given in this legal notice'), null);
});

test('Cook County Recorder: Chancery case number extraction', () => {
  assert.equal(extractCookCaseNumber('Case No: 2024-CH-04821'), '2024-CH-04821');
  assert.equal(extractCookCaseNumber('Court Case 2024CH04821 pending'), '2024-CH-04821');
  assert.equal(extractCookCaseNumber('CHANCERY DIVISION 24 CH 1234'), '2024-CH-01234');
  assert.equal(extractCookCaseNumber('Decree entered in 2023-L-005678'), '2023-L-005678');
  assert.equal(extractCookCaseNumber('No case number mentioned here'), null);
});

test('Cook County Recorder: identifies statutory distress stages', () => {
  assert.equal(identifyCookDistressStage('SHERIFF SALE NOTICE'), 'SCHEDULED_AUCTION');
  assert.equal(identifyCookDistressStage('Notice of Sheriff Sale'), 'SCHEDULED_AUCTION');
  assert.equal(identifyCookDistressStage('SHERIFF DEED'), 'SOLD_POST_SALE');
  assert.equal(identifyCookDistressStage("Sheriff's Deed"), 'SOLD_POST_SALE');
  assert.equal(identifyCookDistressStage('CERTIFICATE OF SALE'), 'SOLD_POST_SALE');
  assert.equal(identifyCookDistressStage('LIS PENDENS'), 'PRE_FORECLOSURE');
  assert.equal(identifyCookDistressStage('LIS PENDENS FORECLOSURE'), 'PRE_FORECLOSURE');
  assert.equal(identifyCookDistressStage('FORECLOSURE CHANCERY'), 'PRE_FORECLOSURE');
  assert.equal(identifyCookDistressStage('NOTICE OF DEFAULT'), 'PRE_FORECLOSURE');
});

test('Cook County Recorder: parses Lis Pendens row with zero-fabrication underwriting', () => {
  const rowHtml = `
    <tr class="cook-record-row">
      <td class="col-doc"><b>Doc #:</b> 2419823412<a href="https://recording.cookcountyclerkil.gov/details?id=2419823412"></a></td>
      <td class="col-date"><b>Recorded:</b> 10/18/2026</td>
      <td class="col-type"><b>Doc Type:</b> LIS PENDENS FORECLOSURE</td>
      <td class="col-case"><b>Case #:</b> 2024-CH-04821</td>
      <td class="col-pin"><b>PIN:</b> 17-10-305-012-0000</td>
      <td class="col-plaintiff"><b>Plaintiff:</b> WELLS FARGO BANK, N.A.</td>
      <td class="col-defendant"><b>Defendant:</b> MARTINEZ, CARLOS</td>
      <td class="col-legal"><b>Legal:</b> LOT 14 IN BLOCK 2 IN WEST CHICAGO ADDITION</td>
    </tr>
  `;

  const parsed = parseCookRecordRow(rowHtml);
  assert.ok(parsed);
  assert.equal(parsed.source, 'recorder');
  assert.equal(parsed.platform, 'cook-recorder');
  assert.equal(parsed.county, 'Cook');
  assert.equal(parsed.state, 'IL');
  assert.equal(parsed.documentNumber, '2419823412');
  assert.equal(parsed.recordedDate, '10/18/2026');
  assert.equal(parsed.docType, 'LIS PENDENS FORECLOSURE');
  assert.equal(parsed.distressStage, 'PRE_FORECLOSURE');
  assert.equal(parsed.caseNumber, '2024-CH-04821');
  assert.equal(parsed.pin, '17-10-305-012-0000');
  assert.equal(parsed.apn, '17-10-305-012-0000'); // Pipeline standard alias
  assert.equal(parsed.plaintiff, 'WELLS FARGO BANK, N.A.');
  assert.equal(parsed.grantee, 'WELLS FARGO BANK, N.A.');
  assert.equal(parsed.defendant, 'MARTINEZ, CARLOS');
  assert.equal(parsed.grantor, 'MARTINEZ, CARLOS');
  assert.equal(parsed.legalDescription, 'LOT 14 IN BLOCK 2 IN WEST CHICAGO ADDITION');

  // Zero-Fabrication Invariants: statutory recorder records notice of suit, never an auction bid
  assert.equal(parsed.openingBid, null);
  assert.equal(parsed.estLow, null);
  assert.equal(parsed.estHigh, null);
  assert.equal(parsed.assessed, null);
});

test('Cook County Recorder: parses full search results HTML page', () => {
  const pageHtml = `
    <html>
      <body>
        <table class="search-results">
          <tr class="cook-record-row">
            <td class="col-doc">Doc #: 241001</td>
            <td class="col-date">10/10/2026</td>
            <td class="col-type">LIS PENDENS FORECLOSURE</td>
            <td class="col-case">2024-CH-01111</td>
            <td class="col-pin">14-20-100-015-0000</td>
            <td class="col-plaintiff">JPMORGAN CHASE BANK</td>
            <td class="col-defendant">SMITH, JOHN</td>
          </tr>
          <tr class="cook-record-row">
            <td class="col-doc">Doc #: 241002</td>
            <td class="col-date">10/12/2026</td>
            <td class="col-type">SHERIFF SALE NOTICE</td>
            <td class="col-case">2023-CH-09999</td>
            <td class="col-pin">16-25-200-010-0000</td>
            <td class="col-plaintiff">US BANK NATIONAL ASSN</td>
            <td class="col-defendant">DOE, JANE</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const results = parseCookSearchHtml(pageHtml);
  assert.equal(results.length, 2);
  assert.equal(results[0].caseNumber, '2024-CH-01111');
  assert.equal(results[0].distressStage, 'PRE_FORECLOSURE');
  assert.equal(results[1].caseNumber, '2023-CH-09999');
  assert.equal(results[1].distressStage, 'SCHEDULED_AUCTION');
});

// ============================================================================
// PART 2: Miami-Dade County, FL Lis Pendens & Tax Deed Adapter Tests
// ============================================================================

test('Miami-Dade Adapter: defines document types and URLs', () => {
  assert.equal(MIAMI_DADE_DOC_TYPES.LIS_PENDENS, 'LIS PENDENS');
  assert.equal(MIAMI_DADE_DOC_TYPES.TAX_DEED_SALE, 'TAX DEED SALE');
  assert.equal(MIAMI_DADE_DOC_TYPES.TAX_CERTIFICATE_SALE, 'TAX CERTIFICATE SALE');
  assert.equal(MIAMI_DADE_DOC_TYPES.CERTIFICATE_OF_TITLE, 'CERTIFICATE OF TITLE');

  const clerkUrl = getMiamiDadeClerkSearchUrl({ folio: '30-4018-001-0120' });
  assert.ok(clerkUrl.startsWith(MIAMI_DADE_CLERK_BASE_URL));
  assert.ok(clerkUrl.includes('folio=30-4018-001-0120'));

  const taxDeedUrl = getMiamiDadeTaxDeedUrl({ auctionId: '984512' });
  assert.ok(taxDeedUrl.startsWith(MIAMI_DADE_REALTAXDEED_BASE_URL));
  assert.ok(taxDeedUrl.includes('AID=984512'));
});

test('Miami-Dade Adapter: Folio formatting and extraction', () => {
  // 13-digit Folio: XX-XXXX-XXX-XXXX
  assert.equal(formatMiamiDadeFolio('3040180010120'), '30-4018-001-0120');
  assert.equal(formatMiamiDadeFolio('30-4018-001-0120'), '30-4018-001-0120');
  assert.equal(formatMiamiDadeFolio('0131360240010'), '01-3136-024-0010');

  // Null & invalid handling
  assert.equal(formatMiamiDadeFolio(null), null);
  assert.equal(formatMiamiDadeFolio(''), null);
  assert.equal(formatMiamiDadeFolio('12345'), null);

  // Extraction from prose / tables
  assert.equal(
    extractMiamiDadeFolio('Property Folio: 30-4018-001-0120 in Coral Gables'),
    '30-4018-001-0120'
  );
  assert.equal(
    extractMiamiDadeFolio('Parcel ID: 0131360240010 City of Miami'),
    '01-3136-024-0010'
  );
  assert.equal(extractMiamiDadeFolio('No parcel ID listed in this notice'), null);
});

test('Miami-Dade Adapter: Case number and Certificate extraction', () => {
  // Tax Deed case numbers
  assert.equal(extractMiamiDadeCaseNumber('Tax Deed File: 2024-TX-000123'), '2024-TX-000123');
  assert.equal(extractMiamiDadeCaseNumber('TD File #: TD-2024-000456'), 'TD-2024-000456');

  // Circuit Civil foreclosure cases
  assert.equal(extractMiamiDadeCaseNumber('Case No: 2024-012345-CA-01'), '2024-012345-CA-01');
  assert.equal(extractMiamiDadeCaseNumber('Court Case 2024-CA-009876'), '2024-CA-009876');

  // Tax Sale Certificate numbers
  assert.equal(extractMiamiDadeCertificateNumber('Certificate #: 2021-04512'), '2021-04512');
  assert.equal(extractMiamiDadeCertificateNumber('Tax Cert # 12345-2020'), '12345-2020');
  assert.equal(extractMiamiDadeCertificateNumber('Cert: 887766'), '887766');
});

test('Miami-Dade Adapter: Opening bid parsing', () => {
  assert.equal(parseMiamiOpeningBid('$4,582.19'), 4582.19);
  assert.equal(parseMiamiOpeningBid('12000'), 12000);
  assert.equal(parseMiamiOpeningBid('$0.00'), 0);
  assert.equal(parseMiamiOpeningBid('N/A'), null);
  assert.equal(parseMiamiOpeningBid(null), null);
});

test('Miami-Dade Adapter: parses RealTaxDeed public auction card with statutory opening bid', () => {
  const cardHtml = `
    <table class="ad_tab">
      <tr><td class="AD_LBL">Auction #:</td><td>AID=984512</td></tr>
      <tr><td class="AD_LBL">Tax Deed #:</td><td>2024-TX-000123</td></tr>
      <tr><td class="AD_LBL">Certificate #:</td><td>2021-04512</td></tr>
      <tr><td class="AD_LBL">Folio #:</td><td>30-4018-001-0120</td></tr>
      <tr><td class="AD_LBL">Sale Date:</td><td>11/19/2026</td></tr>
      <tr><td class="AD_LBL">Opening Bid:</td><td>$4,582.19</td></tr>
      <tr><td class="AD_LBL">Legal:</td><td>CORAL GABLES SEC 4 PB 15-42 LOT 12 BLK 3</td></tr>
      <tr><td class="AD_LBL">Applicant:</td><td>MIAMI TAX LIEN INVESTMENTS LLC</td></tr>
      <tr><td class="AD_LBL">Property Address:</td><td>1425 SALZEDO ST, CORAL GABLES, FL 33134</td></tr>
    </table>
  `;

  const parsed = parseMiamiDadeTaxDeedCard(cardHtml);
  assert.ok(parsed);
  assert.equal(parsed.source, 'sheriff');
  assert.equal(parsed.platform, 'realtaxdeed');
  assert.equal(parsed.county, 'Miami-Dade');
  assert.equal(parsed.state, 'FL');
  assert.equal(parsed.auctionId, '984512');
  assert.equal(parsed.caseNumber, '2024-TX-000123');
  assert.equal(parsed.certificateNumber, '2021-04512');
  assert.equal(parsed.folio, '30-4018-001-0120');
  assert.equal(parsed.apn, '30-4018-001-0120');
  assert.equal(parsed.saleDate, '2026-11-19');
  assert.equal(parsed.openingBid, 4582.19);
  assert.equal(parsed.legalDescription, 'CORAL GABLES SEC 4 PB 15-42 LOT 12 BLK 3');
  assert.equal(parsed.distressStage, 'SCHEDULED_AUCTION');
  assert.equal(parsed.sourceUrl, 'https://miamidade.realtaxdeed.com/index.cfm?zaction=AUCTION&zmethod=DETAILS&AID=984512');

  // Zero-Fabrication Invariants: publisher never provides market estimates
  assert.equal(parsed.estLow, null);
  assert.equal(parsed.estHigh, null);
  assert.equal(parsed.assessed, null);
});

test('Miami-Dade Adapter: parses Official Clerk Lis Pendens row with zero-fabrication', () => {
  const rowHtml = `
    <tr class="miamidade-record-row">
      <td class="col-cfn"><b>CFN:</b> 2026R084512<a href="https://onrecords.miamidadeclerk.gov/details?id=2026R084512"></a></td>
      <td class="col-date"><b>Recorded:</b> 10/14/2026</td>
      <td class="col-type"><b>Doc Type:</b> LIS PENDENS</td>
      <td class="col-case"><b>Case #:</b> 2024-012345-CA-01</td>
      <td class="col-folio"><b>Folio:</b> 01-3136-024-0010</td>
      <td class="col-grantor"><b>Grantor:</b> PEREZ, ELENA</td>
      <td class="col-grantee"><b>Grantee:</b> CITIBANK, N.A.</td>
      <td class="col-legal"><b>Legal:</b> BRICKELL BAY VIEW CONDO UNIT 1402</td>
    </tr>
  `;

  const parsed = parseMiamiDadeRecordRow(rowHtml);
  assert.ok(parsed);
  assert.equal(parsed.source, 'recorder');
  assert.equal(parsed.platform, 'miami-dade-clerk');
  assert.equal(parsed.county, 'Miami-Dade');
  assert.equal(parsed.state, 'FL');
  assert.equal(parsed.cfn, '2026R084512');
  assert.equal(parsed.recordedDate, '10/14/2026');
  assert.equal(parsed.docType, 'LIS PENDENS');
  assert.equal(parsed.distressStage, 'PRE_FORECLOSURE');
  assert.equal(parsed.caseNumber, '2024-012345-CA-01');
  assert.equal(parsed.folio, '01-3136-024-0010');
  assert.equal(parsed.apn, '01-3136-024-0010');
  assert.equal(parsed.grantor, 'PEREZ, ELENA');
  assert.equal(parsed.grantee, 'CITIBANK, N.A.');
  assert.equal(parsed.legalDescription, 'BRICKELL BAY VIEW CONDO UNIT 1402');

  // Zero-Fabrication: Lis Pendens has no auction bid and no scheduled sale date
  assert.equal(parsed.openingBid, null);
  assert.equal(parsed.saleDate, null);
  assert.equal(parsed.estLow, null);
  assert.equal(parsed.estHigh, null);
});

// ============================================================================
// PART 3: GSA Auctions Open-Data REST API Integration Tests
// ============================================================================

test('GSA Open-Data API: URL builder strictly targets api.gsa.gov and bypasses /our-listing', () => {
  const url = getGsaAuctionsApiUrl({ apiKey: 'TEST_KEY_123', status: 'active', limit: 50 });
  assert.ok(url.startsWith('https://api.gsa.gov/assets/gsaauctions/v2/auctions'));
  assert.ok(url.includes('api_key=TEST_KEY_123'));
  assert.ok(url.includes('format=json'));
  assert.ok(url.includes('status=active'));
  assert.ok(url.includes('limit=50'));

  // Strictly obeys robots.txt: never points to realestatesales.gov/our-listing
  assert.ok(!url.includes('/our-listing'));
  assert.ok(!url.includes('realestatesales.gov'));
});

test('GSA Open-Data API: property type mapping', () => {
  assert.equal(mapGsaPropertyType('Commercial Real Estate'), 'Commercial');
  assert.equal(mapGsaPropertyType('Vacant Land / 12 Acres'), 'Land');
  assert.equal(mapGsaPropertyType('Office Building'), 'Office');
  assert.equal(mapGsaPropertyType('Single Family Residence'), 'Single Family');
  assert.equal(mapGsaPropertyType('Warehouse / Industrial'), 'Warehouse');
  assert.equal(mapGsaPropertyType('Residential Condo'), 'Condo');
  assert.equal(mapGsaPropertyType('Unknown Item Category'), 'Unknown');
});

test('GSA Open-Data API: location parsing handles structured fields and fallback prose', () => {
  // Structured fields
  const loc1 = parseGsaLocation({
    itemCity: 'Laredo',
    itemState: 'Texas',
    itemZip: '78040-1234',
    itemStreet: '123 Main St',
  });
  assert.equal(loc1.city, 'Laredo');
  assert.equal(loc1.state, 'TX');
  assert.equal(loc1.zip, '78040');
  assert.equal(loc1.street, '123 Main St');

  // Fallback from property description
  const loc2 = parseGsaLocation({
    propertyDescription: 'Former Federal Courthouse, 450 Golden Gate Ave, San Francisco, CA 94102. 120,000 sq ft.',
  });
  assert.equal(loc2.city, 'San Francisco');
  assert.equal(loc2.state, 'CA');
  assert.equal(loc2.zip, '94102');
  assert.equal(loc2.street, '450 Golden Gate Ave');
});

test('GSA Open-Data API: standardizes single auction item with zero-fabrication', () => {
  const rawItem = {
    auctionNumber: '1-FT-1234-A',
    propertyDescription: 'Former Border Patrol Facility, 123 Main St, Laredo, TX 78040. 3,500 sq ft office on 1.2 acres.',
    currentBid: 150000,
    openingBid: 50000,
    closingDate: '2026-12-15T17:00:00Z',
    itemCity: 'Laredo',
    itemState: 'TX',
    itemZip: '78040',
    itemStreet: '123 Main St',
    propertyType: 'Commercial',
    bidsPlaced: 7,
    reserveMet: true,
  };

  const standardized = standardizeGsaAuctionItem(rawItem);
  assert.ok(standardized);
  assert.equal(standardized.source, 'gsa');
  assert.equal(standardized.auctionNumber, '1-FT-1234-A');
  assert.equal(standardized.state, 'TX');
  assert.equal(standardized.city, 'Laredo');
  assert.equal(standardized.zip, '78040');
  assert.equal(standardized.address, '123 Main St');
  assert.equal(standardized.propType, 'Commercial');
  assert.equal(standardized.sqft, 3500);
  assert.equal(standardized.openingBid, 50000);
  assert.equal(standardized.currentBid, 150000);
  assert.equal(standardized.price, 150000);
  assert.equal(standardized.saleDate, '2026-12-15T17:00:00.000Z');

  // Zero-Fabrication Invariants: Never impute estimated valuations from bids
  assert.equal(standardized.estLow, null);
  assert.equal(standardized.estHigh, null);
  assert.equal(standardized.assessed, null);

  // Provenance contains API endpoint and confirms robots compliance
  assert.equal(standardized.provenance.sourceFacts.apiEndpoint, 'api.gsa.gov/assets/gsaauctions/v2/auctions');
  assert.equal(standardized.provenance.sourceFacts.robotsCompliant, true);
  assert.equal(standardized.provenance.sourceFacts.forbiddenPathBypassed, '/our-listing');
});

test('GSA Open-Data API: parses full JSON API payload and filters non-real-estate items', () => {
  const apiPayload = {
    auctions: [
      {
        auctionNumber: '1-RE-001',
        propertyDescription: 'Surplus Federal Office Building, 100 Main St, Austin, TX 78701',
        itemCity: 'Austin',
        itemState: 'TX',
        itemZip: '78701',
        itemStreet: '100 Main St',
        propertyType: 'Office',
        currentBid: 500000,
        closingDate: '2026-11-30T18:00:00Z',
      },
      {
        auctionNumber: '2-VEH-999',
        propertyDescription: '2020 Ford F-150 Pickup Truck',
        propertyType: 'Vehicles',
        currentBid: 12000,
      },
      {
        auctionNumber: '3-RE-002',
        propertyDescription: 'Former Radio Tower Land Parcel, Highway 9, Reno, NV 89501. 5.4 acres.',
        itemCity: 'Reno',
        itemState: 'NV',
        itemZip: '89501',
        propertyType: 'Land',
        currentBid: 75000,
        closingDate: '2026-12-01T20:00:00Z',
      },
    ],
  };

  const parsed = parseGsaAuctionsApiResponse(apiPayload);
  assert.equal(parsed.totalCount, 3);
  assert.equal(parsed.emittedCount, 2); // 2 real estate auctions emitted
  assert.equal(parsed.rejected.length, 1); // 1 vehicle auction rejected
  assert.equal(parsed.rejected[0].auctionNumber, '2-VEH-999');
  assert.equal(parsed.rejected[0].reason, 'non_real_estate_category');

  assert.equal(parsed.items[0].auctionNumber, '1-RE-001');
  assert.equal(parsed.items[0].propType, 'Office');
  assert.equal(parsed.items[1].auctionNumber, '3-RE-002');
  assert.equal(parsed.items[1].propType, 'Land');
});

test('GsaApiAdapter: fetches auctions using injected transport', async () => {
  const mockPayload = {
    auctions: [
      {
        auctionNumber: 'GSA-TEST-1',
        propertyDescription: 'Surplus Substation, 200 Oak St, Chicago, IL 60601',
        itemCity: 'Chicago',
        itemState: 'IL',
        itemZip: '60601',
        itemStreet: '200 Oak St',
        propertyType: 'Commercial',
        currentBid: 250000,
        closingDate: '2026-12-20T12:00:00Z',
      },
    ],
  };

  let requestedUrl = null;
  const adapter = new GsaApiAdapter({
    apiKey: 'INJECTED_KEY',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return JSON.stringify(mockPayload);
    },
  });

  const listings = await adapter.fetchAuctions();
  assert.ok(requestedUrl);
  assert.ok(requestedUrl.includes('api_key=INJECTED_KEY'));
  assert.ok(!requestedUrl.includes('/our-listing'));

  assert.equal(listings.length, 1);
  assert.equal(listings[0].auctionNumber, 'GSA-TEST-1');
  assert.equal(listings[0].state, 'IL');
  assert.equal(listings[0].currentBid, 250000);
});

test('GsaSurplusScraper: scrapeApi runs cleanly and bypasses /our-listing', async () => {
  const mockPayload = {
    auctions: [
      {
        auctionNumber: '1-TX-500',
        propertyDescription: 'Former Border Patrol Outpost, 500 River Rd, McAllen, TX 78501',
        itemCity: 'McAllen',
        itemState: 'TX',
        itemZip: '78501',
        itemStreet: '500 River Rd',
        propertyType: 'Commercial',
        currentBid: 180000,
        closingDate: '2026-11-25T16:00:00Z',
      },
    ],
  };

  let fetchedUrl = null;
  const scraper = new GsaSurplusScraper({
    useApi: true,
    apiFetchImpl: async (url) => {
      fetchedUrl = url;
      return JSON.stringify(mockPayload);
    },
  });

  const listings = await scraper.scrapeFeed();
  assert.ok(fetchedUrl);
  assert.ok(fetchedUrl.includes('api.gsa.gov/assets/gsaauctions/v2/auctions'));
  assert.ok(!fetchedUrl.includes('/our-listing'));

  assert.equal(listings.length, 1);
  assert.equal(listings[0].provenance.recordId, '1-TX-500');
  assert.equal(listings[0].provenance.sourceFacts.auctionNumber, '1-TX-500');
  assert.equal(listings[0].state, 'TX');
  assert.equal(listings[0].price, 180000);

  // Check lastRunReport
  const report = scraper.lastRunReport;
  assert.ok(report);
  assert.equal(report.outcome, 'success');
  assert.equal(report.sweepType, 'open_data_api');
  assert.equal(report.robotsExclusion.bypassedVia, 'api.gsa.gov');
  assert.equal(report.recordsEmitted, 1);
});
