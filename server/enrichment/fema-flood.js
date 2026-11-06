'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../.cache/fema-flood-cache.json');
const FEMA_NFHL_ENDPOINT = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';

/**
 * Standard High-Risk Special Flood Hazard Area (SFHA) zones.
 * In these zones, federally-backed mortgages mandate flood insurance.
 */
const HIGH_RISK_SFHA_ZONES = new Set(['A', 'AE', 'A1-A30', 'AH', 'AO', 'AR', 'A99', 'V', 'VE', 'V1-V30', 'VO']);
const COASTAL_VELOCITY_ZONES = new Set(['V', 'VE', 'V1-V30', 'VO']);

function normalizeCoordinates(lat, lng) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
  if (nLat < 15 || nLat > 72 || nLng < -180 || nLng > -65) return null;
  // 5 decimals gives ~1.1 meter resolution, ideal for parcel caching
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
    // Non-fatal if corrupted
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
 * Evaluates flood risk category and mandatory insurance requirements.
 */
function evaluateFloodRisk(fldZone, zoneSubtype, sfhaTf) {
  const zone = (fldZone || '').trim().toUpperCase();
  const subty = (zoneSubtype || '').trim().toUpperCase();
  const sfhaFlag = (sfhaTf || '').trim().toUpperCase();

  const isSfha = sfhaFlag === 'T' || HIGH_RISK_SFHA_ZONES.has(zone);
  const isCoastal = COASTAL_VELOCITY_ZONES.has(zone);

  if (isCoastal) {
    return {
      riskTier: 'critical',
      zone,
      subtype: subty || 'COASTAL HIGH HAZARD / VELOCITY WAVE ACTION',
      isSpecialFloodHazardArea: true,
      mandatoryFloodInsurance: true,
      annualProbabilityPct: 1.0,
      description: 'High-risk coastal zone subject to additional velocity wave hazard. Stringent building codes and mandatory NFIP flood insurance apply.'
    };
  }

  if (isSfha) {
    return {
      riskTier: 'high',
      zone,
      subtype: subty || '100-YEAR FLOODPLAIN (1% ANNUAL CHANCE)',
      isSpecialFloodHazardArea: true,
      mandatoryFloodInsurance: true,
      annualProbabilityPct: 1.0,
      description: 'Special Flood Hazard Area (100-year base floodplain). Mandatory flood insurance required by federally regulated lenders.'
    };
  }

  if (zone === 'X' || zone === 'B' || zone === 'C') {
    const is500Year = subty.includes('0.2 PCT') || subty.includes('500') || zone === 'B';
    if (is500Year) {
      return {
        riskTier: 'moderate',
        zone: 'X (Shaded)',
        subtype: subty || '500-YEAR FLOODPLAIN (0.2% ANNUAL CHANCE)',
        isSpecialFloodHazardArea: false,
        mandatoryFloodInsurance: false,
        annualProbabilityPct: 0.2,
        description: 'Moderate flood hazard area between the 100-year and 500-year flood levels. Insurance recommended but not federally mandated.'
      };
    }

    return {
      riskTier: 'minimal',
      zone: 'X (Unshaded)',
      subtype: subty || 'MINIMAL FLOOD HAZARD (OUTSIDE 500-YEAR)',
      isSpecialFloodHazardArea: false,
      mandatoryFloodInsurance: false,
      annualProbabilityPct: 0.05,
      description: 'Area of minimal flood hazard, outside the 0.2% annual chance floodplain. Standard homeowner policies do not cover flood, but risk is minimal.'
    };
  }

  if (zone === 'D') {
    return {
      riskTier: 'undetermined',
      zone: 'D',
      subtype: subty || 'UNDETERMINED FLOOD HAZARD',
      isSpecialFloodHazardArea: false,
      mandatoryFloodInsurance: false,
      annualProbabilityPct: null,
      description: 'Unstudied area where flood hazards are undetermined. Possible risk exists without actuarial rate mapping.'
    };
  }

  return {
    riskTier: 'unknown',
    zone: zone || 'UNKNOWN',
    subtype: subty || 'UNCLASSIFIED',
    isSpecialFloodHazardArea: false,
    mandatoryFloodInsurance: false,
    annualProbabilityPct: null,
    description: 'Flood zone data not classified.'
  };
}

/**
 * Estimates statutory NFIP flood insurance escrow reserve for underwriting models.
 * Zero-fabrication: explicitly marked as assumption basis.
 */
