'use strict';

const { isConusCoord } = require('../geo/state-bounds');

const EARTH_RADIUS_METERS = 6378137.0;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function projectToWebMercator(lat, lng) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const latRad = (clampedLat * Math.PI) / 180;
  const lngRad = (Number(lng) * Math.PI) / 180;
  const x = EARTH_RADIUS_METERS * lngRad;
  const y = EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return { x, y, cosLat: Math.max(0.05, Math.cos(latRad)) };
}

function extractGeometryRings(geometry) {
  if (!geometry || typeof geometry !== 'object') return [];
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.filter((ring) => Array.isArray(ring) && ring.length >= 4);
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const rings = [];
    for (const poly of geometry.coordinates) {
      if (!Array.isArray(poly)) continue;
      for (const ring of poly) {
        if (Array.isArray(ring) && ring.length >= 4) rings.push(ring);
      }
    }
    return rings;
  }
  return [];
}

/**
 * Computes a Web Mercator (EPSG:3857) bounding box with exact width:height
 * aspect ratio. When valid parcel polygon geometry is supplied, frames tightly
 * around the parcel's true extent with comfortable street/neighbor margin.
 */
function computeParcelFramedBbox({
  lat,
  lng,
  geometry = null,
  width = 640,
  height = 480,
  paddingFactor = 1.5,
  minSpanMeters = 65,
  maxSpanMeters = 360,
  defaultWidthMeters = 150,
  defaultHeightMeters = 112.5,
} = {}) {
  const aspect = width / height;
  const rings = extractGeometryRings(geometry);

  if (rings.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let latSum = 0;
    let count = 0;

    for (const ring of rings) {
      for (const pt of ring) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        const pLng = Number(pt[0]);
        const pLat = Number(pt[1]);
        if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
        const { x, y } = projectToWebMercator(pLat, pLng);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        latSum += pLat;
        count += 1;
      }
    }

    if (count >= 3 && Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY)) {
      const meanLat = latSum / count;
      const cosLat = Math.max(0.05, Math.cos((meanLat * Math.PI) / 180));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rawGroundW = ((maxX - minX) * cosLat) * paddingFactor;
      const rawGroundH = ((maxY - minY) * cosLat) * paddingFactor;

      let groundW = Math.max(minSpanMeters, Math.min(maxSpanMeters, Math.max(rawGroundW, rawGroundH * aspect)));
      let groundH = groundW / aspect;
      if (groundH < rawGroundH) {
        groundH = Math.min(maxSpanMeters, rawGroundH);
        groundW = groundH * aspect;
      }

      const halfX = (groundW / 2) / cosLat;
      const halfY = (groundH / 2) / cosLat;
      const fMinX = cx - halfX;
      const fMaxX = cx + halfX;
      const fMinY = cy - halfY;
      const fMaxY = cy + halfY;

      return {
        minX: fMinX,
        minY: fMinY,
        maxX: fMaxX,
        maxY: fMaxY,
        bbox: [fMinX, fMinY, fMaxX, fMaxY].map((n) => n.toFixed(2)).join(','),
        parcelLocked: true,
        width,
        height,
      };
    }
  }

  const { x, y, cosLat } = projectToWebMercator(lat, lng);
  const halfX = (defaultWidthMeters / 2) / cosLat;
  const halfY = (defaultHeightMeters / 2) / cosLat;
  const fMinX = x - halfX;
  const fMaxX = x + halfX;
  const fMinY = y - halfY;
  const fMaxY = y + halfY;

  return {
    minX: fMinX,
    minY: fMinY,
    maxX: fMaxX,
    maxY: fMaxY,
    bbox: [fMinX, fMinY, fMaxX, fMaxY].map((n) => n.toFixed(2)).join(','),
    parcelLocked: false,
    width,
    height,
  };
}

function projectPointToPixel(lat, lng, frame) {
  const { x, y } = projectToWebMercator(lat, lng);
  const spanX = Math.max(1e-6, frame.maxX - frame.minX);
  const spanY = Math.max(1e-6, frame.maxY - frame.minY);
  const px = ((x - frame.minX) / spanX) * frame.width;
  const py = ((frame.maxY - y) / spanY) * frame.height;
  return { px, py };
}

function projectGeometryToSvgPaths(geometry, frame) {
  const rings = extractGeometryRings(geometry);
  if (!rings.length || !frame) return [];

  const paths = [];
  for (const ring of rings) {
    const commands = [];
    for (let i = 0; i < ring.length; i += 1) {
      const pt = ring[i];
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const pLng = Number(pt[0]);
      const pLat = Number(pt[1]);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
      const { px, py } = projectPointToPixel(pLat, pLng, frame);
      commands.push(`${commands.length === 0 ? 'M' : 'L'} ${px.toFixed(1)},${py.toFixed(1)}`);
    }
    if (commands.length >= 3) {
      paths.push(`${commands.join(' ')} Z`);
    }
  }
  return paths;
}

function buildAerialProviders(lat, lng) {
  return [
    {
      endpoint: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export',
      provider: 'USGS National Map',
      attribution: 'U.S. Geological Survey (The National Map)',
    },
    ...(isConusCoord(lat, lng)
      ? [{
          endpoint: 'https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage',
          provider: 'USDA NAIP',
          attribution: 'USDA Farm Production and Conservation (NAIP Public Domain)',
        }]
      : []),
  ];
}

function formatLotSize(lotAcres, lotSqft) {
  if (Number.isFinite(Number(lotAcres)) && Number(lotAcres) > 0) {
    return `${Number(lotAcres).toFixed(2)} ac`;
  }
  if (Number.isFinite(Number(lotSqft)) && Number(lotSqft) > 0) {
    return `${Math.round(Number(lotSqft)).toLocaleString('en-US')} sq ft`;
  }
  return null;
}

