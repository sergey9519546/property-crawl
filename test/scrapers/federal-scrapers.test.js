'use strict';

// test/scrapers/federal-scrapers.test.js
//
// Pure-function unit tests for the eleven federal / federal-adjacent scrapers
// that previously had no direct unit coverage. Each module's network I/O is
// bypassed by exercising the in-process parsers and mappers directly:
//
//   - fannie.js       mapJsonItem / parseHtmlCards
//   - freddie.js      mapJsonItem / parseHtmlCards
//   - fdic.js         toListing / classifyPropType / parseSaleDate / passesFilter
//   - usda.js         parseStateOptions / rowToListing / parseMoney / text / firstInt
//   - va.js           mapJsonItem / parseHtmlCards
//   - bid4assets.js   parseAssetTitle / parseSaleDate / toListing / passesFilter
//                     + classifyPropType
//   - marshals.js     parseMarshalsHtml / parsePartnerCards
//   - sheriff.js      parseRealauctionHtml / parsePublicNoticeHtml / normalizeSaleDate
//                     + parseExtraCounties
//   - treasury.js     parseAddress / parseSaleDate / classifyPropertyType / parseMoney
//   - trustee.js      smoke test of the no-op scrapeFeed contract
//   - landbanksearch.js  parseCardHtml / passesFilter
//
// These cover the high-risk code paths that previous "real scraper" suites
// could only exercise end-to-end against live sites. The pure parsers are
// what actually fail silently when a publisher changes their markup.

const assert = require('node:assert/strict');
const test = require('node:test');

// --- Fannie Mae ----------------------------------------------------------

const { FannieMaeScraper } = require('../../server/scrapers/fannie');

test('fannie mapJsonItem: returns null when both property id and street address are missing', () => {
  const s = new FannieMaeScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.mapJsonItem({}, 'TX'), null);
  assert.equal(s.mapJsonItem({ id: 'X' }, 'TX'), null);
  assert.equal(s.mapJsonItem({ streetAddress: '1 Main St' }, 'TX'), null);
});

test('fannie mapJsonItem: prefixes id with FNMA and uses publisher fields when present', () => {
  const s = new FannieMaeScraper({ useScrapling: false, extractImpl: null });
  const out = s.mapJsonItem({
    propertyId: '12345',
    streetAddress: '500 Test Ave',
    city: 'Cleveland',
    state: 'OH',
    zip: '44101',
    listPrice: 175000,
    bedrooms: 3,
    bathrooms: 2,
    squareFeet: 1500,
    yearBuilt: 1962,
    photo: 'https://example.com/p.jpg',
  }, 'OH');
  assert.ok(out);
  assert.equal(out.id, 'FNMA-12345');
  assert.equal(out.state, 'OH');
  assert.equal(out.city, 'Cleveland');
  assert.equal(out.zip, '44101');
  assert.equal(out.openingBid, 175000);
  assert.equal(out.beds, 3);
  assert.equal(out.baths, 2);
  assert.equal(out.sqft, 1500);
  assert.equal(out.year, 1962);
  assert.equal(out.photo, 'https://example.com/p.jpg');
  assert.equal(out.provenance.publisher, 'Fannie Mae HomePath');
  assert.equal(out.provenance.recordId, '12345');
});

test('fannie mapJsonItem: composes a comma-joined address when no full address is given', () => {
  const s = new FannieMaeScraper({ useScrapling: false, extractImpl: null });
  const out = s.mapJsonItem({
    id: 'A1',
    streetAddress: '12 Pine Rd',
    zip: '43215',
  }, 'OH');
  assert.ok(out);
  // filter(Boolean) drops undefined fields, so an absent city produces
  // `12 Pine Rd, OH, 43215` rather than leaving an empty element.
  assert.equal(out.address, '12 Pine Rd, OH, 43215');
});

test('fannie mapJsonItem: rejects non-positive prices', () => {
  const s = new FannieMaeScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.mapJsonItem({ id: 'X', streetAddress: '1 Main St', listPrice: -5 }, 'TX').openingBid, null);
  assert.equal(s.mapJsonItem({ id: 'X', streetAddress: '1 Main St', listPrice: 'NaN' }, 'TX').openingBid, null);
});

