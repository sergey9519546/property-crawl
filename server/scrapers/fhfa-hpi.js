// server/scrapers/fhfa-hpi.js
//
// FHFA House Price Index enrichment collector.
//
// Source (publisher-of-record):
//   https://www.fhfa.gov/hpi-state/csv
//
// The publisher's legacy DataTools per-(state, period) file
// (HPI_AT_state.csv) is retired and returns HTTP 404. The live public
// state endpoint returns one row per state: seasonally-adjusted HPI
// percent changes ("1 Quarter", "1 Year", "5 Year", "Since 1991")
// plus a rank. It publishes NO index levels, NO periods, and NO dollar
// values — and this collector never invents them.
//
// Parsing, the publisher-name→USPS-code map, and the sha256 helper are
// shared with server/enrichment/fhfa-state-hpi.js; do not duplicate them.
//
// Role: evidence (area_context, enrichment only — never a primary
// opportunity source). Published area percent changes describe the
// area's repeat-sales trajectory, not the value of any property.
//
// What this collector emits:
//   One listing per state. The listing contract is satisfied by using
//   the state code as the `state` field and the synthesized label
//   "FHFA HPI State Summary for <state name> (SA percent changes)".
//   No opening bid, sale date, occupancy, year, beds/baths/sqft, or
//   property class is fabricated; those fields stay null on the
//   canonical record.
//
// Safety:
//   - Default cap of 100 records per run covers all 51 published state rows; hard cap 5,000.
//   - Circuit breaker on every request (inherited from BaseScraper).
//   - CSV download is bounded by maxBytes (1 MB hard cap) and the row
//     cap; the publisher's state summary is ~2 KB so this is
//     comfortably above real-world need.
//   - Requires the 4 metric columns and at least 50 recognizable state
//     rows, else the run fails with a specific FhfaHpiError code.
//   - No fixture fallback. If the live CSV is unreachable the run fails
//     and the circuit breaker trips.
const BaseScraper = require('./base');
const {
  SOURCE_URL,
  INDEX_TYPE,
  MIN_STATE_ROWS,
  parseStateHpiCsv,
  sha256Hex,
  STATE_NAME_TO_CODE
} = require('../enrichment/fhfa-state-hpi');
const { isUsStateOrTerritoryCode } = require('../state-codes');

const SOURCE_KEY = 'fhfa-hpi';
const PUBLISHER = 'FHFA';
const DEFAULT_CSV_URL = SOURCE_URL;
const DEFAULT_MAX_RECORDS = 100; // covers all 51 published state rows
const MAX_RECORDS_CAP = 5_000;
const MAX_CSV_BYTES = 1_048_576; // 1 MB download cap; the snapshot loader's 256 KB cap is separate

// Publisher state name → USPS code map, inverted once for the record
// address label. Reused from the enrichment module; not a value source.
const STATE_CODE_TO_NAME = Object.freeze(
  Object.fromEntries(
    Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name])
  )
);

class FhfaHpiError extends Error {
  constructor(message, code = 'FHFA_HPI_UPSTREAM_UNAVAILABLE') {
    super(message);
    this.name = 'FhfaHpiError';
    this.code = code;
  }
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

// The publisher's live state summary endpoint is a single canonical URL.
// Accept only https://(www.)fhfa.gov/hpi-state/csv (optional trailing
// slash); the retired /datatools/... per-(state, period) file path and
// every other host/path fall back to the default.
function sanitizeCsvUrl(root) {
  if (!root || typeof root !== 'string') return DEFAULT_CSV_URL;
  const value = root.trim();
  if (!value) return DEFAULT_CSV_URL;
  if (!/^https:\/\/(?:www\.)?fhfa\.gov\/hpi-state\/csv\/?$/i.test(value)) {
    return DEFAULT_CSV_URL;
  }
  return value;
}

// Stable URL pointing at the exact state row of the public CSV summary.
// The csvUrl is the publisher's canonical published endpoint; the geo
// query key identifies the row. No other publisher URL is implied.
function buildRecordSourceUrl({ csvUrl, state }) {
  const url = new URL(csvUrl);
  url.searchParams.set('geo', String(state || '').trim().toUpperCase());
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
      endpoint: '/hpi-state/csv',
      csvUrl: this.csvUrl,
      level: 'state',
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
    // Hash the exact bytes received so every emitted record carries a
    // verifiable dataset fingerprint.
    return { text, datasetSha256: sha256Hex(text) };
  }

