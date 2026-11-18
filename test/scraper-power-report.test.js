'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, REQUIRED_ENDS, SCRAPLING_PROFILES } = require('../scripts/scraper-power-report');
const { GovernmentLandScraper, validateEnrollmentUrl } = require('../server/scrapers/government-land');
const { LocalSurplusScraper } = require('../server/scrapers/local-surplus');
const { SOURCE_EXPECTED_FIELDS, evaluateRecordsForDrift } = require('../server/scrapers/drift-alarm');

test('validateEnrollmentUrl enforces HTTPS and rejects private/credential/CGNAT/link-local targets', () => {
  assert.equal(validateEnrollmentUrl('').ok, false);
  assert.equal(validateEnrollmentUrl('http://example.gov/sales').ok, false);
  assert.equal(validateEnrollmentUrl('https://user:pass@example.gov/sales').ok, false);
  for (const blockedUrl of [
    'https://localhost/sales',
    'https://sub.localhost/sales',
    'https://127.0.0.1/sales',
    'https://[::1]/sales',
    'https://10.0.0.5/sales',
    'https://172.16.0.5/sales',
    'https://192.168.1.25/sales',
    'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.10/sales',
    'https://[::ffff:127.0.0.1]/sales',
    'https://printer.local/sales',
    'https://metadata.google.internal/computeMetadata/v1/',
  ]) {
    const res = validateEnrollmentUrl(blockedUrl);
    assert.equal(res.ok, false, `${blockedUrl} must be rejected`);
    assert.equal(res.reason, 'loopback-rejected', `${blockedUrl} must return loopback-rejected`);
  }
  assert.equal(validateEnrollmentUrl('https://blm.gov/landsales').ok, true);
});

test('government-land template collector skips without inventing inventory', async () => {
  const scraper = new GovernmentLandScraper({ enrollmentUrl: '' });
  const listings = await scraper.scrapeFeed();
  assert.deepEqual(listings, []);
  assert.equal(scraper.lastRunReport.outcome, 'skipped_not_enrolled');
  assert.equal(scraper.lastRunReport.recordsEmitted, 0);
});

test('local-surplus template collector skips without inventing inventory', async () => {
  const scraper = new LocalSurplusScraper({ enrollmentUrl: '' });
  const listings = await scraper.scrapeFeed();
  assert.deepEqual(listings, []);
  assert.equal(scraper.lastRunReport.outcome, 'skipped_not_enrolled');
});

test('government-land hydrates JSON-LD properties when enrolled', async () => {
  const mockHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "SingleFamilyResidence",
          "name": "BLM Surplus Parcel 401",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "900 Desert Ridge Way",
            "addressLocality": "Moab",
            "addressRegion": "UT",
            "postalCode": "84532"
          },
          "url": "https://blm.gov/landsales/parcel/UT-401",
          "price": "45000"
        }
        </script>
      </head>
      <body><h1>BLM Land Sale</h1></body>
    </html>
  `;
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => mockHtml,
  });

  const scraper = new GovernmentLandScraper({
    enrollmentUrl: 'https://blm.gov/landsales',
    fetchImpl: fetchMock,
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'GOVERNMENT-LAND-UT-401');
  assert.equal(listings[0].state, 'UT');
  assert.equal(listings[0].openingBid, 45000);
  assert.equal(listings[0].estLow, null);
  assert.equal(listings[0].estHigh, null);
  assert.equal(scraper.lastRunReport.outcome, 'success');
});

test('local-surplus hydrates JSON-LD properties when enrolled', async () => {
  const mockHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Place",
          "name": "Municipal Surplus Lot 12",
          "address": "450 County Road 10, Canton, OH 44702",
          "url": "https://starkcountyohio.gov/surplus/detail/STARK-12",
          "price": "15000"
        }
        </script>
      </head>
      <body><h1>County Surplus Auction</h1></body>
    </html>
  `;
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => mockHtml,
  });

  const scraper = new LocalSurplusScraper({
    enrollmentUrl: 'https://starkcountyohio.gov/surplus',
    fetchImpl: fetchMock,
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'LOCAL-SURPLUS-STARK-12');
  assert.equal(listings[0].state, 'OH');
  assert.equal(listings[0].openingBid, 15000);
  assert.equal(listings[0].estLow, null);
  assert.equal(listings[0].estHigh, null);
  assert.equal(scraper.lastRunReport.outcome, 'success');
});

test('government-land fails closed when enrolled portal lacks structured data', async () => {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => '<html><body>No data here</body></html>',
  });
  const scraper = new GovernmentLandScraper({
    enrollmentUrl: 'https://blm.gov/landsales',
    fetchImpl: fetchMock,
  });
  await assert.rejects(
    async () => scraper.scrapeFeed(),
    /GOV_LAND_PARSER_NOT_IMPLEMENTED/
  );
  assert.equal(scraper.lastRunReport.outcome, 'failed');
});

