'use strict';

const { queryFemaFloodZone } = require('./fema-flood');
const { queryEpaHazards } = require('./epa-hazard');
const { queryTerrainSlope } = require('./usgs-terrain');

/**
 * Aggregates all three federal GIS hazard layers into a unified environmental & physical risk dossier.
 */
async function assessFederalHazards({
  lat,
  lng,
  fetchFn = globalThis.fetch,
  timeoutMs = 8000,
  now = Date.now()
} = {}) {
  const [floodResult, epaResult, terrainResult] = await Promise.all([
    queryFemaFloodZone({ lat, lng, fetchFn, timeoutMs, now }),
    queryEpaHazards({ lat, lng, fetchFn, timeoutMs, now }),
    queryTerrainSlope({ lat, lng, fetchFn, timeoutMs, now })
  ]);

  const flags = [];
  let compositeScore = 100;

  // Flood evaluation
  if (floodResult.status === 'success' && floodResult.floodRisk) {
    const fr = floodResult.floodRisk;
    if (fr.riskTier === 'critical') {
      compositeScore -= 40;
      flags.push({
        layer: 'fema_flood',
        severity: 'critical',
        label: `Coastal High Hazard Flood Zone (${fr.zone})`,
        detail: fr.description
      });
    } else if (fr.riskTier === 'high') {
      compositeScore -= 25;
      flags.push({
        layer: 'fema_flood',
        severity: 'high',
        label: `Special Flood Hazard Area 100-Year Floodplain (${fr.zone})`,
        detail: 'Mandatory flood insurance required by federally-regulated mortgagees.'
      });
    } else if (fr.riskTier === 'moderate') {
      compositeScore -= 10;
      flags.push({
        layer: 'fema_flood',
        severity: 'moderate',
        label: `500-Year Floodplain (${fr.zone})`,
        detail: fr.description
      });
    }
  }

  // EPA evaluation
  if (epaResult.status === 'success' && epaResult.environmentalLiability) {
    const el = epaResult.environmentalLiability;
    if (el.liabilityTier === 'critical') {
      compositeScore -= 50;
      flags.push({
        layer: 'epa_superfund',
        severity: 'critical',
        label: 'Active Superfund / SEMS Site within 0.25 Miles',
        detail: el.summary
      });
    } else if (el.liabilityTier === 'high') {
      compositeScore -= 30;
      flags.push({
        layer: 'epa_hazardous',
        severity: 'high',
        label: 'Multiple RCRA / Brownfield Facilities within 0.25 Miles',
        detail: el.summary
      });
    } else if (el.liabilityTier === 'moderate') {
      compositeScore -= 15;
      flags.push({
        layer: 'epa_hazardous',
        severity: 'moderate',
        label: 'EPA Regulated Facility in Proximity',
        detail: el.summary
      });
    }
  }

  // Terrain slope evaluation
  if (terrainResult.status === 'success' && terrainResult.slopeAnalysis) {
    const sl = terrainResult.slopeAnalysis;
    if (sl.classification === 'severe_slope') {
      compositeScore -= 45;
      flags.push({
        layer: 'usgs_terrain',
        severity: 'critical',
        label: `Severe Ravine/Cliff Slope (${sl.slopePct}%)`,
        detail: sl.summary
      });
    } else if (sl.classification === 'steep_slope') {
      compositeScore -= 25;
      flags.push({
        layer: 'usgs_terrain',
        severity: 'high',
        label: `Steep Building Slope (${sl.slopePct}%)`,
        detail: sl.summary
      });
    } else if (sl.classification === 'moderate_slope') {
      compositeScore -= 10;
      flags.push({
        layer: 'usgs_terrain',
        severity: 'moderate',
        label: `Moderate Grade Slope (${sl.slopePct}%)`,
        detail: sl.summary
      });
    }
  }

  compositeScore = Math.max(0, Math.min(100, compositeScore));

  let overallTier = 'minimal_hazard';
  if (compositeScore < 40) overallTier = 'critical_hazard';
  else if (compositeScore < 70) overallTier = 'high_hazard';
  else if (compositeScore < 85) overallTier = 'moderate_hazard';

  return {
    status: (floodResult.status === 'success' || epaResult.status === 'success' || terrainResult.status === 'success') ? 'success' : 'unavailable',
    evaluatedAt: new Date(now).toISOString(),
    compositeScore,
    overallTier,
    flags,
    layers: {
      femaFlood: floodResult,
      epaHazard: epaResult,
      usgsTerrain: terrainResult
    },
    underwritingImpact: {
      nfipAnnualReserve: floodResult.nfipReserve?.estimatedAnnualPremiumReserve || 0,
      phaseOneEsaRequired: epaResult.environmentalLiability?.phaseOneRecommended || false,
      gradingContingencyRequired: terrainResult.slopeAnalysis?.slopePct > 15
    },
    provenance: 'federal-environmental-physical-gis-v1'
  };
}

module.exports = {
  assessFederalHazards
};
