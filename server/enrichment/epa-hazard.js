'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../.cache/epa-hazard-cache.json');
const EPA_FRS_ENDPOINT = 'https://data.epa.gov/efservice/frs_rest_services.get_facilities';

function normalizeCoordinates(lat, lng) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
  if (nLat < 15 || nLat > 72 || nLng < -180 || nLng > -65) return null;
  return {
    lat: Number(nLat.toFixed(5)),
    lng: Number(nLng.toFixed(5))
  };
}

function hashCoords(coords, radiusMiles = 0.25) {
  return crypto.createHash('sha256').update(`${coords.lat},${coords.lng},${radiusMiles}`).digest('hex').slice(0, 32);
}

function loadCache(cachePath = DEFAULT_CACHE_PATH) {
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (err) {
    // Non-fatal
  }
  return {};
}

function saveCache(cache, cachePath = DEFAULT_CACHE_PATH) {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal
  }
}

/**
 * Calculates haversine distance between two coordinates in miles.
 */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Evaluates environmental liability tier based on nearby EPA facilities.
 */
function evaluateEnvironmentalLiability(facilities = []) {
  if (!Array.isArray(facilities) || facilities.length === 0) {
    return {
      liabilityTier: 'minimal',
      score: 100,
      phaseOneRecommended: false,
      summary: 'No EPA registered hazardous waste, Superfund, or industrial release facilities detected within 0.25 miles.',
      criticalFacilities: [],
      moderateFacilities: []
    };
  }

  const critical = [];
  const moderate = [];
  const standard = [];

  for (const fac of facilities) {
    const pgm = (fac.programAcronyms || fac.programs || []).map((p) => String(p).toUpperCase());
    const isSuperfund = pgm.some((p) => p.includes('SEMS') || p.includes('SUPERFUND') || p.includes('CERCLIS'));
    const isBrownfield = pgm.some((p) => p.includes('ACRES') || p.includes('BROWNFIELD'));
    const isRcra = pgm.some((p) => p.includes('RCRA'));
    const isToxicRelease = pgm.some((p) => p.includes('TRIS'));

    const facRecord = {
      registryId: fac.registryId || null,
      name: fac.name || 'Unnamed facility',
      address: fac.address || null,
      distanceMiles: typeof fac.distanceMiles === 'number' ? Number(fac.distanceMiles.toFixed(3)) : null,
      programs: pgm
    };

    if (isSuperfund) {
      critical.push(facRecord);
    } else if (isBrownfield || isRcra || isToxicRelease) {
      moderate.push(facRecord);
    } else {
      standard.push(facRecord);
    }
  }

  if (critical.length > 0) {
    return {
      liabilityTier: 'critical',
      score: 20,
      phaseOneRecommended: true,
      summary: `CRITICAL ENVIRONMENTAL RISK: ${critical.length} Superfund (SEMS/CERCLA) site(s) detected within 0.25 miles. Stringent statutory owner liabilities apply under 42 U.S.C. § 9607. Comprehensive Phase I/II Environmental Site Assessment required.`,
      criticalFacilities: critical,
      moderateFacilities: moderate,
      totalCount: facilities.length
    };
  }

  if (moderate.length >= 2) {
    return {
      liabilityTier: 'high',
      score: 50,
      phaseOneRecommended: true,
      summary: `ELEVATED LIABILITY: ${moderate.length} hazardous waste (RCRA/Brownfield/TRI) facilities identified within 0.25 miles. Standard commercial Phase I ESA recommended prior to cash acquisition.`,
      criticalFacilities: [],
      moderateFacilities: moderate,
      totalCount: facilities.length
    };
  }

  if (moderate.length === 1) {
    return {
      liabilityTier: 'moderate',
      score: 75,
      phaseOneRecommended: false,
      summary: `MODERATE AWARENESS: 1 active environmental reporting facility (${moderate[0].name}) detected within 0.25 miles.`,
      criticalFacilities: [],
      moderateFacilities: moderate,
      totalCount: facilities.length
    };
  }

  return {
    liabilityTier: 'low',
    score: 90,
    phaseOneRecommended: false,
    summary: `${standard.length} minor regulatory facility/permit record(s) within 0.25 miles (e.g. storm water/air quality permits). Low contamination risk.`,
    criticalFacilities: [],
    moderateFacilities: [],
    totalCount: facilities.length
  };
}

/**
 * Queries EPA Facility Registry Service REST API for facilities near coordinates.
 */
