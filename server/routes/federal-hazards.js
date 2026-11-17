'use strict';

const db = require('../db/client');
const { assessFederalHazards } = require('../enrichment/federal-hazards');

function parseCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max ? num : null;
}

function createFederalHazardsHandler({ database = db, assess = assessFederalHazards } = {}) {
  const coordCache = new Map();
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const MISS_TTL_MS = 2 * 60 * 1000;
  return async function handleFederalHazards(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. GET only.' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const listingId = url.searchParams.get('listingId') || url.searchParams.get('id');

  let lat = parseCoordinate(url.searchParams.get('lat'), 15, 72);
  let lng = parseCoordinate(url.searchParams.get('lng'), -180, -65);

  if ((lat === null || lng === null) && listingId) {
    try {
      const listing = await database.getListingById(listingId);
      if (listing) {
        if (lat === null) lat = parseCoordinate(listing.lat, 15, 72);
        if (lng === null) lng = parseCoordinate(listing.lng, -180, -65);
      }
    } catch {
      // Non-fatal, proceed with coordinate check
    }
  }

  if (lat === null || lng === null) {
    return res.status(400).json({
      error: 'Valid US geographic coordinates (lat, lng) or valid listingId required.',
      status: 'unavailable',
      reason: 'missing_coordinates',
      provenance: 'federal-environmental-physical-gis-v1'
    });
  }


  const cacheKey = `${lat.toFixed(3)}:${lng.toFixed(3)}`;
  const forceRefresh = url.searchParams.get('refresh') === '1';
  if (!forceRefresh) {
    const cached = coordCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader('Cache-Control', cached.assessment.status === 'success' ? 'public, max-age=86400, stale-while-revalidate=604800' : 'no-store');
      return res.status(cached.assessment.status === 'unavailable' ? 503 : 200).json(cached.assessment);
    }
  }

  try {
    const assessment = await assess({ lat, lng });
    if (coordCache.size >= 500) {
      const oldestKey = coordCache.keys().next().value;
      if (oldestKey !== undefined) coordCache.delete(oldestKey);
    }
    coordCache.set(cacheKey, {
      assessment,
      expiresAt: Date.now() + (assessment.status === 'unavailable' ? MISS_TTL_MS : CACHE_TTL_MS),
    });
    res.setHeader('Cache-Control', assessment.status === 'success' ? 'public, max-age=86400, stale-while-revalidate=604800' : 'no-store');
    return res.status(assessment.status === 'unavailable' ? 503 : 200).json(assessment);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      error: 'Federal GIS hazard query failed',
      status: 'unavailable',
      reason: err.message,
      provenance: 'federal-environmental-physical-gis-v1'
    });
  }
};
}

module.exports = createFederalHazardsHandler();
module.exports.createFederalHazardsHandler = createFederalHazardsHandler;
