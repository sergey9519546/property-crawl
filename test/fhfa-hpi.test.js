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
  STATE_LEVEL_PREFIX,
  sanitizeCsvUrl,
  parseCsv,
  headerIndexMap,
  buildRecordSourceUrl,
  truncateRaw
} = require('../server/scrapers/fhfa-hpi');

const fhfaScraper = require('../server/scrapers/fhfa-hpi');

const SAMPLE_CSV = [
  'Series,Geography,Geo_short,Period,Index_nsa,Index_sa',
  'ST-CA,California,CA,2026Q1,418.7,420.1',
  'ST-NY,New York,NY,2026Q1,395.4,397.8',
  'ST-TX,Texas,TX,2026Q1,328.9,330.2',
  'ST-FL,Florida,FL,2026Q1,402.5,404.6',
  'ME-12420,New York-Newark-Jersey City,NY,2026Q1,389.1,391.4',
  'DV-2,Mid-Atlantic,NJ,2026Q1,372.8,374.2',
  'US,United States,US,2026Q1,335.6,337.0',
  'ST-CA,California,CA,2025Q4,415.2,418.0',
  'ST-CA,California,CA,2025Q3,412.9,415.1',
  ',,,,,' // empty row should be ignored
].join('\n');

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
  assert.match(DEFAULT_CSV_URL, /^https:\/\/www\.fhfa\.gov\/DataTools\/Downloads\/Documents\/HPI\/HPI_AT_state\.csv$/);
  assert.equal(DEFAULT_MAX_RECORDS, 50);
  assert.equal(MAX_RECORDS_CAP, 5_000);
  assert.equal(MAX_CSV_BYTES, 1_048_576);
  assert.equal(STATE_LEVEL_PREFIX, 'ST-');
});

test('reads FHFA_HPI_CSV_URL from environment when not passed as option', () => {
  const original = process.env.FHFA_HPI_CSV_URL;
  try {
    process.env.FHFA_HPI_CSV_URL = 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv';
    const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch() });
    assert.equal(scraper.csvUrl, 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv');
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
    process.env.FHFA_HPI_CSV_URL = 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv';
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

test('sanitizeCsvUrl accepts canonical published URLs', () => {
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv'),
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv'
  );
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv'),
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_metro.csv'
  );
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_division.csv'),
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_division.csv'
  );
  assert.equal(
    sanitizeCsvUrl('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_national.csv'),
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_national.csv'
  );
});

