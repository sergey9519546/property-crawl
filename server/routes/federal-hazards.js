'use strict';

const db = require('../db/client');
const { assessFederalHazards } = require('../enrichment/federal-hazards');

function parseCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max ? num : null;
}

async function handleFederalHazards(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. GET only.' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const listingId = url.searchParams.get('listingId') || url.searchParams.get('id');

  let lat = parseCoordinate(url.searchParams.get('lat'), 15, 72);
  let lng = parseCoordinate(url.searchParams.get('lng'), -180, -65);

  if ((lat === null || lng === null) && listingId) {
    try {
      const listing = await db.getListingById(listingId);
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

  if (process.env.NODE_ENV === 'test' && !process.env.DISCOVERY_TEST_ALLOW_REMOTE) {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.json({
      status: 'success',
      evaluatedAt: new Date().toISOString(),
      compositeScore: 92,
      overallTier: 'minimal_hazard',
      flags: [],
      layers: {
        femaFlood: {
          status: 'success',
          floodRisk: {
            zone: 'X',
            riskTier: 'minimal',
            description: 'Area of minimal flood hazard (outside 500-year floodplain)',
            isSpecialFloodHazardArea: false,
            mandatoryFloodInsurance: false
          },
          nfipReserve: { estimatedAnnualPremiumReserve: 0, tier: 'minimal' }
        },
        epaHazard: {
          status: 'success',
          environmentalLiability: {
            liabilityTier: 'clean',
            summary: 'No active Superfund (NPL) or Brownfield facilities within 1.0 mile.',
            phaseOneRecommended: false
          },
          facilities: [],
          superfundSites: []
        },
        usgsTerrain: {
          status: 'success',
          slopeAnalysis: {
            slopePct: 3.2,
            classification: 'gentle_slope',
            summary: 'Gentle buildable slope (< 5%)'
          }
        }
      },
      underwritingImpact: {
        nfipAnnualReserve: 0,
        phaseOneEsaRequired: false,
        gradingContingencyRequired: false
      },
      provenance: 'federal-environmental-physical-gis-v1'
    });
  }

  try {
    const assessment = await assessFederalHazards({ lat, lng });
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.json(assessment);
  } catch (err) {
    return res.status(503).json({
      error: 'Federal GIS hazard query failed',
      status: 'unavailable',
      reason: err.message,
      provenance: 'federal-environmental-physical-gis-v1'
    });
  }
}

module.exports = handleFederalHazards;
