'use strict';

/**
 * Government land-sale enrollment template collector.
 *
 * There is no universal U.S. federal/state land-sale feed. This adapter is
 * scheduled so the "government land" end is always present in Source Radar.
 * It never invents inventory. Live collection runs only when an operator
 * enrolls an official HTTPS discovery URL via GOV_LAND_DISCOVERY_URL after
 * validating the issuer, legal description format, and sale terms.
 */

const BaseScraper = require('./base');
const {
  createRunReport,
  finalizeRunReport,
} = require('./run-report');
const {
  extractWithScrapling,
  isScraplingEnabled,
  isPrivateOrLocalHost,
} = require('./scrapling-bridge');
const { normalizePostalAddress } = require('./embedded-extractor');
const { isUsStateOrTerritoryCode } = require('../state-codes');

const STATE_NAME_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR',
};

const INLINE_ID_KEYS = [
  'id', 'propertyId', 'listingId', 'parcelId', 'parcelNumber', 'parcel',
  'apn', 'caseNumber', 'caseId', 'lot', 'lotNumber', 'mlsNumber', 'aid', 'recordId',
];
const INLINE_ADDRESS_KEYS = [
  'address', 'streetAddress', 'street', 'propAddress', 'situs', 'location', 'propertyAddress',
];

function validateEnrollmentUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return { ok: false, reason: 'not-configured' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'https-required' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'credentials-rejected' };
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || isPrivateOrLocalHost(parsed.hostname)
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.localhost')
  ) {
    return { ok: false, reason: 'loopback-rejected' };
  }
  return { ok: true, url: parsed.toString() };
}

