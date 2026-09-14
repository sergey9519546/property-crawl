// server/scrapers/fhfa-hpi.js
//
// FHFA House Price Index enrichment collector.
//
// Source (publisher-of-record):
//   https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/
//
// The FHFA publishes a flat CSV table per geography level (state, metro,
// division, national). This collector reads the public state-level file
// (HPI_AT_state.csv) and emits one evidence record per (state, period)
// row. Metro / division / national files are explicitly out of scope for
// this collector — keeping the public surface narrow keeps the sourceUrl
// record-shape validator simple and the run report bounded.
//
// Role: evidence (area_context, enrichment only — never a primary
// opportunity source). The index value describes the area's repeat-sales
// trajectory, not the market value of any specific property.
//
// What the publisher publishes:
//   Quarterly index values for the repeat-sales house price index by
//   state, with non-seasonally-adjusted (Index_nsa) and seasonally-adjusted
//   (Index_sa) values. The state file has roughly 50 * N_quarters rows.
//
// What this collector emits:
//   One listing per state/period observation. The listing contract is
//   satisfied by using the state abbreviation as the `state` field and a
//   synthesized address label "FHFA HPI Series ST-XX for period YYYYQN".
//   No opening bid, sale date, occupancy, year, beds/baths/sqft, or
//   property class is fabricated; those fields stay null on the
//   canonical record.
//
// Safety:
//   - Default 50 records per run (one per state), capped at 5,000.
//   - Circuit breaker on every request (inherited from BaseScraper).
//   - CSV download is bounded by maxBytes (1 MB hard cap) and the row
//     cap; the publisher's quarterly state file is ~30 KB so this is
//     comfortably above real-world need.
//   - Never fabricates a bid, sale date, occupancy, year, beds/baths/sqft,
//     or property class.
//   - No fixture fallback. If the live CSV is unreachable the run fails
//     and the circuit breaker trips.
const BaseScraper = require('./base');

const SOURCE_KEY = 'fhfa-hpi';
const PUBLISHER = 'FHFA';
const DEFAULT_CSV_URL = 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_state.csv';
const DEFAULT_MAX_RECORDS = 50;
const MAX_RECORDS_CAP = 5_000;
const MAX_CSV_BYTES = 1_048_576; // 1 MB
const STATE_LEVEL_PREFIX = 'ST-';

// US state + territory abbreviations used by FHFA's state-level HPI CSV.
// DC is included for completeness; PR / GU / VI / AS / MP are valid US
// territories but are not part of FHFA's state index — they are kept
// out so the validator catches bad rows even if the publisher ever adds
// them without notice.
const FHFA_STATE_ABBRS = Object.freeze([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY'
]);
const FHFA_STATE_ABBRS_SET = new Set(FHFA_STATE_ABBRS);

class FhfaHpiError extends Error {
  constructor(message, code = 'FHFA_HPI_UPSTREAM_UNAVAILABLE') {
    super(message);
    this.name = 'FhfaHpiError';
    this.code = code;
  }
}

function textOrNull(value, maximum = 200) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedInt(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function truncateRaw(payload, maxBytes = 8192) {
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(text, 'utf8'),
    preview: text.slice(0, Math.floor(maxBytes * 0.8))
  });
}

