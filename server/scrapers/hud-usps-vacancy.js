// server/scrapers/hud-usps-vacancy.js
//
// HUD/USPS vacancy enrichment collector.
//
// Sources (publisher-of-record):
//   - HUD User:    https://www.huduser.gov/portal/datasets/usps.html
//   - HUD GIS Open Data (public ArcGIS Hub mirror of the same quarterly
//     USPS Crosswalk Statistics dataset). Operators set the FeatureServer
//     service root via the HUD_USPS_VACANCY_SERVICE_ROOT env var or
//     constructor option. Default is the public HUD GIS Hub ArcGIS Hub open
//     data portal service that mirrors the USPS Crosswalk Statistics.
//
// Role: evidence (enrichment only — never a primary opportunity source).
//
// What the publisher publishes:
//   Quarterly USPS-flagged aggregate vacancy counts at Census-tract context:
//   residential / business / no-stat breakdowns and vacancy-duration bands.
//   The publisher does NOT identify whether a particular property address
//   is vacant — it reports tract-level rollups that can be joined to known
//   parcels for screening.
//
// What this collector emits:
//   One listing per tract/quarter aggregate (the canonical record the
//   publisher publishes is a tract-level rollup). The listing contract is
//   satisfied by using the tract GEOID as the address label and the derived
//   2-letter state code as the state field. No opening bid, sale date,
//   occupancy, or property classification is fabricated; those fields stay
//   null on the canonical record.
//
// Safety:
//   - Default 200 records per run, capped at 5,000.
//   - Circuit breaker on every request (inherited from BaseScraper).
//   - The query layer is bounded: resultRecordCount is always set, and the
//     `where` clause is fixed to `1=1` server-side equivalent; pagination
//     uses resultOffset only.
//   - Never fabricates a bid, sale date, occupancy, or property class.
//   - No fixture fallback. If the live feature service is unreachable the
//     run fails and the circuit breaker trips.
//
const BaseScraper = require('./base');

const SOURCE_KEY = 'hud-usps-vacancy';
const PUBLISHER = 'HUD/USPS';
const DEFAULT_SERVICE_ROOT = 'https://hudgis-hud.opendata.arcgis.com/api/v3/datasets/usps_vacancy_national/FeatureServer/0';
const DEFAULT_MAX_RECORDS = 200;
const MAX_RECORDS_CAP = 5_000;
const MAX_RAW_BYTES = 64 * 1024;
const PAGE_SIZE = 100;

// Census FIPS state code (2-digit, integer) → USPS 2-letter abbreviation.
// 50 states + DC + 5 territories (PR, GU, VI, AS, MP).
const STATE_FIPS_TO_ABBR = Object.freeze({
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR',
  '78': 'VI'
});

class HudUspsVacancyError extends Error {
  constructor(message, code = 'HUD_USPS_VACANCY_UPSTREAM_UNAVAILABLE') {
    super(message);
    this.name = 'HudUspsVacancyError';
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

function truncateRaw(payload, maxBytes = MAX_RAW_BYTES) {
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(text, 'utf8'),
    preview: text.slice(0, Math.floor(maxBytes * 0.8))
  });
}

function stateAbbrFromGeoid(geoid) {
  if (geoid === null || geoid === undefined) return null;
  if (typeof geoid !== 'string' && typeof geoid !== 'number') return null;
  const text = String(geoid).slice(0, 2);
  return STATE_FIPS_TO_ABBR[text] || null;
}

function sanitizeServiceRoot(root) {
  if (!root || typeof root !== 'string') return DEFAULT_SERVICE_ROOT;
  let value = root.trim().replace(/\/+$/, '');
  if (!/\/FeatureServer\/\d+$/i.test(value)) {
    value = `${value}/FeatureServer/0`;
  }
  return value;
}

class HudUspsVacancyScraper extends BaseScraper {
  constructor(options = {}) {
    super({
      ...options,
      name: options.name || 'HudUspsVacancyCollector',
      sourceKey: SOURCE_KEY
    });
    this.serviceRoot = sanitizeServiceRoot(
      options.serviceRoot || process.env.HUD_USPS_VACANCY_SERVICE_ROOT || DEFAULT_SERVICE_ROOT
    );
    this.maxRecords = boundedInt(
      options.maxRecords ?? process.env.HUD_USPS_VACANCY_MAX_RECORDS,
      DEFAULT_MAX_RECORDS,
      MAX_RECORDS_CAP
    );
    this.pageSize = boundedInt(
      options.pageSize ?? process.env.HUD_USPS_VACANCY_PAGE_SIZE,
      PAGE_SIZE,
      MAX_RECORDS_CAP
    );
    this.rawPublisherRecords = new WeakMap();
    this.lastRunReport = null;
  }

