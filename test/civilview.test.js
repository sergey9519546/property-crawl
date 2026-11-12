const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CivilViewScraper, rotateCounties } = require('../server/scrapers/civilview');
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
  assert.equal(listing.openingBid, null);
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
  assert.equal(listing.provenance.openingBidSource, null);
  assert.deepEqual(listing.sourceFacts.approximateUpsetPrice, {
    raw: '$564,684.81', amount: 564684.81, qualifier: 'approximate', source: 'CivilView Approx. Upset',
  });
  assert.deepEqual(listing.provenance.sourceFacts, listing.sourceFacts);
  assert.equal(listing.provenance.detailUrlRequiresCountySession, true);
  assert.equal(listing.provenance.parcelNumber, 'LOT 7, BLOCK 1203');
  assert.equal(listing.apn, 'LOT 7, BLOCK 1203');
  assert.equal(listing.sourceFacts.priorPostponements, 1);
  assert.equal(listing.sourceFacts.upsetPrice, 564684.81);
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

test('CivilView preserves a published good-faith upset as a qualified source fact', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);
  const noteOnly = DETAIL_HTML
    .replace(detailItem('Approx. Upset*', '$564,684.81'), '')
    .replace(
      'OCCUPANCY STATUS: OWNER OCCUPIED;',
      'GOOD FAITH ESTIMATED UPSET PRICE: $671, 471.41; OCCUPANCY STATUS: OWNER OCCUPIED;',
    );
  const listing = subject.parseDetailPage(noteOnly, summary);

  assert.equal(listing.openingBid, null);
  assert.equal(
    listing.provenance.approximateUpsetPrice.source,
    'CivilView Property Note — Good Faith Estimated Upset Price',
  );
  assert.equal(listing.provenance.approximateUpsetPrice.amount, 671471.41);
  assert.equal(listing.provenance.approximateUpsetPrice.qualifier, 'approximate');
  assert.equal(subject.passesFilter(listing), true);
});

test('CivilView preserves a timed sale date and approximate upset published in the description', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);
  const descriptionOnly = DETAIL_HTML
    .replace(detailItem('Sales Date', '9/11/2026'), detailItem('Sales Date', '09/14/2026 02:00 PM'))
    .replace(detailItem('Approx. Upset*', '$564,684.81'), '')
    .replace(
      'The approximate amount due on this execution is $556,894.75 plus interest.',
      'The approximate amount of the judgment is $556,894.75. The approximate upset price is $692,817.80. The upset price may change.',
    );
  const listing = subject.parseDetailPage(descriptionOnly, summary);

  assert.equal(listing.saleDate, '2026-09-14');
  assert.equal(listing.openingBid, null);
  assert.equal(listing.sourceFacts.saleDate.raw, '09/14/2026 02:00 PM');
  assert.equal(listing.sourceFacts.saleDate.normalized, '2026-09-14');
  assert.deepEqual(listing.sourceFacts.approximateUpsetPrice, {
    raw: '$692,817.80',
    amount: 692817.80,
    qualifier: 'approximate',
    source: 'CivilView Description — Approximate Upset Price',
  });
});

test('CivilView maps only an explicitly published opening bid into openingBid', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);
  const withOpeningBid = DETAIL_HTML + detailItem('Opening Bid', '$410,000.00');
  const listing = subject.parseDetailPage(withOpeningBid, summary);

  assert.equal(listing.openingBid, 410000);
  assert.deepEqual(listing.sourceFacts.openingBid, {
    raw: '$410,000.00', amount: 410000, source: 'CivilView Opening Bid',
  });
  assert.equal(listing.provenance.openingBidSource, 'CivilView Opening Bid');
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

test('CivilView bounds relational projection text while preserving the full publisher field', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);
  const fullDefendant = 'A VERY LONG PUBLISHED DEFENDANT NAME '.repeat(12).trim();
  const listing = subject.parseDetailPage(
    DETAIL_HTML.replace('MOHAMMED FALAH; ET AL', fullDefendant),
    summary,
  );

  assert.equal(listing.defendant.length, 255);
  assert.equal(listing.provenance.sourceFields.defendant, fullDefendant);
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