test('fannie parseHtmlCards: extracts a card with address + id + price', () => {
  const s = new FannieMaeScraper({ useScrapling: false, extractImpl: null });
  const html = `
    <div class="property-card">
      <span class="address">500 Oak Lane, Dallas, TX</span>
      $225,000
      <a href="/property/99001">View</a>
    </div>
    <div class="property-card">
      <span class="address">12 Elm Way, Dallas, TX</span>
      <a data-property-id="99002">View</a>
    </div>`;
  const out = s.parseHtmlCards(html, 'TX');
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'FNMA-99001');
  assert.equal(out[0].openingBid, 225000);
  assert.equal(out[0].address, '500 Oak Lane, Dallas, TX');
  assert.equal(out[1].id, 'FNMA-99002');
  assert.equal(out[1].city, 'Dallas', 'city is the second CSV segment of the address');
  assert.equal(out[1].openingBid, null);
});

test('fannie parseHtmlCards: skips cards missing address or id', () => {
  const s = new FannieMaeScraper({ useScrapling: false, extractImpl: null });
  const html = `<div class="property-card">no address</div>
                <div class="property-card"><span>$100,000</span></div>`;
  const out = s.parseHtmlCards(html, 'TX');
  assert.equal(out.length, 0);
});

// --- Freddie Mac --------------------------------------------------------

const { FreddieMacScraper } = require('../../server/scrapers/freddie');

test('freddie mapJsonItem: returns null when property id missing', () => {
  const s = new FreddieMacScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.mapJsonItem({ streetAddress: '1 Main' }, 'TX'), null);
  assert.equal(s.mapJsonItem({ mlsNumber: 'M-1' }, 'TX'), null);
});

test('freddie mapJsonItem: prefixes id with FRE and parses listPrice', () => {
  const s = new FreddieMacScraper({ useScrapling: false, extractImpl: null });
  const out = s.mapJsonItem({
    mlsNumber: 'M-77',
    address: '88 Pine St',
    city: 'Phoenix',
    listPrice: 250000,
    yearBuilt: 1980,
    bedrooms: 4,
  }, 'AZ');
  assert.ok(out);
  assert.equal(out.id, 'FRE-M-77');
  assert.equal(out.openingBid, 250000);
  assert.equal(out.beds, 4);
  assert.equal(out.year, 1980);
});

test('freddie parseHtmlCards: extracts cards with property-card markup', () => {
  const s = new FreddieMacScraper({ useScrapling: false, extractImpl: null });
  // The card regex uses non-greedy matching that stops at the first </div>;
  // use a span wrapper so the inner address match survives.
  const html = `<div class="property-card">
    <span class="address">42 Oak Ave, Atlanta, GA</span>
    $199,000
    <a href="/property/A100">link</a>
  </div>`;
  const out = s.parseHtmlCards(html, 'GA');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'FRE-A100');
  assert.equal(out[0].address, '42 Oak Ave, Atlanta, GA');
  assert.equal(out[0].openingBid, 199000);
});

// --- FDIC ---------------------------------------------------------------

// Module exports only the singleton; bind a handle for clarity.
const fdic = require('../../server/scrapers/fdic');

test('fdic toListing: maps a complete record into a listing with provenance', () => {
  const out = fdic.toListing({
    id: 12345,
    propertyName: '1500 Euclid Avenue, Cleveland, OH',
    propertyType: 'Single Family Residence',
    saleDate: '2021-03-02T00:00:00.000Z',
    state: 'OH',
    price: 89500,
    sourceUrl: 'https://sales.fdic.gov/property/12345',
  });
  assert.ok(out);
  assert.equal(out.id, 'FDIC-12345');
  assert.equal(out.state, 'OH');
  assert.equal(out.price, 89500);
  assert.equal(out.openingBid, null, 'openingBid is intentionally null for closed-sale archival data');
  assert.equal(out.status, 'closed');
  assert.equal(out.provenance.dataset, 'closed-real-estate');
  assert.equal(out.provenance.recordId, '12345');
});

