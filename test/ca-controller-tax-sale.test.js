'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CaControllerTaxSaleScraper,
  CA_COUNTY_FIPS,
  DIRECTORY_URL,
  SOURCE_KEY,
  classifyPropType,
  parseDateText,
  parseMoney,
  normalizeCountyName
} = require('../server/scrapers/ca-controller-tax-sale');
const { validateListingForIngestion } = require('../server/scrapers/validation');
const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
const { buildParcelKey, normalizeApn } = require('../server/scrapers/normalization');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DIRECTORY_HTML = `<!DOCTYPE html>
<html>
<head><title>Tax-Defaulted Property Sales</title></head>
<body>
<h1>California Tax-Defaulted Property Sales</h1>
<table>
  <thead>
    <tr>
      <th>County</th>
      <th>Sale Date</th>
      <th>Parcel List</th>
      <th>County Sale Page</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Orange</td>
      <td>March 15, 2026</td>
      <td><a href="https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html">Parcel List</a></td>
      <td><a href="https://www.sco.ca.gov/boe_tax_sales_orange.html">Orange Sale</a></td>
    </tr>
    <tr>
      <td>Sacramento</td>
      <td>04/22/2026</td>
      <td><a href="https://www.sco.ca.gov/boe_tax_sales_sacramento_parcels.html">Parcel List</a></td>
      <td><a href="https://www.sco.ca.gov/boe_tax_sales_sacramento.html">Sacramento Sale</a></td>
    </tr>
    <tr>
      <td>Los Angeles</td>
      <td>TBD</td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>
</body>
</html>`;

const ORANGE_PARCELS_HTML = `<!DOCTYPE html>
<html>
<body>
<table>
  <thead>
    <tr>
      <th>Parcel</th>
      <th>Situs Address</th>
      <th>Property Type</th>
      <th>Assessed Value</th>
      <th>Minimum Bid</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>123-456-789</td>
      <td>100 MAIN ST, ANAHEIM, CA 92805</td>
      <td>Single Family Residence</td>
      <td>$250,000</td>
      <td>$12,500.00</td>
    </tr>
    <tr>
      <td>987-654-321</td>
      <td>VACANT LOT ON HARBOR BLVD</td>
      <td>Vacant Land</td>
      <td>$80,000</td>
      <td>$4,000</td>
    </tr>
    <tr>
      <td>555-000-111</td>
      <td>42 INDUSTRIAL WAY, SANTA ANA</td>
      <td>Commercial Warehouse</td>
      <td>$1,200,000</td>
      <td></td>
    </tr>
  </tbody>
</table>
</body>
</html>`;

const SACRAMENTO_PARCELS_HTML = `<!DOCTYPE html>
<html>
<body>
<table>
  <tr>
    <th>APN</th>
    <th>Address</th>
    <th>Description</th>
    <th>Assessed</th>
    <th>Min Bid</th>
  </tr>
  <tr>
    <td>001-222-033</td>
    <td>900 CAPITOL MALL, SACRAMENTO, CA 95814</td>
    <td>Office Building</td>
    <td>$900,000</td>
    <td>$45,000</td>
  </tr>
</table>
</body>
</html>`;

const SACRAMENTO_PARCELS_CSV = `Parcel,Situs Address,Description,Assessed Value,Minimum Bid,Sale Date
010-200-300,"55 RIVER RD, SACRAMENTO, CA 95814",Single Family,$310000,$15500,2026-04-22
`;

const POSITIONAL_PARCELS_HTML = `<!DOCTYPE html>
<html>
<body>
<table>
  <tr><td>077-100-200</td><td>12 OAK AVE, IRVINE, CA 92618</td><td>$400,000</td><td>$20,000</td></tr>
</table>
</body>
</html>`;

const MALFORMED_HTML = `<html><body><table><tr><td>Orange
<div><span>no closing tags`;

const EMPTY_HTML = `<!DOCTYPE html><html><body><p>No sales scheduled.</p></body></html>`;

function textResponse(status, body, contentType = 'text/html') {
  return {
    status,
    headers: new Headers({ 'content-type': contentType }),
    text: async () => (typeof body === 'string' ? body : String(body))
  };
}