  getCollectionScope() {
    return {
      endpoint: '/FeatureServer/0/query',
      serviceRoot: this.serviceRoot,
      filters: { where: '1=1', outFields: '*' },
      pageSize: this.pageSize,
      maxRecords: this.maxRecords
    };
  }

  getRawPublisherRecord(listing) {
    return this.rawPublisherRecords.get(listing) || null;
  }

  buildQueryUrl({ resultOffset = 0 } = {}) {
    const url = new URL(`${this.serviceRoot}/query`);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('f', 'json');
    url.searchParams.set('returnGeometry', 'false');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('resultRecordCount', String(this.pageSize));
    url.searchParams.set('resultOffset', String(resultOffset));
    return url.toString();
  }

  featureWebUrl(objectId) {
    const root = this.serviceRoot.replace(/\/FeatureServer\/\d+$/i, '/FeatureServer/0');
    return `${root}/${objectId}`;
  }

  async fetchQueryPage({ resultOffset = 0 } = {}) {
    const queryUrl = this.buildQueryUrl({ resultOffset });
    const payload = await this.requestJson(queryUrl);
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.features)) {
      throw new HudUspsVacancyError(
        'HUD/USPS vacancy response is missing a features array',
        'HUD_USPS_VACANCY_SCHEMA_UNRECOGNIZED'
      );
    }
    return { queryUrl, payload };
  }

  mapVacancyRecord(feature, { queryUrl, observedAt }) {
    if (!feature || typeof feature !== 'object') return null;
    const attrs = feature.attributes && typeof feature.attributes === 'object' ? feature.attributes : null;
    if (!attrs) return null;

    // The publisher's canonical record identifier for a tract-level aggregate
    // is its GEOID (15-digit state+county+tract+block-group). When a block
    // group is present we keep the full 15-digit value; for tract-only
    // datasets we accept 11-digit values too.
    const geoidRaw = attrs.GEOID ?? attrs.geoid ?? attrs.FIPS ?? attrs.fips ?? null;
    const geoid = geoidRaw === null || geoidRaw === undefined
      ? null
      : String(geoidRaw).padStart(11, '0');
    if (!geoid || !/^\d{11,15}$/.test(geoid)) return null;

    const state = stateAbbrFromGeoid(geoid);
    if (!state) return null;

    const stateFips = geoid.slice(0, 2);
    const countyFips = geoid.slice(2, 5);
    const tractPart = geoid.slice(5, 11);

    // OBJECTID is required to construct the exact record URL that
    // inspectSourceRecordUrl will validate.
    const objectIdRaw = attrs.OBJECTID ?? attrs.objectId ?? attrs.objectid ?? attrs.OBJECT_ID;
    const objectId = Number(objectIdRaw);
    if (!Number.isInteger(objectId) || objectId < 1) return null;

    // Vacancy counts and band breakdowns.
    const quarter = textOrNull(attrs.QUARTER ?? attrs.quarter ?? attrs.QTR ?? attrs.qtr, 12) || 'unknown';
    const residentialVacant = finiteNumber(
      attrs.RES_VACANT ?? attrs.residential_vacant ?? attrs.VACANT_COUNT ?? attrs.vacant_count
    );
    const businessVacant = finiteNumber(
      attrs.BUS_VACANT ?? attrs.business_vacant ?? attrs.BUSINESS_VACANT
    );
    const noStat = finiteNumber(
      attrs.NO_STAT ?? attrs.no_stat ?? attrs.NO_STAT_COUNT
    );
    const totalAddresses = finiteNumber(attrs.TOTAL ?? attrs.total_addresses ?? attrs.TOTAL_ADDR);

    // Spatial centroid (tract-level). The publisher may return coordinates
    // either as separate x/y or as a geometry object.
    let lat = finiteNumber(attrs.LATITUDE ?? attrs.lat ?? attrs.INTPTLAT);
    let lng = finiteNumber(attrs.LONGITUDE ?? attrs.lng ?? attrs.INTPTLON);
    if ((lat === null || lng === null) && feature.geometry && typeof feature.geometry === 'object') {
      const { x, y } = feature.geometry;
      if (lat === null) lat = finiteNumber(y);
      if (lng === null) lng = finiteNumber(x);
    }

    // Construct a usable address label. The publisher does not publish
    // a street address for these aggregates. The tract identifier plus
    // state is enough to satisfy the 8-500 char address constraint
    // without inventing property-level data. Tract codes are kept in
    // their canonical 6-digit form (e.g., "000100" = tract 100.00);
    // county FIPS retains its 3-digit zero-padded form for clarity.
    const tractLabel = tractPart.replace(/^0+/, '') || '0';
    const countyLabel = countyFips.replace(/^0+/, '').padStart(3, '0');
    const address = `Census Tract ${tractLabel} in ${stateFips}-${countyLabel} County, ${state}`;
    if (address.length < 8 || address.length > 500) return null;

    const releaseDate = textOrNull(attrs.RELEASE_DATE ?? attrs.release_date ?? attrs.PERIOD_END, 10);

    const listingId = `hud-usps-vacancy-${geoid}-${quarter.replace(/[^A-Za-z0-9]/g, '')}`;
    const sourceUrl = this.featureWebUrl(objectId);

    const rawPayload = {
      GEOID: geoid,
      stateFips,
      countyFips,
      OBJECTID: objectId,
      QUARTER: quarter,
      residential_vacant: residentialVacant,
      business_vacant: businessVacant,
      no_stat: noStat,
      total_addresses: totalAddresses,
      release_date: releaseDate,
      lat,
      lng
    };

    const preNormalized = {
      id: listingId,
      source: SOURCE_KEY,
      state,
      county: null,
      city: null,
      zip: null,
      address,
      lat,
      lng,
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
          serviceRoot: this.serviceRoot,
          queryUrl,
          featureUrl: sourceUrl,
          objectId,
          geoid,
          stateFips,
          countyFips: `${stateFips}${countyFips}`,
          quarter,
          releaseDate,
          residentialVacant,
          businessVacant,
          noStat,
          totalAddresses,
          evidenceClass: 'aggregate_vacancy',
          enrichmentSource: true,
          caveat: 'Tract-level USPS vacancy aggregate. The publisher does not identify whether any specific property address is vacant. No bid, sale date, occupancy, or property classification is implied.'
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
      let resultOffset = 0;
      let pagesFetched = 0;
      let publisherFeatures = 0;
      let rejectedFeatures = 0;

      while (collected.length < this.maxRecords) {
        let page;
        try {
          page = await this.fetchQueryPage({ resultOffset });
        } catch (error) {
          if (error.haltScraper === true || pagesFetched === 0) throw error;
          failures.push({ resultOffset, error: error.message, code: error.code || null });
          break;
        }
        pagesFetched += 1;
        const features = page.payload.features;
        publisherFeatures += features.length;

        if (features.length === 0) break;

        for (const feature of features) {
          if (collected.length >= this.maxRecords) break;
          const listing = this.mapVacancyRecord(feature, { queryUrl: page.queryUrl, observedAt });
          if (listing) collected.push(listing);
          else rejectedFeatures += 1;
        }

        // ArcGIS exposes `exceededTransferLimit: true` when more pages exist.
        const exceededTransferLimit = Boolean(page.payload.exceededTransferLimit);
        if (!exceededTransferLimit) break;
        if (features.length < this.pageSize) break;
        resultOffset += features.length;
      }

      const truncated = collected.length >= this.maxRecords;
      const complete = failures.length === 0 && !truncated;
      this.lastRunReport = {
        outcome: failures.length
          ? (collected.length ? 'partial_failure' : 'failed')
          : (collected.length ? 'success' : 'empty'),
        scope: this.getCollectionScope(),
        pagesFetched,
        publisherFeatures,
        recordsDiscovered: publisherFeatures,
        recordsEmitted: collected.length,
        recordsRejected: rejectedFeatures,
        exceededTransferLimit: truncated,
        truncated,
        complete,
        fullSweepComplete: complete,
        fixtureFallbackUsed: false,
        failures,
        sweepStartedAt: observedAt,
        nextContinuationToken: truncated ? String(resultOffset) : null
      };

      console.log(
        `[${this.name}] Collected ${collected.length} HUD/USPS vacancy tract aggregates ` +
        `(${pagesFetched} page(s), ${publisherFeatures} publisher features, ${rejectedFeatures} rejected)`
      );
      return collected;
    });
  }
}

module.exports = new HudUspsVacancyScraper();
module.exports.HudUspsVacancyScraper = HudUspsVacancyScraper;
module.exports.SOURCE_KEY = SOURCE_KEY;
module.exports.PUBLISHER = PUBLISHER;
module.exports.DEFAULT_SERVICE_ROOT = DEFAULT_SERVICE_ROOT;
module.exports.DEFAULT_MAX_RECORDS = DEFAULT_MAX_RECORDS;
module.exports.MAX_RECORDS_CAP = MAX_RECORDS_CAP;
module.exports.STATE_FIPS_TO_ABBR = STATE_FIPS_TO_ABBR;
module.exports.HudUspsVacancyError = HudUspsVacancyError;
module.exports.stateAbbrFromGeoid = stateAbbrFromGeoid;
module.exports.sanitizeServiceRoot = sanitizeServiceRoot;
module.exports.truncateRaw = truncateRaw;