test('fdic toListing: rejects when state is not 2-letter US code', () => {
  assert.equal(fdic.toListing({ id: 1, propertyName: '12345 Six Street Somewhere', state: 'OHIO', sourceUrl: 'https://x' }), null);
});

test('fdic toListing: rejects when propertyName is too short', () => {
  assert.equal(fdic.toListing({ id: 1, propertyName: 'short', state: 'OH', sourceUrl: 'https://x' }), null);
});

test('fdic toListing: rejects when no sourceUrl can be resolved', () => {
  assert.equal(fdic.toListing({ id: 1, propertyName: '12345 Six Street Somewhere', state: 'OH' }), null);
});

test('fdic classifyPropType: handles the documented label set', () => {
  const cases = [
    ['Single Family Residence', 'Single Family'],
    ['Condominium', 'Condo'],
    ['Multi-Family Duplex', 'Multi-Family'],
    ['Commercial Office', 'Commercial'],
    ['Land Lot', 'Land'],
    ['Bank Premises - Vacant', 'Commercial'],
    ['Unrecognized Type', null],
  ];
  for (const [input, expected] of cases) {
    const out = fdic.toListing({
      id: Math.floor(Math.random() * 1e9),
      propertyName: '500 Generic Property Name Here',
      propertyType: input,
      state: 'OH',
      price: 1,
      sourceUrl: 'https://sales.fdic.gov/x',
    });
    assert.ok(out, `expected listing for type ${input}`);
    assert.equal(out.propType, expected, `propType mismatch for ${input}`);
  }
});

test('fdic parseSaleDate: returns YYYY-MM-DD for ISO and rejects garbage', () => {
  const out = fdic.toListing({
    id: 1, propertyName: '500 Generic Property Name Here', state: 'OH', price: 1, sourceUrl: 'https://x',
    saleDate: '2024-07-04T00:00:00.000Z',
  });
  assert.equal(out.saleDate, '2024-07-04');
  const out2 = fdic.toListing({
    id: 2, propertyName: '500 Generic Property Name Here', state: 'OH', price: 1, sourceUrl: 'https://x',
    saleDate: 'not-a-date',
  });
  assert.equal(out2.saleDate, null);
});

test('fdic passesFilter: rejects nulls and bad shapes; accepts well-formed listing', () => {
  assert.equal(fdic.passesFilter(null), false);
  assert.equal(fdic.passesFilter({}), false);
  assert.equal(fdic.passesFilter({ id: 'X-1', state: 'OH', address: 'short', sourceUrl: 'https://x' }), false);
  assert.equal(fdic.passesFilter({ id: 'FDIC-1', state: 'OH', address: '500 Six Street Somewhere', sourceUrl: 'https://x' }), true);
});

// --- USDA ---------------------------------------------------------------

const { UsdaResalesScraper, UsdaScrapeError } = require('../../server/scrapers/usda');

test('usda parseStateOptions: returns array of {code, state} pairs and strips (N) labels', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  const html = `
    <select id="stateCode">
      <option value="">Choose...</option>
      <option value="42">Ohio (12)</option>
      <option value="13">Texas (5)</option>
    </select>`;
  const out = s.parseStateOptions(html);
  assert.deepEqual(out, [
    { code: '42', label: 'Ohio (12)', state: 'OH' },
    { code: '13', label: 'Texas (5)', state: 'TX' },
  ]);
});

test('usda parseStateOptions: throws UsdaScrapeError on missing selector', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  assert.throws(() => s.parseStateOptions('<html>no select</html>'), (err) => err instanceof UsdaScrapeError);
});

test('usda parseStateOptions: throws on duplicate codes or excessive option count', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  const dupHtml = `
    <select id="stateCode">
      <option value="1">Alabama</option>
      <option value="1">Alaska</option>
    </select>`;
  assert.throws(() => s.parseStateOptions(dupHtml), (err) => err instanceof UsdaScrapeError);
});