function makeScraper(options = {}) {
  const requests = [];
  const responses = options.responses || {};
  const scraper = new CaControllerTaxSaleScraper({
    maxRecords: options.maxRecords ?? 50,
    maxCounties: options.maxCounties ?? 25,
    sleep: async () => {},
    random: () => 0,
    useScrapling: false,
    fetchImpl: options.fetchImpl || (async (url) => {
      requests.push(String(url));
      const key = String(url);
      if (Object.prototype.hasOwnProperty.call(responses, key)) {
        const entry = responses[key];
        if (entry instanceof Error) throw entry;
        if (entry && typeof entry === 'object' && typeof entry.status === 'number') return entry;
        return textResponse(200, entry);
      }
      // Default: directory fixture for the directory URL, empty for others.
      if (String(url).includes('boe_tax_sales.html')) return textResponse(200, DIRECTORY_HTML);
      return textResponse(200, EMPTY_HTML);
    }),
    ...options
  });
  scraper.requests = requests;
  return scraper;
}

function fullPipelineScraper(options = {}) {
  const scraper = makeScraper({
    responses: {
      [DIRECTORY_URL]: DIRECTORY_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html': ORANGE_PARCELS_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_sacramento_parcels.html': SACRAMENTO_PARCELS_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange.html': ORANGE_PARCELS_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_sacramento.html': SACRAMENTO_PARCELS_HTML
    },
    ...options
  });
  return scraper;
}

// ---------------------------------------------------------------------------
// Directory page parsing
// ---------------------------------------------------------------------------

test('parses county entries from the Controller directory HTML table', () => {
  const scraper = makeScraper();
  const counties = scraper.parseDirectory(DIRECTORY_HTML, DIRECTORY_URL);

  assert.ok(counties.length >= 2, 'expected at least two counties with links');
  const orange = counties.find((c) => c.county === 'Orange');
  assert.ok(orange);
  assert.equal(orange.saleDate, '2026-03-15');
  assert.equal(orange.parcelListUrl, 'https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html');
  assert.equal(orange.countyPageUrl, 'https://www.sco.ca.gov/boe_tax_sales_orange.html');

  const sacramento = counties.find((c) => c.county === 'Sacramento');
  assert.ok(sacramento);
  assert.equal(sacramento.saleDate, '2026-04-22');

  // Los Angeles has no sale date and no list link — still discovered as a
  // county entry but not visitable.
  const la = counties.find((c) => c.county === 'Los Angeles');
  assert.ok(la, 'directory should still name LA even without a list');
  assert.equal(la.saleDate, null);
});

test('normalizes county names and looks up California FIPS', () => {
  assert.equal(normalizeCountyName('Orange County'), 'Orange');
  assert.equal(normalizeCountyName('Los Angeles'), 'Los Angeles');
  assert.equal(normalizeCountyName('SAN DIEGO'), 'San Diego');
  assert.equal(normalizeCountyName(''), null);
  assert.equal(CA_COUNTY_FIPS.orange, '06059');
  assert.equal(CA_COUNTY_FIPS['los angeles'], '06037');
  assert.equal(CA_COUNTY_FIPS['san francisco'], '06075');
  assert.equal(Object.keys(CA_COUNTY_FIPS).length, 58);
});

test('parses sale dates without fabricating TBD values', () => {
  assert.equal(parseDateText('March 15, 2026'), '2026-03-15');
  assert.equal(parseDateText('04/22/2026'), '2026-04-22');
  assert.equal(parseDateText('2026-07-01'), '2026-07-01');
  assert.equal(parseDateText('TBD'), null);
  assert.equal(parseDateText('To Be Determined'), null);
  assert.equal(parseDateText(''), null);
  assert.equal(parseDateText(null), null);
});

test('parses money values and rejects non-positive amounts', () => {
  assert.equal(parseMoney('$12,500.00'), 12500);
  assert.equal(parseMoney('45,000'), 45000);
  assert.equal(parseMoney('$0'), null);
  assert.equal(parseMoney('N/A'), null);
  assert.equal(parseMoney(''), null);
});

