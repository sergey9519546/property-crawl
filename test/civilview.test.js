const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CivilViewScraper } = require('../server/scrapers/civilview');
const { validateListingForIngestion } = require('../server/scrapers/validation');

const COUNTY = { id: '7', name: 'Bergen County', state: 'NJ', fullName: 'Bergen County, NJ' };
const COUNTY_URL = 'https://salesweb.civilview.com/Sales/SalesSearch?countyId=7';
const DETAIL_URL = 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683';

test('CivilView expansion prioritizes unseen exact records without dropping refresh candidates', () => {
  const subject = new CivilViewScraper({ observedRecordIds: ['CIV-NJ-7-1'] });
  const summaries = [{ propertyId: '1' }, { propertyId: '2' }, { propertyId: '3' }];
  assert.deepEqual(subject.prioritizeSummaries(summaries, COUNTY).map((item) => item.propertyId), ['2', '3', '1']);
  assert.deepEqual(summaries.map((item) => item.propertyId), ['1', '2', '3']);
});

const SEARCH_HTML = `
  <table class="table table-striped">
    <tr>
      <td><a href="/Sales/SaleDetails?PropertyId=2128964683">View Details</a></td>
      <td>F-24003314</td>
      <td>9/11/2026</td>
      <td>US BANK NATIONAL ASSOCIATION</td>
      <td>MOHAMMED FALAH; ET AL</td>
      <td>19 WEST PARK AVENUE PARK RIDGE NJ 07656</td>
    </tr>
    <tr>
      <td><a href="https://attacker.example/Sales/SaleDetails?PropertyId=1">View Details</a></td>
      <td>F-UNSAFE</td><td>9/12/2026</td><td>P</td><td>D</td><td>1 BAD ROAD CITY NJ 07000</td>
    </tr>
  </table>`;

const detailItem = (label, value) => `
  <div class="sale-detail-item">
    <div class="sale-detail-label">${label}&colon;</div>
    <div class="sale-detail-value">${value}</div>
    <div class="sale-detail-image"></div>
  </div>`;

const DETAIL_HTML = `
  <div class="sale-details-list">
    ${detailItem('Sheriff #', 'F-24003314')}
    ${detailItem('Court Case #', 'F00699024')}
    ${detailItem('Sales Date', '9/11/2026')}
    ${detailItem('Plaintiff', 'US BANK NATIONAL ASSOCIATION')}
    ${detailItem('Defendant', 'MOHAMMED FALAH; ET AL')}
    ${detailItem('Address', '19 WEST PARK AVENUE<br/>PARK RIDGE NJ 07656')}
    ${detailItem('Description', "The approximate amount due on this execution is $556,894.75 plus interest.")}
    ${detailItem('Approx. Upset*', '$564,684.81')}
    ${detailItem('Attorney', 'GOLDMAN &amp; BESLOW, LLC')}
    ${detailItem('Parcel #', 'LOT 7, BLOCK 1203')}
    ${detailItem('Property Note', 'OCCUPANCY STATUS: OWNER OCCUPIED; DIMENSIONS (APPROX.): 75 X 126;')}
  </div>
  <table id="longTable">
    <tr><th>Status</th><th>Date</th></tr>
    <tr><td>Scheduled</td><td>1/24/2025</td></tr>
    <tr><td>Adjourned - Court</td><td>9/11/2026</td></tr>
  </table>`;

function scraper(options = {}) {
  return new CivilViewScraper({
    random: () => 0.5,
    sleepImpl: async () => {},
    maxRetries: 1,
    ...options,
  });
}

test('CivilView search rows preserve the exact same-origin View Details URL', () => {
  const subject = scraper();
  const rows = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);

  assert.equal(rows.length, 1, 'cross-origin lookalike detail links must be rejected');
  assert.equal(rows[0].propertyId, '2128964683');
  assert.equal(rows[0].detailUrl, DETAIL_URL);
  assert.equal(rows[0].countySearchUrl, COUNTY_URL);
  assert.equal(rows[0].sheriffNumber, 'F-24003314');
});

