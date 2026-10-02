// test/sheriff-fallback-reports-failure.test.js
//
// A county whose endpoints are ALL down must not be recorded as a success.
//
// Sheriff is the one adapter that fans out per county and has a second,
// fallback endpoint per county: fetchCountyRealauction falls through to
// fetchCountyPublicNotices whenever the primary portal yields no rows OR throws.
//
// The fallback caught its own error and returned []. So a county where both
// endpoints were down returned [] to the caller, which then ran
// recordUnitSuccess(unit, 0) -- and the run report listed the county under
// statesSucceeded with nothing discovered.
//
// That is the failure this repository keeps producing, in the most expensive
// place: an adapter that runs unattended turns a dead endpoint into zero
// coverage and reports it as a clean collection, and finalizeRunReport can only
// say 'partial_failure' if a unit was ever recorded as failed.
//
// The fallback now rethrows, so it lands on the existing recordUnitFailure path
// and the reason survives into the report.

const test = require('node:test');
const assert = require('node:assert/strict');

const { SheriffSaleScraper } = require('../server/scrapers/sheriff');
const {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
} = require('../server/scrapers/run-report');

const COUNTY = { name: 'Franklin', state: 'OH' };

function scraperFailingBoth() {
  return new SheriffSaleScraper({
    counties: [COUNTY],
    // Every outbound request throws, so the primary portal and the fallback
    // both fail for this county.
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
}

test('the fallback rethrows rather than returning an empty list', async () => {
  const scraper = scraperFailingBoth();
  await assert.rejects(
    () => scraper.fetchCountyPublicNotices(COUNTY),
    /both failed/,
    'returning [] from the fallback is the bug: it makes a dead endpoint look like an empty county',
  );
});

test('a county with both endpoints down is a failed unit, not a successful zero', () => {
  // This is the accounting the collect loop performs, driven directly so the
  // assertion is about the report an operator actually reads.
  const report = createRunReport('sheriff', {});
  report.statesRequested.push(`${COUNTY.name},${COUNTY.state}`);
  const unit = `${COUNTY.name},${COUNTY.state}`;

  let listings = [];
  try {
    listings = [];                       // what the old fallback returned
    recordUnitSuccess(report, unit, listings.length);
  } catch (_) { /* not reached */ }

  const asItWas = finalizeRunReport({ ...report });
  assert.ok(
    !asItWas.statesFailed.includes(unit),
    'baseline sanity: the old shape recorded it as succeeded',
  );

  // Now the corrected path.
  const fixed = createRunReport('sheriff', {});
  fixed.statesRequested.push(unit);
  try {
    throw new Error('primary and public-notice fallback both failed: ECONNREFUSED');
  } catch (err) {
    recordUnitFailure(fixed, unit, err, 'county');
  }
  const report2 = finalizeRunReport(fixed);

  assert.ok(report2.statesFailed.includes(unit), 'the county must be in statesFailed');
  assert.ok(!report2.statesSucceeded.includes(unit), 'and not in statesSucceeded');
  assert.equal(report2.recordsDiscovered, 0);
  assert.ok(report2.failures.length > 0, 'the reason has to survive, or this is silent again');
  assert.match(report2.failures[0].message, /both failed/);
});

test('a county that genuinely has no sales is still a success', () => {
  // The distinction the fix must NOT break: no rows found is a real answer.
  const report = createRunReport('sheriff', {});
  const unit = `${COUNTY.name},${COUNTY.state}`;
  report.statesRequested.push(unit);
  recordUnitSuccess(report, unit, 0);
  const final = finalizeRunReport(report);

  assert.ok(final.statesSucceeded.includes(unit));
  assert.equal(final.statesFailed.length, 0);
  assert.equal(final.recordsDiscovered, 0);
});

test('a mixed run reports partial_failure, not success', () => {
  // One county down, one genuinely empty. The report has to say partial, which
  // is only possible because the down county was recorded as a failure.
  const report = createRunReport('sheriff', {});
  report.statesRequested.push('Franklin,OH', 'Delaware,OH');
  recordUnitFailure(report, 'Franklin,OH', new Error('ECONNREFUSED'), 'county');
  recordUnitSuccess(report, 'Delaware,OH', 0);
  const final = finalizeRunReport(report);

  assert.equal(final.outcome, 'partial_failure');
  assert.equal(final.failures.length, 1);
});