// ---------------------------------------------------------------------------
// County entry extraction + full pipeline
// ---------------------------------------------------------------------------

test('extracts county entries and maps parcels to the canonical listing contract', async () => {
  const scraper = fullPipelineScraper();
  const listings = await scraper.scrapeFeed();

  assert.ok(listings.length >= 4, `expected multiple parcels, got ${listings.length}`);

  const orangeParcel = listings.find((l) => l.id === 'ca-tax-orange-123-456-789');
  assert.ok(orangeParcel, 'expected orange parcel listing');
  assert.equal(orangeParcel.source, 'ca-controller-tax-sale');
  assert.equal(orangeParcel.state, 'CA');
  assert.equal(orangeParcel.county, 'Orange');
  assert.equal(orangeParcel.address, '100 MAIN ST, ANAHEIM, CA 92805');
  assert.equal(orangeParcel.openingBid, 12500);
  assert.equal(orangeParcel.saleDate, '2026-03-15');
  assert.equal(orangeParcel.assessed, 250000);
  assert.equal(orangeParcel.provenance.sourceFacts.parcelNumber, '123-456-789');
  // Prefer the more specific SCO county sale page when published.
  assert.equal(orangeParcel.sourceUrl, 'https://www.sco.ca.gov/boe_tax_sales_orange.html');

  const facts = orangeParcel.provenance.sourceFacts;
  assert.equal(facts.countyName, 'Orange');
  assert.equal(facts.saleDate, '2026-03-15');
  assert.equal(facts.parcelNumber, '123-456-789');
  assert.equal(facts.assessedValue, 250000);
  assert.equal(facts.minimumBid, 12500);
  assert.equal(facts.countyFips, '06059');
  assert.match(facts.caveat, /discovery index/i);

  assert.equal(orangeParcel.provenance.origin, 'live');
  assert.equal(orangeParcel.provenance.observed, true);
  assert.equal(orangeParcel.provenance.publisher, 'California State Controller Tax-Defaulted Sales Directory');

  const raw = JSON.parse(orangeParcel.raw);
  assert.equal(raw.parcel.parcel, '123-456-789');
  assert.equal(raw.countyEntry.county, 'Orange');

  const validation = validateListingForIngestion(orangeParcel, {
    expectedSource: 'ca-controller-tax-sale'
  });
  assert.equal(validation.isValid, true, validation.errors.join(', '));
});

test('sets openingBid to null when the county publishes no minimum bid', async () => {
  const scraper = fullPipelineScraper();
  const listings = await scraper.scrapeFeed();
  const noBid = listings.find((l) => l.id === 'ca-tax-orange-555-000-111');
  assert.ok(noBid);
  assert.equal(noBid.openingBid, null);
  assert.equal(noBid.assessed, 1200000);
  assert.equal(noBid.saleDate, '2026-03-15');
});

test('uses the county sale date when a parcel row does not repeat it', async () => {
  const scraper = fullPipelineScraper();
  const listings = await scraper.scrapeFeed();
  const sac = listings.find((l) => l.id === 'ca-tax-sacramento-001-222-033');
  assert.ok(sac);
  assert.equal(sac.saleDate, '2026-04-22');
  assert.equal(sac.openingBid, 45000);
  assert.equal(sac.provenance.sourceFacts.countyFips, '06067');
});

test('computes parcelKey from county FIPS and normalized APN', async () => {
  const scraper = fullPipelineScraper();
  const listings = await scraper.scrapeFeed();
  const listing = listings.find((l) => l.id === 'ca-tax-orange-123-456-789');
  assert.ok(listing);
  const expected = buildParcelKey({ apn: '123-456-789', countyFips: '06059' });
  assert.equal(listing.parcelKey, expected);
  assert.equal(listing.parcelKey, `06059-${normalizeApn('123-456-789')}`);
});

// ---------------------------------------------------------------------------
// Parcel list parsing variants
// ---------------------------------------------------------------------------