function sanitizeCsvUrl(root) {
  if (!root || typeof root !== 'string') return DEFAULT_CSV_URL;
  const value = root.trim();
  if (!value) return DEFAULT_CSV_URL;
  if (!/^https:\/\/(?:www\.)?fhfa\.gov\//i.test(value)) return DEFAULT_CSV_URL;
  if (!/\.csv$/i.test(value)) return DEFAULT_CSV_URL;
  if (!/HPI_AT_(?:state|metro|division|national)\.csv$/i.test(value)) return DEFAULT_CSV_URL;
  return value;
}

// Minimal RFC 4180 CSV parser sufficient for FHFA's well-formed tables.
// Handles quoted fields with embedded commas / escaped quotes; ignores
// empty lines; does NOT handle multiline records (FHFA never emits them).
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\r') {
      // ignore; handled with \n
    } else if (char === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

function headerIndexMap(headerRow) {
  const map = {};
  for (let i = 0; i < headerRow.length; i += 1) {
    const key = String(headerRow[i] || '').trim();
    if (key) map[key.toLowerCase()] = i;
  }
  return map;
}

function buildRecordSourceUrl({ csvUrl, geography, period }) {
  // Stable URL pointing at the exact (geo, period) row of the public CSV
  // table. The csvUrl is the publisher's canonical published file; the
  // geo + period query keys identify the row.
  const url = new URL(csvUrl);
  url.searchParams.set('geo', geography);
  url.searchParams.set('period', period);
  return url.toString();
}

class FhfaHpiScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      ...options,
      name: options.name || 'FhfaHpiCollector',
      sourceKey: SOURCE_KEY
    });
    this.csvUrl = sanitizeCsvUrl(
      options.csvUrl || process.env.FHFA_HPI_CSV_URL || DEFAULT_CSV_URL
    );
    this.maxRecords = boundedInt(
      options.maxRecords ?? process.env.FHFA_HPI_MAX_RECORDS,
      DEFAULT_MAX_RECORDS,
      MAX_RECORDS_CAP
    );
    this.maxCsvBytes = boundedInt(
      options.maxCsvBytes ?? process.env.FHFA_HPI_MAX_CSV_BYTES,
      MAX_CSV_BYTES,
      MAX_CSV_BYTES
    );
    this.rawPublisherRecords = new WeakMap();
    this.lastRunReport = null;
  }

  getCollectionScope() {
    return {
      endpoint: '/DataTools/Downloads/Documents/HPI',
      csvUrl: this.csvUrl,
      level: 'state',
      stateLevelPrefix: STATE_LEVEL_PREFIX,
      maxRecords: this.maxRecords,
      maxCsvBytes: this.maxCsvBytes
    };
  }

  getRawPublisherRecord(listing) {
    return this.rawPublisherRecords.get(listing) || null;
  }

  buildRecordSourceUrl(recordArgs) {
    return buildRecordSourceUrl({ csvUrl: this.csvUrl, ...recordArgs });
  }

  async fetchCsv() {
    const url = this.csvUrl;
    const text = await this.requestText(url, {
      headers: { Accept: 'text/csv, text/plain;q=0.9, */*;q=0.1' }
    });
    if (Buffer.byteLength(text, 'utf8') > this.maxCsvBytes) {
      throw new FhfaHpiError(
        `FHFA HPI CSV exceeded ${this.maxCsvBytes}-byte cap`,
        'FHFA_HPI_RESPONSE_TOO_LARGE'
      );
    }
    return text;
  }

  mapHpiRecord(row, headerMap, { csvUrl, observedAt }) {
    const series = textOrNull(row[headerMap.series], 32);
    const geography = textOrNull(row[headerMap.geography], 80);
    const geoShort = textOrNull(row[headerMap['geo_short']] ?? row[headerMap.geoshort], 8);
    const period = textOrNull(row[headerMap.period], 12);
    const indexNsa = finiteNumber(row[headerMap.index_nsa]);
    const indexSa = finiteNumber(row[headerMap.index_sa]);

    if (!series || !series.toUpperCase().startsWith(STATE_LEVEL_PREFIX)) return null;
    if (!period || !/^\d{4}Q[1-4]$/.test(period)) return null;
    if (!geoShort || !FHFA_STATE_ABBRS_SET.has(geoShort.toUpperCase())) return null;
    if (indexNsa === null && indexSa === null) return null;

    const state = geoShort.toUpperCase();
    const listingId = `${SOURCE_KEY}-${state}-${period}`;
    const sourceUrl = buildRecordSourceUrl({ csvUrl, geography: state, period });

    // The publisher does not publish a street address. The series prefix
    // + state + period is enough to satisfy the 8-500 char address
    // constraint without inventing property-level data.
    const address = `FHFA HPI Series ${series.toUpperCase()} for period ${period}`;
    if (address.length < 8 || address.length > 500) return null;

    const rawPayload = {
      series: series.toUpperCase(),
      geography,
      geo_short: state,
      period,
      index_nsa: indexNsa,
      index_sa: indexSa
    };

    const preNormalized = {
      id: listingId,
      source: SOURCE_KEY,
      state,
      county: null,
      city: null,
      zip: null,
      address,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      propType: null,
      openingBid: null,
      price: null,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate: null,
      sourceUrl,
      raw: truncateRaw(rawPayload),
      occupancy: null,
      provenance: {
        origin: 'live',
        observed: true,
        publisher: PUBLISHER,
        recordId: listingId,
        observedAt,
        sourceFacts: {
          csvUrl,
          recordUrl: sourceUrl,
          series: series.toUpperCase(),
          geography,
          geoShort: state,
          period,
          indexNsa,
          indexSa,
          evidenceClass: 'area_house_price_index',
          enrichmentSource: true,
          caveat: 'Area-level repeat-sales index. The publisher does not establish the market value of any specific property. No bid, sale date, occupancy, year, beds, baths, sqft, or property classification is implied.'
        }
      },
      sourceObservedAt: observedAt
    };

    const listing = this.standardizeListing(preNormalized);
    this.rawPublisherRecords.set(listing, rawPayload);
    return listing;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const observedAt = new Date().toISOString();
      const collected = [];
      const failures = [];
      let csvText;
      let bytes = 0;

      try {
        csvText = await this.fetchCsv();
        bytes = Buffer.byteLength(csvText, 'utf8');
      } catch (error) {
        this.lastRunReport = {
          outcome: 'failed',
          scope: this.getCollectionScope(),
          bytes,
          recordsDiscovered: 0,
          recordsEmitted: 0,
          recordsRejected: 0,
          complete: false,
          fullSweepComplete: false,
          fixtureFallbackUsed: false,
          failures: [{ error: error.message, code: error.code || null }],
          sweepStartedAt: observedAt
        };
        throw error;
      }

      const rows = parseCsv(csvText);
      if (rows.length < 2) {
        throw new FhfaHpiError('FHFA HPI CSV was empty', 'FHFA_HPI_EMPTY_RESPONSE');
      }
      const header = rows[0];
      const headerMap = headerIndexMap(header);
      const required = ['series', 'geography', 'period', 'index_nsa', 'index_sa'];
      for (const key of required) {
        if (!(key in headerMap)) {
          throw new FhfaHpiError(
            `FHFA HPI CSV missing required column "${key}"`,
            'FHFA_HPI_MISSING_COLUMN'
          );
        }
      }
      if (!('geo_short' in headerMap) && !('geoshort' in headerMap)) {
        throw new FhfaHpiError(
          'FHFA HPI CSV missing required column "geo_short"',
          'FHFA_HPI_MISSING_COLUMN'
        );
      }

      const dataRows = rows.slice(1);
      let rejectedRows = 0;

      for (const row of dataRows) {
        if (collected.length >= this.maxRecords) break;
        const listing = this.mapHpiRecord(row, headerMap, {
          csvUrl: this.csvUrl,
          observedAt
        });
        if (listing) collected.push(listing);
        else rejectedRows += 1;
      }

      const truncated = collected.length >= this.maxRecords
        && dataRows.length - rejectedRows > collected.length;

      this.lastRunReport = {
        outcome: collected.length ? (truncated ? 'partial_success' : 'success') : 'empty',
        scope: this.getCollectionScope(),
        bytes,
        recordsDiscovered: dataRows.length,
        recordsEmitted: collected.length,
        recordsRejected: rejectedRows,
        complete: !truncated && failures.length === 0,
        fullSweepComplete: !truncated && failures.length === 0,
        fixtureFallbackUsed: false,
        failures,
        sweepStartedAt: observedAt
      };

      console.log(
        `[${this.name}] Collected ${collected.length} FHFA HPI state/period observations ` +
        `(${bytes} CSV bytes, ${dataRows.length} data rows, ${rejectedRows} rejected)`
      );
      return collected;
    });
  }
}

module.exports = new FhfaHpiScraper();
module.exports.FhfaHpiScraper = FhfaHpiScraper;
module.exports.SOURCE_KEY = SOURCE_KEY;
module.exports.PUBLISHER = PUBLISHER;
module.exports.DEFAULT_CSV_URL = DEFAULT_CSV_URL;
module.exports.DEFAULT_MAX_RECORDS = DEFAULT_MAX_RECORDS;
module.exports.MAX_RECORDS_CAP = MAX_RECORDS_CAP;
module.exports.MAX_CSV_BYTES = MAX_CSV_BYTES;
module.exports.STATE_LEVEL_PREFIX = STATE_LEVEL_PREFIX;
module.exports.FHFA_STATE_ABBRS = FHFA_STATE_ABBRS;
module.exports.FhfaHpiError = FhfaHpiError;
module.exports.sanitizeCsvUrl = sanitizeCsvUrl;
module.exports.parseCsv = parseCsv;
module.exports.headerIndexMap = headerIndexMap;
module.exports.buildRecordSourceUrl = buildRecordSourceUrl;
module.exports.truncateRaw = truncateRaw;