test('scraper power report covers every required end with a scheduled adapter', () => {
  const report = buildReport();
  assert.ok(report.guarantee.catalogSources >= 59);
  assert.ok(report.guarantee.scheduledAdapters >= 21);
  for (const end of report.ends) {
    if (!end.required) continue;
    assert.ok(
      end.scheduledAdapters > 0,
      `required end ${end.label} must have a scheduled adapter`
    );
  }
  const required = REQUIRED_ENDS.filter((e) => e.required);
  assert.equal(report.guarantee.endCoverageWithScheduledAdapter, required.length);
  assert.equal(report.guarantee.endCoverageGaps.length, 0);
});

test('scraper power report keeps irs honest below P4_LIVE_STRONG with canary weakness', () => {
  const report = buildReport();
  const irs = report.sources.find((s) => s.adapterKey === 'irs');
  assert.ok(irs, 'irs adapter present in report');
  assert.notEqual(irs.power.tier, 'P4_LIVE_STRONG');
  assert.equal(irs.power.tier, 'P3_LIVE_ADAPTER');
  assert.match(irs.weakness || '', /NOT_CLEAN|sparse/i);
});

test('government-land hydrates inlineProperties and enforces id + address without inventing valuations', async () => {
  const inlineHtml = `
    <html>
      <body>
        <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "pageProps": {
              "parcels": [
                {
                  "parcelId": "UT-707",
                  "address": "707 Red Canyon Rd",
                  "city": "Moab",
                  "state": "UT",
                  "zip": "84532",
                  "openingBid": "$62,000",
                  "saleDate": "2026-12-18",
                  "estimatedValueLow": 999999
                },
                {
                  "address": "999 Missing Id Way, Moab, UT 84532",
                  "price": 10000
                }
              ]
            }
          }
        }
        </script>
      </body>
    </html>
  `;
  let extractCalled = false;
  const scraper = new GovernmentLandScraper({
    enrollmentUrl: 'https://blm.gov/landsales',
    useScrapling: true,
    extractImpl: async () => { extractCalled = true; return { headers: [], rows: [] }; },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => inlineHtml,
    }),
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(extractCalled, false, 'Scrapling table-extract must not run when embedded data yields listings');
  assert.equal(listings.length, 1, 'Objects without id/parcel/case fields must be filtered out');
  assert.equal(listings[0].id, 'GOVERNMENT-LAND-UT-707');
  assert.equal(listings[0].state, 'UT');
  assert.equal(listings[0].city, 'Moab');
  assert.equal(listings[0].zip, '84532');
  assert.equal(listings[0].openingBid, 62000);
  assert.equal(listings[0].saleDate, '2026-12-18');
  assert.equal(listings[0].estLow, null);
  assert.equal(listings[0].estHigh, null);
  assert.equal(listings[0].provenance.embeddedFormat, 'inline-state');
  assert.equal(scraper.lastRunReport.outcome, 'success');
});

test('government-land invokes Scrapling table-extract when no embedded listings exist and maps flexible headers', async () => {
  const tableHtml = '<html><body><table><tr><th>Parcel ID</th><th>Location</th><th>City</th><th>State</th><th>Zip</th><th>Minimum Bid</th><th>Sale Date</th></tr><tr><td>BLM-88</td><td>880 Mesa Trail</td><td>Kanab</td><td>UT</td><td>84741</td><td>$38,500</td><td>2026-12-22</td></tr></table></body></html>';
  let calledProfile = null;
  const scraper = new GovernmentLandScraper({
    enrollmentUrl: 'https://blm.gov/landsales',
    useScrapling: true,
    extractImpl: async (profile) => {
      calledProfile = profile;
      return {
        engine: 'scrapling',
        engineVersion: '0.4.15',
        headers: ['Parcel ID', 'Location', 'City', 'State', 'Zip', 'Minimum Bid', 'Sale Date'],
        rows: [
          ['BLM-88', '880 Mesa Trail', 'Kanab', 'UT', '84741', '$38,500', '2026-12-22'],
        ],
      };
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => tableHtml,
    }),
  });
  const listings = await scraper.scrapeFeed();
  assert.equal(calledProfile, 'table-extract');
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'GOVERNMENT-LAND-BLM-88');
  assert.equal(listings[0].state, 'UT');
  assert.equal(listings[0].city, 'Kanab');
  assert.equal(listings[0].zip, '84741');
  assert.equal(listings[0].openingBid, 38500);
  assert.equal(listings[0].saleDate, '2026-12-22');
  assert.equal(listings[0].estLow, null);
  assert.equal(listings[0].estHigh, null);
  assert.equal(listings[0].provenance.scraplingProfile, 'table-extract');
  assert.equal(scraper.lastRunReport.outcome, 'success');
});