function estimateNfipReserve(riskEvaluation) {
  if (!riskEvaluation) return { estimatedAnnualPremiumReserve: 0, basis: 'published' };

  if (riskEvaluation.riskTier === 'critical') {
    return {
      estimatedAnnualPremiumReserve: 4200,
      basis: 'assumption',
      reason: 'FEMA Coastal Zone V/VE baseline NFIP policy reserve assumption'
    };
  }

  if (riskEvaluation.riskTier === 'high') {
    return {
      estimatedAnnualPremiumReserve: 1950,
      basis: 'assumption',
      reason: 'FEMA SFHA Zone A/AE baseline NFIP policy reserve assumption'
    };
  }

  if (riskEvaluation.riskTier === 'moderate') {
    return {
      estimatedAnnualPremiumReserve: 680,
      basis: 'assumption',
      reason: 'FEMA Zone X Shaded Preferred Risk Policy reserve assumption'
    };
  }

  if (riskEvaluation.riskTier === 'undetermined' || riskEvaluation.zone === 'D') {
    return {
      estimatedAnnualPremiumReserve: 0,
      basis: 'unknown',
      reason: 'Unstudied / undetermined flood zone D; actuarial rate mapping unavailable'
    };
  }

  return {
    estimatedAnnualPremiumReserve: 0,
    basis: 'published',
    reason: 'Minimal flood risk zone; no mandatory flood insurance reserve required'
  };
}

/**
 * Queries the official FEMA NFHL REST FeatureServer endpoint.
 */
async function queryFemaFloodZone({
  lat,
  lng,
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
      floodRisk: null,
      provenance: 'fema-nfhl-spatial-query'
    };
  }

  const key = hashCoords(coords);
  const cache = loadCache(cachePath);
  if (cache[key]?.schemaVersion === 2 && cache[key]) {
    return {
      status: 'success',
      fromCache: true,
      observedAt: cache[key].observedAt,
      coords,
      floodRisk: cache[key].floodRisk,
      nfipReserve: cache[key].nfipReserve,
      rawAttributes: cache[key].rawAttributes,
      provenance: 'fema-nfhl-spatial-query'
    };
  }

  if (typeof fetchFn !== 'function') {
    return {
      status: 'unavailable',
      reason: 'fetch_not_available',
      floodRisk: null,
      provenance: 'fema-nfhl-spatial-query'
    };
  }

  const geomParam = JSON.stringify({
    x: coords.lng,
    y: coords.lat,
    spatialReference: { wkid: 4326 }
  });

  const queryUrl = new URL(FEMA_NFHL_ENDPOINT);
  queryUrl.searchParams.set('geometryType', 'esriGeometryPoint');
  queryUrl.searchParams.set('geometry', geomParam);
  queryUrl.searchParams.set('inSR', '4326');
  queryUrl.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  queryUrl.searchParams.set('outFields', 'FLD_AR_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,V_DATUM,DEPTH,LEN_UNIT');
  queryUrl.searchParams.set('returnGeometry', 'false');
  queryUrl.searchParams.set('f', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(queryUrl.toString(), {
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
        reason: `fema_api_http_${res.status}`,
        floodRisk: null,
        provenance: 'fema-nfhl-spatial-query'
      };
    }

    const json = await res.json();
    if (!json || json.error || !Array.isArray(json.features)) {
      return { status: 'unavailable', reason: 'fema_invalid_response', floodRisk: null, provenance: 'fema-nfhl-spatial-query' };
    }
    const bestFeature = json.features[0]?.attributes;
    if (typeof bestFeature?.FLD_ZONE !== 'string' || !bestFeature.FLD_ZONE.trim()) {
      return { status: 'unavailable', reason: 'fema_zone_not_observed', floodRisk: null, provenance: 'fema-nfhl-spatial-query' };
    }
    const fldZone = bestFeature.FLD_ZONE;
    const zoneSubty = bestFeature ? bestFeature.ZONE_SUBTY : null;
    const sfhaTf = bestFeature ? bestFeature.SFHA_TF : 'F';
    const staticBfe = bestFeature && Number.isFinite(Number(bestFeature.STATIC_BFE)) ? Number(bestFeature.STATIC_BFE) : null;
    const depth = bestFeature && Number.isFinite(Number(bestFeature.DEPTH)) ? Number(bestFeature.DEPTH) : null;

    const floodRisk = evaluateFloodRisk(fldZone, zoneSubty, sfhaTf);
    floodRisk.baseFloodElevation = staticBfe;
    floodRisk.floodDepthFeet = depth;
    floodRisk.verticalDatum = bestFeature ? bestFeature.V_DATUM || null : null;

    const nfipReserve = estimateNfipReserve(floodRisk);

    const record = {
      schemaVersion: 2,
      observedAt: new Date(now).toISOString(),
      floodRisk,
      nfipReserve,
      rawAttributes: bestFeature
    };

    cache[key] = record;
    saveCache(cache, cachePath);

    return {
      status: 'success',
      fromCache: false,
      observedAt: record.observedAt,
      coords,
      floodRisk,
      nfipReserve,
      rawAttributes: bestFeature,
      provenance: 'fema-nfhl-spatial-query'
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      status: 'unavailable',
      reason: err.name === 'AbortError' ? 'fema_api_timeout' : `fema_api_network_error: ${err.message}`,
      floodRisk: null,
      provenance: 'fema-nfhl-spatial-query'
    };
  }
}

module.exports = {
  FEMA_NFHL_ENDPOINT,
  HIGH_RISK_SFHA_ZONES,
  COASTAL_VELOCITY_ZONES,
  normalizeCoordinates,
  evaluateFloodRisk,
  estimateNfipReserve,
  queryFemaFloodZone,
  loadCache,
  saveCache
};