test('parses a CSV parcel list with published sale date', async () => {
  const scraper = makeScraper({
    responses: {
      [DIRECTORY_URL]: DIRECTORY_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_sacramento_parcels.html': SACRAMENTO_PARCELS_CSV
    }
  });
  const listings = await scraper.scrapeFeed();
  const csvParcel = listings.find((l) => l.id === 'ca-tax-sacramento-010-200-300');
  assert.ok(csvParcel, 'expected CSV parcel listing');
  assert.equal(csvParcel.openingBid, 15500);
  assert.equal(csvParcel.assessed, 310000);
  assert.equal(csvParcel.saleDate, '2026-04-22');
});

test('parses a positional parcel table without headers', async () => {
  const scraper = makeScraper({
    responses: {
      [DIRECTORY_URL]: DIRECTORY_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html': POSITIONAL_PARCELS_HTML
    }
  });
  const listings = await scraper.scrapeFeed();
  const positional = listings.find((l) => l.id === 'ca-tax-orange-077-100-200');
  assert.ok(positional, 'expected positional parcel');
  assert.equal(positional.address, '12 OAK AVE, IRVINE, CA 92618');
  assert.equal(positional.assessed, 400000);
  assert.equal(positional.openingBid, 20000);
  assert.equal(positional.saleDate, '2026-03-15', 'inherits directory sale date');
});

test('classifies property types from parcel descriptions', () => {
  assert.equal(classifyPropType('Single Family Residence'), 'Single Family');
  assert.equal(classifyPropType('Vacant Land'), 'Land');
  assert.equal(classifyPropType('Commercial Warehouse'), 'Commercial');
  assert.equal(classifyPropType('Condominium'), 'Condo');
  assert.equal(classifyPropType(''), 'Unknown');
  assert.equal(classifyPropType(null), 'Unknown');
});

test('falls back to a parcel-derived address when situs is missing', async () => {
  const parcelOnly = `<!DOCTYPE html><html><body><table>
    <tr><th>Parcel</th><th>Assessed Value</th><th>Minimum Bid</th></tr>
    <tr><td>111-222-333</td><td>$10,000</td><td>$500</td></tr>
  </table></body></html>`;
  const scraper = makeScraper({
    maxRecords: 1,
    responses: {
      [DIRECTORY_URL]: DIRECTORY_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html': parcelOnly
    }
  });
  const listings = await scraper.scrapeFeed();
  const listing = listings.find((l) => l.id === 'ca-tax-orange-111-222-333');
  assert.ok(listing);
  assert.equal(listing.address, 'Parcel 111-222-333, Orange County');
  assert.ok(listing.address.length >= 8);
});

// ---------------------------------------------------------------------------
// Bounded collection
// ---------------------------------------------------------------------------

test('respects the default 50-record budget and reports truncation', async () => {
  const manyRows = Array.from({ length: 80 }, (_, i) => `
    <tr>
      <td>000-${String(i).padStart(3, '0')}-999</td>
      <td>${100 + i} MARKET ST, ANAHEIM, CA 92805</td>
      <td>Single Family</td>
      <td>$200,000</td>
      <td>$10,000</td>
    </tr>`).join('');
  const bigList = `<!DOCTYPE html><html><body><table>
    <tr><th>Parcel</th><th>Situs Address</th><th>Type</th><th>Assessed</th><th>Min Bid</th></tr>
    ${manyRows}
  </table></body></html>`;
  const scraper = makeScraper({
    maxRecords: 50,
    responses: {
      [DIRECTORY_URL]: DIRECTORY_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html': bigList
    }
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 50);
  assert.equal(scraper.lastRunReport.truncated, true);
  assert.equal(scraper.lastRunReport.recordsEmitted, 50);
  assert.equal(scraper.lastRunReport.fixtureFallbackUsed, false);
});

// ---------------------------------------------------------------------------
// Fixture / demo rejection
// ---------------------------------------------------------------------------

test('emits only live-observed provenance and never falls back to fixtures', async () => {
  const scraper = fullPipelineScraper();
  scraper.getVerifiedInventory = () => {
    throw new Error('fixture inventory must not be read');
  };

  const listings = await scraper.scrapeFeed();
  assert.ok(listings.length > 0);
  for (const listing of listings) {
    assert.equal(listing.provenance.origin, 'live');
    assert.equal(listing.provenance.observed, true);
    assert.notEqual(listing.provenance.fixture, true);
    assert.ok(listing.provenance.observedAt);
  }
  assert.equal(scraper.lastRunReport.fixtureFallbackUsed, false);

  const fixtureShaped = {
    ...listings[0],
    provenance: { ...listings[0].provenance, origin: 'fixture', observed: false, fixture: true }
  };
  const validation = validateListingForIngestion(fixtureShaped, {
    expectedSource: 'ca-controller-tax-sale'
  });
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.includes('fixture_record_not_ingestible'));
});

