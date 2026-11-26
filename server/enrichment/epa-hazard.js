'use strict';

const { loadJsonDiskCache, saveJsonDiskCache, getDurableCache, setDurableCache } = require('./disk-cache');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../.cache/epa-hazard-cache.json');
const EPA_FRS_ENDPOINT = 'https://data.epa.gov/efservice/frs_rest_services.get_facilities';
const EPA_ECHO_FACILITY_ENDPOINT = 'https://echodata.epa.gov/echo/echo_rest_services.get_facility_info';
const EPA_EMEF_MAPSERVER = 'https://gispub.epa.gov/arcgis/rest/services/OEI/FRS_INTERESTS/MapServer';
const EPA_EMEF_LAYERS = [8]; // Facility Registry Service (FRS) FACILITY_INTERESTS
const LEGACY_FRS_COOLDOWN_MS = 10 * 60 * 1000;
let frsLegacyDownUntil = 0;

function resetEpaProviderStateForTests() {
  frsLegacyDownUntil = 0;
}

function mapEchoFacilityRecord(item = {}) {
  const programs = [];
  if (item.SEMSInd || item.SEMSIds || item.SFIds) programs.push('SEMS');
  if (item.RCRAPermitTypes || item.RCRAComplianceStatus || item.RCRAIds || item.RCRAIDs) programs.push('RCRAINFO');
  if (item.TRIIDs) programs.push('TRIS');
  if (item.CWAPermitTypes || item.CWAComplianceStatus || item.NPDESIDs || item.CWPIds) programs.push('ICIS-NPDES');
  if (item.CAAIDs || item.CAAComplianceStatus) programs.push('ICIS-AIR');
  if (item.SDWASystemTypes) programs.push('SDWIS');
  return {
    RegistryId: item.RegistryID || null,
    PrimaryName: item.FacName || 'Unknown facility',
    LocationAddress: item.FacStreet || null,
    CityName: item.FacCity || null,
    StateCode: item.FacState || null,
    PostalCode: item.FacZip || null,
    Latitude83: item.FacLat ?? null,
    Longitude83: item.FacLong ?? null,
    ProgramSysAcronyms: programs.length > 0 ? programs : ['FRS'],
  };
}

