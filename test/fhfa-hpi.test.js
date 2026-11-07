'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FhfaHpiScraper,
  FhfaHpiError,
  SOURCE_KEY,
  PUBLISHER,
  DEFAULT_CSV_URL,
  DEFAULT_MAX_RECORDS,
  MAX_RECORDS_CAP,
  MAX_CSV_BYTES,
  MIN_STATE_ROWS,
  sanitizeCsvUrl,
  buildRecordSourceUrl,
  truncateRaw
} = require('../server/scrapers/fhfa-hpi');

const fhfaScraper = require('../server/scrapers/fhfa-hpi');

const { sha256Hex, STATE_NAME_TO_CODE } = require('../server/enrichment/fhfa-state-hpi');

// Live publisher shape: one row per state, seasonally-adjusted percent
// changes for the current release. No period column, no index levels.
const LIVE_HEADER = 'State,Rank,"1 Quarter","1 Year","5 Year","Since 1991"';

// The live endpoint publishes 50 states + DC. Puerto Rico is not part of
// the published state index; exclude it from the happy-path fixture.
const PUBLISHED_STATE_NAMES = Object.keys(STATE_NAME_TO_CODE)
  .filter((name) => name !== 'Puerto Rico');

function fixtureValues(index) {
  return {
    rank: index + 1,
    quarterPct: Number(((index % 12) - 6).toFixed(1)),
    yoyPct: Number(((index % 15) - 7).toFixed(1)),
    fiveYearPct: Number(((index % 20) + 1).toFixed(1)),
    since1991Pct: Number(((index % 25) + 40).toFixed(1))
  };
}

function buildStateCsv(names = PUBLISHED_STATE_NAMES) {
  const rows = names.map((name, index) => {
    const values = fixtureValues(index);
    return [
      name,
      values.rank,
      `"${values.quarterPct.toFixed(1)}"`,
      `"${values.yoyPct.toFixed(1)}"`,
      `"${values.fiveYearPct.toFixed(1)}"`,
      `"${values.since1991Pct.toFixed(1)}"`
    ].join(',');
  });
  return [LIVE_HEADER, ...rows].join('\n');
}

const SAMPLE_CSV = buildStateCsv();

function makeFetch(text = SAMPLE_CSV, { ok = true, status = 200 } = {}) {
  return async (input, init) => {
    return {
      ok,
      status,
      text: async () => text,
      json: async () => JSON.parse(text)
    };
  };
}

function makeScraper({ fetchImpl, csvUrl, maxRecords, ...rest } = {}) {
  return new FhfaHpiScraper({
    fetchImpl: fetchImpl || makeFetch(),
    csvUrl,
    maxRecords,
    ...rest
  });
}

test('module exports the singleton and the class with the right shape', () => {
  assert.equal(typeof fhfaScraper, 'object');
  assert.equal(fhfaScraper.sourceKey, SOURCE_KEY);
  assert.equal(fhfaScraper.name, 'FhfaHpiCollector');
  assert.equal(typeof fhfaScraper.scrapeFeed, 'function');
  assert.equal(typeof fhfaScraper.getCollectionScope, 'function');
  assert.equal(typeof fhfaScraper.getRawPublisherRecord, 'function');
  assert.equal(typeof fhfaScraper.buildRecordSourceUrl, 'function');
  assert.equal(SOURCE_KEY, 'fhfa-hpi');
  assert.equal(PUBLISHER, 'FHFA');
  assert.equal(DEFAULT_CSV_URL, 'https://www.fhfa.gov/hpi-state/csv');
  assert.equal(DEFAULT_MAX_RECORDS, 100);
  assert.equal(MAX_RECORDS_CAP, 5_000);
  assert.equal(MAX_CSV_BYTES, 1_048_576);
  assert.equal(MIN_STATE_ROWS, 50);
  assert.equal(STATE_NAME_TO_CODE.Ohio, 'OH');
});