// ---------------------------------------------------------------------------
// Empty / missing county pages
// ---------------------------------------------------------------------------

test('treats an empty directory as an empty run, not a failure', async () => {
  const scraper = makeScraper({
    responses: { [DIRECTORY_URL]: EMPTY_HTML }
  });
  const listings = await scraper.scrapeFeed();
  assert.deepEqual(listings, []);
  assert.equal(scraper.lastRunReport.outcome, 'empty');
  assert.equal(scraper.lastRunReport.recordsEmitted, 0);
});

test('skips county parcel lists that 404 without failing the whole run', async () => {
  const scraper = makeScraper({
    responses: {
      [DIRECTORY_URL]: DIRECTORY_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html': textResponse(404, 'Not Found'),
      'https://www.sco.ca.gov/boe_tax_sales_sacramento_parcels.html': SACRAMENTO_PARCELS_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange.html': textResponse(404, 'Not Found'),
      'https://www.sco.ca.gov/boe_tax_sales_sacramento.html': SACRAMENTO_PARCELS_HTML
    }
  });
  const listings = await scraper.scrapeFeed();
  const sac = listings.find((l) => l.county === 'Sacramento');
  assert.ok(sac, 'reachable county should still collect');
  assert.equal(listings.some((l) => l.county === 'Orange'), false);
  assert.ok(scraper.lastRunReport.failures.length >= 1);
  assert.equal(scraper.lastRunReport.outcome, 'partial_failure');
});