async function fetchEpaEchoFallback(coords, radiusMiles, fetchFn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const qs = new URLSearchParams({
      output: 'JSON',
      p_lat: String(coords.lat),
      p_long: String(coords.lng),
      p_radius: String(radiusMiles),
      responseset: '25',
    });
    const res = await fetchFn(`${EPA_ECHO_FACILITY_ENDPOINT}?${qs.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`epa_echo_http_${res.status}`);
    }
    const data = await res.json();
    const results = data && typeof data === 'object' ? data.Results : null;
    if (!results || typeof results !== 'object' || results.Error) {
      throw new Error('epa_echo_invalid_payload');
    }
    const list = Array.isArray(results.Facilities) ? results.Facilities : [];
    return list.map(mapEchoFacilityRecord);
  } finally {
    clearTimeout(timer);
  }
}
async function fetchEpaArcgisFallback(coords, radiusMiles, fetchFn, signal) {
  const deltaLat = radiusMiles / 69;
  const deltaLng = radiusMiles / (69 * Math.max(0.2, Math.cos((coords.lat * Math.PI) / 180)));
  const xmin = Number((coords.lng - deltaLng).toFixed(5));
  const ymin = Number((coords.lat - deltaLat).toFixed(5));
  const xmax = Number((coords.lng + deltaLng).toFixed(5));
  const ymax = Number((coords.lat + deltaLat).toFixed(5));

  const layerResults = await Promise.all(
    EPA_EMEF_LAYERS.map(async (layerId) => {
      const q = new URL(`${EPA_EMEF_MAPSERVER}/${layerId}/query`);
      q.searchParams.set('geometry', `${xmin},${ymin},${xmax},${ymax}`);
      q.searchParams.set('geometryType', 'esriGeometryEnvelope');
      q.searchParams.set('inSR', '4326');
      q.searchParams.set('outSR', '4326');
      q.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
      q.searchParams.set('outFields', '*');
      q.searchParams.set('returnGeometry', 'false');
      q.searchParams.set('resultRecordCount', '25');
      q.searchParams.set('f', 'json');
      const res = await fetchFn(q.toString(), {
        signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PropertyCrawl/1.0 (Zero-Cost Federal Hazard GIS)'
        }
      });
      if (!res.ok) throw new Error(`epa_arcgis_http_${res.status}`);
      const json = await res.json();
      if (!json || json.error || !Array.isArray(json.features)) {
        throw new Error('epa_arcgis_invalid_response');
      }
      return json.features.map((f) => f.attributes).filter(Boolean);
    })
  );
  const byId = new Map();
  for (const list of layerResults) {
    for (const attr of list) {
      const regId = attr.REGISTRY_ID || attr.registry_id || '';
      const prg = attr.PGM_SYS_ACRNMS || attr.PGM_SYS_ACRNM || attr.pgm_sys_acrnm || '';
      const name = attr.PRIMARY_NAME || attr.primary_name || '';
      const key = `${regId}:${prg}:${name}`;
      if (!byId.has(key)) byId.set(key, attr);
    }
  }
  return Array.from(byId.values());
}

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

const resolveDefaultCachePath = () => process.env.PROPERTY_HAZARD_CACHE_DIR ? path.join(process.env.PROPERTY_HAZARD_CACHE_DIR, 'epa-hazard-cache.json') : ((process.env.VERCEL === '1' || process.env.NOW_REGION) ? path.join(require('node:os').tmpdir(), 'property-crawl-cache', 'hazards', 'epa-hazard-cache.json') : DEFAULT_CACHE_PATH);
function loadCache(cachePath = resolveDefaultCachePath()) {
  return loadJsonDiskCache(cachePath);
}

function saveCache(cache, cachePath = resolveDefaultCachePath()) {
  saveJsonDiskCache(cache, cachePath);
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
  cachePath = resolveDefaultCachePath(),
  fetchFn = globalThis.fetch,
  timeoutMs = 8000,
  now = Date.now(),
  db = undefined,
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
  const cachedEntry = (cache[key]?.schemaVersion === 2 && cache[key])
    || (cachePath === resolveDefaultCachePath() ? await getDurableCache('epa_hazard', key, { db }) : null);
  if (cachedEntry?.schemaVersion === 2 && cachedEntry) {
    return {
      status: 'success',
      fromCache: true,
      observedAt: cachedEntry.observedAt,
      coords,
      environmentalLiability: cachedEntry.environmentalLiability,
      facilities: cachedEntry.facilities,
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

  const queryFallbacks = async (primaryReason) => {
    try {
      return await fetchEpaEchoFallback(coords, radiusMiles, fetchFn, timeoutMs);
    } catch {
      const fbController = new AbortController();
      const fbTimer = setTimeout(() => fbController.abort(), timeoutMs);
      try {
        return await fetchEpaArcgisFallback(coords, radiusMiles, fetchFn, fbController.signal);
      } catch {
        const err = new Error(primaryReason);
        err.primaryReason = primaryReason;
        throw err;
      } finally {
        clearTimeout(fbTimer);
      }
    }
  };

  try {
    let rawList = [];
    const skipLegacyFrs = fetchFn === globalThis.fetch;

    if (skipLegacyFrs) {
      rawList = await queryFallbacks('epa_echo_and_gis_fallback_failed');
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchFn(endpoint, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'PropertyCrawl/1.0 (Zero-Cost Federal Hazard GIS)'
          }
        });
      } catch (primaryErr) {
        clearTimeout(timer);
        if (fetchFn === globalThis.fetch) {
          frsLegacyDownUntil = Date.now() + LEGACY_FRS_COOLDOWN_MS;
        }
        const primaryReason = primaryErr?.name === 'AbortError'
          ? 'epa_api_timeout'
          : `epa_api_network_error: ${primaryErr?.message || 'network_error'}`;
        rawList = await queryFallbacks(primaryReason);
        res = null;
      }

      if (res) {
        clearTimeout(timer);
        if (!res.ok) {
          if (fetchFn === globalThis.fetch) {
            frsLegacyDownUntil = Date.now() + LEGACY_FRS_COOLDOWN_MS;
          }
          rawList = await queryFallbacks(`epa_api_http_${res.status}`);
        } else {
          const data = await res.json();
          if (Array.isArray(data)) {
            rawList = data;
          } else if (data && Array.isArray(data.Results?.FRSFacet)) {
            rawList = data.Results.FRSFacet;
          } else if (data && Array.isArray(data.Facility)) {
            rawList = data.Facility;
          } else if (data && Array.isArray(data.features)) {
            rawList = data.features.map((f) => f?.attributes).filter(Boolean);
          } else {
            return { status: 'unavailable', reason: 'epa_invalid_response', environmentalLiability: null, provenance: 'epa-envirofacts-spatial-query' };
          }
        }
      }
    }

    const facilities = rawList.map((item) => {
      const facLat = Number(item.Latitude83 || item.LATITUDE || item.LATITUDE83 || item.latitude || item.lat);
      const facLon = Number(item.Longitude83 || item.LONGITUDE || item.LONGITUDE83 || item.longitude || item.lng);
      const dist = (Number.isFinite(facLat) && Number.isFinite(facLon))
        ? haversineMiles(coords.lat, coords.lng, facLat, facLon)
        : null;

      let programs = [];
      if (Array.isArray(item.ProgramSysAcronyms)) {
        programs = item.ProgramSysAcronyms;
      } else if (typeof item.ProgramSysAcronyms === 'string') {
        programs = item.ProgramSysAcronyms.split(',').map((s) => s.trim());
      } else if (item.PGM_SYS_ACRNMS || item.PROGRAM_SYSTEM_ACRONYMS || item.pgm_sys_acrnm) {
        programs = String(item.PGM_SYS_ACRNMS || item.PROGRAM_SYSTEM_ACRONYMS || item.pgm_sys_acrnm).split(',').map((s) => s.trim());
      }

      return {
        registryId: item.RegistryId || item.REGISTRY_ID || item.registry_id || null,
        name: item.PrimaryName || item.PRIMARY_NAME || item.FACILITY_NAME || item.primary_name || 'Unknown facility',
        address: item.LocationAddress || item.LOCATION_ADDRESS || item.location_address || null,
        city: item.CityName || item.CITY_NAME || item.city_name || null,
        state: item.StateCode || item.STATE_CODE || item.state_code || null,
        postalCode: item.PostalCode || item.POSTAL_CODE || item.postal_code || null,
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
    if (cachePath === resolveDefaultCachePath()) {
      await setDurableCache('epa_hazard', key, record, { db });
    }

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
    return {
      status: 'unavailable',
      reason: err?.primaryReason || (err?.name === 'AbortError' ? 'epa_api_timeout' : `epa_api_network_error: ${err?.message || 'unknown_error'}`),
      environmentalLiability: null,
      provenance: 'epa-envirofacts-spatial-query'
    };
  }
}

module.exports = {
  EPA_FRS_ENDPOINT,
  EPA_ECHO_FACILITY_ENDPOINT,
  EPA_EMEF_MAPSERVER,
  resetEpaProviderStateForTests,
  normalizeCoordinates,
  haversineMiles,
  evaluateEnvironmentalLiability,
  queryEpaHazards,
  loadCache,
  saveCache
};