  mapStateRecord(state, row, { csvUrl, observedAt, datasetSha256 }) {
    const stateCode = String(state || '').trim().toUpperCase();
    if (!isUsStateOrTerritoryCode(stateCode)) return null;
    const stateName = STATE_CODE_TO_NAME[stateCode];
    if (!stateName) return null;

    const listingId = `${SOURCE_KEY}-${stateCode}`;
    const sourceUrl = buildRecordSourceUrl({ csvUrl, state: stateCode });

    // The publisher does not publish a street address. The state name
    // label is enough to satisfy the 8-500 char address constraint
    // without inventing property-level data.
    const address = `FHFA HPI State Summary for ${stateName} (SA percent changes)`;
    if (address.length < 8 || address.length > 500) return null;

    const metrics = {
      rank: row.rank ?? null,
      quarterPct: row.quarterPct ?? null,
      yoyPct: row.yoyPct ?? null,
      fiveYearPct: row.fiveYearPct ?? null,
      since1991Pct: row.since1991Pct ?? null
    };

    const rawPayload = {
      state: stateCode,
      stateName,
      ...metrics,
      indexType: INDEX_TYPE
    };

    const preNormalized = {
      id: listingId,
      source: SOURCE_KEY,
      state: stateCode,
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
          state: stateCode,
          stateName,
          ...metrics,
          indexType: INDEX_TYPE,
          datasetSha256,
          evidenceClass: 'area_house_price_index',
          caveat: 'Published area percent changes. Not index levels and not the value of any specific property; no bid, sale date, occupancy, or property facts are implied.'
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
      let datasetSha256 = null;
      let bytes = 0;

      try {
        const fetched = await this.fetchCsv();
        csvText = fetched.text;
        datasetSha256 = fetched.datasetSha256;
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

      if (!csvText.trim()) {
        throw new FhfaHpiError('FHFA HPI CSV was empty', 'FHFA_HPI_EMPTY_RESPONSE');
      }

      const parsed = parseStateHpiCsv(csvText);
      if (!parsed.hasMetrics) {
        throw new FhfaHpiError(
          'FHFA HPI CSV missing one or more required metric columns ("1 Quarter", "1 Year", "5 Year", "Since 1991")',
          'FHFA_HPI_MISSING_COLUMN'
        );
      }
      const stateRows = Object.entries(parsed.states);
      if (stateRows.length < MIN_STATE_ROWS) {
        throw new FhfaHpiError(
          `FHFA HPI CSV contained ${stateRows.length} recognizable state rows; at least ${MIN_STATE_ROWS} required`,
          'FHFA_HPI_INSUFFICIENT_ROWS'
        );
      }

      let rejectedRows = 0;

      for (const [state, metrics] of stateRows) {
        if (collected.length >= this.maxRecords) break;
        const listing = this.mapStateRecord(state, metrics, {
          csvUrl: this.csvUrl,
          observedAt,
          datasetSha256
        });
        if (listing) collected.push(listing);
        else rejectedRows += 1;
      }

      const truncated = collected.length >= this.maxRecords
        && stateRows.length - rejectedRows > collected.length;

      this.lastRunReport = {
        outcome: collected.length ? (truncated ? 'partial_success' : 'success') : 'empty',
        scope: this.getCollectionScope(),
        bytes,
        recordsDiscovered: stateRows.length,
        recordsEmitted: collected.length,
        recordsRejected: rejectedRows,
        complete: !truncated && failures.length === 0,
        fullSweepComplete: !truncated && failures.length === 0,
        fixtureFallbackUsed: false,
        failures,
        sweepStartedAt: observedAt
      };

      console.log(
        `[${this.name}] Collected ${collected.length} FHFA HPI state summaries ` +
        `(${bytes} CSV bytes, ${stateRows.length} state rows, ${rejectedRows} rejected)`
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
module.exports.MIN_STATE_ROWS = MIN_STATE_ROWS;
module.exports.FhfaHpiError = FhfaHpiError;
module.exports.sanitizeCsvUrl = sanitizeCsvUrl;
module.exports.buildRecordSourceUrl = buildRecordSourceUrl;
module.exports.truncateRaw = truncateRaw;
