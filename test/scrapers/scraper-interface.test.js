'use strict';

// test/scrapers/scraper-interface.test.js
//
// Pins the scraper adapter contract the scheduler silently assumed.
//
// server/scrapers/scheduler.js reads exactly nine members off every adapter it
// runs (sourceKey, name, scrapeFeed, circuitBreaker, fixtureOnly,
// historicalOnly, getRawPublisherRecord, setCheckpoint, lastRunReport) and
// NOTHING declared that contract. With no interface, drift degrades silently
// instead of failing: a catalog adapterKey that stopped matching any
// sourceKey, and a scheduler fallback that wrote derived data into the
// publisher-raw column for adapters without getRawPublisherRecord.
//
// These tests pin the CONTRACT, not today's fleet. Adapter-specific defects
// (e.g. an adapter that returns a run report where the scheduler expects an
// array of listings) are runtime findings, reported separately, not encoded
// here - this file must not become a change-detector for other workers' files.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_SCRAPER_MEMBERS,
  validateScraperAdapter,
  validateScraperAdapters,
} = require('../../server/scrapers/scraper-interface');

// The set the scheduler reads, in the order it first reads them.
const EXPECTED_MEMBERS = [
  'circuitBreaker',
  'fixtureOnly',
  'getRawPublisherRecord',
  'historicalOnly',
  'lastRunReport',
  'name',
  'scrapeFeed',
  'setCheckpoint',
  'sourceKey',
];

// A minimal object that satisfies the contract. Optional members
// (setCheckpoint, fixtureOnly, historicalOnly) are legitimately absent.
function validAdapter(overrides = {}) {
  return {
    name: 'ProbeScraper',
    sourceKey: 'probe',
    scrapeFeed: async () => [],
    circuitBreaker: { isOpen: () => false },
    getRawPublisherRecord: () => null,
    lastRunReport: null,
    ...overrides,
  };
}

function errorsFor(adapter) {
  const { errors } = validateScraperAdapter(adapter);
  return errors;
}

function mentions(errors, member) {
  return errors.some((message) => message.includes(member));
}

test('REQUIRED_SCRAPER_MEMBERS is the frozen nine the scheduler requires', () => {
  assert.deepEqual([...REQUIRED_SCRAPER_MEMBERS], EXPECTED_MEMBERS);
  assert.equal(Object.isFrozen(REQUIRED_SCRAPER_MEMBERS), true);
});