async function queryEpaHazards({
  lat,
  lng,
  radiusMiles = 0.25,
  cachePath = DEFAULT_CACHE_PATH,
  fetchFn = globalThis.fetch,
  timeoutMs = 8000,
  now = Date.now()
} = {}) {
  const coords = normalizeCoordinates(lat, lng);
  if (!coords) {
    return {
      status: 'unavailable',
      reason: 'invalid_or_missing_coordinates',
      environmentalLiability: null,
      provenance: 'epa-envirofacts-spatial-query'
    };
  }

  const key = hashCoords(coords, radiusMiles);
  const cache = loadCache(cachePath);
  if (cache[key]?.schemaVersion === 2 && cache[key]) {
    return {
      status: 'success',
      fromCache: true,
      observedAt: cache[key].observedAt,
      coords,
      environmentalLiability: cache[key].environmentalLiability,
      facilities: cache[key].facilities,
      provenance: 'epa-envirofacts-spatial-query'
    };
  }

  if (typeof fetchFn !== 'function') {
    return {
      status: 'unavailable',
      reason: 'fetch_not_available',
      environmentalLiability: null,
      provenance: 'epa-envirofacts-spatial-query'
    };
  }

  // EPA FRS REST Endpoint format
  // Example: https://data.epa.gov/efservice/frs_rest_services.get_facilities/latitude83/39.7392/longitude83/-104.9903/search_radius/0.25/JSON
  const endpoint = `${EPA_FRS_ENDPOINT}/latitude83/${coords.lat}/longitude83/${coords.lng}/search_radius/${radiusMiles}/JSON`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(endpoint, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PropertyCrawl/1.0 (Zero-Cost Federal Hazard GIS)'
      }
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        status: 'unavailable',
        reason: `epa_api_http_${res.status}`,
        environmentalLiability: null,
        provenance: 'epa-envirofacts-spatial-query'
      };
    }

    const data = await res.json();
    let rawList = [];
    if (Array.isArray(data)) {
      rawList = data;
    } else if (data && Array.isArray(data.Results?.FRSFacet)) {
      rawList = data.Results.FRSFacet;
    } else if (data && Array.isArray(data.Facility)) {
      rawList = data.Facility;
    } else {
      return { status: 'unavailable', reason: 'epa_invalid_response', environmentalLiability: null, provenance: 'epa-envirofacts-spatial-query' };
    }

    const facilities = rawList.map((item) => {
      const facLat = Number(item.Latitude83 || item.LATITUDE || item.lat);
      const facLon = Number(item.Longitude83 || item.LONGITUDE || item.lng);
      const dist = (Number.isFinite(facLat) && Number.isFinite(facLon))
        ? haversineMiles(coords.lat, coords.lng, facLat, facLon)
        : null;

      let programs = [];
      if (Array.isArray(item.ProgramSysAcronyms)) {
        programs = item.ProgramSysAcronyms;
      } else if (typeof item.ProgramSysAcronyms === 'string') {
        programs = item.ProgramSysAcronyms.split(',').map((s) => s.trim());
      } else if (item.PROGRAM_SYSTEM_ACRONYMS) {
        programs = String(item.PROGRAM_SYSTEM_ACRONYMS).split(',').map((s) => s.trim());
      }

      return {
        registryId: item.RegistryId || item.REGISTRY_ID || null,
        name: item.PrimaryName || item.PRIMARY_NAME || item.FACILITY_NAME || 'Unknown facility',
        address: item.LocationAddress || item.LOCATION_ADDRESS || null,
        city: item.CityName || item.CITY_NAME || null,
        state: item.StateCode || item.STATE_CODE || null,
        postalCode: item.PostalCode || item.POSTAL_CODE || null,
        distanceMiles: dist,
        programAcronyms: programs
      };
    });

    const environmentalLiability = evaluateEnvironmentalLiability(facilities);

    const record = {
      schemaVersion: 2,
      observedAt: new Date(now).toISOString(),
      environmentalLiability,
      facilities
    };

    cache[key] = record;
    saveCache(cache, cachePath);

    return {
      status: 'success',
      fromCache: false,
      observedAt: record.observedAt,
      coords,
      environmentalLiability,
      facilities,
      provenance: 'epa-envirofacts-spatial-query'
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      status: 'unavailable',
      reason: err.name === 'AbortError' ? 'epa_api_timeout' : `epa_api_network_error: ${err.message}`,
      environmentalLiability: null,
      provenance: 'epa-envirofacts-spatial-query'
    };
  }
}

module.exports = {
  EPA_FRS_ENDPOINT,
  normalizeCoordinates,
  haversineMiles,
  evaluateEnvironmentalLiability,
  queryEpaHazards,
  loadCache,
  saveCache
};