function scopedScraper(options = {}) {
  const subject = scraper({ countyId: '7', targetState: 'NJ', maxDetailPages: 10, ...options });
  subject.fetchCounties = async () => [COUNTY, { id: '8', name: 'Essex County', state: 'NJ' }];
  subject.fetchCountySummaries = async (county) => ({
    sessionCookie: 'ASP.NET_SessionId=test',
    summaries: ['1', '2'].map((propertyId) => ({
      propertyId,
      county,
      detailUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${propertyId}`,
    })),
  });
  subject.fetchText = async () => '<div class="sale-details-list">valid detail</div>';
  subject.parseDetailPage = (_html, summary) => ({
    id: `CIV-NJ-7-${summary.propertyId}`,
    provenance: { propertyId: summary.propertyId },
  });
  subject.passesFilter = () => true;
  return subject;
}

test('CivilView explicit county scope reports a gate-compatible complete sweep', async () => {
  const subject = scopedScraper();
  const listings = await subject.scrapeFeed();

  assert.equal(listings.length, 2);
  assert.deepEqual(subject.lastRunReport.scope, {
    endpoint: '/Sales/SalesSearch',
    filters: { state: 'NJ', countyId: '7' },
  });
  assert.equal(subject.lastRunReport.recordsAccepted, 2);
  assert.equal(subject.lastRunReport.recordsRejected, 0);
  assert.equal(subject.lastRunReport.unattemptedSummaries, 0);
  assert.equal(subject.lastRunReport.complete, true);
  assert.equal(subject.lastRunReport.fullSweepComplete, true);
  assert.equal(subject.lastRunReport.truncated, false);
  assert.equal(subject.lastRunReport.boundedSample, false);
});

test('CivilView explicit county budget marks unattempted summaries and never completes', async () => {
  const subject = scopedScraper({ maxDetailPages: 1 });
  await subject.scrapeFeed();

  assert.equal(subject.lastRunReport.recordsAccepted, 1);
  assert.equal(subject.lastRunReport.recordsRejected, 0);
  assert.equal(subject.lastRunReport.unattemptedSummaries, 1);
  assert.equal(subject.lastRunReport.truncated, true);
  assert.equal(subject.lastRunReport.complete, false);
  assert.equal(subject.lastRunReport.fullSweepComplete, false);
});

test('CivilView explicit county detail failure is counted as rejected and incomplete', async () => {
  const subject = scopedScraper();
  subject.fetchText = async (url) => {
    if (url.endsWith('=2')) throw new Error('detail unavailable');
    return '<div class="sale-details-list">valid detail</div>';
  };
  const listings = await subject.scrapeFeed();

  assert.equal(listings.length, 1);
  assert.equal(subject.lastRunReport.recordsAccepted, 1);
  assert.equal(subject.lastRunReport.recordsRejected, 1);
  assert.equal(subject.lastRunReport.failures.length, 1);
  assert.equal(subject.lastRunReport.complete, false);
  assert.equal(subject.lastRunReport.fullSweepComplete, false);
});

test('CivilView legacy state sample cannot claim a complete promotable scope', async () => {
  const subject = scopedScraper({ countyId: null, maxCounties: 1 });
  await subject.scrapeFeed();

  assert.deepEqual(subject.lastRunReport.scope.filters, {
    state: 'NJ', selection: 'bounded-priority-sample',
  });
  assert.equal(subject.lastRunReport.truncated, true);
  assert.equal(subject.lastRunReport.complete, false);
  assert.equal(subject.lastRunReport.fullSweepComplete, false);
});

// A scraper that spans several counties in the target state and records which
// ones a run actually reached.
function rotatingScraper(maxCounties = 2) {
  const subject = scraper({
    countyId: null, targetState: 'NJ', maxCounties, maxDetailPages: 10,
  });
  const counties = ['7', '10', '8', '17', '2', '13', '21'].map((id) => ({
    id, name: `County ${id}`, state: 'NJ',
  }));
  subject.fetchCounties = async () => counties;
  subject.attempted = [];
  subject.fetchCountySummaries = async (county) => {
    subject.attempted.push(String(county.id));
    return {
      sessionCookie: 'ASP.NET_SessionId=test',
      summaries: [{
        propertyId: `p-${county.id}`,
        county,
        detailUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=p-${county.id}`,
      }],
    };
  };
  subject.fetchText = async () => '<div class="sale-details-list">valid detail</div>';
  subject.parseDetailPage = (_html, summary) => ({
    id: `CIV-NJ-${summary.county.id}-${summary.propertyId}`,
    provenance: { propertyId: summary.propertyId },
  });
  subject.passesFilter = () => true;
  return subject;
}

test('CivilView advances through counties across runs instead of re-sampling the same ones', async () => {
  const subject = rotatingScraper(2);
  await subject.scrapeFeed();
  const first = [...subject.attempted];

  // Cold start keeps the declared priority counties.
  assert.deepEqual(first, ['7', '10']);

  // The scheduler hands the previous run's cursor back before the next run.
  const token = subject.lastRunReport.nextContinuationToken;
  assert.ok(token, 'a run that cannot cover every county must report where to resume');
  subject.setCheckpoint({ continuationToken: token });
  await subject.scrapeFeed();
  const second = subject.attempted.slice(first.length);

  assert.deepEqual(first, ['7', '10']);
  assert.deepEqual(second, ['8', '17'],
    'a second run must reach counties the first never attempted');
  assert.deepEqual(second.filter((id) => first.includes(id)), [],
    'the two runs must not overlap, or the rotation buys no new coverage');
});

test('CivilView keeps the priority counties first and reports no cursor once all are covered', async () => {
  const subject = rotatingScraper(9); // budget covers every county
  await subject.scrapeFeed();

  assert.deepEqual([...subject.attempted], ['7', '10', '8', '17', '2', '13', '21']);
  assert.equal(subject.lastRunReport.nextContinuationToken, null,
    'a run that reached every county has nothing left to resume from');
});

test('an unparseable cursor restarts the rotation instead of guessing an offset', () => {
  const subject = rotatingScraper(2);
  for (const bad of [{}, { continuationToken: 'not-a-number' }, { continuationToken: -4 }, null]) {
    subject.setCheckpoint(bad);
    assert.equal(subject.countyRotationOffset, 0, JSON.stringify(bad));
  }
  subject.setCheckpoint({ continuationToken: '3' });
  assert.equal(subject.countyRotationOffset, 3);
});

test('rotateCounties wraps and never returns more than the budget', () => {
  const counties = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(rotateCounties(counties, 0, 2), ['a', 'b']);
  assert.deepEqual(rotateCounties(counties, 2, 2), ['c', 'd']);
  assert.deepEqual(rotateCounties(counties, 4, 2), ['e', 'a'], 'must wrap past the last county');
  assert.deepEqual(rotateCounties(counties, 7, 2), ['c', 'd'], 'an offset beyond the end still resolves');
  assert.deepEqual(rotateCounties(counties, 0, 9), counties, 'a budget larger than the list returns everything');
  assert.deepEqual(rotateCounties(counties, 0, 0), []);
  assert.deepEqual(rotateCounties([], 0, 2), []);
});

test('CivilView rejects malformed explicit state and county configuration', () => {
  assert.throws(() => scraper({ targetState: 'nj', countyId: '7' }), /targetState/);
  assert.throws(() => scraper({ targetState: 'NJ', countyId: '7 OR 1=1' }), /countyId/);
});

test('CivilView early county-index failure replaces a prior complete report', async () => {
  const subject = scopedScraper();
  await subject.scrapeFeed();
  assert.equal(subject.lastRunReport.complete, true);

  subject.fetchCounties = async () => { throw new Error('county index unavailable'); };
  await assert.rejects(subject.scrapeFeed(), /county index unavailable/);

  assert.equal(subject.lastRunReport.outcome, 'failed');
  assert.equal(subject.lastRunReport.complete, false);
  assert.equal(subject.lastRunReport.fullSweepComplete, false);
  assert.equal(subject.lastRunReport.truncated, true);
  assert.deepEqual(subject.lastRunReport.scope.filters, { state: 'NJ', countyId: '7' });
});

test('CivilView nationwide mode accepts multi-state records and attaches deterministic parcelKey', () => {
  const nationwideScraper = scraper({ nationwide: true, targetState: 'NJ' });
  const paCounty = { id: '51', name: 'Lehigh County', state: 'PA', fullName: 'Lehigh County, PA' };
  const paSummary = {
    propertyId: '99887766',
    county: paCounty,
    countySearchUrl: 'https://salesweb.civilview.com/Sales/SalesSearch?countyId=51',
    detailUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99887766',
    sheriffNumber: 'S-2026-4411',
    plaintiff: 'PNC BANK, NATIONAL ASSOCIATION',
    defendant: 'JANE DOE',
  };
  const paDetailHtml = DETAIL_HTML
    .replace('19 WEST PARK AVENUE<br/>PARK RIDGE NJ 07656', '742 HAMILTON STREET<br/>ALLENTOWN PA 18101')
    .replace('LOT 7, BLOCK 1203', '02-5497-8123-0001');

  const listing = nationwideScraper.parseDetailPage(paDetailHtml, paSummary);
  assert.ok(listing);
  assert.equal(listing.id, 'CIV-PA-51-99887766');
  assert.equal(listing.state, 'PA');
  assert.equal(listing.county, 'Lehigh County');
  assert.equal(listing.apn, '02-5497-8123-0001');
  assert.equal(listing.parcelKey, '02549781230001');
  assert.equal(nationwideScraper.passesFilter(listing), true, 'nationwide mode must accept non-NJ state records');

  const singleStateNjScraper = scraper({ nationwide: false, targetState: 'NJ' });
  assert.equal(singleStateNjScraper.passesFilter(listing), false, 'single-state NJ scraper must still reject PA records');
});

test('CivilView derives sold/closed/cancelled/stayed status and transactionOutcome from statusHistory', () => {
  const subject = scraper();
  const [summary] = subject.parseSalesTable(SEARCH_HTML, COUNTY, COUNTY_URL);

  const soldHtml = DETAIL_HTML.replace(
    '<tr><td>Adjourned - Court</td><td>9/11/2026</td></tr>',
    '<tr><td>Adjourned by the Defendant to</td><td>11/12/2026</td></tr>\n    <tr><td>Purchased - 3rd Party</td><td>11/12/2026</td></tr>',
  );
  const sold = subject.parseDetailPage(soldHtml, summary);
  assert.equal(sold.status, 'sold');
  assert.equal(sold.lifecycleStatus, 'Purchased - 3rd Party');
  assert.equal(sold.transactionOutcome, 'sold_to_third_party');

  const plaintiffHtml = DETAIL_HTML.replace(
    '<tr><td>Adjourned - Court</td><td>9/11/2026</td></tr>',
    '<tr><td>Purchased - Plaintiff</td><td>11/12/2026</td></tr>',
  );
  const reverted = subject.parseDetailPage(plaintiffHtml, summary);
  assert.equal(reverted.status, 'closed');
  assert.equal(reverted.lifecycleStatus, 'Purchased - Plaintiff');
  assert.equal(reverted.transactionOutcome, 'reverted_to_plaintiff');

  const cancelledHtml = DETAIL_HTML.replace(
    '<tr><td>Adjourned - Court</td><td>9/11/2026</td></tr>',
    '<tr><td>Dismissed</td><td>11/12/2026</td></tr>',
  );
  const cancelled = subject.parseDetailPage(cancelledHtml, summary);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.transactionOutcome, null);

  const stayedHtml = DETAIL_HTML.replace(
    '<tr><td>Adjourned - Court</td><td>9/11/2026</td></tr>',
    '<tr><td>Bankruptcy</td><td>11/12/2026</td></tr>',
  );
  const stayed = subject.parseDetailPage(stayedHtml, summary);
  assert.equal(stayed.status, 'stayed');
  assert.equal(stayed.transactionOutcome, null);
});