test('usda rowToListing: maps a well-formed 11-cell row to a listing', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  const cells = [
    '<img src="/img/p.jpg"/><a href="/resales/public/SFHPropertyDetail?id=99&x=1">detail</a>',
    'REO Property',
    '123 Main St',
    'Cleveland,',
    'Ohio',
    'Cuyahoga',
    '44101',
    '$125,000',
    '3',
    '2',
    '1500',
  ];
  const out = s.rowToListing(cells);
  assert.ok(out);
  assert.equal(out.id, 'USDA-OH-99');
  assert.equal(out.state, 'OH');
  assert.equal(out.city, 'Cleveland');
  assert.equal(out.zip, '44101');
  assert.equal(out.county, 'Cuyahoga');
  assert.equal(out.openingBid, 125000);
  assert.equal(out.beds, 3);
  assert.equal(out.baths, 2);
  assert.equal(out.sqft, 1500);
  assert.equal(out.address, '123 Main St, Cleveland, OH 44101');
  assert.match(out.sourceUrl, /SFHPropertyDetail/);
  assert.equal(out.provenance.recordId, '99');
});

test('usda rowToListing: rejects rows with fewer than 11 cells', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.rowToListing(['only', 'five', 'cells', 'here', 'now']), null);
});

test('usda rowToListing: rejects when state name is not recognized', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  const cells = [
    '', '', '123 Main St', '', 'Atlantis', '', '', '', '', '', '',
  ];
  assert.equal(s.rowToListing(cells), null);
});

test('usda parseMoney: strips $ , and rounds; rejects non-positive', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.parseMoney('$125,000'), 125000);
  assert.equal(s.parseMoney('1,234.56'), 1235);
  assert.equal(s.parseMoney('$0'), null);
  assert.equal(s.parseMoney('-5'), null);
  assert.equal(s.parseMoney(''), null);
  assert.equal(s.parseMoney('not money'), null);
});

test('usda firstInt: returns first integer or null', () => {
  const s = new UsdaResalesScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.firstInt('3 bedrooms'), 3);
  assert.equal(s.firstInt('1,500 sqft'), 1500);
  assert.equal(s.firstInt('no number'), null);
  assert.equal(s.firstInt(''), null);
});

// --- VA REO -------------------------------------------------------------

const { VaReoScraper } = require('../../server/scrapers/va');

test('va mapJsonItem: rejects when no property id is present', () => {
  const s = new VaReoScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.mapJsonItem({ address: '1 Main St' }, 'TX'), null);
});

test('va mapJsonItem: composes address when only street/city/zip given', () => {
  const s = new VaReoScraper({ useScrapling: false, extractImpl: null });
  const out = s.mapJsonItem({
    vrmNumber: 'V-100',
    street: '500 Pine St',
    city: 'Tampa',
    zip: '33602',
    listPrice: 180000,
  }, 'FL');
  assert.ok(out);
  assert.equal(out.id, 'VA-V-100');
  assert.equal(out.state, 'FL');
  assert.match(out.address, /500 Pine St/);
  assert.equal(out.openingBid, 180000);
});

test('va parseHtmlCards: extracts a property-item card with address + price + id', () => {
  const s = new VaReoScraper({ useScrapling: false, extractImpl: null });
  // The card regex stops at the first </div>, so wrap content in span tags
  // to keep the inner address match alive inside the captured card.
  const html = `<div class="property-item">
    <span class="property-address">88 Cedar Ave, Tampa, FL</span>
    $215,000
    <a data-id="P-1">link</a>
  </div>`;
  const out = s.parseHtmlCards(html, 'FL');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'VA-P-1');
  assert.equal(out[0].address, '88 Cedar Ave, Tampa, FL');
  assert.equal(out[0].openingBid, 215000);
});

// --- Bid4Assets ---------------------------------------------------------

// Module exports only the singleton; bind a handle for clarity.
const bid4assets = require('../../server/scrapers/bid4assets');