test('reads FHFA_HPI_CSV_URL from environment when not passed as option', () => {
  const original = process.env.FHFA_HPI_CSV_URL;
  try {
    process.env.FHFA_HPI_CSV_URL = 'https://fhfa.gov/hpi-state/csv';
    const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch() });
    assert.equal(scraper.csvUrl, 'https://fhfa.gov/hpi-state/csv');
  } finally {
    if (original === undefined) delete process.env.FHFA_HPI_CSV_URL;
    else process.env.FHFA_HPI_CSV_URL = original;
  }
});

test('a retired DataTools URL from the environment falls back to the live endpoint', () => {
  const original = process.env.FHFA_HPI_CSV_URL;
  try {
    process.env.FHFA_HPI_CSV_URL = 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv';
    const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch() });
    assert.equal(scraper.csvUrl, DEFAULT_CSV_URL);
  } finally {
    if (original === undefined) delete process.env.FHFA_HPI_CSV_URL;
    else process.env.FHFA_HPI_CSV_URL = original;
  }
});

test('reads FHFA_HPI_MAX_RECORDS from environment when not passed as option', () => {
  const original = process.env.FHFA_HPI_MAX_RECORDS;
  try {
    process.env.FHFA_HPI_MAX_RECORDS = '17';
    const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch() });
    assert.equal(scraper.maxRecords, 17);
  } finally {
    if (original === undefined) delete process.env.FHFA_HPI_MAX_RECORDS;
    else process.env.FHFA_HPI_MAX_RECORDS = original;
  }
});

test('constructor option overrides env vars', () => {
  const originalCsv = process.env.FHFA_HPI_CSV_URL;
  const originalMax = process.env.FHFA_HPI_MAX_RECORDS;
  try {
    process.env.FHFA_HPI_CSV_URL = 'https://fhfa.gov/hpi-state/csv';
    process.env.FHFA_HPI_MAX_RECORDS = '999';
    const scraper = new FhfaHpiScraper({
      fetchImpl: makeFetch(),
      csvUrl: DEFAULT_CSV_URL,
      maxRecords: 7
    });
    assert.equal(scraper.csvUrl, DEFAULT_CSV_URL);
    assert.equal(scraper.maxRecords, 7);
  } finally {
    if (originalCsv === undefined) delete process.env.FHFA_HPI_CSV_URL;
    else process.env.FHFA_HPI_CSV_URL = originalCsv;
    if (originalMax === undefined) delete process.env.FHFA_HPI_MAX_RECORDS;
    else process.env.FHFA_HPI_MAX_RECORDS = originalMax;
  }
});

test('clamps maxRecords to the configured cap', () => {
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(), maxRecords: 999_999 });
  assert.equal(scraper.maxRecords, MAX_RECORDS_CAP);
});

test('falls back to DEFAULT_MAX_RECORDS when maxRecords is invalid', () => {
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(), maxRecords: 'banana' });
  assert.equal(scraper.maxRecords, DEFAULT_MAX_RECORDS);
});

test('falls back to DEFAULT_MAX_RECORDS when maxRecords is zero or negative', () => {
  const a = new FhfaHpiScraper({ fetchImpl: makeFetch(), maxRecords: 0 });
  const b = new FhfaHpiScraper({ fetchImpl: makeFetch(), maxRecords: -3 });
  assert.equal(a.maxRecords, DEFAULT_MAX_RECORDS);
  assert.equal(b.maxRecords, DEFAULT_MAX_RECORDS);
});

test('clamps maxCsvBytes to the hard cap', () => {
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(), maxCsvBytes: 99_999_999 });
  assert.equal(scraper.maxCsvBytes, MAX_CSV_BYTES);
});

test('falls back to MAX_CSV_BYTES when maxCsvBytes is invalid', () => {
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(), maxCsvBytes: 'not-a-number' });
  assert.equal(scraper.maxCsvBytes, MAX_CSV_BYTES);
});

test('sanitizeCsvUrl accepts only the live hpi-state/csv endpoint', () => {
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/hpi-state/csv'),
    'https://www.fhfa.gov/hpi-state/csv'
  );
  assert.equal(
    sanitizeCsvUrl('https://fhfa.gov/hpi-state/csv'),
    'https://fhfa.gov/hpi-state/csv'
  );
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/hpi-state/csv/'),
    'https://www.fhfa.gov/hpi-state/csv/'
  );
});

