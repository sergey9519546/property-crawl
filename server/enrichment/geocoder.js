'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../.cache/geocoding-cache.json');
const CENSUS_GEOCODER_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

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
function loadCache(cachePath = DEFAULT_CACHE_PATH) {
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    // Return empty cache on read error or corrupted json
  }
  return {};
}

/**
 * Saves cache entry safely to disk.
 */
function saveCache(cache, cachePath = DEFAULT_CACHE_PATH) {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal if cache cannot be written
  }
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

  const cachePath = options.cachePath || DEFAULT_CACHE_PATH;
  const hash = hashAddress(norm);

  // 1. Check local cache
  if (!options.skipCache) {
    const cache = loadCache(cachePath);
    if (cache[hash]) {
      return {
        ...cache[hash],
        cached: true,
        hash
      };
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
      }
      return result;
    }
  } catch (err) {
    // Network or parse failure fails closed
    return null;
  }

  return null;
}

module.exports = {
  normalizeAddress,
  hashAddress,
  parseCensusResponse,
  geocodeAddress,
  loadCache,
  saveCache,
  DEFAULT_CACHE_PATH,
  CENSUS_GEOCODER_ENDPOINT
};
