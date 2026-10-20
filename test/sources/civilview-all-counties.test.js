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