function cleanNonEmpty(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function parsePositiveMoney(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  const text = String(value).trim();
  if (!text) return null;
  const m = text.match(/\$\s*([0-9][0-9,]*(?:\.\d+)?)/) || text.match(/^(-?[0-9][0-9,]*(?:\.\d+)?)$/);
  if (!m) return null;
  const num = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

function normalizeSaleDateValue(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || /^(?:tbd|n\/a|none|unknown|-+)$/i.test(text)) return null;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const slash = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const mm = slash[1].padStart(2, '0');
    const dd = slash[2].padStart(2, '0');
    const yyyy = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

function normalizeStateCode(rawState) {
  const cleaned = cleanNonEmpty(rawState);
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  if (isUsStateOrTerritoryCode(upper)) return upper;
  return STATE_NAME_TO_CODE[cleaned.toLowerCase()] || null;
}

function resolveStateAndZip(rawState, rawZip, addressText = '') {
  let state = normalizeStateCode(rawState);
  if (!state && addressText) {
    const stateZipMatch = addressText.match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/i)
      || addressText.match(/,\s*([A-Z]{2})\b/i);
    if (stateZipMatch) {
      const candidate = stateZipMatch[1].toUpperCase();
      if (isUsStateOrTerritoryCode(candidate)) state = candidate;
    }
  }
  const zipSource = cleanNonEmpty(rawZip) || addressText || '';
  const zipMatch = zipSource.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : null;
  return { state, zip };
}

function composeAddress(baseAddr, city, state, zip) {
  if (!baseAddr) return null;
  const hasStateInAddr = state
    ? new RegExp(`(?:,|\\b)${state}\\b`, 'i').test(baseAddr)
    : false;
  if (hasStateInAddr) return baseAddr;
  const parts = [baseAddr];
  if (city && !new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(baseAddr)) {
    parts.push(city);
  }
  const tail = [state, zip && !baseAddr.includes(zip) ? zip : null].filter(Boolean).join(' ');
  if (tail) parts.push(tail);
  return parts.join(', ');
}

function resolveEnrolledUrl(candidate, fallbackUrl) {
  const text = cleanNonEmpty(candidate);
  if (!text) return fallbackUrl;
  try {
    const resolved = new URL(text, fallbackUrl).toString();
    return validateEnrollmentUrl(resolved).ok ? resolved : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

function buildPrefixedId(sourceKey, rawId) {
  const cleanId = String(rawId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  if (!cleanId) return null;
  const prefix = `${sourceKey.toUpperCase()}-`;
  return cleanId.toUpperCase().startsWith(prefix) ? cleanId : `${prefix}${cleanId}`;
}

function extractInlinePropertyListings(scraper, inlineProperties, { sourceKey, sourceUrl, publisher }) {
  if (!Array.isArray(inlineProperties) || inlineProperties.length === 0) return [];
  const listings = [];
  for (const item of inlineProperties) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const idKey = INLINE_ID_KEYS.find((k) => cleanNonEmpty(item[k]) !== null);
    const addrKey = INLINE_ADDRESS_KEYS.find((k) => {
      const val = item[k];
      return val && typeof val === 'object'
        ? Boolean(normalizePostalAddress(val))
        : cleanNonEmpty(val) !== null;
    });
    if (!idKey || !addrKey) continue;

    const rawId = cleanNonEmpty(item[idKey]);
    const id = buildPrefixedId(sourceKey, rawId);
    if (!id) continue;

    const baseAddr = normalizePostalAddress(item[addrKey]);
    const addrObj = item.address && typeof item.address === 'object' ? item.address : null;
    const city = cleanNonEmpty(item.city ?? item.addressLocality ?? addrObj?.addressLocality);
    const county = cleanNonEmpty(item.county);
    const rawState = item.state ?? item.addressRegion ?? addrObj?.addressRegion;
    const rawZip = item.zip ?? item.postalCode ?? addrObj?.postalCode;
    const { state, zip } = resolveStateAndZip(rawState, rawZip, baseAddr || '');
    const fullAddress = composeAddress(baseAddr, city, state, zip);
    if (!fullAddress) continue;

    const openingBid = parsePositiveMoney(
      item.openingBid ?? item.minimumBid ?? item.minBid ?? item.startingBid ?? item.listPrice ?? item.price ?? item.bid
    );
    const saleDate = normalizeSaleDateValue(
      item.saleDate ?? item.auctionDate ?? item.bidDeadline ?? item.closingDate ?? item.date
    );
    const resolvedUrl = resolveEnrolledUrl(item.sourceUrl ?? item.detailUrl ?? item.url ?? item.link, sourceUrl);
    const normalizedInput = {
      ...item,
      address: fullAddress,
      city,
      county,
      price: openingBid,
      name: rawId,
      saleDate,
      url: resolvedUrl,
      image: cleanNonEmpty(item.photo ?? item.image ?? item.imageUrl),
    };
    const [parsed] = scraper.parseJsonLdProperties([normalizedInput], {
      sourceKey,
      sourceUrl,
      publisher,
      state: state || 'US',
    });
    if (!parsed) continue;

    const apn = cleanNonEmpty(item.apn ?? item.parcelId ?? item.parcelNumber ?? item.parcel);
    listings.push({
      ...parsed,
      id,
      state: state || parsed.state,
      county: county || parsed.county,
      city: city || parsed.city,
      zip: zip || parsed.zip,
      address: fullAddress,
      apn,
      propType: cleanNonEmpty(item.propType ?? item.propertyType) || null,
      openingBid,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate,
      sourceUrl: resolvedUrl,
      raw: JSON.stringify(item).slice(0, 1000),
      provenance: {
        ...parsed.provenance,
        recordId: String(rawId),
        embeddedFormat: 'inline-state',
      },
    });
  }
  return listings;
}

function detectTableColumnIndices(headers) {
  const idx = {
    id: -1,
    address: -1,
    city: -1,
    state: -1,
    zip: -1,
    county: -1,
    bid: -1,
    saleDate: -1,
    propType: -1,
    url: -1,
  };
  let addressScore = -1;
  let idScore = -1;

  headers.forEach((rawHeader, i) => {
    const h = String(rawHeader || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!h) return;

    if (idx.saleDate < 0 && /\b(?:sale\s*date|auction\s*date|saledate|close\s*date|closing\s*date|bid\s*date|deadline|date)\b/.test(h)) {
      idx.saleDate = i;
      return;
    }
    if (idx.bid < 0 && !/\b(?:date|deadline|bidder|count|status)\b/.test(h)
      && /\b(?:opening\s*bid|minimum\s*bid|min\.?\s*bid|starting\s*bid|reserve|upset|bid|price|minimum|opening)\b/.test(h)) {
      idx.bid = i;
      return;
    }
    if (idx.zip < 0 && /\b(?:zip|zip\s*code|postal|postal\s*code)\b/.test(h)) {
      idx.zip = i;
      return;
    }
    if (idx.state < 0 && !/\b(?:estate|status)\b/.test(h)
      && (/^(?:st|state|state\s*code)$/.test(h) || /\b(?:state|province|region)\b/.test(h))) {
      idx.state = i;
      return;
    }
    if (idx.city < 0 && /\b(?:city|municipality|town|locality)\b/.test(h)) {
      idx.city = i;
      return;
    }
    if (idx.county < 0 && /\b(?:county|parish|borough)\b/.test(h)) {
      idx.county = i;
      return;
    }
    if (/\b(?:property\s*address|street\s*address|address|street|situs|location)\b/.test(h)) {
      const score = /\b(?:address|street|situs)\b/.test(h) ? 2 : 1;
      if (score > addressScore) {
        addressScore = score;
        idx.address = i;
      }
      return;
    }
    if (!/\b(?:size|area|sqft|acre)\b/.test(h)
      && /\b(?:parcel\s*(?:id|no|num|number|#)?|case\s*(?:id|no|num|number|#)?|lot\s*(?:id|no|num|number|#)?|listing\s*(?:id|no|num|number|#)?|property\s*(?:id|no|num|number|#)?|apn|pin|tract|docket|rfp|id)\b/.test(h)) {
      const score = /\b(?:id|parcel|case|apn)\b/.test(h) ? 2 : 1;
      if (score > idScore) {
        idScore = score;
        idx.id = i;
      }
      return;
    }
    if (idx.propType < 0 && /\b(?:property\s*type|prop\s*type|asset\s*type|type|category)\b/.test(h)) {
      idx.propType = i;
      return;
    }
    if (idx.url < 0 && /\b(?:url|link|detail|href)\b/.test(h)) {
      idx.url = i;
    }
  });

  return idx;
}

function mapTableExtractRows(extracted, { sourceKey, sourceUrl, publisher }) {
  if (!extracted || !Array.isArray(extracted.rows) || extracted.rows.length === 0) return [];
  let headers = Array.isArray(extracted.headers)
    ? extracted.headers.map((h) => String(h || '').trim())
    : [];
  let rows = extracted.rows;

  if (headers.length === 0 && Array.isArray(rows[0])) {
    const firstRowText = rows[0].join(' ');
    if (/\b(?:address|location|street|parcel|case|lot|id|bid|price|state|date)\b/i.test(firstRowText)) {
      headers = rows[0].map((c) => String(c || '').trim());
      rows = rows.slice(1);
    }
  }
  if (headers.length === 0) return [];

  const idx = detectTableColumnIndices(headers);
  if (idx.address < 0 || idx.id < 0) return [];

  const listings = [];
  const idHeader = headers[idx.id] || '';
  for (const cells of rows) {
    if (!Array.isArray(cells)) continue;
    const rawId = cleanNonEmpty(cells[idx.id]);
    const rawAddr = cleanNonEmpty(cells[idx.address]);
    if (!rawId || !rawAddr) continue;

    const id = buildPrefixedId(sourceKey, rawId);
    if (!id) continue;

    const city = idx.city >= 0 ? cleanNonEmpty(cells[idx.city]) : null;
    const stateCell = idx.state >= 0 ? cleanNonEmpty(cells[idx.state]) : null;
    const zipCell = idx.zip >= 0 ? cleanNonEmpty(cells[idx.zip]) : null;
    const county = idx.county >= 0 ? cleanNonEmpty(cells[idx.county]) : null;
    const { state, zip } = resolveStateAndZip(stateCell, zipCell, rawAddr);
    const address = composeAddress(rawAddr, city, state, zip);
    if (!address) continue;

    const openingBid = idx.bid >= 0 ? parsePositiveMoney(cells[idx.bid]) : null;
    const saleDate = idx.saleDate >= 0 ? normalizeSaleDateValue(cells[idx.saleDate]) : null;
    const propType = idx.propType >= 0 ? cleanNonEmpty(cells[idx.propType]) : null;
    const resolvedUrl = idx.url >= 0 ? resolveEnrolledUrl(cells[idx.url], sourceUrl) : sourceUrl;

    listings.push({
      id,
      source: sourceKey,
      state: state || 'US',
      county,
      city: city || (address.includes(',') ? cleanNonEmpty(address.split(',')[1]) : null),
      zip,
      address,
      lat: null,
      lng: null,
      beds: null,
      baths: null,
      sqft: null,
      year: null,
      propType,
      apn: /\b(?:parcel|apn)\b/i.test(idHeader) ? rawId : null,
      openingBid,
      estLow: null,
      estHigh: null,
      assessed: null,
      saleDate,
      plaintiff: null,
      defendant: null,
      occupancy: null,
      deposit: null,
      photo: null,
      sourceUrl: resolvedUrl,
      raw: cells.map((c) => String(c || '').trim()).filter(Boolean).join(' | ').slice(0, 1000),
      provenance: {
        origin: 'live',
        observed: true,
        publisher,
        recordId: String(rawId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48),
        scraplingProfile: 'table-extract',
      },
    });
  }
  return listings;
}

async function runEnrolledTemplateScrape(scraper, config) {
  const {
    sourceKey,
    end,
    catalogTemplates,
    publisher,
    envVarName,
    notConfiguredMessage,
    observationErrorNotEnrolled,
    parserNotImplementedMessage,
    observationErrorParserMissing,
    errorCodeMessage,
  } = config;

  const report = createRunReport(sourceKey, {
    end,
    enrollmentUrl: scraper.enrollmentUrl || null,
    catalogTemplates,
  });
  report.statesRequested = ['enrollment'];
  report.endpointsTried = 1;
  scraper.lastRunReport = report;

  const validation = validateEnrollmentUrl(scraper.enrollmentUrl);
  if (!validation.ok) {
    report.statesFailed.push('enrollment');
    report.failures.push({
      unit: 'enrollment',
      kind: 'not_enrolled',
      message: validation.reason === 'not-configured'
        ? notConfiguredMessage
        : `Enrollment URL rejected: ${validation.reason}`,
    });
    finalizeRunReport(report, { emitted: 0 });
    report.outcome = 'skipped_not_enrolled';
    report.complete = false;
    report.fullSweepComplete = false;
    report.observationError = observationErrorNotEnrolled || `${end} end is enrollment-only until ${envVarName} is configured`;
    return [];
  }

  try {
    const html = await scraper.requestText(validation.url);
    const embedded = typeof scraper.extractEmbeddedState === 'function'
      ? scraper.extractEmbeddedState(html)
      : null;

    const candidatePool = [];
    if (embedded && Array.isArray(embedded.jsonLd) && embedded.jsonLd.length > 0) {
      candidatePool.push(...scraper.parseJsonLdProperties(embedded.jsonLd, {
        sourceKey,
        sourceUrl: validation.url,
        publisher,
      }));
    }
    if (embedded && Array.isArray(embedded.inlineProperties) && embedded.inlineProperties.length > 0) {
      candidatePool.push(...extractInlinePropertyListings(scraper, embedded.inlineProperties, {
        sourceKey,
        sourceUrl: validation.url,
        publisher,
      }));
    }

    const deduped = [];
    const seenIds = new Set();
    for (const candidate of candidatePool) {
      if (!candidate || !candidate.id || seenIds.has(candidate.id)) continue;
      seenIds.add(candidate.id);
      deduped.push(candidate);
    }

    let valid = deduped.filter((c) => scraper.passesFilter(c)).map((c) => scraper.standardizeListing(c));
    if (valid.length > 0) {
      report.statesSucceeded.push('enrollment');
      finalizeRunReport(report, { emitted: valid.length });
      report.outcome = 'success';
      report.complete = true;
      return valid;
    }

    if (scraper.useScrapling && typeof scraper.extract === 'function') {
      try {
        const extracted = await scraper.extract('table-extract', { html, url: validation.url });
        scraper._lastExtraction = extracted;
        const tableCandidates = mapTableExtractRows(extracted, {
          sourceKey,
          sourceUrl: validation.url,
          publisher,
        });
        valid = tableCandidates.filter((c) => scraper.passesFilter(c)).map((c) => scraper.standardizeListing(c));
        if (valid.length > 0) {
          report.statesSucceeded.push('enrollment');
          finalizeRunReport(report, { emitted: valid.length });
          report.outcome = 'success';
          report.complete = true;
          report.scrapling = {
            enabled: true,
            profile: 'table-extract',
            engine: extracted?.engine || null,
            engineVersion: extracted?.engineVersion || null,
          };
          return valid;
        }
      } catch (err) {
        if (err && err.code === 'LISTING_SCHEMA_INVALID') throw err;
        scraper._lastExtraction = { error: String(err?.message || err), code: err?.code || null };
      }
    }
  } catch (err) {
    if (err && err.code === 'LISTING_SCHEMA_INVALID') throw err;
  }

  // Enrolled but no structured parser matched.
  // Fail closed — never return invented parcels.
  report.statesFailed.push('enrollment');
  report.failures.push({
    unit: 'enrollment',
    kind: 'parser_not_implemented',
    message: parserNotImplementedMessage(validation.url),
  });
  finalizeRunReport(report, { emitted: 0 });
  report.outcome = 'failed';
  report.complete = false;
  report.observationError = observationErrorParserMissing;
  throw new Error(errorCodeMessage);
}

class GovernmentLandScraper extends BaseScraper {
  constructor(options = {}) {
    super({ name: 'GovernmentLandCollector', sourceKey: 'government-land', ...options });
    this.catalogId = 'state-land-auctions';
    this.enrollmentUrl = options.enrollmentUrl
      ?? process.env.GOV_LAND_DISCOVERY_URL
      ?? '';
    this.lastRunReport = null;
    this.useScrapling = options.useScrapling ?? isScraplingEnabled('government-land');
    this.extract = options.extractImpl || extractWithScrapling;
  }

  async scrapeFeed() {
    return this.executeWithRetry(() => runEnrolledTemplateScrape(this, {
      sourceKey: 'government-land',
      end: 'government_land',
      catalogTemplates: ['blm-public-land-sales', 'state-land-auctions'],
      publisher: 'BLM / State Land Office',
      envVarName: 'GOV_LAND_DISCOVERY_URL',
      notConfiguredMessage: 'No GOV_LAND_DISCOVERY_URL enrolled; catalog templates only (BLM / state land offices). Live land-sale inventory requires jurisdiction enrollment.',
      observationErrorNotEnrolled: 'government_land end is enrollment-only until GOV_LAND_DISCOVERY_URL is configured',
      parserNotImplementedMessage: (url) => `Enrollment URL accepted (${url}) but no land-sale parser is bound; import official notices via source intake until an adapter is written.`,
      observationErrorParserMissing: 'government-land parser not implemented for enrolled publisher',
      errorCodeMessage: 'GOV_LAND_PARSER_NOT_IMPLEMENTED: enrollment URL set but no land-sale HTML parser is bound',
    }));
  }
}

module.exports = new GovernmentLandScraper();
module.exports.GovernmentLandScraper = GovernmentLandScraper;
module.exports.validateEnrollmentUrl = validateEnrollmentUrl;
module.exports.extractInlinePropertyListings = extractInlinePropertyListings;
module.exports.mapTableExtractRows = mapTableExtractRows;
module.exports.runEnrolledTemplateScrape = runEnrolledTemplateScrape;
module.exports.SOURCE_KEY = 'government-land';