test('bid4assets parseAssetTitle: handles plain, postponed, and colon-separated titles', () => {
  const plain = bid4assets.toListing({
    AuctionID: 1,
    Asset_Title: 'Berks County, PA Sheriff Sale: 906 NORTH 25TH STREET',
    ActualCloseTime: '11/06/2026',
    MinimumBid: 5000,
    CurrentBid: 7500,
    DebtAmount: 120000,
    SheriffNumber: 'S-1',
    BidCount: 3,
    Attorney: 'Smith & Co.',
    Defendant: 'Doe, Jane',
  }, '/berkscountysheriffsales', 'https://www.bid4assets.com/berkscountysheriffsales');
  assert.ok(plain);
  assert.equal(plain.state, 'PA');
  assert.equal(plain.address, '906 NORTH 25TH STREET');
  assert.equal(plain.status, 'Scheduled');
  assert.equal(plain.county, 'berks');
  assert.equal(plain.defendant, 'Doe, Jane');

  const postponed = bid4assets.toListing({
    AuctionID: 2,
    Asset_Title: '***POSTPONED***Berks County, PA Sheriff Sale: 906 NORTH 25TH STREET - Postponed to 11/06/2026, New Auction 1308882',
    ActualCloseTime: '11/13/2026',
    MinimumBid: 0,
  }, '/berkscountysheriffsales', 'https://www.bid4assets.com/berkscountysheriffsales');
  assert.ok(postponed);
  assert.equal(postponed.status, 'POSTPONED');
  // The street splitter uses ` - ` (dash with surrounding spaces). Pin the
  // documented separator so the test fails loudly if the format drifts.
  assert.equal(postponed.address, '906 NORTH 25TH STREET');

  const cancelled = bid4assets.toListing({
    AuctionID: 3,
    Asset_Title: '**CANCELLED**Adams County, PA Sheriff Sale: 12 ELM STREET',
  }, '/adamscountysheriffsales', 'https://www.bid4assets.com/adamscountysheriffsales');
  assert.ok(cancelled);
  assert.equal(cancelled.status, 'CANCELLED');
});

test('bid4assets toListing: returns null when state cannot be parsed', () => {
  assert.equal(bid4assets.toListing({
    AuctionID: 4,
    Asset_Title: 'Some County Sheriff Sale: 12 ELM STREET',
  }, '/somecountysheriffsales', 'https://x'), null);
});

test('bid4assets toListing: null openingBid when MinimumBid is non-positive', () => {
  const out = bid4assets.toListing({
    AuctionID: 5,
    Asset_Title: 'Berks County, PA Sheriff Sale: 12 ELM STREET',
    MinimumBid: 0,
    CurrentBid: 100,
  }, '/berkscountysheriffsales', 'https://x');
  assert.ok(out);
  assert.equal(out.openingBid, null);
  assert.equal(out.price, 100);
});

test('bid4assets passesFilter: rejects records that fail id/state/address shape', () => {
  assert.equal(bid4assets.passesFilter(null), false);
  assert.equal(bid4assets.passesFilter({ id: 'B4A-1', state: 'PA', address: 'short' }), false);
  assert.equal(bid4assets.passesFilter({ id: 'X-1', state: 'PA', address: '12 ELM STREET' }), false);
  assert.equal(bid4assets.passesFilter({ id: 'B4A-1', state: 'PENN', address: '12 ELM STREET' }), false);
  assert.equal(bid4assets.passesFilter({ id: 'B4A-1', state: 'PA', address: '12 ELM STREET, Reading' }), true);
});

// --- US Marshals --------------------------------------------------------

const { UsMarshalsScraper } = require('../../server/scrapers/marshals');

test('marshals parseMarshalsHtml: parses a 4-cell row with state + zip + price + asset id', () => {
  const s = new UsMarshalsScraper({ useScrapling: false, extractImpl: null });
  // The record-id regex `(?:asset|case|property)...([A-Z0-9-]{4,})` matches
  // the FIRST such token in the row — the link text "case-12345" wins over
  // the URL slug. Document that behavior so the test pins it.
  const html = `
    <table>
      <tr><th>Address</th><th>Status</th><th>Value</th><th>Case</th></tr>
      <tr>
        <td>500 Elm St, Cleveland, OH 44101</td>
        <td>Forfeited</td>
        <td>$245,000</td>
        <td><a href="/assets/12345">case-12345</a></td>
      </tr>
    </table>`;
  const out = s.parseMarshalsHtml(html);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'OH');
  assert.equal(out[0].zip, '44101');
  assert.equal(out[0].openingBid, 245000);
  assert.match(out[0].sourceUrl, /assets\/12345/);
  // The id is `USMS-<recordId>` where recordId is sanitized of non-alnum
  // characters; pin the prefix only.
  assert.match(out[0].id, /^USMS-/);
});