test('government-land negative controls: refuses unparseable table rows and respects useScrapling=false', async () => {
  const html = '<html><body><table><tr><th>Parcel ID</th><th>Location</th></tr><tr><td>X-1</td><td>Short</td></tr></table></body></html>';
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => html,
  });

  const disabled = new GovernmentLandScraper({
    enrollmentUrl: 'https://blm.gov/landsales',
    useScrapling: false,
    extractImpl: async () => { throw new Error('must not be called'); },
    fetchImpl: fetchMock,
  });
  await assert.rejects(() => disabled.scrapeFeed(), /GOV_LAND_PARSER_NOT_IMPLEMENTED/);

  const badTable = new GovernmentLandScraper({
    enrollmentUrl: 'https://blm.gov/landsales',
    useScrapling: true,
    extractImpl: async () => ({ headers: ['Parcel ID', 'Location'], rows: [['X-1', '100 Main St']] }),
    fetchImpl: fetchMock,
  });
  await assert.rejects(() => badTable.scrapeFeed(), /GOV_LAND_PARSER_NOT_IMPLEMENTED/);
});

test('local-surplus supports inlineProperties, Scrapling table-extract, and SSRF rejection', async () => {
  const ssrfScraper = new LocalSurplusScraper({ enrollmentUrl: 'https://100.64.0.5/surplus' });
  const skipped = await ssrfScraper.scrapeFeed();
  assert.deepEqual(skipped, []);
  assert.equal(ssrfScraper.lastRunReport.outcome, 'skipped_not_enrolled');
  assert.match(ssrfScraper.lastRunReport.failures[0].message, /loopback-rejected/);

  const inlineHtml = `
    <html><body><script>
      var listings = [{"caseNumber":"SUR-90","streetAddress":"900 Civic Center Dr","city":"Akron","state":"OH","zip":"44308","minimumBid":22500}];
    </script></body></html>
  `;
  const inlineScraper = new LocalSurplusScraper({
    enrollmentUrl: 'https://summitcountyoh.gov/surplus',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => inlineHtml,
    }),
  });
  const inlineResults = await inlineScraper.scrapeFeed();
  assert.equal(inlineResults.length, 1);
  assert.equal(inlineResults[0].id, 'LOCAL-SURPLUS-SUR-90');
  assert.equal(inlineResults[0].state, 'OH');
  assert.equal(inlineResults[0].openingBid, 22500);
  assert.equal(inlineResults[0].estLow, null);
  assert.equal(inlineResults[0].estHigh, null);

  const tableScraper = new LocalSurplusScraper({
    enrollmentUrl: 'https://summitcountyoh.gov/surplus',
    useScrapling: true,
    extractImpl: async () => ({
      headers: ['Lot #', 'Street', 'Opening Price', 'Auction Date'],
      rows: [['LOT-42', '450 County Road 10, Canton, OH 44702', '$15,000', '12/15/2026']],
    }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<html><body><table></table></body></html>',
    }),
  });
  const tableResults = await tableScraper.scrapeFeed();
  assert.equal(tableResults.length, 1);
  assert.equal(tableResults[0].id, 'LOCAL-SURPLUS-LOT-42');
  assert.equal(tableResults[0].state, 'OH');
  assert.equal(tableResults[0].zip, '44702');
  assert.equal(tableResults[0].openingBid, 15000);
  assert.equal(tableResults[0].saleDate, '2026-12-15');
  assert.equal(tableResults[0].estLow, null);
  assert.equal(tableResults[0].estHigh, null);
});

test('SCRAPLING_PROFILES and buildReport include government-land and local-surplus table-extract', () => {
  assert.deepEqual(SCRAPLING_PROFILES['government-land'], ['table-extract']);
  assert.deepEqual(SCRAPLING_PROFILES['local-surplus'], ['table-extract']);
  const report = buildReport();
  const govLand = report.sources.find((s) => s.adapterKey === 'government-land');
  const localSurplus = report.sources.find((s) => s.adapterKey === 'local-surplus');
  assert.deepEqual(govLand?.power?.scrapling, ['table-extract']);
  assert.deepEqual(localSurplus?.power?.scrapling, ['table-extract']);
});