test('CivilView extracts Plaintiff Upset Price, Lot/Block, description occupancy, dimensions, open liens, WALK, and N/K/A', () => {
  const subject = scraper();
  const morrisCounty = { id: '9', name: 'Morris County', state: 'NJ', fullName: 'Morris County, NJ' };
  const morrisUrl = 'https://salesweb.civilview.com/Sales/SalesSearch?countyId=9';
  const morrisDetailUrl = 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2242070159';
  const morrisSearchHtml = `<table><tr>
    <td><a href="/Sales/SaleDetails?PropertyId=2242070159">View Details</a></td>
    <td>26001169</td>
    <td>11/12/2026</td>
    <td>PENNYMAC LOAN SERVICES, LLC</td>
    <td>BOLIVAR MARTINEZ</td>
    <td>1400 HOWARD BOULEVARD,, N/K/A 1400 ROGERS WALK MT. LAUREL NJ 08054</td>
  </tr></table>`;
  const [summary] = subject.parseSalesTable(morrisSearchHtml, morrisCounty, morrisUrl);
  assert.equal(summary.detailUrl, morrisDetailUrl);

  const morrisDetailHtml = `
  <div class="sale-details-list">
    ${detailItem('Sheriff #', '26001169')}
    ${detailItem('Sales Date', '11/12/2026')}
    ${detailItem('Plaintiff', 'PENNYMAC LOAN SERVICES, LLC')}
    ${detailItem('Defendant', 'BOLIVAR MARTINEZ, et als.')}
    ${detailItem('Address', '1400 HOWARD BOULEVARD,, N/K/A 1400 ROGERS WALK<br/>MT. LAUREL NJ 08054')}
    ${detailItem('Description', `SUPERIOR COURT OF NEW JERSEY\nMorris County Chancery Division\nSHERIFF'S SALE NO. 26001169\nDOCKET NO. F-293-25\nBeing known as: Lot 6, Block 2002\nApproximate Dimensions: 50 x 100\nNearest Cross Street: Cooper Street\nPlaintiff Upset Price: $249,593.48\nOccupancy Status: Owner Occupied\nPREMISES COMMONLY KNOWN AS:\n1400 Rogers Walk, Mt. Laurel, NJ 08054\nLien(s)/Taxes: Prior Liens/Encumbrances\nWATER OPEN AND DUE $140.24\nSEWER OPEN AND DUE $95.91\nTOTAL AS OF June 26, 2026: $236.15\nNote: The street address is merely given as a convenience.\nThe approximate amount due on this execution is $231,480.42 plus interest.`)}
  </div>
  <table id="longTable">
    <tr><th>Status</th><th>Date</th></tr>
    <tr><td>Scheduled</td><td>9/17/2026</td></tr>
  </table>`;

  const listing = subject.parseDetailPage(morrisDetailHtml, summary);
  assert.ok(listing);
  assert.equal(listing.openingBid, null, 'Plaintiff Upset Price must NEVER fabricate openingBid');
  assert.deepEqual(listing.sourceFacts.approximateUpsetPrice, {
    raw: '$249,593.48',
    amount: 249593.48,
    qualifier: 'approximate',
    source: 'CivilView Description — Plaintiff Upset Price',
  });
  assert.equal(listing.sourceFacts.upsetPrice, 249593.48);
  assert.equal(listing.occupancy, 'OWNER OCCUPIED');
  assert.equal(listing.apn, 'Lot 6, Block 2002');
  assert.equal(listing.provenance.parcelNumber, 'Lot 6, Block 2002');
  assert.deepEqual(listing.sourceFacts.lotBlock, { block: '2002', lot: '6' });
  assert.equal(listing.sourceFacts.dimensions, '50 x 100');
  assert.equal(listing.sourceFacts.priorLiensTotal, 236.15);
  assert.match(listing.sourceFacts.priorLiensNotice, /WATER OPEN AND DUE \$140\.24/);
  assert.equal(listing.provenance.courtCaseNumber, 'F-293-25');
  assert.equal(listing.city, 'MT. LAUREL');
  assert.equal(listing.zip, '08054');
  assert.doesNotMatch(listing.address, /,,/);
});

test('CivilView records completedCounties for lossless per-county absence reconciliation only when county has zero failures', async () => {
  const subject = scraper({ countyId: null, targetState: 'NJ', maxCounties: 2, maxDetailPages: 10 });
  const c1 = { id: '7', name: 'Bergen County', state: 'NJ' };
  const c2 = { id: '9', name: 'Morris County', state: 'NJ' };
  subject.fetchCounties = async () => [c1, c2];
  subject.fetchCountySummaries = async (county) => ({
    sessionCookie: 'ASP.NET_SessionId=test',
    summaries: [{
      propertyId: county.id === '7' ? '111' : '222',
      county,
      detailUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${county.id === '7' ? '111' : '222'}`,
    }],
  });
  subject.fetchText = async (url) => {
    if (url.endsWith('=222')) throw new Error('detail timeout');
    return '<div class="sale-details-list">ok</div>';
  };
  subject.parseDetailPage = (_html, summary) => ({
    id: `CIV-NJ-${summary.county.id}-${summary.propertyId}`,
    provenance: { propertyId: summary.propertyId },
  });
  subject.passesFilter = () => true;

  await subject.scrapeFeed();
  assert.equal(Array.isArray(subject.lastRunReport.completedCounties), true);
  assert.deepEqual(subject.lastRunReport.completedCounties, [
    { state: 'NJ', county: 'Bergen County', countyId: '7', seenIds: ['CIV-NJ-7-111'] },
  ]);
});
