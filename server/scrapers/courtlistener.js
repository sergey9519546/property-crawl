// server/scrapers/courtlistener.js
//
const { buildDocumentReferences } = require('./document-reference');

// CourtListener / RECAP docket enrichment collector.
//
// Source: https://www.courtlistener.com/api/rest/v4/
//
// CourtListener is a free API for court docket research (PACER alternative).
// RECAP is the community document archive. This collector searches for
// foreclosure / lien / property-related federal court dockets and maps each
// docket to a listing-like enrichment record.
//
// IMPORTANT: This is an ENRICHMENT source, not a primary listing source.
// A court docket is NOT a property sale. It has no opening bid, no sale date,
// and no property classification. Fields that would require sale-specific
// data are always null. The record is useful for linking court filings to
// known properties.
//
// Strategy:
//   1. Search the CourtListener v4 search endpoint for RECAP dockets (type=r)
//      matching foreclosure / lien / property keywords in a target court.
//   2. Map each search result to the canonical listing contract with
//      enrichment-only provenance.
//   3. Enforce 1 req/sec rate limit and a bounded per-run record budget.
//
// Safety:
//   - Default 20 dockets per run (free tier is 100/day unauthenticated).
//   - Circuit breaker on every request (inherited from BaseScraper).
//   - Minimum 1-second delay between API requests.
//   - COURTLISTENER_API_KEY env var enables authenticated access (higher limits).
//   - Never fabricates a bid, sale date, or occupancy status.

const BaseScraper = require('./base');

const SOURCE_KEY = 'courtlistener';
const PUBLISHER = 'Free Law Project / CourtListener';
const API_ROOT = 'https://www.courtlistener.com/api/rest/v4';
const DOCKET_URL_ROOT = 'https://www.courtlistener.com/docket';
const DEFAULT_MAX_RECORDS = 20;
const MAX_RECORDS_CAP = 50;
const MAX_RAW_BYTES = 64 * 1024;
const MIN_REQUEST_INTERVAL_MS = 1000;

// Search keywords that surface foreclosure / lien / property-related dockets.
// These are CourtListener search-engine query terms for type=r (RECAP).
const DEFAULT_SEARCH_QUERY = 'foreclosure OR "lis pendens" OR "notice of default" OR "deed of trust" OR lien';

// Federal court ID prefix → 2-letter state code. CourtListener federal court
// IDs follow the pattern {state}{direction}d for district courts,
// {state}{direction}b for bankruptcy, and {state}{circuit} for appellate.
// State courts use various IDs (e.g., 'oh', 'calctapp') — we handle those
// separately.
function stateFromCourtId(courtId) {
  if (!courtId || typeof courtId !== 'string') return null;
  const id = courtId.toLowerCase();
  // Explicit non-state court IDs that would otherwise match a state prefix.
  if (id === 'scotus' || id === 'cafc' || id === 'uscfc') return null;
  // Federal district/bankruptcy: first 2 chars are the state abbreviation.
  if (/^[a-z]{2}[a-z]?[db]$/.test(id) || /^[a-z]{2}\d{1,2}$/.test(id)) {
    const candidate = id.slice(0, 2).toUpperCase();
    if (/^[A-Z]{2}$/.test(candidate)) return candidate;
  }
  // Known state court IDs that start with the state abbreviation.
  const stateCourtPrefixes = {
    al: 'AL', ak: 'AK', az: 'AZ', ar: 'AR', ca: 'CA', co: 'CO', ct: 'CT',
    dc: 'DC', de: 'DE', fl: 'FL', ga: 'GA', hi: 'HI', id: 'ID', il: 'IL',
    in: 'IN', ia: 'IA', ks: 'KS', ky: 'KY', la: 'LA', me: 'ME', md: 'MD',
    ma: 'MA', mi: 'MI', mn: 'MN', ms: 'MS', mo: 'MO', mt: 'MT', ne: 'NE',
    nv: 'NV', nh: 'NH', nj: 'NJ', nm: 'NM', ny: 'NY', nc: 'NC', nd: 'ND',
    oh: 'OH', ok: 'OK', or: 'OR', pa: 'PA', ri: 'RI', sc: 'SC', sd: 'SD',
    tn: 'TN', tx: 'TX', ut: 'UT', vt: 'VT', va: 'VA', wa: 'WA', wv: 'WV',
    wi: 'WI', wy: 'WY'
  };
  const prefix = id.slice(0, 2);
  if (stateCourtPrefixes[prefix]) return stateCourtPrefixes[prefix];
  return null;
}

