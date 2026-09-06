'use strict';

const db = require('../db/client');

// Public cadastral reference layers. Their polygons are assessor/GIS records,
// not boundary surveys, and are returned only when the upstream service supplies
// an actual feature intersecting the requested point.
const ARCGIS_REGISTRY = Object.freeze({
  OH: {
    name: 'Ohio Geographically Referenced Information Program (OGRIP)',
    endpoint: 'https://gis5.oit.ohio.gov/arcgis/rest/services/LBRS/MapServer/0/query'
  },
  FL: {
    name: 'Florida Geographic Data Library / FDEP Open Data Parcels',
    endpoint: 'https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PARCELS/MapServer/0/query'
  },
  TX: {
    name: 'Texas StratMap Parcels / TNRIS',
    endpoint: 'https://feature.geographic.texas.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query'
  },
  NJ: {
    name: 'New Jersey Office of GIS (NJGIN) Parcel Data',
    endpoint: 'https://maps.nj.gov/arcgis/rest/services/Basemap/Parcels/MapServer/0/query'
  }
});

class ParcelBoundaryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ParcelBoundaryError';
    this.status = status;
    this.code = code;
  }
}

function coordinate(value, minimum, maximum) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function textValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstValue(properties, keys, parser) {
  for (const key of keys) {
    const value = parser(properties[key]);
    if (value !== null) return value;
  }
  return null;
}

function isPosition(position) {
  return Array.isArray(position)
    && position.length >= 2
    && coordinate(position[0], -180, 180) !== null
    && coordinate(position[1], -90, 90) !== null;
}

function isClosedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition)) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isCadastralGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  if (geometry.type === 'Polygon') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && geometry.coordinates.every(isClosedRing);
  }
  if (geometry.type === 'MultiPolygon') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && geometry.coordinates.every(
        polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.every(isClosedRing)
      );
  }
  return false;
}

function observedProperties(properties, serviceInfo) {
  const source = properties && typeof properties === 'object' ? properties : {};
  const parcelId = firstValue(source, ['PARCEL_ID', 'PARCELID', 'PARCELNO', 'PARCEL_NO', 'PIN', 'APN'], textValue);
  const observedAcres = firstValue(source, ['CALCULATED_ACRES', 'CALC_ACRES', 'LOT_ACRES', 'ACRES', 'GIS_ACRES'], numberValue);
  const observedSqft = firstValue(source, ['LOT_SQFT', 'LOT_SF', 'LAND_SQFT', 'SQFT'], numberValue);
  const lotSqft = observedSqft ?? (observedAcres === null ? null : Math.round(observedAcres * 43560));
  const lotAcres = observedAcres ?? (observedSqft === null ? null : Number((observedSqft / 43560).toFixed(4)));

  return {
    parcelId,
    lotSqft,
    lotAcres,
    frontageFt: firstValue(source, ['FRONT_FEET', 'FRONTAGE', 'FRONT_FT'], numberValue),
    depthFt: firstValue(source, ['DEPTH_FEET', 'LOT_DEPTH', 'DEPTH_FT'], numberValue),
    zoning: firstValue(source, ['ZONING', 'ZONE_CODE', 'ZONING_CODE'], textValue),
    topography: firstValue(source, ['TOPOGRAPHY', 'TOPO_DESC'], textValue),
    setbacks: null,
    setbackGeometry: null,
    source: 'arcgis_rest',
    sourceName: serviceInfo.name,
    serviceEndpoint: serviceInfo.endpoint,
    evidenceStatus: 'source_observed',
    surveyStatus: 'not_a_survey',
    disclaimer: 'Cadastral reference geometry only. It is not a boundary survey and must not be used to establish legal boundaries.'
  };
}

function hasObservedListingCoordinates(listing) {
  const provenance = listing?.provenance;
  if (!provenance || typeof provenance !== 'object' || provenance.observed !== true) return false;
  if (provenance.origin === 'snapshot' || provenance.recordKind === 'demo') return false;
  const derived = provenance.derivedFields;
  if (!derived || typeof derived !== 'object') return true;
  return !derived.geocode && !derived.coordinates && !derived.location;
}