test('CivilView detail parser uses published facts and leaves unavailable facts unknown', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);
  const listing = subject.parseDetailPage(DETAIL_HTML, summary);

  assert.ok(listing);
  assert.equal(listing.id, 'CIV-NJ-7-2128964683');
  assert.equal(listing.sourceUrl, DETAIL_URL);
  assert.equal(listing.openingBid, 564684.81);
  assert.equal(listing.judgment, 556894.75);
  assert.equal(listing.saleDate, '2026-09-11');
  assert.equal(listing.address, '19 WEST PARK AVENUE, PARK RIDGE, NJ 07656');
  assert.equal(listing.attorney, 'GOLDMAN & BESLOW, LLC');
  assert.equal(listing.occupancy, 'OWNER OCCUPIED');
  assert.equal(listing.lat, null);
  assert.equal(listing.lng, null);
  assert.equal(listing.estLow, null);
  assert.equal(listing.estHigh, null);
  assert.equal(listing.photo, null);
  assert.equal(listing.provenance.openingBidSource, 'CivilView Approx. Upset');
  assert.equal(listing.provenance.detailUrlRequiresCountySession, true);
  assert.equal(listing.provenance.parcelNumber, 'LOT 7, BLOCK 1203');
  assert.deepEqual(listing.provenance.statusHistory.at(-1), {
    status: 'Adjourned - Court',
    date: '2026-09-11',
  });
  assert.equal(subject.passesFilter(listing), true);
  assert.deepEqual(
    validateListingForIngestion(listing, { expectedSource: 'civilview' }).errors,
    [],
    'honest unknown valuation/geocode fields should survive the ingestion gate',
  );
});

test('CivilView preserves an exact detail record when the source has not published an upset amount', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);
  const withoutUpset = DETAIL_HTML.replace(detailItem('Approx. Upset*', '$564,684.81'), '');
  const listing = subject.parseDetailPage(withoutUpset, summary);

  assert.ok(listing);
  assert.equal(listing.openingBid, null);
  assert.equal(subject.passesFilter(listing), true);
  assert.deepEqual(
    validateListingForIngestion(listing, { expectedSource: 'civilview' }).errors,
    [],
  );
});

test('CivilView can use a published good-faith upset from the property note', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);
  const noteOnly = DETAIL_HTML
    .replace(detailItem('Approx. Upset*', '$564,684.81'), '')
    .replace(
      'OCCUPANCY STATUS: OWNER OCCUPIED;',
      'GOOD FAITH ESTIMATED UPSET PRICE: $671, 471.41; OCCUPANCY STATUS: OWNER OCCUPIED;',
    );
  const listing = subject.parseDetailPage(noteOnly, summary);

  assert.equal(listing.openingBid, 671471.41);
  assert.equal(
    listing.provenance.openingBidSource,
    'CivilView Property Note — Good Faith Estimated Upset Price',
  );
  assert.equal(subject.passesFilter(listing), true);
});

test('CivilView occupancy extraction does not absorb unrelated tax and lien notes', () => {
  const subject = scraper();
  assert.equal(
    subject.parseOccupancy(
      'OCCUPANCY STATUS: OCCUPIED. DIMENSIONS OF LOT: 58X98. 2026 TAXES: $8,705.58 OPEN;',
    ),
    'OCCUPIED',
  );
});

test('CivilView carries the county session cookie into detail requests', async () => {
  const calls = [];
  const headers = {
    entries: () => [['set-cookie', 'ASP.NET_SessionId=session-123; path=/; HttpOnly']],
    getSetCookie: () => ['ASP.NET_SessionId=session-123; path=/; HttpOnly'],
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      url,
      headers,
      text: async () => '<html><body>' + 'valid payload '.repeat(20) + '</body></html>',
    };
  };
  const subject = scraper({ fetchImpl });

  const countyPage = await subject.fetchPage(COUNTY_URL);
  await subject.fetchPage(DETAIL_URL, 30000, countyPage.sessionCookie);

  assert.equal(countyPage.sessionCookie, 'ASP.NET_SessionId=session-123');
  assert.equal(calls[1].options.headers.Cookie, 'ASP.NET_SessionId=session-123');
});

test('CivilView circuit breaker halts immediately on a WAF response', async () => {
  const fetchImpl = async (url) => ({
    ok: false,
    status: 403,
    url,
    headers: { entries: () => [], getSetCookie: () => [] },
    text: async () => '<html>' + 'access denied '.repeat(20) + '</html>',
  });
  const subject = scraper({ fetchImpl });

  await assert.rejects(subject.fetchPage(COUNTY_URL), /CIRCUIT_BREAKER_TRIPPED/);
  assert.equal(subject.circuitBreaker.isOpen(), true);
  await assert.rejects(subject.fetchPage(COUNTY_URL), /circuit breaker is OPEN/i);
});