function truncateRaw(payload, maxBytes = MAX_RAW_BYTES) {
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(text, 'utf8'),
    preview: text.slice(0, Math.floor(maxBytes * 0.8))
  });
}

function textOrNull(value, maximum = 200) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : null;
}

function boundedInt(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

class CourtListenerError extends Error {
  constructor(message, code = 'COURTLISTENER_UPSTREAM_UNAVAILABLE') {
    super(message);
    this.name = 'CourtListenerError';
    this.code = code;
  }
}

class CourtListenerScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      ...options,
      name: options.name || 'CourtListenerCollector',
      sourceKey: SOURCE_KEY
    });
    this.apiRoot = options.apiRoot || API_ROOT;
    this.docketUrlRoot = options.docketUrlRoot || DOCKET_URL_ROOT;
    this.maxRecords = boundedInt(
      options.maxRecords ?? process.env.COURTLISTENER_MAX_RECORDS,
      DEFAULT_MAX_RECORDS,
      MAX_RECORDS_CAP
    );
    this.searchQuery = options.searchQuery || DEFAULT_SEARCH_QUERY;
    this.courtId = options.courtId || process.env.COURTLISTENER_COURT || null;
    this.apiKey = options.apiKey ?? process.env.COURTLISTENER_API_KEY ?? null;
    this.minRequestIntervalMs = Number.isFinite(options.minRequestIntervalMs)
      ? Math.max(0, Math.floor(options.minRequestIntervalMs))
      : MIN_REQUEST_INTERVAL_MS;
    this.lastRequestAt = 0;
    this.lastRunReport = null;
    this.rawPublisherRecords = new WeakMap();
  }

  getCollectionScope() {
    return {
      endpoint: '/api/rest/v4/search',
      filters: {
        type: 'r',
        query: this.searchQuery,
        ...(this.courtId ? { court: this.courtId } : {})
      },
      pageSize: this.maxRecords
    };
  }

  getRawPublisherRecord(listing) {
    return this.rawPublisherRecords.get(listing) || null;
  }

  buildSearchUrl({ cursor } = {}) {
    const url = new URL(`${this.apiRoot}/search/`);
    url.searchParams.set('q', this.searchQuery);
    url.searchParams.set('type', 'r');
    url.searchParams.set('order_by', 'dateFiled desc');
    if (this.courtId) url.searchParams.set('court', this.courtId);
    if (cursor) url.searchParams.set('cursor', cursor);
    return url.toString();
  }

  docketWebUrl(docketId, absolutePath) {
    // Prefer the publisher-provided absolute path when available; otherwise
    // construct the canonical docket URL.
    if (absolutePath && typeof absolutePath === 'string') {
      return `https://www.courtlistener.com${absolutePath}`;
    }
    return `${this.docketUrlRoot}/${docketId}/`;
  }

  buildAuthHeaders() {
    const headers = {
      'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
      Accept: 'application/json'
    };
    if (this.apiKey) {
      headers.Authorization = `Token ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Enforce a minimum interval between API requests. The free tier allows
   * only 5 requests/minute; we stay well under that with 1 req/sec.
   */
  async enforceRateLimit() {
    if (this.minRequestIntervalMs <= 0) return;
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < this.minRequestIntervalMs) {
      const waitMs = this.minRequestIntervalMs - elapsed;
      const sleep = this.sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
      await sleep(waitMs);
    }
    this.lastRequestAt = Date.now();
  }

  async fetchSearchPage({ cursor } = {}) {
    await this.enforceRateLimit();
    const queryUrl = this.buildSearchUrl({ cursor });
    const payload = await this.requestJson(queryUrl, {
      headers: this.buildAuthHeaders()
    });
    if (payload && typeof payload === 'object' && payload.detail && !Array.isArray(payload.results)) {
      // Django REST Framework returns { detail: "..." } on auth/throttle errors.
      const detail = String(payload.detail);
      const code = /throttl|rate.?limit/i.test(detail)
        ? 'COURTLISTENER_RATE_LIMITED'
        : 'COURTLISTENER_UPSTREAM_UNAVAILABLE';
      throw new CourtListenerError(`CourtListener search failed: ${detail}`, code);
    }
    if (!payload || !Array.isArray(payload.results)) {
      throw new CourtListenerError(
        'CourtListener search response is missing a results array',
        'COURTLISTENER_SCHEMA_UNRECOGNIZED'
      );
    }
    return { queryUrl, payload };
  }

  mapDocket(result, { queryUrl, observedAt }) {
    if (!result || typeof result !== 'object') return null;
    const docketId = Number(result.docket_id);
    if (!Number.isInteger(docketId) || docketId <= 0) return null;

    const caseName = textOrNull(result.caseName, 300);
    const docketNumber = textOrNull(result.docketNumber, 60);
    const courtId = textOrNull(result.court_id, 20);
    const courtName = textOrNull(result.court, 200);
    const dateFiled = textOrNull(result.dateFiled, 10);
    const cause = textOrNull(result.cause, 200);
    const suitNature = textOrNull(result.suitNature, 200);
    const parties = Array.isArray(result.party)
      ? result.party.map((p) => textOrNull(p, 120)).filter(Boolean)
      : [];
    const attorneys = Array.isArray(result.attorney)
      ? result.attorney.map((a) => textOrNull(a, 120)).filter(Boolean)
      : [];
    const state = stateFromCourtId(courtId);

    // Court dockets have no property address. Use the case name as a
    // human-readable label so the validation contract is satisfied without
    // fabricating a street address.
    const address = caseName || `Court docket ${docketNumber || docketId}`;
    if (address.length < 8) return null;
    if (address.length > 500) return null;

    const sourceUrl = this.docketWebUrl(docketId, result.docket_absolute_url);
    const listingId = `courtlistener-${docketId}`;
    const pacerCaseId = textOrNull(result.pacer_case_id, 40);

    const rawPayload = {
      docket_id: docketId,
      docketNumber,
      court_id: courtId,
      court: courtName,
      dateFiled,
      caseName,
      cause,
      suitNature,
      party: parties,
      attorney: attorneys,
      pacer_case_id: pacerCaseId,
      assignedTo: textOrNull(result.assignedTo, 120),
      dateTerminated: textOrNull(result.dateTerminated, 10),
      jurisdictionType: textOrNull(result.jurisdictionType, 80),
      docket_absolute_url: result.docket_absolute_url || null
    };

    const preNormalized = {
      id: listingId,
      source: SOURCE_KEY,
      state: state || 'US',
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
      propType: 'Unknown',
      openingBid: null,
      price: null,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate: null,
      sourceUrl,
      raw: truncateRaw(rawPayload),
      occupancy: 'Unknown',
      provenance: {
        origin: 'live',
        observed: true,
        publisher: PUBLISHER,
        recordId: listingId,
        sourceFacts: {
          apiRoot: this.apiRoot,
          searchUrl: queryUrl,
          docketUrl: sourceUrl,
          docketId,
          docketNumber,
          courtId,
          courtName,
          dateFiled,
          dateTerminated: textOrNull(result.dateTerminated, 10),
          caseName,
          cause,
          suitNature,
          parties,
          attorneys,
          assignedTo: textOrNull(result.assignedTo, 120),
          jurisdictionType: textOrNull(result.jurisdictionType, 80),
          pacerCaseId,
          evidenceClass: 'publisher_reported',
          enrichmentSource: true,
          caveat: 'A court docket is not a property sale. No bid, sale date, or occupancy can be inferred from a filing alone.',
          documents: buildDocumentReferences([
            sourceUrl && { kind: 'docket', url: sourceUrl, label: docketNumber ? `CourtListener docket ${docketNumber}` : `CourtListener docket ${docketId}` }
          ], { observedAt })
        }
      },
      sourceObservedAt: observedAt
    };

    // Court dockets often lack a state code; skip standardization when the
    // state is unknown so we don't emit an invalid 2-letter code.
    const listing = state ? this.standardizeListing(preNormalized) : { ...preNormalized };
    // The shared normalizer strips 'Unknown' as a placeholder; restore these
    // because court dockets genuinely have no property classification or
    // occupancy data.
    listing.propType = 'Unknown';
    listing.occupancy = 'Unknown';
    this.rawPublisherRecords.set(listing, rawPayload);
    return listing;
  }

  async scrapeFeed() {
    return this.executeWithRetry(async () => {
      const observedAt = new Date().toISOString();
      const collected = [];
      const failures = [];
      let cursor = null;
      let pagesFetched = 0;
      let publisherResults = 0;
      let rejectedResults = 0;

      while (collected.length < this.maxRecords) {
        let page;
        try {
          page = await this.fetchSearchPage({ cursor });
        } catch (error) {
          if (error.haltScraper === true || pagesFetched === 0) throw error;
          failures.push({ cursor, error: error.message, code: error.code || null });
          break;
        }
        pagesFetched += 1;
        const results = page.payload.results;
        publisherResults += results.length;

        if (results.length === 0) break;

        for (const result of results) {
          if (collected.length >= this.maxRecords) break;
          const listing = this.mapDocket(result, { queryUrl: page.queryUrl, observedAt });
          if (listing) collected.push(listing);
          else rejectedResults += 1;
        }

        // CourtListener uses cursor-based pagination via the `next` URL.
        const nextUrl = page.payload.next;
        if (!nextUrl || collected.length >= this.maxRecords) break;
        try {
          const nextParsed = new URL(nextUrl);
          cursor = nextParsed.searchParams.get('cursor');
        } catch (_) {
          break;
        }
        if (!cursor) break;
      }

      const truncated = collected.length >= this.maxRecords;
      const complete = failures.length === 0 && !truncated;
      this.lastRunReport = {
        outcome: failures.length
          ? (collected.length ? 'partial_failure' : 'failed')
          : (collected.length ? 'success' : 'empty'),
        scope: this.getCollectionScope(),
        pagesFetched,
        publisherResults,
        recordsDiscovered: publisherResults,
        recordsEmitted: collected.length,
        recordsRejected: rejectedResults,
        truncated,
        complete,
        fullSweepComplete: complete,
        fixtureFallbackUsed: false,
        failures,
        sweepStartedAt: observedAt,
        nextContinuationToken: truncated ? cursor : null
      };

      console.log(
        `[${this.name}] Collected ${collected.length} CourtListener dockets ` +
        `(${pagesFetched} page(s), ${publisherResults} publisher results, ${rejectedResults} rejected)`
      );
      return collected;
    });
  }
}

module.exports = new CourtListenerScraper();
module.exports.CourtListenerScraper = CourtListenerScraper;
module.exports.SOURCE_KEY = SOURCE_KEY;
module.exports.API_ROOT = API_ROOT;
module.exports.DOCKET_URL_ROOT = DOCKET_URL_ROOT;
module.exports.DEFAULT_SEARCH_QUERY = DEFAULT_SEARCH_QUERY;
module.exports.DEFAULT_MAX_RECORDS = DEFAULT_MAX_RECORDS;
module.exports.MIN_REQUEST_INTERVAL_MS = MIN_REQUEST_INTERVAL_MS;
module.exports.stateFromCourtId = stateFromCourtId;
module.exports.truncateRaw = truncateRaw;