test('sanitizeCsvUrl rejects the retired DataTools path and unrelated URLs', () => {
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv'),
    DEFAULT_CSV_URL,
    'retired per-(state, period) file path'
  );
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv'),
    DEFAULT_CSV_URL,
    'retired metro file path'
  );
  assert.equal(sanitizeCsvUrl('https://example.com/hpi-state/csv'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl('https://www.fhfa.gov/some/other/path.csv'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl('https://www.fhfa.gov/'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl('https://www.fhfa.gov/hpi-state'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl('https://www.fhfa.gov/hpi-state/csv?geo=OH'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl('http://www.fhfa.gov/hpi-state/csv'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(''), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(null), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(undefined), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(42), DEFAULT_CSV_URL);
});

test('getCollectionScope returns a stable, comparable descriptor', () => {
  const scraper = makeScraper();
  const scope = scraper.getCollectionScope();
  assert.deepEqual(scope, {
    endpoint: '/hpi-state/csv',
    csvUrl: DEFAULT_CSV_URL,
    level: 'state',
    maxRecords: DEFAULT_MAX_RECORDS,
    maxCsvBytes: MAX_CSV_BYTES
  });
});

test('buildRecordSourceUrl identifies the state row of the live CSV', () => {
  const url = buildRecordSourceUrl({
    csvUrl: DEFAULT_CSV_URL,
    state: 'CA'
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://www.fhfa.gov');
  assert.equal(parsed.pathname, '/hpi-state/csv');
  assert.equal(parsed.searchParams.get('geo'), 'CA');
  assert.equal([...parsed.searchParams.keys()].length, 1);
  assert.equal(parsed.searchParams.get('period'), null);
});

test('truncateRaw passes through short payloads unchanged', () => {
  const out = truncateRaw({ a: 1, b: 'two' }, 1024);
  assert.equal(out, '{"a":1,"b":"two"}');
});

test('truncateRaw marks oversized payloads with a truncated envelope', () => {
  const big = { s: 'x'.repeat(2_000) };
  const out = JSON.parse(truncateRaw(big, 256));
  assert.equal(out.truncated, true);
  assert.equal(typeof out.originalBytes, 'number');
  assert.ok(out.originalBytes > 256);
  assert.ok(typeof out.preview === 'string');
});

test('FhfaHpiError exposes a code property and a sensible name', () => {
  const err = new FhfaHpiError('boom', 'FHFA_HPI_TEST');
  assert.equal(err.name, 'FhfaHpiError');
  assert.equal(err.code, 'FHFA_HPI_TEST');
  assert.equal(err.message, 'boom');
});

test('FhfaHpiError defaults to UPSTREAM_UNAVAILABLE code', () => {
  const err = new FhfaHpiError('downstream');
  assert.equal(err.code, 'FHFA_HPI_UPSTREAM_UNAVAILABLE');
});

test('scrapeFeed returns one record per published state', async () => {
  const scraper = makeScraper({ maxRecords: 60 });
  const records = await scraper.scrapeFeed();
  assert.equal(records.length, PUBLISHED_STATE_NAMES.length);
  assert.ok(records.every((record) => record.source === SOURCE_KEY));
  assert.ok(records.every((record) => /^[A-Z]{2}$/.test(record.state)));
  assert.equal(new Set(records.map((record) => record.id)).size, records.length);
});

test('the default run covers every published state row and reports success', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  assert.equal(records.length, PUBLISHED_STATE_NAMES.length);
  assert.ok(records.length <= DEFAULT_MAX_RECORDS);
  assert.equal(scraper.lastRunReport.outcome, 'success');
  assert.equal(scraper.lastRunReport.complete, true);
  assert.equal(scraper.lastRunReport.recordsDiscovered, PUBLISHED_STATE_NAMES.length);
});

test('scrapeFeed emits the live state-summary address label', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  const ca = records.find((record) => record.state === 'CA');
  assert.ok(ca);
  assert.equal(ca.id, 'fhfa-hpi-CA');
  assert.equal(ca.address, 'FHFA HPI State Summary for California (SA percent changes)');
});

test('scrapeFeed emits the canonical sourceUrl pointing at the state row', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  const ca = records.find((record) => record.state === 'CA');
  assert.ok(ca);
  const url = new URL(ca.sourceUrl);
  assert.equal(url.hostname, 'www.fhfa.gov');
  assert.equal(url.pathname, '/hpi-state/csv');
  assert.equal(url.searchParams.get('geo'), 'CA');
  assert.deepEqual([...url.searchParams.keys()], ['geo']);
  assert.equal(url.searchParams.get('period'), null);
});

test('scrapeFeed emits observed seasonally-adjusted percent changes with the dataset sha256', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  const ca = records.find((record) => record.state === 'CA');
  const expected = fixtureValues(PUBLISHED_STATE_NAMES.indexOf('California'));
  assert.ok(ca);
  const facts = ca.provenance.sourceFacts;
  assert.equal(facts.indexType, 'SA');
  assert.equal(facts.quarterPct, expected.quarterPct);
  assert.equal(facts.yoyPct, expected.yoyPct);
  assert.equal(facts.fiveYearPct, expected.fiveYearPct);
  assert.equal(facts.since1991Pct, expected.since1991Pct);
  assert.equal(facts.rank, expected.rank);
  assert.equal(facts.state, 'CA');
  assert.equal(facts.stateName, 'California');
  assert.match(facts.datasetSha256, /^[a-f0-9]{64}$/);
  assert.equal(facts.datasetSha256, sha256Hex(SAMPLE_CSV));
  assert.equal(facts.csvUrl, DEFAULT_CSV_URL);
  assert.equal(facts.recordUrl, ca.sourceUrl);
});

test('sourceFacts never carry period, geo_short, series, or index levels', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  for (const record of records) {
    const facts = record.provenance.sourceFacts;
    for (const banned of ['period', 'geo_short', 'geoshort', 'series', 'indexNsa', 'indexSa', 'index_nsa', 'index_sa']) {
      assert.equal(Object.prototype.hasOwnProperty.call(facts, banned), false, `unexpected key ${banned}`);
    }
    assert.equal(typeof facts.quarterPct, 'number');
    assert.equal(typeof facts.yoyPct, 'number');
  }
});

test('mapped listings pass the ingestion validation contract when state is known', async () => {
  const { validateListingForIngestion } = require('../server/scrapers/validation');
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  assert.ok(records.length > 0);
  for (const record of records) {
    const result = validateListingForIngestion(record, { expectedSource: SOURCE_KEY });
    assert.equal(result.isValid, true, JSON.stringify(result.errors));
  }
});

test('mapStateRecord returns null for an unknown state code', async () => {
  const scraper = makeScraper();
  const listing = scraper.mapStateRecord('ZZ', { rank: 1, quarterPct: 1, yoyPct: 2, fiveYearPct: 3, since1991Pct: 4 }, {
    csvUrl: DEFAULT_CSV_URL,
    observedAt: new Date().toISOString(),
    datasetSha256: sha256Hex(SAMPLE_CSV)
  });
  assert.equal(listing, null);
});

test('mapped listings emit provenance.observed=true and a publisher label', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  assert.ok(records.length > 0);
  for (const record of records) {
    assert.equal(record.provenance.origin, 'live');
    assert.equal(record.provenance.observed, true);
    assert.equal(record.provenance.publisher, PUBLISHER);
    assert.equal(record.provenance.recordId, `fhfa-hpi-${record.state}`);
    assert.equal(typeof Date.parse(record.provenance.observedAt), 'number');
  }
});

