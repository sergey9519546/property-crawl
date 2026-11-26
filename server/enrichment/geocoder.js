'use strict';

const { loadJsonDiskCache, saveJsonDiskCache, getDurableCache, setDurableCache } = require('./disk-cache');
const { isCoordInStateBounds } = require('../geo/state-bounds');
const { isUsStateOrTerritoryCode } = require('../state-codes');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../.cache/geocoding-cache.json');
const CENSUS_GEOCODER_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const CENSUS_STRUCTURED_GEOCODER_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/address';
const MAX_GEOCODER_RESPONSE_BYTES = 256 * 1024;

const ROUTE_TOKEN_ALIASES = Object.freeze({
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr',
  lane: 'ln', court: 'ct', circle: 'cir', terrace: 'ter', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', trail: 'trl',
});

function normalizeAddressToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeRouteName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:apartment|apt|unit|suite|ste)\b.*$/i, '')
    .replace(/\s+#\s*\S+.*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ROUTE_TOKEN_ALIASES[token] || token)
    .join(' ');
}

/**
 * Normalizes an address string for stable deterministic hashing.
 * Removes extra whitespace, punctuation, and converts to uppercase.
 */
function normalizeAddress(address) {
  if (!address || typeof address !== 'string') return '';
  return address
    .toUpperCase()
    .replace(/[,\.\-\#\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates SHA-256 hash of normalized address for cache indexing.
 */
function hashAddress(address) {
  const norm = normalizeAddress(address);
  return crypto.createHash('sha256').update(norm).digest('hex');
}

/**
 * Loads the disk cache safely.
 */
const resolveDefaultCachePath = () => process.env.PROPERTY_GEOCODER_CACHE_PATH || ((process.env.VERCEL === '1' || process.env.NOW_REGION) ? path.join(require('node:os').tmpdir(), 'property-crawl-cache', 'geocoding-cache.json') : DEFAULT_CACHE_PATH);
function loadCache(cachePath = resolveDefaultCachePath()) {
  return loadJsonDiskCache(cachePath);
}

/**
 * Saves cache entry safely to disk.
 */
function saveCache(cache, cachePath = resolveDefaultCachePath()) {
  saveJsonDiskCache(cache, cachePath);
}

/**
 * Parses US Census Geocoder API response into standardized structure.
 */
function parseCensusResponse(data) {
  if (!data || !data.result || !Array.isArray(data.result.addressMatches) || data.result.addressMatches.length === 0) {
    return null;
  }

  const match = data.result.addressMatches[0];
  const coords = match.coordinates || {};
  const comps = match.addressComponents || {};

  const lng = Number(coords.x);
  const lat = Number(coords.y);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    source: 'US_CENSUS_GEOCODER',
    matchedAddress: match.matchedAddress || '',
    lat,
    lng,
    standardized: {
      street: [comps.preDirection, comps.streetName, comps.suffixType].filter(Boolean).join(' ').trim(),
      city: comps.city || '',
      state: comps.state || '',
      zip: comps.zip || '',
    },
    confidence: 1.0,
    timestamp: new Date().toISOString()
  };
}

/**
 * Standardizes and geocodes an address via US Census Geocoder or cache.
 *
 * @param {string} address - Full address line (e.g. "4600 Silver Hill Rd, Washington, DC 20233")
 * @param {Object} [options]
 * @param {string} [options.cachePath] - Custom cache file path
 * @param {Function} [options.fetchFn] - Custom fetch function for testing
 * @param {boolean} [options.skipCache] - Force live lookup
 * @returns {Promise<Object|null>}
 */
async function geocodeAddress(address, options = {}) {
  const norm = normalizeAddress(address);
  if (!norm) return null;

  const cachePath = options.cachePath || resolveDefaultCachePath();
  const hash = hashAddress(norm);

  // 1. Check local cache, then durable PG cache
  if (!options.skipCache) {
    const cache = loadCache(cachePath);
    if (cache[hash]) {
      return {
        ...cache[hash],
        cached: true,
        hash
      };
    }
    if (!options.cachePath) {
      const durable = await getDurableCache('geocoder', hash, { db: options.db });
      if (durable) {
        return { ...durable, cached: true, hash };
      }
    }
  }

  // 2. Query US Census Bureau Geocoder API
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return null;
  }

  const queryUrl = `${CENSUS_GEOCODER_ENDPOINT}?address=${encodeURIComponent(norm)}&benchmark=Public_AR_Current&format=json`;

  try {
    const res = await fetchFn(queryUrl, {
      signal: options.signal || AbortSignal.timeout(5000),
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PropertyCrawl/2.0 (Foreclosure Discovery Engine)'
      }
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    const result = parseCensusResponse(json);

    if (result) {
      result.hash = hash;
      result.cached = false;

      // Update cache
      if (!options.skipCache) {
        const cache = loadCache(cachePath);
        cache[hash] = result;
        saveCache(cache, cachePath);
        if (!options.cachePath) {
          await setDurableCache('geocoder', hash, result, { db: options.db });
        }
      }
      return result;
    }
  } catch (err) {
    // Network or parse failure fails closed
    return null;
  }

  return null;
}

function parseStructuredExpectedAddress(input, { allowMissingZip = false } = {}) {
  if (!input || typeof input !== 'object') {
    if (typeof input !== 'string') return null;
    const raw = input.trim();
    if (!raw) return null;
    const m = raw.match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2})(?:\s*,?\s*(\d{5})(?:-\d{4})?)?\s*$/);
    if (!m) return null;
    return parseStructuredExpectedAddress(
      { address: m[1].trim(), city: m[2].trim(), state: m[3].trim(), zip: m[4] || '' },
      { allowMissingZip }
    );
  }
  if (input.street && input.streetNumber && input.route && input.state && (input.zip5 || allowMissingZip)) {
    const state = String(input.state || '').trim().toUpperCase();
    const zip5 = String(input.zip5 || input.zip || '').trim().slice(0, 5);
    if (!isUsStateOrTerritoryCode(state)) return null;
    if (!allowMissingZip && !/^\d{5}$/.test(zip5)) return null;
    return {
      street: String(input.street).trim(),
      city: String(input.city || '').trim(),
      state,
      zip5,
      query: input.query || [input.street, input.city, `${state}${zip5 ? ` ${zip5}` : ''}`].filter(Boolean).join(', '),
      streetNumber: normalizeAddressToken(input.streetNumber),
      route: normalizeRouteName(input.route),
    };
  }
  const fullAddress = String(input.address || input.street || '').replace(/\s+/g, ' ').trim().slice(0, 256);
  const rawStreetPart = fullAddress ? fullAddress.split(',')[0].trim() : '';
  const street = rawStreetPart
    ? rawStreetPart.replace(/^(?:lot|parcel)\s+[A-Za-z0-9-]+\s*[:,-]\s*(?=\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+[A-Za-z])/i, '').trim()
    : '';
  let city = String(input.city || '').replace(/\s+/g, ' ').trim().slice(0, 128);
  const state = String(input.state || '').trim().toUpperCase().slice(0, 2);
  let zip = String(input.zip || '').trim().slice(0, 10);
  if ((!city || !zip) && fullAddress) {
    const trailingMatch = fullAddress.match(/^.+?,\s*([A-Za-z][A-Za-z .'-]{1,40}?)(?:,\s*|\s+)(?:[A-Za-z]{2,}\s+)?(\d{5})(?:-\d{4})?\s*$/);
    if (trailingMatch) {
      const candCity = trailingMatch[1].trim();
      if (!city && !/^[A-Za-z]{2}$/.test(candCity) && !/\d/.test(candCity) && !/^(?:unit|apt|ste|suite|lot|bldg|fl|floor|rm|room)\b/i.test(candCity)) {
        city = candCity.slice(0, 128);
      }
      if (!zip) zip = trailingMatch[2].slice(0, 10);
    }
  }
  if (!street || !city || !state || !isUsStateOrTerritoryCode(state)) return null;
  if (!allowMissingZip && !/^\d{5}(?:-\d{4})?$/.test(zip)) return null;
  if (/^(?:p\.?\s*o\.?\s*box|lot\b|parcel\b|vacant\b)/i.test(street)) return null;
  const streetMatch = street.match(/^\s*(\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?)\s+(.{2,})$/);
  if (!streetMatch) return null;
  const streetNumber = normalizeAddressToken(streetMatch[1]);
  const route = normalizeRouteName(streetMatch[2]);
  if (!streetNumber || !route) return null;
  const zip5 = /^\d{5}/.test(zip) ? zip.slice(0, 5) : '';
  return {
    street,
    city,
    state,
    zip5,
    query: `${street}, ${city}, ${state}${zip5 ? ` ${zip}` : ''}`,
    streetNumber,
    route,
  };
}

function exactCensusGeocode(match, expected) {
  if (!match || typeof match !== 'object' || !expected || typeof expected !== 'object') return null;
  const matchedAddress = String(match.matchedAddress || '').trim().slice(0, 256);
  const numberMatch = matchedAddress.match(/^\s*(\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?)\b/);
  if (!numberMatch) return null;
  const returnedStreetNumber = normalizeAddressToken(numberMatch[1]);
  const comps = match.addressComponents && typeof match.addressComponents === 'object' ? match.addressComponents : {};
  const componentStreet = [comps.preDirection, comps.streetName, comps.suffixType, comps.postDirection].filter(Boolean).join(' ');
  const matchedStreet = matchedAddress.split(',')[0].replace(/^\s*\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+/, '');
  const returnedRoutes = [componentStreet, matchedStreet].map(normalizeRouteName).filter(Boolean);
  const returnedState = String(comps.state || '').trim().toUpperCase();
  const returnedZip5 = String(comps.zip || '').trim().slice(0, 5);

  const expStreetNumber = normalizeAddressToken(expected.streetNumber);
  const expRoute = normalizeRouteName(expected.route);
  const expState = String(expected.state || '').trim().toUpperCase();
  const expZip5 = String(expected.zip5 || expected.zip || '').trim().slice(0, 5);

  if (!expStreetNumber || !expRoute || !expState) return null;
  if (returnedStreetNumber !== expStreetNumber || !returnedRoutes.includes(expRoute) || returnedState !== expState) {
    return null;
  }
  if (expZip5 && returnedZip5 !== expZip5) {
    return null;
  }

  const lat = match?.coordinates?.y == null || match?.coordinates?.y === '' ? NaN : Number(match.coordinates.y);
  const lng = match?.coordinates?.x == null || match?.coordinates?.x === '' ? NaN : Number(match.coordinates.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
    return null;
  }
  if (!isCoordInStateBounds(lat, lng, returnedState || expState).ok) {
    return null;
  }
  return {
    lat,
    lng,
    matchedAddress,
    precision: 'street_interpolated',
  };
}

async function readBoundedCensusJson(res, maxBytes = MAX_GEOCODER_RESPONSE_BYTES) {
  const declared = Number(res.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Geocoder response exceeded byte limit');
  }
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error('Geocoder response exceeded byte limit');
        }
        chunks.push(Buffer.from(value));
      }
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  if (typeof res.text === 'function') {
    const rawText = await res.text();
    if (Buffer.byteLength(rawText, 'utf8') > maxBytes) {
      throw new Error('Geocoder response exceeded byte limit');
    }
    return JSON.parse(rawText);
  }
  return res.json();
}