test('drift-alarm SOURCE_EXPECTED_FIELDS preserves core baselines and accurately screens expanded sources', () => {
  assert.deepEqual(SOURCE_EXPECTED_FIELDS.gsa, ['id', 'address', 'city', 'zip', 'sourceUrl']);
  assert.deepEqual(SOURCE_EXPECTED_FIELDS.irs, ['id', 'address', 'city', 'zip', 'openingBid', 'saleDate', 'sourceUrl']);
  assert.deepEqual(SOURCE_EXPECTED_FIELDS.hud, ['id', 'address', 'city', 'zip', 'lat', 'lng', 'sourceUrl']);
  assert.deepEqual(SOURCE_EXPECTED_FIELDS.trustee, ['id', 'address', 'county', 'sourceUrl']);

  const samples = {
    treasury: {
      healthy: { id: 'TRSY-1', address: '100 Main St, Reno, NV 89501', city: 'Reno', zip: '89501', openingBid: 50000, saleDate: '2026-12-01', sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/1.shtml' },
      broken: { id: 'TRSY-1', address: '100 Main St', city: null, zip: null, openingBid: null, saleDate: null, sourceUrl: null },
    },
    usda: {
      healthy: { id: 'USDA-OH-1', address: '100 Main St, Cleveland, OH 44101', city: 'Cleveland', county: 'Cuyahoga', zip: '44101', openingBid: 95000, saleDate: null, sourceUrl: 'https://www.resales.usda.gov/resales/public/SFHPropertyDetail?id=1' },
      broken: { id: 'USDA-OH-1', address: '100 Main St', city: null, county: null, zip: null, openingBid: null, sourceUrl: null },
    },
    civilview: {
      healthy: { id: 'CIV-NJ-1-2', address: '100 Main St, Newark, NJ 07102', county: 'Essex', city: 'Newark', zip: '07102', saleDate: '2026-12-10', plaintiff: 'Bank', openingBid: null, sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2' },
      broken: { id: 'CIV-NJ-1-2', address: '100 Main St', county: 'Essex', city: null, zip: null, saleDate: null, plaintiff: null, sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2' },
    },
    sheriff: {
      healthy: { id: 'SHERIFF-OH-1', address: '100 Main St, Columbus, OH 43215', county: 'Franklin', saleDate: '2026-12-15', openingBid: 75000, sourceUrl: 'https://franklin.sheriffsaleauction.ohio.gov/1' },
      broken: { id: 'SHERIFF-OH-1', address: '100 Main St', county: null, saleDate: null, openingBid: null, sourceUrl: null },
    },
    servicelink: {
      healthy: { id: 'servicelink:1', address: '100 Main St, Austin, TX 78701', city: 'Austin', county: 'Travis', zip: '78701', saleDate: '2026-12-10', openingBid: 120000, sourceUrl: 'https://www.servicelinkauction.com/listing/1' },
      broken: { id: 'servicelink:1', address: '100 Main St', city: null, county: null, zip: null, saleDate: null, openingBid: null, sourceUrl: null },
    },
    fannie: {
      healthy: { id: 'FNMA-1', address: '100 Main St, Dallas, TX 75201', city: 'Dallas', zip: '75201', openingBid: 180000, sourceUrl: 'https://www.homepath.fanniemae.com/property/1' },
      broken: { id: 'FNMA-1', address: '100 Main St', city: null, zip: null, openingBid: null, sourceUrl: 'https://www.homepath.fanniemae.com/property/1' },
    },
    freddie: {
      healthy: { id: 'FRE-1', address: '100 Main St, Phoenix, AZ 85001', city: 'Phoenix', zip: '85001', openingBid: 210000, sourceUrl: 'https://www.homesteps.com/property/1' },
      broken: { id: 'FRE-1', address: '100 Main St', city: null, zip: null, openingBid: null, sourceUrl: 'https://www.homesteps.com/property/1' },
    },
    va: {
      healthy: { id: 'VA-1', address: '100 Main St, Richmond, VA 23219', city: 'Richmond', zip: '23219', openingBid: 165000, sourceUrl: 'https://vrmproperties.com/property/1' },
      broken: { id: 'VA-1', address: '100 Main St', city: null, zip: null, openingBid: null, sourceUrl: 'https://vrmproperties.com/property/1' },
    },
    marshals: {
      healthy: { id: 'USMS-1', address: '100 Main St, Miami, FL 33101', zip: '33101', openingBid: 300000, sourceUrl: 'https://www.usmarshals.gov/what-we-do/asset-forfeiture/real-property/1' },
      broken: { id: 'USMS-1', address: '100 Main St', zip: null, openingBid: null, sourceUrl: null },
    },
  };

  for (const [sourceKey, pair] of Object.entries(samples)) {
    assert.ok(Array.isArray(SOURCE_EXPECTED_FIELDS[sourceKey]), `${sourceKey} present in SOURCE_EXPECTED_FIELDS`);
    const ok = evaluateRecordsForDrift(sourceKey, [pair.healthy]);
    assert.equal(ok.hasDrift, false, `${sourceKey} healthy record must not trigger false drift (yield=${ok.currentYield})`);
    const bad = evaluateRecordsForDrift(sourceKey, [pair.broken]);
    assert.equal(bad.hasDrift, true, `${sourceKey} degraded record must trigger drift alarm (yield=${bad.currentYield})`);
  }
});