test('mapped listings leave property-shape fields null (no bid, year, beds, etc.)', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  for (const record of records) {
    assert.equal(record.openingBid, null);
    assert.equal(record.price, null);
    assert.equal(record.estLow, null);
    assert.equal(record.estHigh, null);
    assert.equal(record.assessed, null);
    assert.equal(record.saleDate, null);
    assert.equal(record.year, null);
    assert.equal(record.beds, null);
    assert.equal(record.baths, null);
    assert.equal(record.sqft, null);
    assert.equal(record.propType, null);
    assert.equal(record.occupancy, null);
    assert.equal(record.county, null);
    assert.equal(record.city, null);
    assert.equal(record.zip, null);
    assert.equal(record.lat, null);
    assert.equal(record.lng, null);
  }
});

test('raw payload is retained on the WeakMap and retrievable by listing', async () => {
  const stateCodeToName = Object.fromEntries(
    Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name])
  );
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  for (const listing of records) {
    const raw = scraper.getRawPublisherRecord(listing);
    assert.ok(raw);
    assert.equal(raw.state, listing.state);
    assert.equal(raw.stateName, stateCodeToName[listing.state]);
    assert.equal(raw.indexType, 'SA');
    assert.equal(typeof raw.quarterPct, 'number');
    assert.ok(!('period' in raw));
    assert.ok(!('series' in raw));
  }
});

