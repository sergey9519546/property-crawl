'use strict';

// test/scrapers/publisher-record-capture.test.js
//
// Pins the base-class publisher-record capture in server/scrapers/base.js.
//
// Context: discovery_snapshots.raw_payload is the record of what the
// publisher actually returned. Only 6 of 19 scheduled scrapers exposed
// getRawPublisherRecord, so the scheduler had no publisher record for the
// rest and recorded null (migration 016) - honest, but it discarded
// evidence the scraper already had in hand, because standardizeListing()
// receives the pre-normalization parsed record and throws it away.
//
// The fix captures `raw` at that one funnel, keyed by the standardized
// listing identity the scheduler actually receives. Keying on `raw` would
// never resolve: standardizeListingRecord() builds a NEW object.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const BaseScraper = require('../../server/scrapers/base');

const ROOT = path.resolve(__dirname, '..', '..');

const RAW = Object.freeze({
  id: 'USDA-MS-6274',
  source: 'usda',
  state: 'MS',
  address: '100 Main St, Jackson, MS',
  city: 'Jackson',
  zip: '39201',
  openingBid: 50000,
  raw: 'USDA published notice text',
});

function scraper() {
  return new BaseScraper({ name: 'probe', sourceKey: 'usda' });
}

test('standardizeListing still returns a usable listing', () => {
  const listing = scraper().standardizeListing({ ...RAW });
  assert.equal(listing.id, RAW.id);
  assert.equal(listing.state, 'MS');
});

test('getRawPublisherRecord returns the pre-normalization record', () => {
  const s = scraper();
  const listing = s.standardizeListing({ ...RAW });
  const record = s.getRawPublisherRecord(listing);
  assert.ok(record, 'expected a captured publisher record');
  assert.equal(record.id, RAW.id);
  assert.equal(record.raw, RAW.raw, 'must be the publisher record, not the standardized one');
});

test('the capture is keyed on the standardized listing, not the raw input', () => {
  // The whole reason this works: standardizeListingRecord returns a new object,
  // so a WeakMap keyed on `raw` would return null for the scheduler's item.
  const s = scraper();
  const raw = { ...RAW };
  const listing = s.standardizeListing(raw);
  assert.notStrictEqual(listing, raw, 'standardizeListingRecord must return a new object');
  assert.strictEqual(s.getRawPublisherRecord(listing), raw);
  assert.strictEqual(s.getRawPublisherRecord(raw), null, 'the raw input is not the key');
});

test('an unknown or null listing yields null rather than throwing', () => {
  const s = scraper();
  assert.equal(s.getRawPublisherRecord({ id: 'never-seen' }), null);
  assert.equal(s.getRawPublisherRecord(null), null);
  assert.equal(s.getRawPublisherRecord(undefined), null);
});

test('two listings from the same scraper do not collide', () => {
  const s = scraper();
  const a = s.standardizeListing({ ...RAW, id: 'A-1' });
  const b = s.standardizeListing({ ...RAW, id: 'B-1' });
  assert.equal(s.getRawPublisherRecord(a).id, 'A-1');
  assert.equal(s.getRawPublisherRecord(b).id, 'B-1');
});

test('the capture map is a WeakMap, so a long run cannot leak parsed rows', () => {
  assert.ok(scraper()._publisherRecords instanceof WeakMap);
});

test('scrapers with a structured upstream record keep their own implementation', () => {
  // These capture a parsed JSON record, which is strictly better than the
  // fallback. A subclass method wins over the base, so the scheduler still
  // calls theirs.
  const own = ['hud-usps-vacancy', 'courtlistener', 'fl-dor-cadastral', 'ca-controller-tax-sale', 'fhfa-hpi', 'servicelink'];
  for (const name of own) {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'scrapers', `${name}.js`), 'utf8');
    assert.match(src, /getRawPublisherRecord/, `${name} should keep its own publisher record`);
  }
});

test('the scheduled federal scrapers now inherit the base capture', () => {
  // These never implemented it, which is why raw_payload was null for them.
  const inherits = ['hud', 'treasury', 'irs', 'usda', 'fannie', 'freddie', 'gsa', 'marshals', 'fdic', 'va', 'sheriff', 'bid4assets', 'bid4assets'];
  for (const name of new Set(inherits)) {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'scrapers', `${name}.js`), 'utf8');
    assert.ok(
      !/getRawPublisherRecord\s*\(/.test(src),
      `${name} defines its own record; update this list if that is deliberate`,
    );
    assert.match(
      src,
      /standardizeListing\(/,
      `${name} should reach the base funnel that captures the publisher record`,
    );
  }
});

test('the scheduler still prefers a scraper-provided record over the fallback', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'scrapers', 'scheduler.js'), 'utf8');
  assert.match(
    src,
    /typeof scraper\.getRawPublisherRecord === 'function'\s*\?\s*scraper\.getRawPublisherRecord\(item\)/,
    'the scheduler must call the scraper method so subclass overrides win',
  );
});