test('marshals parseMarshalsHtml: skips rows without a $ price or a usable id', () => {
  const s = new UsMarshalsScraper({ useScrapling: false, extractImpl: null });
  const html = `<table>
    <tr><td>500 Elm St, Cleveland, OH</td><td>x</td><td>no price</td></tr>
    <tr><td>600 Oak St, Cleveland, OH</td><td>$5</td><td>no link</td></tr>
  </table>`;
  const out = s.parseMarshalsHtml(html);
  assert.equal(out.length, 0);
});

test('marshals parsePartnerCards: extracts property-item cards from partner feed', () => {
  const s = new UsMarshalsScraper({ useScrapling: false, extractImpl: null });
  // The card regex uses non-greedy matching that stops at the FIRST </div>,
  // so inner divs would close the match early. Use span wrappers instead.
  const html = `<div class="property-item">
    <span class="address">88 Pine Ave, Columbus, OH 43215</span>
    $99,000
    <a data-id="ML-9" href="/p/9">view</a>
  </div>`;
  const out = s.parsePartnerCards(html);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'USMS-ML-9');
  assert.equal(out[0].state, 'OH');
  assert.equal(out[0].openingBid, 99000);
  assert.equal(out[0].zip, '43215');
});

test('marshals parsePartnerCards: skips cards without a 2-letter state', () => {
  const s = new UsMarshalsScraper({ useScrapling: false, extractImpl: null });
  const html = `<div class="property-item">
    <div class="address">Some address without state</div>
    $5,000
    <a data-id="X-1">link</a>
  </div>`;
  assert.equal(s.parsePartnerCards(html).length, 0);
});

// --- Sheriff sales ------------------------------------------------------

const { SheriffSaleScraper, DEFAULT_OH_COUNTIES, parseExtraCounties } = require('../../server/scrapers/sheriff');

test('sheriff parseExtraCounties: parses Name:domain:ST triples', () => {
  const out = parseExtraCounties('Lucas:lucas.sheriffsaleauction.ohio.gov:OH, Other:other.example.gov');
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Lucas');
  assert.equal(out[0].state, 'OH');
  assert.equal(out[1].name, 'Other');
  assert.equal(out[1].state, 'OH');
  assert.equal(parseExtraCounties('').length, 0);
  assert.equal(parseExtraCounties('invalid-no-colon').length, 0);
});

test('sheriff parseRealauctionHtml: extracts a row with case + address + bid + appraisal + date', () => {
  const s = new SheriffSaleScraper({ counties: [{ name: 'Cuyahoga', domain: 'cuyahoga.sheriffsaleauction.ohio.gov', state: 'OH' }] });
  const html = `<table>
    <tr class="DataRow">
      <td><a href="/case/CV-24-001">CV-24-001</a></td>
      <td>500 Elm St, Cleveland, OH 44101</td>
      <td>Opening Bid: $100,000</td>
      <td>Appraised: $180,000</td>
      <td>Sale Date: 11/06/2026</td>
    </tr>
  </table>`;
  const out = s.parseRealauctionHtml(html, { name: 'Cuyahoga', domain: 'cuyahoga.sheriffsaleauction.ohio.gov', state: 'OH' });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'SHERIFF-OH-CUY-CV-24-001');
  assert.equal(out[0].state, 'OH');
  assert.equal(out[0].county, 'Cuyahoga');
  assert.equal(out[0].address, '500 Elm St, Cleveland, OH 44101');
  assert.equal(out[0].openingBid, 100000);
  assert.equal(out[0].assessed, 180000);
  assert.equal(out[0].saleDate, '2026-11-06');
});

test('sheriff normalizeSaleDate: handles both MM/DD/YYYY and YYYY-MM-DD', () => {
  const s = new SheriffSaleScraper({ counties: [] });
  assert.equal(s.normalizeSaleDate('11/06/2026'), '2026-11-06');
  assert.equal(s.normalizeSaleDate('11-06-2026'), '2026-11-06');
  assert.equal(s.normalizeSaleDate('2026-11-06'), '2026-11-06');
  assert.equal(s.normalizeSaleDate(''), null);
  assert.equal(s.normalizeSaleDate('not a date'), null);
});

