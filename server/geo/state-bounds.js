'use strict';

/**
 * Shared geographic bounds & coordinate integrity guards.
 * Pure zero-dependency CommonJS so both Node services and browser policy modules
 * (`src/lib/listing-map-policy.js`) can import a single source of truth.
 */

// 50 US states + DC rectangular envelopes (US Census TIGER/Line coarse bounds).
const STATE_BBOX = Object.freeze({
  AL: { south: 30.22, north: 35.01, west: -88.47, east: -84.89 },
  AK: { south: 51.21, north: 71.44, west: -179.15, east: -129.97 },
  AZ: { south: 31.33, north: 37.00, west: -114.82, east: -109.05 },
  AR: { south: 33.00, north: 36.50, west: -94.62, east: -89.64 },
  CA: { south: 32.53, north: 42.01, west: -124.41, east: -114.13 },
  CO: { south: 36.99, north: 41.00, west: -109.06, east: -102.04 },
  CT: { south: 40.98, north: 42.05, west: -73.73, east: -71.79 },
  DE: { south: 38.45, north: 39.84, west: -75.79, east: -75.05 },
  DC: { south: 38.79, north: 38.99, west: -77.12, east: -76.91 },
  FL: { south: 24.40, north: 31.00, west: -87.63, east: -80.03 },
  GA: { south: 30.36, north: 35.00, west: -85.61, east: -80.84 },
  HI: { south: 18.91, north: 22.24, west: -160.25, east: -154.81 },
  ID: { south: 41.99, north: 49.00, west: -117.24, east: -111.05 },
  IL: { south: 36.97, north: 42.51, west: -91.51, east: -87.50 },
  IN: { south: 37.77, north: 41.76, west: -88.10, east: -84.78 },
  IA: { south: 40.38, north: 43.50, west: -96.64, east: -90.14 },
  KS: { south: 36.99, north: 40.00, west: -102.05, east: -94.59 },
  KY: { south: 36.50, north: 39.15, west: -89.57, east: -81.97 },
  LA: { south: 28.93, north: 33.02, west: -94.04, east: -88.82 },
  ME: { south: 43.06, north: 47.46, west: -71.08, east: -66.95 },
  MD: { south: 37.91, north: 39.72, west: -79.49, east: -75.05 },
  MA: { south: 41.24, north: 42.89, west: -73.51, east: -69.93 },
  MI: { south: 41.70, north: 48.30, west: -90.42, east: -82.42 },
  MN: { south: 43.50, north: 49.38, west: -97.24, east: -89.49 },
  MS: { south: 30.17, north: 35.00, west: -91.65, east: -88.10 },
  MO: { south: 35.99, north: 40.61, west: -95.77, east: -89.10 },
  MT: { south: 44.36, north: 49.00, west: -116.05, east: -104.04 },
  NE: { south: 39.99, north: 43.00, west: -104.05, east: -95.31 },
  NV: { south: 35.00, north: 42.00, west: -120.01, east: -114.04 },
  NH: { south: 42.70, north: 45.31, west: -72.56, east: -70.61 },
  NJ: { south: 38.93, north: 41.36, west: -75.56, east: -73.89 },
  NM: { south: 31.33, north: 37.00, west: -109.05, east: -103.00 },
  NY: { south: 40.50, north: 45.02, west: -79.76, east: -71.85 },
  NC: { south: 33.84, north: 36.59, west: -84.32, east: -75.46 },
  ND: { south: 45.94, north: 49.00, west: -104.05, east: -96.55 },
  OH: { south: 38.40, north: 41.98, west: -84.82, east: -80.52 },
  OK: { south: 33.62, north: 37.00, west: -103.00, east: -94.43 },
  OR: { south: 41.99, north: 46.30, west: -124.57, east: -116.46 },
  PA: { south: 39.72, north: 42.27, west: -80.52, east: -74.69 },
  RI: { south: 41.15, north: 42.02, west: -71.86, east: -71.12 },
  SC: { south: 32.03, north: 35.22, west: -83.35, east: -78.54 },
  SD: { south: 42.48, north: 45.95, west: -104.06, east: -96.43 },
  TN: { south: 34.98, north: 36.68, west: -90.31, east: -81.65 },
  TX: { south: 25.84, north: 36.50, west: -106.65, east: -93.51 },
  UT: { south: 36.99, north: 42.00, west: -114.05, east: -109.04 },
  VT: { south: 42.73, north: 45.02, west: -73.44, east: -71.46 },
  VA: { south: 36.54, north: 39.47, west: -83.68, east: -75.24 },
  WA: { south: 45.54, north: 49.00, west: -124.85, east: -116.92 },
  WV: { south: 37.20, north: 40.64, west: -82.64, east: -77.72 },
  WI: { south: 42.49, north: 47.08, west: -92.89, east: -86.81 },
  WY: { south: 41.00, north: 45.01, west: -111.06, east: -104.05 },
});