test('sanitizeCsvUrl rejects unrelated hosts and non-CSV paths', () => {
  assert.equal(sanitizeCsvUrl('https://example.com/HPI_AT_state.csv'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl('https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl('https://www.fhfa.gov/'), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(''), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(null), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(undefined), DEFAULT_CSV_URL);
  assert.equal(sanitizeCsvUrl(42), DEFAULT_CSV_URL);
});

test('sanitizeCsvUrl rejects HTTP (non-HTTPS) URLs', () => {
  assert.equal(
    sanitizeCsvUrl('http://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv'),
    DEFAULT_CSV_URL
  );
});

test('getCollectionScope returns a stable, comparable descriptor', () => {
  const scraper = makeScraper();
  const scope = scraper.getCollectionScope();
  assert.deepEqual(scope, {
    endpoint: '/DataTools/Downloads/Documents/HPI',
    csvUrl: DEFAULT_CSV_URL,
    level: 'state',
    stateLevelPrefix: 'ST-',
    maxRecords: DEFAULT_MAX_RECORDS,
    maxCsvBytes: MAX_CSV_BYTES
  });
});

test('parseCsv handles a simple FHFA-shaped CSV correctly', () => {
  const rows = parseCsv(SAMPLE_CSV);
  assert.equal(rows.length, 11);
  assert.deepEqual(rows[0], ['Series', 'Geography', 'Geo_short', 'Period', 'Index_nsa', 'Index_sa']);
  assert.deepEqual(rows[1], ['ST-CA', 'California', 'CA', '2026Q1', '418.7', '420.1']);
});

test('parseCsv handles quoted fields with embedded commas', () => {
  const text = 'Series,Geography,Period\n"ST-CA","San Francisco, Bay Area","2026Q1"\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['ST-CA', 'San Francisco, Bay Area', '2026Q1']);
});

test('parseCsv handles escaped double quotes inside quoted fields', () => {
  const text = 'Series,Geography,Period\n"ST-CA","He said ""hi""","2026Q1"\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['ST-CA', 'He said "hi"', '2026Q1']);
});

test('parseCsv ignores empty trailing lines', () => {
  const text = 'Series,Geography,Period\nST-CA,California,2026Q1\n\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 2);
});

test('parseCsv handles \\r\\n line endings', () => {
  const text = 'Series,Geography,Period\r\nST-CA,California,2026Q1\r\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['ST-CA', 'California', '2026Q1']);
});

test('headerIndexMap normalizes column keys to lowercase', () => {
  const map = headerIndexMap(['Series', 'Geography', 'Geo_short', 'Period', 'Index_nsa', 'Index_sa']);
  assert.equal(map.series, 0);
  assert.equal(map.geography, 1);
  assert.equal(map.geo_short, 2);
  assert.equal(map.period, 3);
  assert.equal(map.index_nsa, 4);
  assert.equal(map.index_sa, 5);
});

test('headerIndexMap accepts GeoShort (no underscore) variant', () => {
  const map = headerIndexMap(['Series', 'Geography', 'GeoShort', 'Period']);
  assert.equal(map.geoshort, 2);
});

test('buildRecordSourceUrl produces a stable per-row URL', () => {
  const url = buildRecordSourceUrl({
    csvUrl: DEFAULT_CSV_URL,
    geography: 'CA',
    period: '2026Q1'
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://www.fhfa.gov');
  assert.equal(parsed.pathname, '/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv');
  assert.equal(parsed.searchParams.get('geo'), 'CA');
  assert.equal(parsed.searchParams.get('period'), '2026Q1');
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

test('scrapeFeed returns one record per state/period (state-level only)', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  // 4 state-level rows in 2026Q1 (CA/NY/TX/FL) + 2 state-level rows for CA in 2025Q4 + 2025Q3 = 6
  assert.equal(records.length, 6);
  assert.ok(records.every((record) => record.source === SOURCE_KEY));
  assert.ok(records.every((record) => /^[A-Z]{2}$/.test(record.state)));
});

test('scrapeFeed skips non-state-level rows (metro, division, national)', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  const seriesList = records.map((record) => record.provenance.sourceFacts.series);
  assert.ok(seriesList.every((series) => series.startsWith('ST-')));
  assert.ok(!seriesList.includes('ME-12420'));
  assert.ok(!seriesList.includes('DV-2'));
  assert.ok(!seriesList.includes('US'));
});

test('scrapeFeed emits the canonical sourceUrl pointing at the (geo, period) row', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  const ca = records.find((record) => record.state === 'CA' && /2026Q1/.test(record.address));
  assert.ok(ca);
  const url = new URL(ca.sourceUrl);
  assert.equal(url.hostname, 'www.fhfa.gov');
  assert.equal(url.pathname, '/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv');
  assert.equal(url.searchParams.get('geo'), 'CA');
  assert.equal(url.searchParams.get('period'), '2026Q1');
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

test('mapped listings fail ingestion when state is unknown (defensive check)', async () => {
  const { validateListingForIngestion } = require('../server/scrapers/validation');
  const header = headerIndexMap(['Series', 'Geography', 'Geo_short', 'Period', 'Index_nsa', 'Index_sa']);
  const scraper = makeScraper();
  const bogusRow = ['ST-XX', 'Nowhere', 'XX', '2026Q1', '100.0', '101.0'];
  const listing = scraper.mapHpiRecord(bogusRow, header, {
    csvUrl: DEFAULT_CSV_URL,
    observedAt: new Date().toISOString()
  });
  assert.equal(listing, null);
});

test('mapped listings skip rows with bad period strings', () => {
  const header = headerIndexMap(['Series', 'Geography', 'Geo_short', 'Period', 'Index_nsa', 'Index_sa']);
  const scraper = makeScraper();
  const bad = ['ST-CA', 'California', 'CA', '2026Q5', '418.7', '420.1']; // Q5 is invalid
  const listing = scraper.mapHpiRecord(bad, header, {
    csvUrl: DEFAULT_CSV_URL,
    observedAt: new Date().toISOString()
  });
  assert.equal(listing, null);
});

test('mapped listings skip rows where neither index_nsa nor index_sa is present', () => {
  const header = headerIndexMap(['Series', 'Geography', 'Geo_short', 'Period', 'Index_nsa', 'Index_sa']);
  const scraper = makeScraper();
  const bad = ['ST-CA', 'California', 'CA', '2026Q1', '', ''];
  const listing = scraper.mapHpiRecord(bad, header, {
    csvUrl: DEFAULT_CSV_URL,
    observedAt: new Date().toISOString()
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
    assert.match(record.provenance.recordId, /^fhfa-hpi-[A-Z]{2}-\d{4}Q[1-4]$/);
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
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  for (const listing of records) {
    const raw = scraper.getRawPublisherRecord(listing);
    assert.ok(raw);
    assert.match(raw.series, /^ST-[A-Z]{2}$/);
    assert.match(raw.period, /^\d{4}Q[1-4]$/);
    assert.equal(raw.geo_short, listing.state);
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
  const scraper = makeScraper({ maxRecords: 10 });
  await scraper.scrapeFeed();
  const report = scraper.lastRunReport;
  assert.ok(report);
  assert.equal(report.fixtureFallbackUsed, false);
  assert.equal(typeof report.bytes, 'number');
  assert.ok(report.bytes > 0);
  assert.equal(report.recordsDiscovered, 10); // 10 non-empty data rows in SAMPLE_CSV
  assert.ok(report.recordsEmitted > 0);
  assert.ok(report.recordsEmitted <= 10);
  assert.equal(typeof report.recordsRejected, 'number');
  assert.equal(report.complete, true);
  assert.equal(report.fullSweepComplete, true);
});

test('lastRunReport marks the run partial when maxRecords truncates the discovered rows', async () => {
  const scraper = makeScraper({ maxRecords: 2 });
  await scraper.scrapeFeed();
  const report = scraper.lastRunReport;
  assert.equal(report.recordsEmitted, 2);
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

test('rejects when the CSV has no data rows (header only)', async () => {
  const csv = 'Series,Geography,Geo_short,Period,Index_nsa,Index_sa\n';
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(csv), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_EMPTY_RESPONSE'
  );
});

test('rejects when a required CSV column is missing', async () => {
  const csv = 'Series,Geography,Geo_short,Period\nST-CA,California,CA,2026Q1\n';
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(csv), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_MISSING_COLUMN'
  );
});

test('rejects when the CSV lacks the geo_short column', async () => {
  const csv = 'Series,Geography,Period,Index_nsa,Index_sa\nST-CA,California,2026Q1,418.7,420.1\n';
  const scraper = new FhfaHpiScraper({ fetchImpl: makeFetch(csv), maxRecords: 5 });
  await assert.rejects(
    scraper.scrapeFeed(),
    (err) => err instanceof FhfaHpiError && err.code === 'FHFA_HPI_MISSING_COLUMN'
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

test('mapped listings never fabricate a property class, year, beds, baths, or sqft', async () => {
  const scraper = makeScraper();
  const records = await scraper.scrapeFeed();
  for (const record of records) {
    const caveat = record.provenance.sourceFacts.caveat;
    assert.match(caveat, /No bid, sale date, occupancy, year, beds, baths, sqft/);
    assert.equal(record.provenance.sourceFacts.enrichmentSource, true);
    assert.equal(record.provenance.sourceFacts.evidenceClass, 'area_house_price_index');
  }
});

test('source-policy accepts canonical FHFA HPI per-row URLs', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const ok = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=CA&period=2026Q1'
  );
  assert.equal(ok.isValid, true, JSON.stringify(ok));
  assert.match(ok.url, /^https:\/\/www\.fhfa\.gov\/DataTools\/Downloads\/Documents\/HPI\/HPI_AT_state\.csv\?geo=CA&period=2026Q1$/);
});

test('source-policy rejects FHFA HPI URLs on unrelated hosts', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const bad = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://example.com/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=CA&period=2026Q1'
  );
  assert.equal(bad.isValid, false);
  assert.equal(bad.error, 'source_host_mismatch');
});

test('source-policy rejects FHFA HPI URLs on a different file path', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const bad = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/some/other/path.csv?geo=CA&period=2026Q1'
  );
  assert.equal(bad.isValid, false);
  assert.equal(bad.error, 'source_url_not_exact_record');
});

test('source-policy rejects FHFA HPI URLs without both geo and period', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const noGeo = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?period=2026Q1'
  );
  assert.equal(noGeo.isValid, false);
  const noPeriod = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=CA'
  );
  assert.equal(noPeriod.isValid, false);
  const extras = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=CA&period=2026Q1&extra=x'
  );
  assert.equal(extras.isValid, false);
});

test('source-policy rejects FHFA HPI URLs with malformed geo or period', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const badGeo = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=ZZ&period=2026Q1'
  );
  assert.equal(badGeo.isValid, false);
  const badPeriod = inspectSourceRecordUrl(
    'fhfa-hpi',
    'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=CA&period=2026-04'
  );
  assert.equal(badPeriod.isValid, false);
});

test('source-policy rejects FHFA HPI URLs on http (not https)', () => {
  const { inspectSourceRecordUrl } = require('../server/scrapers/source-policy');
  const bad = inspectSourceRecordUrl(
    'fhfa-hpi',
    'http://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv?geo=CA&period=2026Q1'
  );
  assert.equal(bad.isValid, false);
  assert.equal(bad.error, 'unsafe_source_url');
});