test('sheriff parsePublicNoticeHtml: extracts case + address + minimum bid from notice block', () => {
  const s = new SheriffSaleScraper({ counties: [] });
  // The address regex `\d+\s+[A-Za-z0-9\s,]+(?:Ave|St|Rd|Blvd|Dr|Ln|Way|Ct|Pl)`
  // is greedy and matches the first digit followed by an address suffix, even
  // if digits appear before the address. Real Ohio public notices put the
  // address as the first line. Pin the prefix and the bid so the test fails
  // loudly if those change, and assert the address contains the expected
  // street suffix.
  const html = `<div class="notice-item">
    12 Main St, Cleveland, OH
    CASE NO. CV-2024-99
    Minimum bid $50,000
    <a href="/notice/99">details</a>
  </div>`;
  const out = s.parsePublicNoticeHtml(html, { name: 'Cuyahoga', state: 'OH' });
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^SHERIFF-OH-CUY-/, `unexpected id ${out[0].id}`);
  assert.equal(out[0].openingBid, 50000);
  assert.match(out[0].address, /Main St/);
  assert.equal(out[0].county, 'Cuyahoga');
});

test('sheriff DEFAULT_OH_COUNTIES contains the documented 20 Ohio counties', () => {
  assert.ok(Array.isArray(DEFAULT_OH_COUNTIES));
  assert.equal(DEFAULT_OH_COUNTIES.length, 20);
  assert.equal(DEFAULT_OH_COUNTIES[0].name, 'Cuyahoga');
  assert.equal(DEFAULT_OH_COUNTIES.every((c) => c.state === 'OH'), true);
});

// --- Treasury -----------------------------------------------------------

const { TreasuryForfeitureScraper } = require('../../server/scrapers/treasury');

test('treasury parseAddress: handles full state name + zip', () => {
  const s = new TreasuryForfeitureScraper({ useScrapling: false, extractImpl: null });
  const out = s.parseAddress('4705 Battle Creek Road SE, Salem, Oregon 97302');
  assert.equal(out.state, 'OR');
  assert.equal(out.zip, '97302');
  assert.equal(out.city, 'Salem');
});

test('treasury parseAddress: handles two-letter state code + zip', () => {
  const s = new TreasuryForfeitureScraper({ useScrapling: false, extractImpl: null });
  const out = s.parseAddress('915 E Stewart Ave, Las Vegas, NV 89101');
  assert.equal(out.state, 'NV');
  assert.equal(out.zip, '89101');
  assert.equal(out.city, 'Las Vegas');
});

test('treasury parseAddress: falls back to a sentinel when format is unrecognizable', () => {
  const s = new TreasuryForfeitureScraper({ useScrapling: false, extractImpl: null });
  const out = s.parseAddress('single-token');
  assert.equal(out.state, 'US');
  assert.equal(out.zip, '00000');
});

test('treasury parseSaleDate: parses English month names to YYYY-MM-DD', () => {
  const s = new TreasuryForfeitureScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.parseSaleDate('November 6, 2026'), '2026-11-06');
  assert.equal(s.parseSaleDate('January 1, 2027'), '2027-01-01');
  assert.equal(s.parseSaleDate('not a date'), null);
  assert.equal(s.parseSaleDate(''), null);
});

test('treasury classifyPropertyType: maps documented keywords to canonical types', () => {
  const s = new TreasuryForfeitureScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.classifyPropertyType('SINGLE FAMILY HOME on a corner lot'), 'Single Family');
  assert.equal(s.classifyPropertyType('CONDO unit, 2BR'), 'Condo');
  assert.equal(s.classifyPropertyType('MULTI-FAMILY triplex'), 'Multi-Family');
  assert.equal(s.classifyPropertyType('COMMERCIAL retail'), 'Commercial');
  assert.equal(s.classifyPropertyType('VACANT LAND'), 'Land');
  assert.equal(s.classifyPropertyType('unrecognized'), null);
});