async function geocodeExactAddress(observedAddress, options = {}) {
  const expected = parseStructuredExpectedAddress(observedAddress, {
    allowMissingZip: Boolean(options.allowMissingZip),
  });
  if (!expected) return null;

  const cachePath = options.cachePath || resolveDefaultCachePath();
  const normKey = normalizeAddress(expected.query);
  if (!normKey) return null;
  const hash = hashAddress(normKey);

  const customFetch = options.fetchImpl || options.fetchFn;
  const inTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
  const shouldUseCache = options.skipCache === true
    ? false
    : Boolean(options.cachePath || options.useCache === true || (!inTestEnv && (!customFetch || customFetch === globalThis.fetch)));

  if (shouldUseCache) {
    const cache = loadCache(cachePath);
    const cached = cache[hash] || (!options.cachePath ? await getDurableCache('geocoder_exact', hash, { db: options.db }) : null);
    if (cached
        && cached.precision === 'street_interpolated'
        && Number.isFinite(Number(cached.lat))
        && Number.isFinite(Number(cached.lng))
        && isCoordInStateBounds(Number(cached.lat), Number(cached.lng), expected.state).ok) {
      return {
        ...cached,
        lat: Number(cached.lat),
        lng: Number(cached.lng),
        precision: 'street_interpolated',
        cached: true,
        hash,
      };
    }
  }

  const fetchFn = customFetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;

  const url = new URL(CENSUS_STRUCTURED_GEOCODER_ENDPOINT);
  const searchParams = {
    street: expected.street,
    city: expected.city,
    state: expected.state,
    benchmark: 'Public_AR_Current',
    format: 'json',
  };
  if (expected.zip5) searchParams.zip = expected.zip5;
  url.search = new URLSearchParams(searchParams).toString();

  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 5000);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  let clearParentAbort = null;
  if (controller) {
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else {
        const onAbort = () => controller.abort();
        options.signal.addEventListener('abort', onAbort, { once: true });
        clearParentAbort = () => options.signal.removeEventListener('abort', onAbort);
      }
    }
    timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller ? controller.signal : options.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PropertyCrawl/2.0 (Foreclosure Discovery Engine)',
      },
    });
    if (!res || !res.ok) return null;
    const json = await readBoundedCensusJson(res);
    const matches = Array.isArray(json?.result?.addressMatches) ? json.result.addressMatches : [];
    const verified = matches.map((m) => exactCensusGeocode(m, expected)).filter(Boolean);
    if (verified.length !== 1) return null;

    const record = {
      source: 'US_CENSUS_GEOCODER',
      matchedAddress: verified[0].matchedAddress,
      lat: verified[0].lat,
      lng: verified[0].lng,
      precision: 'street_interpolated',
      timestamp: new Date().toISOString(),
    };
    if (shouldUseCache) {
      const cache = loadCache(cachePath);
      cache[hash] = record;
      saveCache(cache, cachePath);
      if (!options.cachePath) {
        await setDurableCache('geocoder_exact', hash, record, { db: options.db });
      }
    }
    return {
      ...record,
      cached: false,
      hash,
    };
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    if (clearParentAbort) clearParentAbort();
  }
}

