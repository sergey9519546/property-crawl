'use strict';

/**
 * panoramax.js — Open-Source Panoramax & Street-Level Imagery Client
 *
 * Implements Task 11:
 * Queries open Panoramax (CC-BY-SA-4.0) spatial endpoints using bounding boxes,
 * provides multi-tier visual resolution (Publisher -> Panoramax -> Blueprint SVG),
 * and generates deterministic vector parcel blueprints for zero-broken-image guarantees.
 */

const PANORAMAX_API_ENDPOINT = 'https://api.panoramax.xyz/api/search';

/**
 * Calculates a bounding box around a lat/lng point given a radius in meters.
 * Approx 1 deg lat = 111,320m; 1 deg lng = 111,320m * cos(lat).
 */
function calculateBbox(lat, lng, radiusMeters = 75) {
  const latDelta = radiusMeters / 111320;
  const rad = (lat * Math.PI) / 180;
  const lngDelta = radiusMeters / (111320 * Math.cos(rad));

  const minLng = Math.round((lng - lngDelta) * 100000) / 100000;
  const minLat = Math.round((lat - latDelta) * 100000) / 100000;
  const maxLng = Math.round((lng + lngDelta) * 100000) / 100000;
  const maxLat = Math.round((lat + latDelta) * 100000) / 100000;

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Queries Panoramax open imagery catalog for street view pictures near a location.
 *
 * @param {Object} params
 * @param {number} params.lat - Latitude
 * @param {number} params.lng - Longitude
 * @param {number} [params.radiusMeters=75] - Search radius in meters
 * @param {Function} [params.fetchFn] - Custom fetch for testing
 * @returns {Promise<Object|null>}
 */
async function queryPanoramaxImagery({ lat, lng, radiusMeters = 75, fetchFn = globalThis.fetch }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const bbox = calculateBbox(lat, lng, radiusMeters);
  const url = `${PANORAMAX_API_ENDPOINT}?bbox=${bbox.join(',')}&limit=1`;

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/geo+json, application/json',
        'User-Agent': 'PropertyCrawl/2.0 (Panoramax Open Street View Client)'
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || !Array.isArray(data.features) || data.features.length === 0) {
      return null;
    }

    const feature = data.features[0];
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates || [lng, lat];

    return {
      source: 'PANORAMAX_OPEN_STREET_VIEW',
      id: feature.id,
      sequenceId: feature.collection,
      coordinates: { lng: coords[0], lat: coords[1] },
      viewerUrl: `https://api.panoramax.xyz/?pic=${encodeURIComponent(feature.id)}`,
      thumbnailUrl: `https://api.panoramax.xyz/api/pictures/${encodeURIComponent(feature.id)}/thumb.jpg`,
      license: props.license || 'CC-BY-SA-4.0',
      capturedAt: props.datetime || null,
      fieldOfView: props.field_of_view || null,
      attribution: 'Panoramax contributors (CC-BY-SA-4.0)'
    };
  } catch (err) {
    return null;
  }
}

/**
 * Generates an SVG vector parcel blueprint for properties lacking exterior imagery.
 * 100% self-contained, no external requests, zero layout shift.
 *
 * @param {Object} listing
 * @returns {string} SVG markup string
 */
function generateParcelSvgBlueprint(listing = {}) {
  const address = String(listing.address || 'Address unrecorded').replace(/[<>&"']/g, '');
  const state = String(listing.state || 'US').replace(/[<>&"']/g, '');
  const county = String(listing.county || 'CAD').replace(/[<>&"']/g, '');
  const propType = String(listing.propType || 'Distressed Parcel').replace(/[<>&"']/g, '');
  const bid = Number(listing.openingBid);
  const bidText = Number.isFinite(bid) && bid > 0 ? `$${bid.toLocaleString()}` : 'Docket Recorded';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" width="100%" height="100%" style="background:#0b1120;font-family:ui-sans-serif,system-ui,sans-serif">
  <defs>
    <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" stroke-width="1"/>
    </pattern>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>

  <rect width="600" height="450" fill="url(#grad)"/>
  <rect width="600" height="450" fill="url(#grid)" opacity="0.6"/>

  <!-- Blueprint Parcel Boundary Contour -->
  <g transform="translate(150, 100)" stroke="#38bdf8" stroke-width="2" fill="#0284c7" fill-opacity="0.12">
    <polygon points="150,20 270,90 230,230 40,200 10,70" stroke-dasharray="6,4"/>
    <!-- Building Footprint -->
    <polygon points="110,90 190,130 160,190 80,150" fill="#38bdf8" fill-opacity="0.25" stroke="#38bdf8" stroke-width="2.5"/>
  </g>

  <!-- Top Badges -->
  <g transform="translate(30, 36)">
    <rect width="90" height="26" rx="6" fill="#0284c7" fill-opacity="0.25" stroke="#0284c7" stroke-width="1"/>
    <text x="45" y="17" fill="#38bdf8" font-size="11" font-weight="700" text-anchor="middle">${state} · ${county}</text>

    <rect x="100" width="130" height="26" rx="6" fill="#334155" fill-opacity="0.4" stroke="#475569" stroke-width="1"/>
    <text x="165" y="17" fill="#cbd5e1" font-size="11" font-weight="600" text-anchor="middle">${propType}</text>
  </g>

  <!-- Bottom Details Card -->
  <g transform="translate(30, 350)">
    <rect width="540" height="74" rx="12" fill="#0f172a" fill-opacity="0.85" stroke="#334155" stroke-width="1"/>
    <text x="20" y="30" fill="#f8fafc" font-size="15" font-weight="700">${address}</text>
    <text x="20" y="52" fill="#94a3b8" font-size="12">Cadastral Blueprint · Opening Bid: <tspan fill="#38bdf8" font-weight="700">${bidText}</tspan></text>
    <text x="520" y="42" fill="#64748b" font-size="10" text-anchor="end">PUBLIC RECORD DATA</text>
  </g>
</svg>`;
}

/**
 * Resolves the highest quality visual asset available for a listing.
 * Tier 1: Publisher Photo
 * Tier 2: Panoramax Street View Photo
 * Tier 3: SVG Blueprint Vector
 */
async function resolveListingVisual(listing, options = {}) {
  if (!listing) return null;

  // Tier 1: Official publisher photo
  if (listing.imageUrl && typeof listing.imageUrl === 'string' && listing.imageUrl.startsWith('http')) {
    return {
      tier: 'PUBLISHER',
      url: listing.imageUrl,
      attribution: listing.source || 'Publisher Official',
      isFallback: false
    };
  }

  // Tier 2: Panoramax Open Street View
  if (Number.isFinite(listing.lat) && Number.isFinite(listing.lng)) {
    const panoramax = await queryPanoramaxImagery({
      lat: listing.lat,
      lng: listing.lng,
      fetchFn: options.fetchFn
    });

    if (panoramax) {
      return {
        tier: 'PANORAMAX_STREET_VIEW',
        url: panoramax.thumbnailUrl,
        viewerUrl: panoramax.viewerUrl,
        attribution: panoramax.attribution,
        license: panoramax.license,
        isFallback: false
      };
    }
  }

  // Tier 3: Vector Parcel Blueprint SVG
  const svg = generateParcelSvgBlueprint(listing);
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  return {
    tier: 'BLUEPRINT_SVG',
    url: dataUri,
    svgMarkup: svg,
    attribution: 'County Cadastral Record',
    isFallback: true
  };
}

module.exports = {
  calculateBbox,
  queryPanoramaxImagery,
  generateParcelSvgBlueprint,
  resolveListingVisual,
  PANORAMAX_API_ENDPOINT
};
