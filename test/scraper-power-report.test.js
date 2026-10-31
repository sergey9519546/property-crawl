'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, REQUIRED_ENDS } = require('../scripts/scraper-power-report');
const { GovernmentLandScraper, validateEnrollmentUrl } = require('../server/scrapers/government-land');
const { LocalSurplusScraper } = require('../server/scrapers/local-surplus');

test('validateEnrollmentUrl enforces HTTPS and rejects private/credential targets', () => {
  assert.equal(validateEnrollmentUrl('').ok, false);
  assert.equal(validateEnrollmentUrl('http://example.gov/sales').ok, false);
  assert.equal(validateEnrollmentUrl('https://user:pass@example.gov/sales').ok, false);
  assert.equal(validateEnrollmentUrl('https://localhost/sales').ok, false);
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