const CENSUS_BATCH_GEOCODER_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function csvEscape(value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Batch-geocodes structured addresses via US Census Bureau's free
 * /geocoder/locations/addressbatch endpoint (chunked <= 400 rows per POST).
 * Every match is verified against street number, state, and state bounds and
 * honestly stamped precision: 'street_interpolated'.
 */
async function geocodeExactAddressBatch(items = [], options = {}) {
  const results = new Map();
  if (!Array.isArray(items) || items.length === 0) return results;

  const chunkSize = Math.max(1, Math.min(400, Number(options.chunkSize) || 400));
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(options.timeoutMs) || 30_000));
  const fetchFn = options.fetchFn || globalThis.fetch;
  const cachePath = options.cachePath || resolveDefaultCachePath();
  const shouldUseCache = !options.skipCache && (Boolean(options.cachePath) || (!options.fetchFn && process.env.NODE_ENV !== 'test'));
  const cache = shouldUseCache ? loadCache(cachePath) : {};
  const cacheDb = options.db !== undefined ? options.db : (!options.fetchFn && !options.skipCache && process.env.NODE_ENV !== 'test' ? require('../db/client') : null);
  const useDurableDb = Boolean(cacheDb?.isPg && cacheDb?.pool?.query && !options.skipCache);
  const { getDurableCache, setDurableCache } = useDurableDb ? require('./durable-cache') : { getDurableCache: null, setDurableCache: null };
  let cacheDirty = false;

  const uncached = [];
  for (const item of items) {
    if (!item || !item.id || !item.expected) continue;
    const expected = item.expected;
    const normKey = `${expected.street}, ${expected.city || ''}, ${expected.state} ${expected.zip5}`;
    const hash = hashAddress(normKey);
    if (shouldUseCache && cache[hash] && Number.isFinite(cache[hash].lat) && Number.isFinite(cache[hash].lng)) {
      if (isCoordInStateBounds(cache[hash].lat, cache[hash].lng, expected.state).ok) {
        results.set(item.id, { ...cache[hash], cached: true, hash });
        continue;
      }
    }
    if (useDurableDb) {
      try {
        const dbCached = await getDurableCache('geocode_exact', hash, { db: cacheDb });
        if (dbCached && Number.isFinite(dbCached.lat) && Number.isFinite(dbCached.lng) && isCoordInStateBounds(dbCached.lat, dbCached.lng, expected.state).ok) {
          results.set(item.id, { ...dbCached, cached: true, hash });
          continue;
        }
      } catch {}
    }
    uncached.push({ id: String(item.id), expected, hash });
  }

  if (!uncached.length || typeof fetchFn !== 'function') return results;

  const expectedById = new Map(uncached.map((entry) => [entry.id, entry]));

  for (let start = 0; start < uncached.length; start += chunkSize) {
    const chunk = uncached.slice(start, start + chunkSize);
    const csvRows = chunk.map(({ id, expected }) => [
      csvEscape(id),
      csvEscape(expected.street),
      csvEscape(expected.city || ''),
      csvEscape(expected.state),
      csvEscape(expected.zip5),
    ].join(','));
    const csvBody = `${csvRows.join('\n')}\n`;

    const form = new FormData();
    form.append('addressFile', new Blob([csvBody], { type: 'text/csv' }), 'addresses.csv');
    form.append('benchmark', 'Public_AR_Current');

    try {
      const res = await fetchFn(CENSUS_BATCH_GEOCODER_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        body: form,
        signal: options.signal || AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': 'PropertyCrawl/2.0 (Foreclosure Discovery Engine)',
        },
      });
      if (!res || !res.ok) continue;
      const text = await res.text();
      for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine.trim()) continue;
        const cols = parseCsvLine(rawLine);
        const rowId = (cols[0] || '').trim();
        const matchIndicator = (cols[2] || '').trim();
        const matchType = (cols[3] || '').trim();
        const matchedAddress = (cols[4] || '').trim();
        const coordPair = (cols[5] || '').trim();
        if (matchIndicator !== 'Match' || matchType !== 'Exact' || !coordPair.includes(',')) continue;
        const entry = expectedById.get(rowId);
        if (!entry) continue;
        const [lngRaw, latRaw] = coordPair.split(',');
        const lng = Number(lngRaw);
        const lat = Number(latRaw);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
        if (!isCoordInStateBounds(lat, lng, entry.expected.state).ok) continue;

        // Verify street number matches expected street number
        const matchedFirstToken = normalizeAddressToken(matchedAddress.split(/\s+/)[0]);
        if (entry.expected.streetNumber && matchedFirstToken !== normalizeAddressToken(entry.expected.streetNumber)) {
          continue;
        }

        const record = {
          source: 'US_CENSUS_GEOCODER',
          matchedAddress,
          lat,
          lng,
          precision: 'street_interpolated',
          timestamp: new Date().toISOString(),
        };
        results.set(rowId, { ...record, cached: false, hash: entry.hash });
        if (shouldUseCache) {
          cache[entry.hash] = record;
          cacheDirty = true;
        }
        if (useDurableDb) {
          await setDurableCache('geocode_exact', entry.hash, record, { db: cacheDb, ttlMs: 90 * 24 * 3600 * 1000 }).catch(() => {});
        }
      }
    } catch (_) {
      // Continue with next chunk if a single batch POST times out.
    }
  }

  if (shouldUseCache && cacheDirty) {
    saveCache(cache, cachePath);
  }
  return results;
}

module.exports = {
  normalizeAddress,
  normalizeAddressToken,
  normalizeRouteName,
  hashAddress,
  parseCensusResponse,
  parseStructuredExpectedAddress,
  exactCensusGeocode,
  geocodeAddress,
  geocodeExactAddress,
  geocodeExactAddressBatch,
  loadCache,
  saveCache,
  DEFAULT_CACHE_PATH,
  CENSUS_GEOCODER_ENDPOINT,
  CENSUS_STRUCTURED_GEOCODER_ENDPOINT,
  CENSUS_BATCH_GEOCODER_ENDPOINT,
};