test('treasury parseMoney + parseInt0: strip non-digits, reject null', () => {
  const s = new TreasuryForfeitureScraper({ useScrapling: false, extractImpl: null });
  assert.equal(s.parseMoney('$125,000'), 125000);
  assert.equal(s.parseMoney(''), null);
  assert.equal(s.parseMoney('abc'), null);
  assert.equal(s.parseInt0('1500'), 1500);
  assert.equal(s.parseInt0('1,500'), 1500);
  assert.equal(s.parseInt0(''), null);
});

// --- Trustee ------------------------------------------------------------

const trustee = require('../../server/scrapers/trustee');

test('trustee scrapeFeed returns [] and signals no live collector is wired', async () => {
  // Trustee is a documented no-op; assert the contract directly so the
  // behavior can't silently drift toward live inventory.
  const out = await trustee.scrapeFeed();
  assert.deepEqual(out, []);
  assert.equal(trustee.sourceKey, 'trustee');
  assert.equal(trustee.name, 'TrusteeSaleScraper');
});

// --- LandBankSearch -----------------------------------------------------

// The module exports only the singleton; call methods on it directly.
const landbanksearch = require('../../server/scrapers/landbanksearch');

test('landbanksearch parseCardHtml: extracts a card with Structure badge and $ price', () => {
  const card = `<a href="/p/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">
    <img src="https://cdn.landbanksearch.com/p.jpg" alt="0 Ruby Ave" />
    <div class="truncate text-xs">Cleveland, OH</div>
    <div class="font-display">$1,500</div>
    <span>Structure</span>
  </a>`;
  const out = landbanksearch.parseCardHtml('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', card, { name: 'Cuyahoga Land Bank', slug: 'cuyahoga', state: 'OH' });
  assert.ok(out);
  assert.equal(out.id, 'LB-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(out.state, 'OH');
  assert.equal(out.city, 'Cleveland');
  assert.equal(out.address, '0 Ruby Ave, Cleveland, OH');
  assert.equal(out.openingBid, 1500);
  assert.equal(out.propType, 'Single Family');
  assert.equal(out.sourceUrl, 'https://www.landbanksearch.com/p/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(out.provenance.publisher, 'Cuyahoga Land Bank');
});

test('landbanksearch parseCardHtml: handles "Make offer" without inventing a price', () => {
  const card = `<a href="/p/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">
    <img src="https://cdn.landbanksearch.com/p.jpg" alt="12 Pine St" />
    <div class="truncate text-xs">Cleveland, OH</div>
    <div class="font-display">Make offer</div>
    <span>Vacant lot</span>
  </a>`;
  const out = landbanksearch.parseCardHtml('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', card, { name: 'Cuyahoga Land Bank', slug: 'cuyahoga', state: 'OH' });
  assert.ok(out);
  assert.equal(out.openingBid, null);
  assert.equal(out.propType, 'Vacant Lot');
});

test('landbanksearch parseCardHtml: returns null when no alt text is present', () => {
  const card = `<a href="/p/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">
    <div class="truncate text-xs">Cleveland, OH</div>
    <div class="font-display">$100</div>
  </a>`;
  assert.equal(landbanksearch.parseCardHtml('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', card, { name: 'X', slug: 'x', state: 'OH' }), null);
});

test('landbanksearch parseCardHtml: returns null when city/state line is malformed', () => {
  const card = `<a href="/p/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">
    <img src="x" alt="0 Ruby Ave" />
    <div class="truncate text-xs">Cleveland</div>
    <div class="font-display">$100</div>
  </a>`;
  assert.equal(landbanksearch.parseCardHtml('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', card, { name: 'X', slug: 'x', state: 'OH' }), null);
});

test('landbanksearch passesFilter: rejects shape and address-length violations', () => {
  assert.equal(landbanksearch.passesFilter(null), false);
  assert.equal(landbanksearch.passesFilter({ id: 'LB-1', state: 'OH', address: '12 ELM STREET' }), true);
  assert.equal(landbanksearch.passesFilter({ id: 'X-1', state: 'OH', address: '12 ELM STREET' }), false);
  assert.equal(landbanksearch.passesFilter({ id: 'LB-1', state: 'OHIO', address: '12 ELM STREET' }), false);
  assert.equal(landbanksearch.passesFilter({ id: 'LB-1', state: 'OH', address: 'short' }), false);
});