test('handles malformed HTML without throwing', async () => {
  const scraper = makeScraper({
    responses: {
      [DIRECTORY_URL]: MALFORMED_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange_parcels.html': MALFORMED_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_sacramento_parcels.html': MALFORMED_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_orange.html': MALFORMED_HTML,
      'https://www.sco.ca.gov/boe_tax_sales_sacramento.html': MALFORMED_HTML
    }
  });
  const listings = await scraper.scrapeFeed();
  assert.ok(Array.isArray(listings));
  // Malformed tables should not invent parcel numbers.
  assert.equal(listings.every((l) => l.provenance.sourceFacts.parcelNumber), true);
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

test('circuit breaker halts immediately on HTTP 403', async () => {
  let calls = 0;
  const scraper = makeScraper({
    fetchImpl: async () => {
      calls += 1;
      return textResponse(403, 'Forbidden');
    }
  });

  await assert.rejects(scraper.scrapeFeed(), (error) => {
    return error.code === 'UPSTREAM_FORBIDDEN' || /403|Forbidden|circuit/i.test(error.message);
  });
  assert.equal(calls, 1, '403 must halt after a single request');
  assert.equal(scraper.circuitBreaker.isOpen(), true);
});

test('circuit breaker opens after consecutive HTTP 500 responses', async () => {
  let calls = 0;
  const scraper = makeScraper({
    maxRetries: 3,
    fetchImpl: async () => {
      calls += 1;
      return textResponse(500, 'Internal Server Error');
    }
  });

  await assert.rejects(scraper.scrapeFeed());
  assert.ok(calls >= 1);
  assert.equal(scraper.circuitBreaker.isOpen(), true);
  assert.match(scraper.circuitBreaker.lastFailureReason || '', /500|HTTP/i);
});

test('Cloudflare challenge bodies trip the circuit breaker', async () => {
  const challenge = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
    <body>Checking your browser before accessing. attention required! | cloudflare</body></html>`;
  const scraper = makeScraper({
    fetchImpl: async () => textResponse(200, challenge)
  });
  await assert.rejects(scraper.scrapeFeed());
  assert.equal(scraper.circuitBreaker.isOpen(), true);
});

// ---------------------------------------------------------------------------
// Source-policy URL validation
// ---------------------------------------------------------------------------

test('source-policy accepts the Controller directory URL and rejects lookalikes', () => {
  const good = inspectSourceRecordUrl('ca-controller-tax-sale', DIRECTORY_URL);
  assert.equal(good.isValid, true, good.error);
  assert.equal(good.url, DIRECTORY_URL);

  const countyPage = inspectSourceRecordUrl(
    'ca-controller-tax-sale',
    'https://www.sco.ca.gov/boe_tax_sales_orange.html'
  );
  assert.equal(countyPage.isValid, true, countyPage.error);

  const pdfList = inspectSourceRecordUrl(
    'ca-controller-tax-sale',
    'https://sco.ca.gov/ard_tax_sale_los_angeles.pdf'
  );
  assert.equal(pdfList.isValid, true, pdfList.error);

  for (const bad of [
    'https://www.sco.ca.gov/',
    'https://www.sco.ca.gov/index.html',
    'https://attacker.example/boe_tax_sales.html',
    'http://www.sco.ca.gov/boe_tax_sales.html',
    'https://www.sco.ca.gov:8443/boe_tax_sales.html',
    'https://user:pass@sco.ca.gov/boe_tax_sales.html',
    'https://orangecounty.net/tax-sales',
    'not-a-url'
  ]) {
    const result = inspectSourceRecordUrl('ca-controller-tax-sale', bad);
    assert.equal(result.isValid, false, bad);
  }
});

// ---------------------------------------------------------------------------
// Collection scope / registration
// ---------------------------------------------------------------------------

test('exposes a bounded collection scope for the discovery store', () => {
  const scraper = makeScraper({ maxRecords: 50 });
  const scope = scraper.getCollectionScope();
  assert.equal(scope.endpoint, '/boe_tax_sales.html');
  assert.deepEqual(scope.filters.states, ['CA']);
  assert.equal(scope.filters.program, 'tax_defaulted_sales');
});

test('scheduler registers ca-controller-tax-sale as a live source key', () => {
  const schedulerModule = require('../server/scrapers/scheduler');
  assert.ok(
    schedulerModule.realScraperKeys.has('ca-controller-tax-sale'),
    'ca-controller-tax-sale must be registered in realScraperKeys'
  );
  assert.ok(
    schedulerModule.realScrapers.some((scraper) => scraper.sourceKey === 'ca-controller-tax-sale'),
    'ca-controller-tax-sale must be present in realScrapers'
  );
});

test('catalog registers ca-controller-tax-sale as a scheduled adapter', () => {
  const { SCHEDULED_ADAPTER_KEYS, getSource } = require('../server/sources/catalog');
  assert.ok(SCHEDULED_ADAPTER_KEYS.includes('ca-controller-tax-sale'));
  const entry = getSource('ca-controller-tax-sale');
  assert.ok(entry);
  assert.equal(entry.adapterKey, 'ca-controller-tax-sale');
  assert.equal(entry.status, 'DISCOVERY_ONLY');
  assert.equal(entry.discoveryUrl, DIRECTORY_URL);
});

test('source-policy host list includes sco.ca.gov', () => {
  const { SOURCE_HOSTS } = require('../server/scrapers/source-policy');
  assert.deepEqual(SOURCE_HOSTS['ca-controller-tax-sale'], ['sco.ca.gov']);
});

test('raw publisher record is retained for discovery evidence ingestion', async () => {
  const scraper = fullPipelineScraper();
  const listings = await scraper.scrapeFeed();
  const listing = listings.find((l) => l.id === 'ca-tax-orange-123-456-789');
  assert.ok(listing);
  const raw = scraper.getRawPublisherRecord(listing);
  assert.ok(raw);
  assert.equal(raw.parcel.parcel, '123-456-789');
  assert.equal(raw.parcel.minimumBid, 12500);
});

test('source key constant matches the catalog and scheduler registration', () => {
  assert.equal(SOURCE_KEY, 'ca-controller-tax-sale');
  assert.equal(DIRECTORY_URL, 'https://www.sco.ca.gov/boe_tax_sales.html');
});