const TERRITORY_BBOX = Object.freeze({
  PR: { south: 17.88, north: 18.55, west: -67.97, east: -65.20 },
  VI: { south: 17.65, north: 18.43, west: -65.10, east: -64.55 },
  GU: { south: 13.20, north: 13.68, west: 144.60, east: 144.98 },
  MP: { south: 14.08, north: 20.60, west: 144.85, east: 146.10 },
  AS: { south: -14.40, north: -11.00, west: -171.12, east: -168.10 },
});

// Multi-box envelopes (notably Alaska's Aleutian islands crossing the 180th meridian).
const EXTRA_STATE_BOXES = Object.freeze({
  AK: [{ south: 51.21, north: 53.50, west: 172.30, east: 180.00 }],
});

const STATE_BOUNDS = Object.freeze({
  ...STATE_BBOX,
  ...TERRITORY_BBOX,
});

function boxContains(box, lat, lng, cushion) {
  return lat >= (box.south - cushion)
    && lat <= (box.north + cushion)
    && lng >= (box.west - cushion)
    && lng <= (box.east + cushion);
}

/**
 * Validates that (lat, lng) are finite non-zero coordinates inside the
 * reported US state/territory bounds (with tight border cushion).
 */
function isCoordInStateBounds(lat, lng, state) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)
      || nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180
      || (nLat === 0 && nLng === 0)) {
    return { ok: false, reason: 'coordinates_missing_or_invalid' };
  }
  const code = typeof state === 'string' ? state.trim().toUpperCase() : '';
  const primary = STATE_BOUNDS[code];
  if (!primary) {
    return { ok: false, reason: 'state_invalid_for_coord_check' };
  }
  const cushion = code === 'DC' ? 0.03 : 0.08;
  const boxes = EXTRA_STATE_BOXES[code] ? [primary, ...EXTRA_STATE_BOXES[code]] : [primary];
  const inside = boxes.some((box) => boxContains(box, nLat, nLng, cushion));
  if (!inside) {
    return { ok: false, reason: `coords_outside_state_bbox:lat=${nLat},lng=${nLng},state=${code}` };
  }
  return { ok: true, reason: null };
}

/**
 * Returns true when coordinates lie inside the contiguous 48 US states (CONUS).
 * Used to gate CONUS-only federal datasets such as USDA NAIP.
 */
function isConusCoord(lat, lng) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return false;
  return nLat >= 24.3 && nLat <= 49.5 && nLng >= -125.0 && nLng <= -66.8;
}

function baseBuildingKey(listing) {
  if (!listing || typeof listing !== 'object') return '';
  const rawStreet = String(listing.address || '').split(',')[0].toUpperCase();
  const stripped = rawStreet
    .replace(/\b(?:APARTMENT|APT|UNIT|SUITE|STE|BLDG|BUILDING|LOT)\b.*$/i, '')
    .replace(/#.*$/, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  const zip5 = String(listing.zip || '').trim().slice(0, 5);
  const state = String(listing.state || '').trim().toUpperCase();
  if (!stripped) return '';
  return `${stripped}|${zip5}|${state}`;
}

/**
 * Detects coordinates shared by >= minDistinctBuildings distinct normalized
 * base street addresses (e.g. county courthouse or city centroid poison).
 * Multiple units inside one building collapse to the same base building key.
 */
function detectCoincidentCoordPoison(listings, { minDistinctBuildings = 3 } = {}) {
  const buckets = new Map();
  if (!Array.isArray(listings)) return new Set();
  for (const item of listings) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const building = baseBuildingKey(item);
    if (!building) continue;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    let set = buckets.get(key);
    if (!set) {
      set = new Set();
      buckets.set(key, set);
    }
    set.add(building);
  }
  const poisoned = new Set();
  for (const [key, buildings] of buckets.entries()) {
    if (buildings.size >= minDistinctBuildings) poisoned.add(key);
  }
  return poisoned;
}

module.exports = {
  STATE_BBOX,
  TERRITORY_BBOX,
  STATE_BOUNDS,
  isCoordInStateBounds,
  isConusCoord,
  baseBuildingKey,
  detectCoincidentCoordPoison,
};
