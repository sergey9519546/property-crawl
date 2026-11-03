'use strict';

/**
 * server/scrapers/adapters/gsa-api.js
 *
 * Official GSA Auctions Open-Data REST API integration.
 * Target: api.gsa.gov/assets/gsaauctions/v2/auctions (Data.gov / GSA Open Data).
 *
 * Robots / Legal Non-Negotiable:
 * This REST API client completely bypasses the prohibited HTML route /our-listing
 * on realestatesales.gov (which is disallowed by publisher robots.txt).
 * It reads official machine-readable JSON payloads directly from api.gsa.gov.
 *
 * Invariant:
 * Zero-fabrication underwriting: Never invent or impute estimated values (estLow, estHigh)
 * from current bid or opening bid; missing fields remain null.
 */

const https = require('https');
const http = require('http');

const GSA_API_BASE_URL =
  process.env.GSA_API_URL || 'https://api.gsa.gov/assets/gsaauctions/v2';
const GSA_API_ENDPOINT = '/auctions';
const GSA_DEFAULT_API_KEY = process.env.GSA_API_KEY || 'DEMO_KEY';

const STATE_NAME_TO_CODE = Object.freeze({
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC', 'Puerto Rico': 'PR'
});

/**
 * Maps GSA property / asset category strings to standardized property types.
 *
 * @param {string} rawType - Raw category/type string from GSA API
 * @returns {string} Standardized propType
 */
function mapGsaPropertyType(rawType) {
  const norm = String(rawType || '').toLowerCase();
  if (/condo/i.test(norm)) return 'Condo';
  if (/duplex/i.test(norm)) return 'Duplex';
  if (/triplex/i.test(norm)) return 'Triplex';
  if (/commercial/i.test(norm)) return 'Commercial';
  if (/land|acre|lot|parcel|vacant/i.test(norm)) return 'Land';
  if (/warehouse|industrial/i.test(norm)) return 'Warehouse';
  if (/office/i.test(norm)) return 'Office';
  if (/\b(?:single\s*family|residential|house|home)\b/i.test(norm)) return 'Single Family';
  if (/real\s*property|real\s*estate/i.test(norm)) return 'Commercial';
  return 'Unknown';
}

/**
 * Normalizes numeric money values from GSA API.
 *
 * @param {number|string} val - Currency or numeric string
 * @returns {number|null} Clean numeric float or null
 */
