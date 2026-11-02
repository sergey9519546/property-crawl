'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../.cache/usgs-terrain-cache.json');
const USGS_EPQS_ENDPOINT = 'https://epqs.nationalmap.gov/v1/json';

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

function hashCoords(coords) {
  return crypto.createHash('sha256').update(`${coords.lat},${coords.lng}`).digest('hex').slice(0, 32);
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
 * Calculates grade slope percentage and classifications.
 * @param {number} elevRiseMeters Elevation difference (max - min) in meters
 * @param {number} runDistanceMeters Horizontal distance span in meters
 */
function classifySlope(elevRiseMeters, runDistanceMeters) {
  if (!Number.isFinite(elevRiseMeters) || !Number.isFinite(runDistanceMeters) || runDistanceMeters <= 0) {
    return {
      slopePct: 0,
      classification: 'unknown',
      score: 100,
      buildability: 'unclassified',
      summary: 'Insufficient terrain data to compute slope gradient.'
    };
  }

  const slopePct = Number(((elevRiseMeters / runDistanceMeters) * 100).toFixed(1));

  if (slopePct < 8) {
    return {
      slopePct,
      classification: 'flat_to_gentle',
      score: 100,
      buildability: 'standard_buildable',
      summary: `Gentle slope (${slopePct}%). Favorable for standard foundation construction and grading.`
    };
  }

  if (slopePct < 15) {
    return {
      slopePct,
      classification: 'moderate_slope',
      score: 80,
      buildability: 'moderate_grading_required',
      summary: `Moderate slope (${slopePct}%). Standard building site; may require stepped foundations or bench grading.`
    };
  }

  if (slopePct < 25) {
    return {
      slopePct,
      classification: 'steep_slope',
      score: 50,
      buildability: 'engineered_foundation_required',
      summary: `Steep slope (${slopePct}%). Engineered structural foundation, civil drainage controls, and retaining walls required.`
    };
  }

  return {
    slopePct,
    classification: 'severe_slope',
    score: 20,
    buildability: 'severe_building_constraint',
    summary: `SEVERE CLIFF/RAVINE SLOPE (${slopePct}%). High landslide/erosion hazard. Conventional construction likely cost-prohibitive or statutorily restricted under municipal hillside ordinances.`
  };
}

/**
 * Queries single elevation point from USGS EPQS.
 */
async function fetchSingleElevation(lat, lng, fetchFn, signal) {
  const url = `${USGS_EPQS_ENDPOINT}?x=${lng}&y=${lat}&units=Meters&output=json`;
  const res = await fetchFn(url, {
    signal,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'PropertyCrawl/1.0 (Zero-Cost Federal Hazard GIS)'
    }
  });

  if (!res.ok) throw new Error(`USGS EPQS HTTP ${res.status}`);
  const json = await res.json();
  const elev = Number(json.value ?? json.Value ?? json.elevation);
  if (!Number.isFinite(elev) || elev === -1000000) {
    throw new Error('USGS EPQS returned invalid elevation value');
  }
  return elev;
}

/**
 * Computes parcel terrain slope by sampling 5 points (center + 30m N/S/E/W).
 */
async function queryTerrainSlope({
  lat,
  lng,
  offsetMeters = 30,
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
      slopeAnalysis: null,
      provenance: 'usgs-3dep-elevation-query'
    };
  }

  const key = hashCoords(coords);
  const cache = loadCache(cachePath);
  if (cache[key]) {
    return {
      status: 'success',
      fromCache: true,
      observedAt: cache[key].observedAt,
      coords,
      slopeAnalysis: cache[key].slopeAnalysis,
      elevationMeters: cache[key].elevationMeters,
      samples: cache[key].samples,
      provenance: 'usgs-3dep-elevation-query'
    };
  }

  if (typeof fetchFn !== 'function') {
    return {
      status: 'unavailable',
      reason: 'fetch_not_available',
      slopeAnalysis: null,
      provenance: 'usgs-3dep-elevation-query'
    };
  }

  // 1 deg lat ~= 111,000 meters
  const deltaLat = offsetMeters / 111000;
  // 1 deg lon ~= 111,000 * cos(lat) meters
  const radLat = (coords.lat * Math.PI) / 180;
  const deltaLng = offsetMeters / (111000 * Math.max(0.1, Math.cos(radLat)));

  const points = [
    { label: 'center', lat: coords.lat, lng: coords.lng },
    { label: 'north', lat: Number((coords.lat + deltaLat).toFixed(5)), lng: coords.lng },
    { label: 'south', lat: Number((coords.lat - deltaLat).toFixed(5)), lng: coords.lng },
    { label: 'east', lat: coords.lat, lng: Number((coords.lng + deltaLng).toFixed(5)) },
    { label: 'west', lat: coords.lat, lng: Number((coords.lng - deltaLng).toFixed(5)) }
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const sampleResults = await Promise.all(
      points.map(async (pt) => {
        const elevation = await fetchSingleElevation(pt.lat, pt.lng, fetchFn, controller.signal);
        return { ...pt, elevationMeters: elevation };
      })
    );

    clearTimeout(timer);

    const elevs = sampleResults.map((s) => s.elevationMeters);
    const minElev = Math.min(...elevs);
    const maxElev = Math.max(...elevs);
    const rise = maxElev - minElev;
    const run = offsetMeters * 2; // Span across opposite sides (e.g. 60 meters)

    const slopeAnalysis = classifySlope(rise, run);
    slopeAnalysis.minElevationMeters = minElev;
    slopeAnalysis.maxElevationMeters = maxElev;
    slopeAnalysis.centerElevationMeters = sampleResults[0].elevationMeters;
    slopeAnalysis.centerElevationFeet = Number((sampleResults[0].elevationMeters * 3.28084).toFixed(1));

    const record = {
      observedAt: new Date(now).toISOString(),
      slopeAnalysis,
      elevationMeters: sampleResults[0].elevationMeters,
      samples: sampleResults
    };

    cache[key] = record;
    saveCache(cache, cachePath);

    return {
      status: 'success',
      fromCache: false,
      observedAt: record.observedAt,
      coords,
      slopeAnalysis,
      elevationMeters: record.elevationMeters,
      samples: sampleResults,
      provenance: 'usgs-3dep-elevation-query'
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      status: 'unavailable',
      reason: err.name === 'AbortError' ? 'usgs_api_timeout' : `usgs_api_network_error: ${err.message}`,
      slopeAnalysis: null,
      provenance: 'usgs-3dep-elevation-query'
    };
  }
}

module.exports = {
  USGS_EPQS_ENDPOINT,
  normalizeCoordinates,
  classifySlope,
  fetchSingleElevation,
  queryTerrainSlope,
  loadCache,
  saveCache
};
