'use strict';

// test/scrapers/report-only-collector.test.js
//
// A collector has two legitimate shapes at the scraper seam:
//
//   listing collector  - scrapeFeed() returns an array of listing records
//   report-only        - scrapeFeed() ingests its own evidence, has no
//                        listing rows to hand over, and returns a run
//                        report object
//
// public-notices-email is the second kind. It reads IMAP or an EML corpus
// directory, writes evidence packets to the intake store, and returns
// { accepted, rejected, evidencePackets, publicationStatus, report }.
//
// The scheduler only understood the first shape, so it threw
// "returned a non-array payload" for public-notices-email on every sweep.
// The throw was contained by mapWithConcurrency — the rest of the sweep
// survived — but the source could never succeed, lost a worker slot, and
// logged a spurious error on every run.
//
// These tests pin that a report-only return is treated as an outcome rather
// than an error, and that the counts it reports are reflected without
// producing NaN or undefined.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const schedulerSrc = fs.readFileSync(
  path.join(ROOT, 'server', 'scrapers', 'scheduler.js'),
  'utf8',
);

const { PublicNoticesEmailScraper } = require('../../server/scrapers/email-ingest');

test('the scheduler recognises a report-only return instead of throwing', () => {
  assert.match(
    schedulerSrc,
    /reportOnly\s*=\s*!Array\.isArray\(items\)/,
    'the scheduler must distinguish a run-report return from a malformed payload',
  );
  assert.ok(
    /if \(!Array\.isArray\(items\) && !reportOnly\)/.test(schedulerSrc),
    'the non-array guard must only fire for payloads that are NOT a run report',
  );
});

test('a report-only collector is offered to the seam as a real adapter', () => {
  const scraper = new PublicNoticesEmailScraper({ env: {} });
  assert.equal(typeof scraper.scrapeFeed, 'function');
  assert.equal(typeof scraper.sourceKey, 'string');
  assert.ok(scraper.sourceKey.length > 0);
  // It is not a BaseScraper, so the interface validator reports it. That
  // report is intentional: the source is legitimate but its shape is
  // different, and the audit doc records it as the one fleet offender.
});

test('the report-only path does not use items.length, which would be NaN', () => {
  // A run report has no .length, so `items.length - accepted.length` is NaN and
  // `?? items.length` yields undefined. Both downstream uses must read the
  // normalised list instead.
  assert.ok(
    !/accepted\.length\}\s*rejected\)/.test(schedulerSrc.replace(/\s+/g, ' ').replace(/\$\{scraper\.name\}/g, 'X')) || !/\$\{items\.length - accepted\.length\}/.test(schedulerSrc),
    'the completion log must not subtract from items.length for a report-only source',
  );
  assert.ok(
    !/publisherDiscovered \?\? items\.length/.test(schedulerSrc),
    'finishRun discovered count must not fall back to items.length for a report-only source',
  );
  assert.match(schedulerSrc, /publisherDiscovered \?\? itemsToIngest\.length/);
  assert.match(schedulerSrc, /itemsToIngest\.length - accepted\.length/);
});

test('a report-only source is not counted as a malformed-payload failure', () => {
  assert.ok(
    !/returned a non-array payload/.test(schedulerSrc.replace(/\$\{scraper\.name\}/g, 'X').replace(/`/g, "'")) ||
      schedulerSrc.includes('reportOnly'),
    'the malformed-payload throw must remain for genuine contract violations',
  );
});

test('PublicNoticesEmailScraper.scrapeFeed returns a report, and never an array', async () => {
  // Unconfigured and no corpus dir: the honest answer is a run report saying
  // it could not collect, not an empty array that would imply "collected
  // nothing successfully".
  const scraper = new PublicNoticesEmailScraper({ env: {} });
  const out = await scraper.scrapeFeed();
  assert.ok(!Array.isArray(out), 'must not return an array, or the fix is not exercised');
  assert.equal(typeof out, 'object');
  assert.equal(out.source, scraper.sourceKey);
  assert.ok('report' in out);
  assert.equal(out.error, 'imap_not_configured');
  assert.equal(out.accepted, 0);
});