function parseGsaMoney(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const clean = String(val).replace(/[\$,]/g, '').trim();
  const num = parseFloat(clean);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * Parses and formats closing / sale date string into ISO date format.
 *
 * @param {string|number|Date} dateVal - Date value
 * @returns {string|null} ISO date string (YYYY-MM-DD or full ISO) or null
 */
function parseGsaClosingDate(dateVal) {
  if (!dateVal) return null;
  try {
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch (_) {
    // Fallback: regex parse MM/DD/YYYY or YYYY-MM-DD
  }
  const m = String(dateVal).match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (m) {
    if (m[1]) return m[1];
    const [month, day, year] = m[2].split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Extracts and normalizes location fields (city, state, zip, street address)
 * from a GSA auction payload or its description.
 *
 * @param {Object} item - Raw auction item object
 * @returns {Object} { street, city, state, zip }
 */
function parseGsaLocation(item = {}) {
  let city = item.itemCity || item.city || item.item_city || null;
  let rawState = item.itemState || item.state || item.item_state || null;
  let zip = item.itemZip || item.zip || item.item_zip || item.zipcode || null;
  let street = item.itemStreet || item.street || item.street_address || item.address || null;

  // Resolve state code
  let state = null;
  if (rawState) {
    const cleanState = String(rawState).trim();
    if (cleanState.length === 2) {
      state = cleanState.toUpperCase();
    } else if (STATE_NAME_TO_CODE[cleanState]) {
      state = STATE_NAME_TO_CODE[cleanState];
    }
  }

  // If street address or location is missing, attempt to extract from property description
  const desc = item.propertyDescription || item.property_description || item.itemDescription || item.item_description || '';
  if ((!street || !city || !state || !zip) && desc) {
    // e.g. "123 Main St, Laredo, TX 78040"
    const addrMatch = desc.match(
      /\b([0-9]+[A-Za-z0-9\s,\.\-#]+?),\s*([A-Za-z\s]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/
    );
    if (addrMatch) {
      if (!street) street = addrMatch[1].trim();
      if (!city) city = addrMatch[2].trim();
      if (!state) state = addrMatch[3].trim().toUpperCase();
      if (!zip) zip = addrMatch[4].trim();
    }
  }

  // Clean and format zip
  if (zip) {
    const zipMatch = String(zip).match(/\b\d{5}\b/);
    if (zipMatch) zip = zipMatch[0];
  }

  return {
    street: street ? String(street).trim() : null,
    city: city ? String(city).trim() : null,
    state: state || null,
    zip: zip || null,
  };
}

/**
 * Constructs the official GSA Auctions Open-Data REST API request URL.
 * Completely avoids HTML routes like /our-listing.
 *
 * @param {Object} [options] - Query options
 * @returns {string} URL targeting api.gsa.gov/assets/gsaauctions/v2/auctions
 */
function getGsaAuctionsApiUrl(options = {}) {
  const base = (options.baseUrl || GSA_API_BASE_URL).replace(/\/+$/, '');
  const endpoint = options.endpoint || GSA_API_ENDPOINT;
  const apiKey = options.apiKey || GSA_DEFAULT_API_KEY;

  const url = new URL(`${base}${endpoint}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  if (options.status) {
    url.searchParams.set('status', options.status);
  }
  if (options.limit) {
    url.searchParams.set('limit', String(options.limit));
  }
  if (options.page) {
    url.searchParams.set('page', String(options.page));
  }
  return url.toString();
}

/**
 * Standardizes a single raw JSON auction item from the GSA Auctions API
 * into the canonical property-crawl listing shape.
 *
 * Invariant: Never invent or impute estLow / estHigh from bids.
 *
 * @param {Object} rawItem - Single auction item from API
 * @param {Object} [options] - Standardization options
 * @returns {Object} Standardized listing record
 */
function standardizeGsaAuctionItem(rawItem = {}, options = {}) {
  const auctionNumber =
    rawItem.auctionNumber ||
    rawItem.auction_number ||
    rawItem.saleNumber ||
    rawItem.sale_number ||
    rawItem.id ||
    'UNKNOWN';

  const propertyDescription =
    rawItem.propertyDescription ||
    rawItem.property_description ||
    rawItem.itemDescription ||
    rawItem.item_description ||
    rawItem.description ||
    '';

  const propertyType =
    rawItem.propertyType ||
    rawItem.property_type ||
    rawItem.itemCategory ||
    rawItem.item_category ||
    rawItem.category ||
    null;

  const loc = parseGsaLocation(rawItem);
  const state = loc.state || 'US';
  const city = loc.city;
  const zip = loc.zip;
  const address = loc.street || (city && state ? `${city}, ${state} ${zip || ''}`.trim() : propertyDescription.slice(0, 80));

  // Extract square footage if mentioned in description: "3,500 sq ft" or "3500 SF"
  let sqft = null;
  const sqftMatch = propertyDescription.match(/\b([0-9,]+)\s*(?:sq(?:uare)?\.?\s*(?:ft|feet)|sqft|sf)\b/i);
  if (sqftMatch) {
    const val = parseInt(sqftMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(val) && val > 0) sqft = val;
  }

  const currentBid = parseGsaMoney(rawItem.currentBid ?? rawItem.current_bid ?? rawItem.highBid ?? rawItem.high_bid);
  const openingBid = parseGsaMoney(rawItem.openingBid ?? rawItem.opening_bid ?? rawItem.minimumBid ?? rawItem.minimum_bid);
  const closingDate = parseGsaClosingDate(rawItem.closingDate ?? rawItem.closing_date ?? rawItem.endDate ?? rawItem.end_date);

  const cleanAuctionNum = String(auctionNumber).replace(/[^a-zA-Z0-9-_]/g, '');
  const listingId = `GSA-${state}-${cleanAuctionNum}-${zip || '00000'}`.slice(0, 64);

  const auctionUrl =
    rawItem.auctionUrl ||
    rawItem.auction_url ||
    rawItem.itemUrl ||
    rawItem.item_url ||
    null;

  return {
    id: listingId,
    source: 'gsa',
    state,
    county: rawItem.county || null,
    city: city ? city.slice(0, 64) : null,
    zip: zip ? String(zip).slice(0, 10) : null,
    address: address ? address.slice(0, 128) : `${city || 'Unknown'}, ${state} ${zip || ''}`.trim(),
    propType: mapGsaPropertyType(propertyType),
    sqft,
    openingBid: openingBid !== null ? openingBid : null,
    currentBid: currentBid !== null ? currentBid : null,
    price: currentBid ?? openingBid ?? null,
    // Zero-Fabrication Invariant: Never impute valuations or estimates
    estLow: null,
    estHigh: null,
    assessed: null,
    saleDate: closingDate || null,
    closingDate: closingDate || null,
    auctionNumber,
    caseNumber: auctionNumber,
    sourceUrl: auctionUrl,
    raw: `${auctionNumber}. ${propertyDescription}`.trim(),
    provenance: {
      origin: 'live',
      observed: true,
      publisher: 'U.S. General Services Administration (GSA Auctions Open-Data API)',
      recordId: String(auctionNumber),
      observedAt: new Date().toISOString(),
      sourceFacts: {
        program: 'gsa_auctions_open_data_api',
        auctionNumber,
        currentBid,
        openingBid,
        closingDate,
        bidsPlaced: rawItem.bidsPlaced ?? rawItem.bids_placed ?? null,
        reserveMet: rawItem.reserveMet ?? rawItem.reserve_met ?? null,
        propertyType,
        apiEndpoint: 'api.gsa.gov/assets/gsaauctions/v2/auctions',
        robotsCompliant: true,
        forbiddenPathBypassed: '/our-listing',
      },
    },
  };
}

/**
 * Parses full GSA Auctions API JSON response into standardized listings.
 *
 * @param {string|Object} jsonOrObject - API JSON text or parsed object
 * @param {Object} [options] - Parsing configuration
 * @returns {Object} { items: Array<Object>, totalCount: number, emittedCount: number, rejected: Array }
 */
function parseGsaAuctionsApiResponse(jsonOrObject, options = {}) {
  let data = jsonOrObject;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      const error = new Error(`GSA Auctions API response is not valid JSON: ${err.message}`);
      error.code = 'GSA_API_JSON_PARSE_ERROR';
      throw error;
    }
  }

  if (!data || typeof data !== 'object') {
    return { items: [], totalCount: 0, emittedCount: 0, rejected: [] };
  }

  // Handle various response wrappers
  let rawItems = [];
  if (Array.isArray(data)) {
    rawItems = data;
  } else if (Array.isArray(data.auctions)) {
    rawItems = data.auctions;
  } else if (Array.isArray(data.items)) {
    rawItems = data.items;
  } else if (Array.isArray(data.results)) {
    rawItems = data.results;
  } else if (Array.isArray(data.data)) {
    rawItems = data.data;
  }

  const items = [];
  const rejected = [];

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') {
      rejected.push({ item: raw, reason: 'not_an_object' });
      continue;
    }

    // Filter real estate / real property if specified or default
    const cat = String(raw.propertyType || raw.property_type || raw.itemCategory || raw.item_category || raw.category || '').toLowerCase();
    const isRealEstate =
      /real|commercial|land|residential|house|building|property|office|warehouse|facility|acre/i.test(cat) ||
      /real\s*estate|real\s*property|building|parcel|acre/i.test(raw.propertyDescription || raw.itemDescription || '');

    if (options.realEstateOnly !== false && !isRealEstate) {
      // Non-real-estate GSA item (e.g. vehicles, surplus equipment, or unverified category)
      rejected.push({
        auctionNumber: raw.auctionNumber || raw.saleNumber || 'UNKNOWN',
        reason: 'non_real_estate_category',
        category: cat || 'unspecified',
      });
      continue;
    }

    try {
      const standardized = standardizeGsaAuctionItem(raw, options);
      if (standardized && standardized.id && standardized.state) {
        items.push(standardized);
      } else {
        rejected.push({ item: raw, reason: 'missing_id_or_state' });
      }
    } catch (err) {
      rejected.push({ item: raw, error: err.message });
    }
  }

  return {
    items,
    totalCount: rawItems.length,
    emittedCount: items.length,
    rejected,
  };
}

/**
 * GsaApiAdapter: HTTP/HTTPS REST client for the GSA Auctions Open-Data API.
 */
class GsaApiAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey || GSA_DEFAULT_API_KEY;
    this.baseUrl = (options.baseUrl || GSA_API_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl || null;
  }

  /**
   * Fetches and parses active auctions from the GSA REST API.
   *
   * @param {Object} [options] - Query options
   * @returns {Promise<Array<Object>>} Standardized listings
   */
  async fetchAuctions(options = {}) {
    const url = getGsaAuctionsApiUrl({
      baseUrl: this.baseUrl,
      apiKey: options.apiKey || this.apiKey,
      status: options.status,
      limit: options.limit,
      page: options.page,
      ...options,
    });

    let jsonText;
    if (typeof this.fetchImpl === 'function') {
      jsonText = await this.fetchImpl(url, options);
    } else if (typeof globalThis.fetch === 'function') {
      const res = await globalThis.fetch(url, {
        headers: {
          'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`GSA Auctions API request failed with HTTP ${res.status}: ${res.statusText}`);
      }
      jsonText = await res.text();
    } else {
      jsonText = await new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;
        const req = transport.get(
          url,
          {
            headers: {
              'User-Agent': 'property-crawl-bot/1.0',
              Accept: 'application/json',
            },
          },
          (res) => {
            if (res.statusCode >= 400) {
              return reject(new Error(`GSA Auctions API HTTP ${res.statusCode}`));
            }
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve(body));
          }
        );
        req.on('error', reject);
        req.setTimeout(options.timeoutMs || 30000, () => {
          req.destroy(new Error('GSA Auctions API timeout'));
        });
      });
    }

    const parsed = parseGsaAuctionsApiResponse(jsonText, options);
    return parsed.items;
  }
}

module.exports = {
  GSA_API_BASE_URL,
  GSA_API_ENDPOINT,
  GSA_DEFAULT_API_KEY,
  STATE_NAME_TO_CODE,
  mapGsaPropertyType,
  parseGsaMoney,
  parseGsaClosingDate,
  parseGsaLocation,
  getGsaAuctionsApiUrl,
  standardizeGsaAuctionItem,
  parseGsaAuctionsApiResponse,
  GsaApiAdapter,
};