async function queryArcGisRest(lat, lng, state) {
  const normalizedState = textValue(state)?.toUpperCase() || null;
  const serviceInfo = normalizedState ? ARCGIS_REGISTRY[normalizedState] : null;
  if (!serviceInfo) {
    throw new ParcelBoundaryError(
      404,
      'PARCEL_SOURCE_UNAVAILABLE',
      normalizedState
        ? `No parcel geometry source is configured for ${normalizedState}.`
        : 'State is required to select a parcel geometry source.'
    );
  }
  if (typeof fetch !== 'function') {
    throw new ParcelBoundaryError(503, 'PARCEL_SOURCE_UNAVAILABLE', 'Parcel geometry service is unavailable.');
  }

  const queryUrl = new URL(serviceInfo.endpoint);
  queryUrl.search = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson'
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(queryUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/geo+json, application/json' }
    });
    if (!response.ok) {
      throw new ParcelBoundaryError(502, 'PARCEL_SOURCE_ERROR', `Parcel source returned HTTP ${response.status}.`);
    }

    const geojson = await response.json();
    if (geojson?.error) {
      throw new ParcelBoundaryError(502, 'PARCEL_SOURCE_ERROR', 'Parcel source rejected the spatial query.');
    }

    const feature = Array.isArray(geojson?.features)
      ? geojson.features.find(candidate => isCadastralGeometry(candidate?.geometry))
      : null;
    if (!feature) {
      throw new ParcelBoundaryError(
        404,
        'PARCEL_GEOMETRY_NOT_FOUND',
        'No source-provided parcel polygon was found at the exact coordinates.'
      );
    }

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: observedProperties(feature.properties, serviceInfo)
    };
  } catch (error) {
    if (error instanceof ParcelBoundaryError) throw error;
    const timedOut = error?.name === 'AbortError';
    throw new ParcelBoundaryError(
      502,
      timedOut ? 'PARCEL_SOURCE_TIMEOUT' : 'PARCEL_SOURCE_ERROR',
      timedOut ? 'Parcel source timed out.' : 'Parcel source could not be reached.'
    );
  } finally {
    clearTimeout(timeout);
  }
}

function sendError(res, error) {
  const status = error instanceof ParcelBoundaryError ? error.status : 500;
  const code = error instanceof ParcelBoundaryError ? error.code : 'PARCEL_BOUNDARY_ERROR';
  const message = error instanceof ParcelBoundaryError ? error.message : 'Parcel boundary lookup failed.';
  return res.status(status).json({ error: message, code, geometry: null });
}

async function handleParcelBoundary(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let params = {};
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    params = Object.fromEntries(url.searchParams.entries());
  } else {
    params = req.body || {};
  }

  try {
    const listingId = params.listingId || params.id;
    const listing = listingId ? await db.getListingById(listingId) : null;
    if (listingId && !listing) {
      throw new ParcelBoundaryError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    const lat = coordinate(params.lat ?? listing?.lat, -90, 90);
    const lng = coordinate(params.lng ?? listing?.lng, -180, 180);
    if (lat === null || lng === null) {
      throw new ParcelBoundaryError(
        422,
        'EXACT_COORDINATES_REQUIRED',
        'Exact source coordinates are required for parcel geometry lookup.'
      );
    }
    if (listing && !hasObservedListingCoordinates(listing)) {
      throw new ParcelBoundaryError(
        422,
        'EXACT_COORDINATES_UNVERIFIED',
        'This listing does not have source-observed coordinates for parcel geometry lookup.'
      );
    }

    const state = textValue(params.state ?? listing?.state);
    if (!state) {
      throw new ParcelBoundaryError(422, 'STATE_REQUIRED', 'State is required for parcel geometry lookup.');
    }

    const parcelFeature = await queryArcGisRest(lat, lng, state);
    return res.json(parcelFeature);
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = handleParcelBoundary;
module.exports.ARCGIS_REGISTRY = ARCGIS_REGISTRY;
module.exports.hasObservedListingCoordinates = hasObservedListingCoordinates;
module.exports.isCadastralGeometry = isCadastralGeometry;
module.exports.observedProperties = observedProperties;
module.exports.queryArcGisRest = queryArcGisRest;
