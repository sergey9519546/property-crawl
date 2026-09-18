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