test('a valid adapter validates clean', () => {
  const result = validateScraperAdapter(validAdapter());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('a real adapter from the repo validates clean', () => {
  const fhfa = require('../../server/scrapers/fhfa-hpi');
  const result = validateScraperAdapter(fhfa);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('the adapters that implement resumable checkpoints validate clean', () => {
  // setCheckpoint is the member that actually varies across the fleet, so
  // validate the two adapters that implement it plus the publisher-record
  // overrides the base class does not provide.
  for (const modulePath of ['hud', 'servicelink', 'ca-controller-tax-sale', 'courtlistener']) {
    const { errors } = validateScraperAdapter(require(`../../server/scrapers/${modulePath}`));
    assert.deepEqual(errors, [], modulePath);
  }
});

test('a missing required member is reported by name', () => {
  for (const member of ['name', 'sourceKey', 'scrapeFeed']) {
    const adapter = validAdapter();
    delete adapter[member];
    const errors = errorsFor(adapter);
    assert.equal(mentions(errors, member), true, `${member} not named in: ${errors.join(' | ')}`);
    assert.equal(validateScraperAdapter(adapter).ok, false);
  }
});

test('a production adapter without getRawPublisherRecord is reported by name', () => {
  // scheduler.js falls back to JSON.parse(listing.raw) when this is missing,
  // which labels derived normalized data as publisher-observed evidence.
  const adapter = validAdapter();
  delete adapter.getRawPublisherRecord;
  const errors = errorsFor(adapter);
  assert.equal(mentions(errors, 'getRawPublisherRecord'), true, errors.join(' | '));
});

test('sourceKey and name must be non-empty strings', () => {
  assert.equal(mentions(errorsFor(validAdapter({ sourceKey: '' })), 'sourceKey'), true);
  assert.equal(mentions(errorsFor(validAdapter({ sourceKey: undefined })), 'sourceKey'), true);
  assert.equal(mentions(errorsFor(validAdapter({ sourceKey: 42 })), 'sourceKey'), true);
  assert.equal(mentions(errorsFor(validAdapter({ name: '' })), 'name'), true);
  assert.equal(mentions(errorsFor(validAdapter({ name: '   ' })), 'name'), true);
  assert.equal(validateScraperAdapter(validAdapter({ name: 7 })).ok, false);
});

test('a non-function scrapeFeed is reported', () => {
  for (const bad of ['not-a-function', 42, {}, []]) {
    const errors = errorsFor(validAdapter({ scrapeFeed: bad }));
    assert.equal(mentions(errors, 'scrapeFeed'), true, `${JSON.stringify(bad)}: ${errors.join(' | ')}`);
  }
  assert.equal(validateScraperAdapter(validAdapter({ scrapeFeed: null })).ok, false);
});

test('a fixture-only adapter may legitimately omit scrapeFeed', () => {
  const adapter = validAdapter({ fixtureOnly: true });
  delete adapter.scrapeFeed;
  const result = validateScraperAdapter(adapter);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('a fixture-only adapter with a broken scrapeFeed is still reported', () => {
  const errors = errorsFor(validAdapter({ fixtureOnly: true, scrapeFeed: 'nope' }));
  assert.equal(mentions(errors, 'scrapeFeed'), true, errors.join(' | '));
});

test('adapters the scheduler refuses to ingest are exempt from the publisher record', () => {
  // The scheduler throws before ingestion for fixture-only (FIXTURE_ONLY_SCRAPER)
  // and historical-only (HISTORICAL_ONLY_SCRAPER) adapters, so neither can
  // reach the raw_payload fallback.
  for (const flag of ['fixtureOnly', 'historicalOnly']) {
    const adapter = validAdapter({ [flag]: true });
    delete adapter.getRawPublisherRecord;
    assert.deepEqual(errorsFor(adapter), [], flag);
  }
});

test('optional members are type-checked when declared', () => {
  assert.equal(mentions(errorsFor(validAdapter({ circuitBreaker: 'closed' })), 'circuitBreaker'), true);
  assert.equal(mentions(errorsFor(validAdapter({ circuitBreaker: {} })), 'circuitBreaker'), true);
  assert.equal(mentions(errorsFor(validAdapter({ setCheckpoint: 'nope' })), 'setCheckpoint'), true);
  assert.equal(mentions(errorsFor(validAdapter({ fixtureOnly: 'yes' })), 'fixtureOnly'), true);
  assert.equal(mentions(errorsFor(validAdapter({ historicalOnly: 1 })), 'historicalOnly'), true);
  assert.equal(mentions(errorsFor(validAdapter({ lastRunReport: 'done' })), 'lastRunReport'), true);
});

test('an absent optional member is not a defect', () => {
  // setCheckpoint is implemented by 2 of 24 adapters and fixtureOnly by 1.
  // The scheduler guards each of these reads, so absence is a legal state and
  // requiring declaration would only invent work.
  const adapter = validAdapter();
  delete adapter.setCheckpoint;
  delete adapter.lastRunReport;
  assert.deepEqual(errorsFor(adapter), []);
});

test('a non-object adapter is rejected without throwing', () => {
  for (const bad of [null, undefined, 'scraper', 7, []]) {
    const result = validateScraperAdapter(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.ok(result.errors.length > 0);
  }
});

test('validateScraperAdapters combines the fleet into one result', () => {
  const result = validateScraperAdapters([
    validAdapter(),
    validAdapter({ name: 'Second', sourceKey: 'second' }),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('validateScraperAdapters reports every offender, labelled by source', () => {
  const missingSourceKey = validAdapter();
  delete missingSourceKey.sourceKey;
  const result = validateScraperAdapters([
    validAdapter(),
    missingSourceKey,
    validAdapter({ name: 'Broken', sourceKey: 'broken', scrapeFeed: 'nope' }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some((message) => message.startsWith('ProbeScraper')));
  assert.ok(result.errors.some((message) => message.startsWith('Broken:') && message.includes('scrapeFeed')));
});

test('validateScraperAdapters rejects a non-array input', () => {
  const result = validateScraperAdapters(null);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});