test('raw payload is not retrievable for an unrelated object', () => {
  const scraper = makeScraper();
  assert.equal(scraper.getRawPublisherRecord({ id: 'something-else' }), null);
});

test('getRawPublisherRecord returns null before scrapeFeed runs', () => {
  const scraper = makeScraper();
  assert.equal(scraper.getRawPublisherRecord({ id: 'never-emitted' }), null);
});

test('lastRunReport is null before scrapeFeed runs', () => {
  const scraper = makeScraper();
  assert.equal(scraper.lastRunReport, null);
});

test('lastRunReport is populated after a successful scrape', async () => {
  const scraper = makeScraper({ maxRecords: 60 });
  await scraper.scrapeFeed();
  const report = scraper.lastRunReport;
  assert.ok(report);
  assert.equal(report.outcome, 'success');
  assert.equal(report.fixtureFallbackUsed, false);
  assert.equal(typeof report.bytes, 'number');
  assert.ok(report.bytes > 0);
  assert.equal(report.recordsDiscovered, PUBLISHED_STATE_NAMES.length);
  assert.equal(report.recordsEmitted, PUBLISHED_STATE_NAMES.length);
  assert.equal(report.recordsRejected, 0);
  assert.equal(report.complete, true);
  assert.equal(report.fullSweepComplete, true);
});

test('lastRunReport marks the run partial when maxRecords truncates the discovered rows', async () => {
  const scraper = makeScraper({ maxRecords: 2 });
  await scraper.scrapeFeed();
  const report = scraper.lastRunReport;
  assert.equal(report.recordsEmitted, 2);
  assert.equal(report.outcome, 'partial_success');
  assert.equal(report.complete, false);
  assert.equal(report.fullSweepComplete, false);
});

test('lastRunReport captures an upstream failure when the CSV cannot be fetched', async () => {
  const failingFetch = async () => {
    const err = new Error('ECONNRESET');
    err.code = 'ECONNRESET';
    err.haltScraper = true;
    throw err;
  };
  const scraper = new FhfaHpiScraper({ fetchImpl: failingFetch, maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err && err.code === 'UPSTREAM_TRANSPORT_ERROR'
  );
  const report = scraper.lastRunReport;
  assert.ok(report);
  assert.equal(report.outcome, 'failed');
  assert.equal(report.recordsEmitted, 0);
  assert.equal(report.fixtureFallbackUsed, false);
  assert.ok(report.failures.length > 0);
  assert.match(report.failures[0].error, /ECONNRESET|UPSTREAM_TRANSPORT_ERROR/);
});

test('rejects when the CSV response is too large', async () => {
  const bigText = 'x'.repeat(MAX_CSV_BYTES + 1);
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(bigText), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_RESPONSE_TOO_LARGE'
  );
});

test('rejects with MISSING_COLUMN when a metric column is absent', async () => {
  const csv = 'State,Rank,"1 Quarter","5 Year","Since 1991"\nAlabama,1,"1.0","15.0","120.0"\n';
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(csv), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_MISSING_COLUMN'
  );
});

