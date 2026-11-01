'use strict';

/**
 * test/recorder_platform_adapters.test.js
 *
 * Comprehensive test suite for Pre-Foreclosure, Notice of Trustee Sale,
 * and Lis Pendens County Recorder Platform Adapters:
 * 1. Maricopa County, AZ Recorder (recorder.maricopa.gov)
 * 2. Harris County, TX County Clerk Foreclosure Postings (cclerk.hctx.net)
 * 3. Zero-fabrication invariants (no imputed bids, no manufactured valuations)
 * 4. URL inspection validity via inspectSourceRecordUrl('trustee', url)
 * 5. TrusteeSaleScraper end-to-end multi-jurisdiction scrapeFeed wiring
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { inspectSourceRecordUrl, SOURCE_HOSTS } = require('../server/scrapers/source-policy');
const {
  MARICOPA_DOC_TYPES,
  getMaricopaSearchUrl,
  cleanCellText: cleanMaricopaText,
  identifyDistressStage,
  parseMaricopaRecordRow,
  parseMaricopaSearchHtml,
} = require('../server/scrapers/adapters/maricopa-recorder');

const {
  HARRIS_DOC_TYPES,
  getFirstTuesdayOfMonth,
  calculateTexasForeclosureSaleDate,
  cleanCellText: cleanHarrisText,
  getHarrisClerkSearchUrl,
  parseHarrisClerkNotice,
  parseHarrisClerkHtml,
} = require('../server/scrapers/adapters/harris-clerk-foreclosure');

const trustee = require('../server/scrapers/trustee');

// ---------------------------------------------------------------------------
// 1. Maricopa County, AZ Recorder Adapter Tests
// ---------------------------------------------------------------------------

test('Maricopa Recorder adapter defines statutory document types and builds URLs', () => {
  assert.equal(MARICOPA_DOC_TYPES.NOTICE_OF_TRUSTEE_SALE, 'NOTICE OF TRUSTEE SALE');
  assert.equal(MARICOPA_DOC_TYPES.NOTICE_OF_DEFAULT, 'NOTICE OF DEFAULT');
  assert.equal(MARICOPA_DOC_TYPES.CERTIFICATE_OF_SALE, 'CERTIFICATE OF SALE');
  assert.equal(MARICOPA_DOC_TYPES.LIS_PENDENS, 'LIS PENDENS');

  const defaultUrl = getMaricopaSearchUrl();
  assert.ok(defaultUrl.startsWith('https://recorder.maricopa.gov'));
  assert.ok(defaultUrl.includes('docType=NOTICE%20OF%20TRUSTEE%20SALE'));

  const nodUrl = getMaricopaSearchUrl(MARICOPA_DOC_TYPES.NOTICE_OF_DEFAULT);
  assert.ok(nodUrl.includes('docType=NOTICE%20OF%20DEFAULT'));

  const detailUrl = getMaricopaSearchUrl(null, { recordingNumber: '2026-084912' });
  assert.equal(detailUrl, 'https://recorder.maricopa.gov/details?id=2026-084912');
});

test('Maricopa Recorder correctly classifies statutory distress stages', () => {
  assert.equal(identifyDistressStage('NOTICE OF TRUSTEE SALE'), 'SCHEDULED_AUCTION');
  assert.equal(identifyDistressStage('Trustee Sale Notice'), 'SCHEDULED_AUCTION');
  assert.equal(identifyDistressStage('CERTIFICATE OF SALE'), 'SOLD_POST_SALE');
  assert.equal(identifyDistressStage('Sheriff Certificate'), 'SOLD_POST_SALE');
  assert.equal(identifyDistressStage('NOTICE OF DEFAULT'), 'PRE_FORECLOSURE');
  assert.equal(identifyDistressStage('LIS PENDENS'), 'PRE_FORECLOSURE');
  assert.equal(identifyDistressStage('Unknown Notice'), 'PRE_FORECLOSURE');
});

test('Maricopa Recorder parses Notice of Trustee Sale table row into structured record', () => {
  const rowHtml = `
    <tr class="maricopa-record-row">
      <td class="col-recording"><b>Recording #:</b> 2026-084912</td>
      <td class="col-date"><b>Recorded:</b> 10/14/2026</td>
      <td class="col-type"><b>Doc Type:</b> NOTICE OF TRUSTEE SALE</td>
      <td class="col-grantor"><b>Grantor:</b> Alvarez, Carlos<br>AKA Carlos M Alvarez</td>
      <td class="col-grantee"><b>Grantee:</b> Clear Recon Corp</td>
      <td class="col-apn"><b>APN:</b> 134-22-108</td>
      <td class="col-legal"><b>Legal:</b> Lot 18, Block 4, Desert Ridge Parcels</td>
    </tr>
  `;

  const record = parseMaricopaRecordRow(rowHtml);
  assert.ok(record);
  assert.equal(record.source, 'recorder');
  assert.equal(record.platform, 'maricopa-recorder');
  assert.equal(record.county, 'Maricopa');
  assert.equal(record.state, 'AZ');
  assert.equal(record.recordingNumber, '2026-084912');
  assert.equal(record.recordedDate, '10/14/2026');
  assert.equal(record.docType, 'NOTICE OF TRUSTEE SALE');
  assert.equal(record.distressStage, 'SCHEDULED_AUCTION');
  assert.equal(record.grantor, 'Alvarez, Carlos');
  assert.equal(record.grantee, 'Clear Recon Corp');
  assert.equal(record.apn, '134-22-108');
  assert.equal(record.legalDescription, 'Lot 18, Block 4, Desert Ridge Parcels');
  assert.equal(record.sourceUrl, 'https://recorder.maricopa.gov/details?id=2026-084912');

  // Zero-fabrication check
  assert.equal(record.openingBid, null);
  assert.equal(record.estLow, null);
  assert.equal(record.estHigh, null);
  assert.equal(record.assessed, null);
});

test('Maricopa Recorder parses full search result HTML containing multiple filings', () => {
  const searchHtml = `
    <div class="search-results-table">
      <div class="search-result-row">
        Recording #: 2026-011111
        Recorded: 10/10/2026
        Doc Type: NOTICE OF TRUSTEE SALE
        Grantor: Smith, Roger
        Grantee: Quality Loan Service Corp
        APN: 215-08-012
        Legal: Lot 5 Mountain Vista
      </div>
      <div class="search-result-row">
        Recording #: 2026-022222
        Recorded: 10/11/2026
        Doc Type: NOTICE OF DEFAULT
        Grantor: Johnson, Brenda
        Grantee: Trustee Services Inc
        APN: 142-33-890
        Legal: Lot 12 Sunburst Valley
      </div>
      <div class="search-result-row">
        Recording #: 2026-033333
        Recorded: 10/12/2026
        Doc Type: CERTIFICATE OF SALE
        Grantor: Williams, Kevin
        Grantee: Apex Real Estate Holdings
        APN: 108-14-551
        Legal: Unit 302 Camelback Condos
      </div>
    </div>
  `;

  const results = parseMaricopaSearchHtml(searchHtml);
  assert.equal(results.length, 3);

  assert.equal(results[0].recordingNumber, '2026-011111');
  assert.equal(results[0].distressStage, 'SCHEDULED_AUCTION');
  assert.equal(results[0].grantor, 'Smith, Roger');
  assert.equal(results[0].apn, '215-08-012');

  assert.equal(results[1].recordingNumber, '2026-022222');
  assert.equal(results[1].distressStage, 'PRE_FORECLOSURE');
  assert.equal(results[1].grantor, 'Johnson, Brenda');
  assert.equal(results[1].apn, '142-33-890');

  assert.equal(results[2].recordingNumber, '2026-033333');
  assert.equal(results[2].distressStage, 'SOLD_POST_SALE');
  assert.equal(results[2].grantor, 'Williams, Kevin');
  assert.equal(results[2].apn, '108-14-551');
});

// ---------------------------------------------------------------------------
// 2. Harris County, TX Clerk Foreclosure Notice Adapter Tests
// ---------------------------------------------------------------------------

test('getFirstTuesdayOfMonth calculates exact First Tuesday per Tex. Prop. Code § 51.002', () => {
  // October 2026: Oct 1 is Thu -> Oct 6 is Tue
  assert.equal(getFirstTuesdayOfMonth(2026, 10), '2026-10-06');
  // November 2026: Nov 1 is Sun -> Nov 3 is Tue
  assert.equal(getFirstTuesdayOfMonth(2026, 11), '2026-11-03');
  // December 2026: Dec 1 is Tue -> Dec 1 is Tue
  assert.equal(getFirstTuesdayOfMonth(2026, 12), '2026-12-01');
  // January 2027: Jan 1 is Fri -> Jan 5 is Tue
  assert.equal(getFirstTuesdayOfMonth(2027, 1), '2027-01-05');
  // February 2027: Feb 1 is Mon -> Feb 2 is Tue
  assert.equal(getFirstTuesdayOfMonth(2027, 2), '2027-02-02');
});

test('calculateTexasForeclosureSaleDate enforces statutory 21-day notice rule', () => {
  // Case A: Posted 2026-10-01
  // 10/01 + 21 days = 10/22/2026.
  // Oct First Tuesday (10/06) has passed.
  // Nov First Tuesday is 11/03/2026 (>= 10/22, 33 days notice).
  // Statutory sale date is 2026-11-03.
  assert.equal(calculateTexasForeclosureSaleDate('10/01/2026'), '2026-11-03');
  assert.equal(calculateTexasForeclosureSaleDate('2026-10-01'), '2026-11-03');

  // Case B: Posted 2026-10-15
  // 10/15 + 21 days = 11/05/2026.
  // Nov First Tuesday (11/03) is < 11/05 (only 19 days notice, violates 21-day statutory rule).
  // Rolls over to December First Tuesday: 2026-12-01.
  assert.equal(calculateTexasForeclosureSaleDate('10/15/2026'), '2026-12-01');
  assert.equal(calculateTexasForeclosureSaleDate('2026-10-15'), '2026-12-01');

  // Case C: Exact boundary test: posted 2026-10-13
  // 10/13 + 21 days = 11/03/2026 (exactly 21 days).
  // Nov First Tuesday (11/03) satisfies >= 11/03.
  assert.equal(calculateTexasForeclosureSaleDate('10/13/2026'), '2026-11-03');

  // Case D: Year transition test: posted 2026-12-20
  // 12/20 + 21 days = 2027-01-10.
  // Jan First Tuesday (2027-01-05) is < Jan 10.
  // Rolls over to February 2027 First Tuesday: 2027-02-02.
  assert.equal(calculateTexasForeclosureSaleDate('2026-12-20'), '2027-02-02');

  // Edge cases: null or invalid inputs return null
  assert.equal(calculateTexasForeclosureSaleDate(null), null);
  assert.equal(calculateTexasForeclosureSaleDate(''), null);
  assert.equal(calculateTexasForeclosureSaleDate('not-a-date'), null);
});

test('Harris County Clerk parses § 51.002 21-day foreclosure posting into structured record', () => {
  const noticeHtml = `
    <tr class="harris-notice-row">
      <td class="col-file"><b>File #:</b> FC-2026-009182</td>
      <td class="col-post"><b>Posting Date:</b> 10/05/2026</td>
      <td class="col-debtor"><b>Debtor:</b> Henderson, Derrick</td>
      <td class="col-trustee"><b>Substitute Trustee:</b> Hughes Watters Askanase LLP</td>
      <td class="col-situs"><b>Property Address:</b> 4120 Westheimer Rd, Houston, TX 77027</td>
      <td class="col-hcad"><b>HCAD Account:</b> 041-012-000-0042</td>
    </tr>
  `;

  const parsed = parseHarrisClerkNotice(noticeHtml);
  assert.ok(parsed);
  assert.equal(parsed.source, 'recorder');
  assert.equal(parsed.platform, 'harris-clerk-foreclosure');
  assert.equal(parsed.county, 'Harris');
  assert.equal(parsed.state, 'TX');
  assert.equal(parsed.fileNumber, 'FC-2026-009182');
  assert.equal(parsed.postingDate, '10/05/2026');
  // 10/05 + 21 days = 10/26 -> First Tuesday of November is 2026-11-03
  assert.equal(parsed.saleDate, null);
    assert.equal(parsed.earliestEligibleSaleDate, '2026-11-03');
  assert.equal(parsed.debtor, 'Henderson, Derrick');
  assert.equal(parsed.trustee, 'Hughes Watters Askanase LLP');
  assert.equal(parsed.situsAddress, '4120 Westheimer Rd, Houston, TX 77027');
  assert.equal(parsed.apn, '041-012-000-0042');
  assert.equal(parsed.docType, 'NOTICE OF FORECLOSURE SALE');
  assert.equal(parsed.distressStage, 'SCHEDULED_AUCTION');
  assert.equal(
    parsed.sourceUrl,
    'https://www.cclerk.hctx.net/Foreclosure/details?id=FC-2026-009182'
  );

  // Zero-fabrication guarantees
  assert.equal(parsed.openingBid, null);
  assert.equal(parsed.estLow, null);
  assert.equal(parsed.estHigh, null);
  assert.equal(parsed.assessed, null);
});

test('Harris County Clerk parses multi-notice HTML feed', () => {
  const multiHtml = `
    <div class="notices-container">
      <div class="NoticeItem">
        File #: FC-2026-001001
        Posting Date: 10/02/2026
        Debtor: Martinez, Elena
        Substitute Trustee: Mackie Wolf Zientz & Mann PC
        Property Address: 7810 Bellaire Blvd, Houston, TX 77036
        HCAD Account: 078-024-001-0019
      </div>
      <div class="NoticeItem">
        File #: FC-2026-001002
        Posting Date: 10/16/2026
        Debtor: Taylor, Gregory
        Substitute Trustee: Barrett Daffin Frappier Turner & Engel LLP
        Property Address: 1400 Post Oak Blvd, Houston, TX 77056
        HCAD Account: 099-012-005-0001
      </div>
    </div>
  `;

  const notices = parseHarrisClerkHtml(multiHtml);
  assert.equal(notices.length, 2);

  // Notice 1: Posted 10/02 -> Sale 2026-11-03
  assert.equal(notices[0].fileNumber, 'FC-2026-001001');
  assert.equal(notices[0].saleDate, null);
    assert.equal(notices[0].earliestEligibleSaleDate, '2026-11-03');
  assert.equal(notices[0].debtor, 'Martinez, Elena');
  assert.equal(notices[0].situsAddress, '7810 Bellaire Blvd, Houston, TX 77036');

  // Notice 2: Posted 10/16 -> 21 days is 11/06 -> Sale rolls over to 2026-12-01
  assert.equal(notices[1].fileNumber, 'FC-2026-001002');
  assert.equal(notices[1].saleDate, null);
    assert.equal(notices[1].earliestEligibleSaleDate, '2026-12-01');
  assert.equal(notices[1].debtor, 'Taylor, Gregory');
});

// ---------------------------------------------------------------------------
// 3. Zero-Fabrication Guarantees (No Imputed Bids, No Bleed, Strict Nulls)
// ---------------------------------------------------------------------------

test('Zero-Fabrication Invariant: Maricopa & Harris adapters never manufacture opening bids or valuations', () => {
  const maricopaRow = `
    <tr>
      <td>Recording #: 2026-099444</td>
      <td>Recorded: 10/18/2026</td>
      <td>Doc Type: NOTICE OF TRUSTEE SALE</td>
      <td>Grantor: Unencumbered Estate</td>
    </tr>
  `;
  const mRecord = parseMaricopaRecordRow(maricopaRow);
  assert.ok(mRecord);
  assert.equal(mRecord.openingBid, null, 'Opening bid must remain strictly null');
  assert.equal(mRecord.estLow, null, 'estLow must remain strictly null');
  assert.equal(mRecord.estHigh, null, 'estHigh must remain strictly null');
  assert.equal(mRecord.assessed, null, 'assessed must remain strictly null');
  assert.equal(mRecord.apn, null, 'Unspecified APN must be strictly null');

  const hharrisNotice = `
    <div>
      File #: FC-2026-778899
      Posting Date: 10/07/2026
      Debtor: Lone Star Holdings
    </div>
  `;
  const hRecord = parseHarrisClerkNotice(hharrisNotice);
  assert.ok(hRecord);
  assert.equal(hRecord.openingBid, null, 'Harris opening bid must remain strictly null');
  assert.equal(hRecord.estLow, null);
  assert.equal(hRecord.estHigh, null);
  assert.equal(hRecord.assessed, null);
  assert.equal(hRecord.apn, null);
  assert.equal(hRecord.situsAddress, null);

  // Unparseable empty/junk rows return null without creating ghost listings
  assert.equal(parseMaricopaRecordRow('<tr><td>Blank footer</td></tr>'), null);
  assert.equal(parseHarrisClerkNotice('<div>Non-notice banner disclaimer</div>'), null);
});

// ---------------------------------------------------------------------------
// 4. Source Policy & URL Inspection Validity
// ---------------------------------------------------------------------------

test('inspectSourceRecordUrl validates Maricopa and Harris County trustee records', () => {
  // Allowlist includes recorder.maricopa.gov and cclerk.hctx.net
  assert.ok(SOURCE_HOSTS.trustee.includes('recorder.maricopa.gov'));
  assert.ok(SOURCE_HOSTS.trustee.includes('cclerk.hctx.net'));

  // Valid Maricopa County Recorder record URL
  const maricopaUrl = 'https://recorder.maricopa.gov/details?id=2026-084912';
  const mInspection = inspectSourceRecordUrl('trustee', maricopaUrl);
  assert.equal(mInspection.isValid, true);
  assert.equal(mInspection.error, null);

  // Valid Harris County Clerk Foreclosure record URL
  const harrisUrl = 'https://www.cclerk.hctx.net/Foreclosure/details?id=FC-2026-009182';
  const hInspection = inspectSourceRecordUrl('trustee', harrisUrl);
  assert.equal(hInspection.isValid, true);
  assert.equal(hInspection.error, null);

  // Valid Clark County NV AcclaimWeb record URL (existing baseline)
  const clarkUrl = 'https://recorder.clarkcountynv.gov/AcclaimWeb/details?id=20261008%3A009412';
  const cInspection = inspectSourceRecordUrl('trustee', clarkUrl);
  assert.equal(cInspection.isValid, true);

  // Untrusted foreign host fails closed
  const fakeMaricopa = 'https://fake-maricopa.recorder.com/details?id=2026-084912';
  const fakeInspection = inspectSourceRecordUrl('trustee', fakeMaricopa);
  assert.equal(fakeInspection.isValid, false);
  assert.equal(fakeInspection.error, 'source_host_mismatch');

  // Generic non-record search endpoint fails shape check
  const searchUrl = 'https://recorder.maricopa.gov/recdoc/search';
  const sInspection = inspectSourceRecordUrl('trustee', searchUrl);
  assert.equal(sInspection.isValid, false);
  assert.equal(sInspection.error, 'source_url_not_exact_record');
});

// ---------------------------------------------------------------------------
// 5. TrusteeSaleScraper Multi-Jurisdiction Integration Tests
// ---------------------------------------------------------------------------

test('TrusteeSaleScraper integrates Maricopa County recorder filings in scrapeFeed', async () => {
  const maricopaHtml = `
    <table id="tblSearchResults">
      <tr class="search-result-row">
        <td class="col-recording">Recording #: 2026-091482</td>
        <td class="col-date">Recorded: 10/14/2026</td>
        <td class="col-type">Doc Type: NOTICE OF TRUSTEE SALE</td>
        <td class="col-grantor">Grantor: Martinez, David</td>
        <td class="col-grantee">Grantee: Quality Loan Service Corp</td>
        <td class="col-apn">APN: 162-23-410</td>
        <td class="col-legal">Legal: Lot 44 North Phoenix Vista</td>
      </tr>
    </table>
  `;

  const origFetch = trustee.fetchText;
  try {
    trustee.fetchText = async () => maricopaHtml;

    const listings = await trustee.scrapeFeed({ jurisdiction: 'maricopa' });
    assert.equal(listings.length, 1);

    const l = listings[0];
    assert.equal(l.id, 'TRUSTEE-AZ-MAR-2026-091482');
    assert.equal(l.source, 'trustee');
    assert.equal(l.state, 'AZ');
    assert.equal(l.county, 'Maricopa');
    assert.equal(l.openingBid, null, 'Zero-fabrication: openingBid is strictly null');
    assert.equal(l.provenance.sourceFacts.apn, '162-23-410');
    assert.ok(l.parcelKey, 'Parcel key should be attached from APN');
    assert.equal(l.plaintiff, 'Quality Loan Service Corp');
    assert.equal(l.defendant, 'Martinez, David');
    assert.equal(l.provenance.publisher, 'Maricopa County Recorder');
    assert.equal(l.provenance.platform, 'maricopa-recorder');
    assert.equal(l.provenance.recordId, '2026-091482');
    assert.equal(l.provenance.sourceFacts.distressStage, 'SCHEDULED_AUCTION');

    const inspection = inspectSourceRecordUrl('trustee', l.sourceUrl);
    assert.equal(inspection.isValid, true);
    assert.equal(trustee.lastRunReport.outcome, 'success');
  } finally {
    trustee.fetchText = origFetch;
  }
});

test('TrusteeSaleScraper integrates Harris County foreclosure notice filings in scrapeFeed', async () => {
  const harrisHtml = `
    <div class="NoticeContainer">
      <div class="NoticeItem">
        File #: FC-2026-004412
        Posting Date: 10/06/2026
        Debtor: Robinson, Keith
        Substitute Trustee: Barrett Daffin Frappier Turner & Engel LLP
        Property Address: 5500 Richmond Ave, Houston, TX 77056
        HCAD Account: 088-014-002-0010
      </div>
    </div>
  `;

  const origFetch = trustee.fetchText;
  try {
    trustee.fetchText = async () => harrisHtml;

    const listings = await trustee.scrapeFeed({ jurisdiction: 'harris' });
    assert.equal(listings.length, 1);

    const l = listings[0];
    assert.equal(l.id, 'TRUSTEE-TX-HAR-FC-2026-004412');
    assert.equal(l.source, 'trustee');
    assert.equal(l.state, 'TX');
    assert.equal(l.county, 'Harris');
    assert.equal(l.city, 'Houston');
    assert.equal(l.openingBid, null, 'Zero-fabrication: openingBid is strictly null');
    assert.equal(l.saleDate, null);
    assert.equal(l.provenance.sourceFacts.earliestEligibleSaleDate, '2026-11-03');
    assert.equal(l.provenance.sourceFacts.apn, '088-014-002-0010');
    assert.ok(l.parcelKey, 'Parcel key should be attached from HCAD account');
    assert.equal(l.plaintiff, 'Barrett Daffin Frappier Turner & Engel LLP');
    assert.equal(l.defendant, 'Robinson, Keith');
    assert.equal(l.provenance.publisher, 'Harris County Clerk');
    assert.equal(l.provenance.platform, 'harris-clerk-foreclosure');
    assert.equal(l.provenance.recordId, 'FC-2026-004412');
    assert.equal(l.provenance.sourceFacts.distressStage, 'SCHEDULED_AUCTION');

    const inspection = inspectSourceRecordUrl('trustee', l.sourceUrl);
    assert.equal(inspection.isValid, true);
    assert.equal(trustee.lastRunReport.outcome, 'success');
  } finally {
    trustee.fetchText = origFetch;
  }
});
