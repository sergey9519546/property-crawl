'use strict';

/**
 * test/scrapers/la-recorder.test.js
 *
 * Unit tests for server/scrapers/adapters/la-recorder.js
 * Tests: AIN formatting/extraction, case number extraction, distress stage
 * identification, opening bid zero-fabrication, URL building, HTML parsing.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LA_DOC_TYPES,
  LA_RECORDER_BASE_URL,
  formatLaAin,
  extractLaAin,
  extractLaCaseNumber,
  identifyDistressStage,
  parseOpeningBid,
  getLaRecorderSearchUrl,
  parseLaRecordRow,
  parseLaSearchHtml,
} = require('../../server/scrapers/adapters/la-recorder');

// ---------------------------------------------------------------------------
// formatLaAin
// ---------------------------------------------------------------------------

test('formatLaAin: normalizes 10 raw digits to XXXX-XXX-XXX', () => {
  assert.equal(formatLaAin('5001003002'), '5001-003-002');
});

test('formatLaAin: normalizes 9 raw digits to XXX-XXX-XXX', () => {
  assert.equal(formatLaAin('500100302'), '500-100-302');
});

test('formatLaAin: normalizes already-dashed XXXX-XXX-XXX passthrough', () => {
  assert.equal(formatLaAin('5001-003-002'), '5001-003-002');
});

test('formatLaAin: strips non-digit characters before normalizing', () => {
  assert.equal(formatLaAin('5001 003 002'), '5001-003-002');
});

test('formatLaAin: returns null for null input', () => {
  assert.equal(formatLaAin(null), null);
});

test('formatLaAin: returns null for undefined input', () => {
  assert.equal(formatLaAin(undefined), null);
});

test('formatLaAin: returns null for short digit strings (< 7)', () => {
  assert.equal(formatLaAin('123'), null);
});

// ---------------------------------------------------------------------------
// extractLaAin
// ---------------------------------------------------------------------------

test('extractLaAin: extracts AIN from labeled text', () => {
  const result = extractLaAin('AIN: 5001-003-002');
  assert.equal(result, '5001-003-002');
});

test('extractLaAin: extracts APN from parcel labeled text', () => {
  const result = extractLaAin('Assessor Parcel Number: 5001003002');
  assert.equal(result, '5001-003-002');
});

test('extractLaAin: extracts bare dashed pattern from text', () => {
  const result = extractLaAin('Property located per AIN 2045-018-007 in LA County.');
  assert.equal(result, '2045-018-007');
});

test('extractLaAin: returns null for null/empty input', () => {
  assert.equal(extractLaAin(null), null);
  assert.equal(extractLaAin(''), null);
});

test('extractLaAin: returns null when no AIN present', () => {
  assert.equal(extractLaAin('No parcel information here.'), null);
});

// ---------------------------------------------------------------------------
// extractLaCaseNumber
// ---------------------------------------------------------------------------

test('extractLaCaseNumber: extracts TS# reference', () => {
  const result = extractLaCaseNumber('T.S. No. 2024-05678 recorded with LA County.');
  assert.ok(result, 'should return a case number');
  assert.match(result, /2024/);
});

test('extractLaCaseNumber: extracts trustee sale number with TS# prefix', () => {
  const result = extractLaCaseNumber('TS# 20240001234 Trustee Sale scheduled.');
  assert.ok(result, 'should return a case number');
  assert.match(result, /20240001234/);
});

test('extractLaCaseNumber: extracts CA-style reference', () => {
  const result = extractLaCaseNumber('Reference: CA-24-001234-CL on this recording.');
  assert.ok(result, 'should return a case number');
  assert.match(result, /CA/i);
});

test('extractLaCaseNumber: returns null for empty input', () => {
  assert.equal(extractLaCaseNumber(''), null);
  assert.equal(extractLaCaseNumber(null), null);
});

test('extractLaCaseNumber: returns null when no case number present', () => {
  assert.equal(extractLaCaseNumber('No case references here at all.'), null);
});

// ---------------------------------------------------------------------------
// identifyDistressStage
// ---------------------------------------------------------------------------

test('identifyDistressStage: NOD maps to pre-foreclosure', () => {
  assert.equal(identifyDistressStage('NOTICE OF DEFAULT'), 'pre-foreclosure');
});

test('identifyDistressStage: NTS maps to scheduled-sale', () => {
  assert.equal(identifyDistressStage('NOTICE OF TRUSTEE SALE'), 'scheduled-sale');
});

test('identifyDistressStage: Trustee Deed Upon Sale maps to post-sale', () => {
  assert.equal(identifyDistressStage('TRUSTEE DEED UPON SALE'), 'post-sale');
});

test('identifyDistressStage: Trustee Deed maps to post-sale', () => {
  assert.equal(identifyDistressStage('TRUSTEE DEED'), 'post-sale');
});

test('identifyDistressStage: LIS PENDENS maps to lis-pendens', () => {
  assert.equal(identifyDistressStage('LIS PENDENS'), 'lis-pendens');
});

test('identifyDistressStage: SUBSTITUTION OF TRUSTEE maps to pre-foreclosure', () => {
  assert.equal(identifyDistressStage('SUBSTITUTION OF TRUSTEE'), 'pre-foreclosure');
});

test('identifyDistressStage: case-insensitive matching', () => {
  assert.equal(identifyDistressStage('notice of default'), 'pre-foreclosure');
  assert.equal(identifyDistressStage('notice of trustee sale'), 'scheduled-sale');
});

test('identifyDistressStage: unknown type returns unknown', () => {
  assert.equal(identifyDistressStage('GRANT DEED'), 'unknown');
  assert.equal(identifyDistressStage(''), 'unknown');
});

// ---------------------------------------------------------------------------
// parseOpeningBid — Zero-Fabrication Invariant
// ---------------------------------------------------------------------------

test('parseOpeningBid: returns null when no bid stated', () => {
  assert.equal(parseOpeningBid('NOTICE OF DEFAULT recorded.'), null);
});

test('parseOpeningBid: returns null for empty/null input', () => {
  assert.equal(parseOpeningBid(null), null);
  assert.equal(parseOpeningBid(''), null);
});

test('parseOpeningBid: returns null even when a dollar amount appears without bid label', () => {
  // Must not impute from arbitrary numbers in text
  assert.equal(parseOpeningBid('Loan amount $450,000 outstanding.'), null);
});

test('parseOpeningBid: parses explicitly labeled opening bid', () => {
  const result = parseOpeningBid('Opening Bid: $350,000.00 at trustee sale.');
  assert.equal(result, 350000);
});

test('parseOpeningBid: parses minimum bid label', () => {
  const result = parseOpeningBid('Minimum Bid $125,500 required.');
  assert.equal(result, 125500);
});

test('parseOpeningBid: parses starting bid label', () => {
  const result = parseOpeningBid('Starting Bid: $87,250.50');
  assert.equal(result, 87250.5);
});

// ---------------------------------------------------------------------------
// getLaRecorderSearchUrl
// ---------------------------------------------------------------------------

test('getLaRecorderSearchUrl: includes default doc type', () => {
  const url = getLaRecorderSearchUrl();
  assert.match(url, /DocumentType/);
  assert.match(url, /NOTICE/i);
});

test('getLaRecorderSearchUrl: includes AIN when provided', () => {
  const url = getLaRecorderSearchUrl({ ain: '5001003002', docType: LA_DOC_TYPES.NOD });
  assert.match(url, /AIN/);
  assert.match(url, /5001/);
});

test('getLaRecorderSearchUrl: includes GrantorName when provided', () => {
  const url = getLaRecorderSearchUrl({ grantor: 'Smith, John' });
  assert.match(url, /GrantorName/);
  assert.match(url, /Smith/);
});

test('getLaRecorderSearchUrl: includes date range params', () => {
  const url = getLaRecorderSearchUrl({
    startDate: '01/01/2024',
    endDate: '12/31/2024',
  });
  assert.match(url, /StartDate/);
  assert.match(url, /EndDate/);
});

test('getLaRecorderSearchUrl: respects custom baseUrl', () => {
  const url = getLaRecorderSearchUrl({ baseUrl: 'https://custom.example.com' });
  assert.match(url, /custom\.example\.com/);
});

// ---------------------------------------------------------------------------
// parseLaRecordRow — golden fixture
// ---------------------------------------------------------------------------

const GOLDEN_ROW = `
<tr class="la-record-row">
  <td class="col-doc">20241234567</td>
  <td class="col-date">03/15/2024</td>
  <td class="col-type">NOTICE OF DEFAULT</td>
  <td class="col-ain">5001-003-002</td>
  <td class="col-grantor">DOE, JOHN</td>
  <td class="col-grantee">ACME TRUSTEE SERVICES LLC</td>
  <td class="col-legal">LOT 7 BLK 12 TRACT 4521 LA COUNTY</td>
</tr>
`;

test('parseLaRecordRow: parses golden NOD row correctly', () => {
  const result = parseLaRecordRow(GOLDEN_ROW);
  assert.ok(result, 'should return a parsed record');
  assert.equal(result.documentNumber, '20241234567');
  assert.equal(result.recordedDate, '03/15/2024');
  assert.equal(result.docType, 'NOTICE OF DEFAULT');
  assert.equal(result.ain, '5001-003-002');
  assert.equal(result.grantor, 'DOE, JOHN');
  assert.equal(result.grantee, 'ACME TRUSTEE SERVICES LLC');
  assert.equal(result.county, 'Los Angeles');
  assert.equal(result.state, 'CA');
  assert.equal(result.platform, 'la-recorder');
  assert.equal(result.distressStage, 'pre-foreclosure');
});

test('parseLaRecordRow: enforces Zero-Fabrication — openingBid is null for NOD row', () => {
  const result = parseLaRecordRow(GOLDEN_ROW);
  assert.equal(result.openingBid, null);
  assert.equal(result.estLow, null);
  assert.equal(result.estHigh, null);
  assert.equal(result.assessed, null);
});

test('parseLaRecordRow: returns null for empty string', () => {
  assert.equal(parseLaRecordRow(''), null);
});

test('parseLaRecordRow: returns null for row with no identifiable fields', () => {
  assert.equal(parseLaRecordRow('<tr><td>Nothing useful</td></tr>'), null);
});

const NTS_ROW = `
<div class="la-record-row">
  <span class="col-type">NOTICE OF TRUSTEE SALE</span>
  <span class="col-ain">2045-018-007</span>
  <span class="col-grantor">JONES, MARY</span>
  TS# 20240099887 Opening Bid: $320,000
</div>
`;

test('parseLaRecordRow: parses NTS row and classifies as scheduled-sale', () => {
  const result = parseLaRecordRow(NTS_ROW);
  assert.ok(result, 'should parse NTS row');
  assert.equal(result.distressStage, 'scheduled-sale');
  assert.equal(result.ain, '2045-018-007');
  assert.equal(result.grantor, 'JONES, MARY');
});

test('parseLaRecordRow: extracts opening bid from NTS row', () => {
  const result = parseLaRecordRow(NTS_ROW);
  assert.equal(result.openingBid, 320000);
});

// ---------------------------------------------------------------------------
// parseLaSearchHtml — golden fixture
// ---------------------------------------------------------------------------

const GOLDEN_HTML = `
<html><body>
<table>
<tr class="la-record-row">
  <td class="col-doc">20241000001</td>
  <td class="col-date">01/10/2024</td>
  <td class="col-type">NOTICE OF DEFAULT</td>
  <td class="col-ain">4038-012-009</td>
  <td class="col-grantor">SMITH, ALICE</td>
</tr>
<tr class="la-record-row">
  <td class="col-doc">20241000002</td>
  <td class="col-date">02/20/2024</td>
  <td class="col-type">NOTICE OF TRUSTEE SALE</td>
  <td class="col-ain">4038-012-009</td>
  <td class="col-grantor">SMITH, ALICE</td>
</tr>
</table>
</body></html>
`;

test('parseLaSearchHtml: returns empty array for empty HTML', () => {
  assert.deepEqual(parseLaSearchHtml(''), []);
  assert.deepEqual(parseLaSearchHtml('   '), []);
});

test('parseLaSearchHtml: parses two records from golden HTML', () => {
  const results = parseLaSearchHtml(GOLDEN_HTML);
  assert.equal(results.length, 2);
});

test('parseLaSearchHtml: first result is NOD', () => {
  const results = parseLaSearchHtml(GOLDEN_HTML);
  assert.equal(results[0].docType, 'NOTICE OF DEFAULT');
  assert.equal(results[0].distressStage, 'pre-foreclosure');
  assert.equal(results[0].documentNumber, '20241000001');
});

test('parseLaSearchHtml: second result is NTS', () => {
  const results = parseLaSearchHtml(GOLDEN_HTML);
  assert.equal(results[1].docType, 'NOTICE OF TRUSTEE SALE');
  assert.equal(results[1].distressStage, 'scheduled-sale');
});

test('parseLaSearchHtml: all results have Zero-Fabrication fields null', () => {
  const results = parseLaSearchHtml(GOLDEN_HTML);
  for (const r of results) {
    assert.equal(r.estLow, null);
    assert.equal(r.estHigh, null);
    assert.equal(r.assessed, null);
  }
});

// ---------------------------------------------------------------------------
// LA_DOC_TYPES constants
// ---------------------------------------------------------------------------

test('LA_DOC_TYPES exports expected constants', () => {
  assert.equal(LA_DOC_TYPES.NOD, 'NOTICE OF DEFAULT');
  assert.equal(LA_DOC_TYPES.NTS, 'NOTICE OF TRUSTEE SALE');
  assert.equal(LA_DOC_TYPES.TRUSTEE_DEED, 'TRUSTEE DEED UPON SALE');
  assert.equal(LA_DOC_TYPES.LIS_PENDENS, 'LIS PENDENS');
});

test('LA_DOC_TYPES is frozen', () => {
  assert.ok(Object.isFrozen(LA_DOC_TYPES));
});