test('rejects the retired DataTools header shape with MISSING_COLUMN', async () => {
  const csv = 'Series,Geography,Geo_short,Period,Index_nsa,Index_sa\nST-CA,California,CA,2026Q1,418.7,420.1\n';
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(csv), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_MISSING_COLUMN'
  );
});

test('rejects with INSUFFICIENT_ROWS when fewer than 50 states are published', async () => {
  const csv = buildStateCsv(PUBLISHED_STATE_NAMES.slice(0, 3));
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(csv), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_INSUFFICIENT_ROWS'
  );
});

test('rejects with INSUFFICIENT_ROWS when the CSV is header-only', async () => {
  const csv = `${LIVE_HEADER}\n`;
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(csv), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_INSUFFICIENT_ROWS'
  );
});

test('rejects when the CSV response is empty (base layer rejects empty text)', async () => {
  const badFetch = async () => ({ ok: true, status: 200, text: async () => '' });
  const scraper = new FhfaHpiScraper({ fetchImpl: badFetch, maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => /Empty upstream payload/.test(String(err && err.message))
  );
});

test('mapped listings never fabricate a property value and carry the area-index caveat', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  for (const record of records) {
    const caveat = record.provenance.sourceFacts.caveat;
    assert.match(caveat, /Not index levels and not the value of any specific property/);
    assert.match(caveat, /no bid, sale date, occupancy, or property facts are implied/);
    assert.equal(record.provenance.sourceFacts.evidenceClass, 'area_house_price_index');
    assert.equal(record.openingBid, null);
    assert.equal(record.price, null);
    assert.equal(record.estLow, null);
    assert.equal(record.estHigh, null);
  }
});

test('source-policy accepts the live per-state record URLs', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const ok = inspectSourceRecordUrl('fhfa-hpi', 'https://www.fhfa.gov/hpi-state/csv?geo=CA');
  assert.equal(ok.isValid, true, JSON.stringify(ok));
  assert.match(ok.url, /^https:\/\/www\.fhfa\.gov\/hpi-state\/csv\?geo=CA$/);
  const bare = inspectSourceRecordUrl('fhfa-hpi', 'https://www.fhfa.gov/hpi-state/csv');
  assert.equal(bare.isValid, true, JSON.stringify(bare));
});

test('source-policy rejects FHFA HPI URLs on unrelated hosts', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const bad = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://example.com/hpi-state/csv?geo=CA'
  );
  assert.equal(bad.isValid, false);
  assert.equal(bad.error, 'source_host_mismatch');
});

test('source-policy rejects FHFA HPI URLs on the retired DataTools path', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const bad = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=CA&period=2026Q1'
  );
  assert.equal(bad.isValid, false);
  assert.equal(bad.error, 'source_url_not_exact_record');
});

test('source-policy rejects FHFA HPI URLs with unknown query keys or bad geo', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const period = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/hpi-state/csv?geo=CA&period=2026Q1'
  );
  assert.equal(period.isValid, false, 'period is not part of the shape');
  const extra = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/hpi-state/csv?geo=CA&extra=x'
  );
  assert.equal(extra.isValid, false);
  const onlyPeriod = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/hpi-state/csv?period=2026Q1'
  );
  assert.equal(onlyPeriod.isValid, false);
  const badGeo = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/hpi-state/csv?geo=ZZ'
  );
  assert.equal(badGeo.isValid, false);
  const emptyGeo = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/hpi-state/csv?geo='
  );
  assert.equal(emptyGeo.isValid, false);
  const otherPath = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/some/other/path.csv?geo=CA'
  );
  assert.equal(otherPath.isValid, false, 'only /hpi-state/csv is accepted');
});

test('source-policy rejects FHFA HPI URLs on http (not https)', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const bad = inspectSourceRecordUrl(
    'fhfa-hpi',
    'http://www.fhfa.gov/hpi-state/csv?geo=CA'
  );
  assert.equal(bad.isValid, false);
  assert.equal(bad.error, 'unsafe_source_url');
});