/**
 * Renders a deterministic, zero-hallucination SVG-over-ortho composite visual.
 * Embeds the real public-domain JPEG/PNG as a base64 data URI (zero external
 * subrequests, zero scripts, safe inside <img src="..."> under strict CSP).
 */
function renderParcelCompositeSvg({
  imageBuffer,
  contentType = 'image/jpeg',
  geometry = null,
  frame,
  lat,
  lng,
  precision = 'source_observed',
  provider = 'USGS National Map',
  lotAcres = null,
  lotSqft = null,
  parcelId = null,
}) {
  const width = frame?.width || 640;
  const height = frame?.height || 480;
  const safeMime = contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  const base64 = Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : '';
  const parcelPaths = frame?.parcelLocked ? projectGeometryToSvgPaths(geometry, frame) : [];
  const hasParcelOverlay = parcelPaths.length > 0;

  let overlayMarkup = '';
  if (hasParcelOverlay) {
    overlayMarkup = parcelPaths
      .map((d) => (
        `<path d="${d}" fill="#38bdf8" fill-opacity="0.16" stroke="#0f172a" stroke-width="4.5" stroke-linejoin="round"/>`
        + `<path d="${d}" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linejoin="round"/>`
      ))
      .join('');
  } else if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && frame) {
    const { px, py } = projectPointToPixel(lat, lng, frame);
    const cx = px.toFixed(1);
    const cy = py.toFixed(1);
    if (precision === 'street_interpolated') {
      overlayMarkup = (
        `<circle cx="${cx}" cy="${cy}" r="36" fill="#f59e0b" fill-opacity="0.14" stroke="#0f172a" stroke-width="3.5" stroke-dasharray="6,4"/>`
        + `<circle cx="${cx}" cy="${cy}" r="36" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="6,4"/>`
        + `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#fbbf24" stroke="#0f172a" stroke-width="1.5"/>`
      );
    } else {
      overlayMarkup = (
        `<circle cx="${cx}" cy="${cy}" r="14" fill="#38bdf8" fill-opacity="0.18" stroke="#0f172a" stroke-width="3"/>`
        + `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="#38bdf8" stroke-width="1.8"/>`
        + `<circle cx="${cx}" cy="${cy}" r="4" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5"/>`
      );
    }
  }

  const lotSize = formatLotSize(lotAcres, lotSqft);
  const topParts = [
    hasParcelOverlay
      ? 'PARCEL-LOCKED AERIAL'
      : (precision === 'street_interpolated' ? 'OVERHEAD AERIAL · STREET-INTERPOLATED' : 'OVERHEAD AERIAL'),
    lotSize,
    hasParcelOverlay && parcelId ? `APN ${String(parcelId).slice(0, 24)}` : null,
  ].filter(Boolean);
  const topLabel = escapeXml(topParts.join(' · '));
  const topPillWidth = Math.min(width - 28, Math.max(170, topLabel.length * 6.8 + 26));

  const bottomLabel = escapeXml(`${provider} · Not a survey · Not a ground photo`);
  const bottomPillWidth = Math.min(width - 28, Math.max(210, bottomLabel.length * 6.2 + 22));
  const bottomX = width - bottomPillWidth - 12;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<image href="data:${safeMime};base64,${base64}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`
    + overlayMarkup
    + `<g font-family="ui-sans-serif,system-ui,-apple-system,sans-serif">`
    + `<rect x="12" y="12" width="${topPillWidth.toFixed(0)}" height="24" rx="6" fill="#0f172a" fill-opacity="0.82"/>`
    + `<text x="22" y="28" fill="#f8fafc" font-size="11" font-weight="700" letter-spacing="0.4">${topLabel}</text>`
    + `<rect x="${bottomX.toFixed(0)}" y="${height - 32}" width="${bottomPillWidth.toFixed(0)}" height="20" rx="5" fill="#0f172a" fill-opacity="0.76"/>`
    + `<text x="${(bottomX + 10).toFixed(0)}" y="${height - 18}" fill="#e2e8f0" font-size="10" font-weight="600">${bottomLabel}</text>`
    + `</g></svg>`;
}

/**
 * Bounded LRU/TTL memory cache with in-flight request coalescing for public-domain
 * aerial tiles and parcel-locked composite visuals.
 */
function createAerialTileCache({ maxEntries = 128, ttlMs = 30 * 60_000, now = Date.now } = {}) {
  const store = new Map();
  const inFlight = new Map();

  function get(key) {
    const hit = store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now()) {
      store.delete(key);
      return null;
    }
    store.delete(key);
    store.set(key, hit);
    return hit.value;
  }

  function set(key, value) {
    if (store.has(key)) store.delete(key);
    while (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
    store.set(key, { value, expiresAt: now() + ttlMs });
  }

  async function getOrLoad(key, loader) {
    const cached = get(key);
    if (cached !== null) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (value !== null && value !== undefined) set(key, value);
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  }

  function stats() {
    const t = now();
    let live = 0;
    let expired = 0;
    for (const entry of store.values()) {
      if (entry.expiresAt > t) live += 1;
      else expired += 1;
    }
    return { total: store.size, live, expired, maxEntries, ttlMs, inFlight: inFlight.size };
  }

  return { get, set, getOrLoad, stats };
}

module.exports = {
  projectToWebMercator,
  computeParcelFramedBbox,
  projectPointToPixel,
  projectGeometryToSvgPaths,
  buildAerialProviders,
  renderParcelCompositeSvg,
  createAerialTileCache,
};
