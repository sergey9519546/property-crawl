'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  evaluateFloodRisk,
  estimateNfipReserve,
  queryFemaFloodZone,
  normalizeCoordinates: normFlood
} = require('../../server/enrichment/fema-flood');

const {
  evaluateEnvironmentalLiability,
  haversineMiles,
  queryEpaHazards,
  normalizeCoordinates: normEpa
} = require('../../server/enrichment/epa-hazard');

const {
  classifySlope,
  queryTerrainSlope,
  normalizeCoordinates: normTerrain
} = require('../../server/enrichment/usgs-terrain');

const { assessFederalHazards } = require('../../server/enrichment/federal-hazards');

const TEMP_CACHE_DIR = path.resolve(__dirname, '../../.cache/test-hazard-gis');

test.beforeEach(() => {
  if (fs.existsSync(TEMP_CACHE_DIR)) {
    fs.rmSync(TEMP_CACHE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_CACHE_DIR, { recursive: true });
});

test.afterEach(() => {
  if (fs.existsSync(TEMP_CACHE_DIR)) {
    fs.rmSync(TEMP_CACHE_DIR, { recursive: true, force: true });
  }
});

test('FEMA Flood: Coordinate normalization and boundary checks', () => {
  assert.equal(normFlood(null, -80.1), null);
  assert.equal(normFlood(10, -80.1), null); // Below 15 deg N
  assert.equal(normFlood(85, -80.1), null); // Above 72 deg N
  assert.deepEqual(normFlood(25.7616789, -80.1917891), {
    lat: 25.76168,
    lng: -80.19179
  });
});

test('FEMA Flood: Evaluates Coastal Velocity Zones (VE/V)', () => {
  const risk = evaluateFloodRisk('VE', 'COASTAL HIGH HAZARD', 'T');
  assert.equal(risk.riskTier, 'critical');
  assert.equal(risk.isSpecialFloodHazardArea, true);
  assert.equal(risk.mandatoryFloodInsurance, true);

  const reserve = estimateNfipReserve(risk);
  assert.equal(reserve.estimatedAnnualPremiumReserve, 4200);
  assert.equal(reserve.basis, 'assumption');
});

test('FEMA Flood: Evaluates 100-Year Base Floodplain (AE/A)', () => {
  const risk = evaluateFloodRisk('AE', '', 'T');
  assert.equal(risk.riskTier, 'high');
  assert.equal(risk.isSpecialFloodHazardArea, true);
  assert.equal(risk.mandatoryFloodInsurance, true);

  const reserve = estimateNfipReserve(risk);
  assert.equal(reserve.estimatedAnnualPremiumReserve, 1950);
});

test('FEMA Flood: Evaluates 500-Year Moderate Flood Zone (X Shaded)', () => {
  const risk = evaluateFloodRisk('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', 'F');
  assert.equal(risk.riskTier, 'moderate');
  assert.equal(risk.isSpecialFloodHazardArea, false);
  assert.equal(risk.mandatoryFloodInsurance, false);

  const reserve = estimateNfipReserve(risk);
  assert.equal(reserve.estimatedAnnualPremiumReserve, 680);
});

test('FEMA Flood: Evaluates Minimal Flood Zone (X Unshaded)', () => {
  const risk = evaluateFloodRisk('X', 'AREA OF MINIMAL FLOOD HAZARD', 'F');
  assert.equal(risk.riskTier, 'minimal');
  assert.equal(risk.isSpecialFloodHazardArea, false);
  assert.equal(risk.mandatoryFloodInsurance, false);

  const reserve = estimateNfipReserve(risk);
  assert.equal(reserve.estimatedAnnualPremiumReserve, 0);
  assert.equal(reserve.basis, 'published');
});

test('FEMA Flood: Spatial query returns mock attributes and caches', async () => {
  const testCache = path.join(TEMP_CACHE_DIR, 'fema-test-cache.json');
  let fetchCalled = 0;

  const mockFetch = async () => {
    fetchCalled++;
    return {
      ok: true,
      json: async () => ({
        features: [
          {
            attributes: {
              FLD_ZONE: 'AE',
              ZONE_SUBTY: '1 PCT ANNUAL CHANCE FLOOD HAZARD',
              SFHA_TF: 'T',
              STATIC_BFE: 14.5,
              V_DATUM: 'NAVD88',
              DEPTH: null
            }
          }
        ]
      })
    };
  };

  const res1 = await queryFemaFloodZone({
    lat: 29.951065,
    lng: -90.071533,
    cachePath: testCache,
    fetchFn: mockFetch
  });

  assert.equal(res1.status, 'success');
  assert.equal(res1.fromCache, false);
  assert.equal(res1.floodRisk.riskTier, 'high');
  assert.equal(res1.floodRisk.baseFloodElevation, 14.5);
  assert.equal(fetchCalled, 1);

  // Subsequent call should hit cache
  const res2 = await queryFemaFloodZone({
    lat: 29.951065,
    lng: -90.071533,
    cachePath: testCache,
    fetchFn: mockFetch
  });

  assert.equal(res2.status, 'success');
  assert.equal(res2.fromCache, true);
  assert.equal(res2.floodRisk.baseFloodElevation, 14.5);
  assert.equal(fetchCalled, 1);
});

test('FEMA Flood: Unmapped rural area with empty features returns Zone D undetermined risk', async () => {
  const testCache = path.join(TEMP_CACHE_DIR, 'fema-unmapped-cache.json');
  const emptyFeaturesFetch = async () => ({
    ok: true,
    json: async () => ({ features: [] })
  });

  const res = await queryFemaFloodZone({
    lat: 38.8951,
    lng: -77.0364,
    cachePath: testCache,
    fetchFn: emptyFeaturesFetch
  });

  assert.equal(res.status, 'success');
  assert.equal(res.floodRisk.riskTier, 'undetermined');
  assert.equal(res.floodRisk.zone, 'D');
  assert.equal(res.floodRisk.subtype, 'UNSTUDIED / UNMAPPED AREA');
  assert.equal(res.nfipReserve.basis, 'unknown');
  assert.equal(res.nfipReserve.estimatedAnnualPremiumReserve, 0);
});

test('FEMA Flood: Network error fails closed without fabricating zone', async () => {
  const testCache = path.join(TEMP_CACHE_DIR, 'fema-fail-cache.json');
  const failingFetch = async () => {
    throw new Error('Connection refused');
  };

  const res = await queryFemaFloodZone({
    lat: 29.951,
    lng: -90.071,
    cachePath: testCache,
    fetchFn: failingFetch
  });

  assert.equal(res.status, 'unavailable');
  assert.match(res.reason, /fema_api_network_error/);
  assert.equal(res.floodRisk, null);
});

test('EPA Hazard: Haversine distance calculation is accurate', () => {
  // ~1 mile distance between two points
  const dist = haversineMiles(40.7128, -74.006, 40.7272, -74.006);
  assert.ok(dist > 0.9 && dist < 1.1, `Expected ~1.0 mile, got ${dist}`);
});

test('EPA Hazard: Detects Superfund (SEMS) critical liability', () => {
  const facilities = [
    {
      registryId: '110000000001',
      name: 'Metropolitan Chemical Superfund Site',
      distanceMiles: 0.12,
      programAcronyms: ['SEMS', 'SUPERFUND']
    }
  ];

  const evalResult = evaluateEnvironmentalLiability(facilities);
  assert.equal(evalResult.liabilityTier, 'critical');
  assert.equal(evalResult.score, 20);
  assert.equal(evalResult.phaseOneRecommended, true);
  assert.match(evalResult.summary, /CRITICAL ENVIRONMENTAL RISK/);
});

test('EPA Hazard: Evaluates multiple Brownfield/RCRA facilities as high liability', () => {
  const facilities = [
    {
      registryId: '110000000002',
      name: 'Industrial Metal Plating',
      distanceMiles: 0.15,
      programAcronyms: ['RCRAINFO']
    },
    {
      registryId: '110000000003',
      name: 'Former Rail Yard Brownfield',
      distanceMiles: 0.22,
      programAcronyms: ['ACRES']
    }
  ];

  const evalResult = evaluateEnvironmentalLiability(facilities);
  assert.equal(evalResult.liabilityTier, 'high');
  assert.equal(evalResult.score, 50);
  assert.equal(evalResult.phaseOneRecommended, true);
});

test('EPA Hazard: Clean vicinity scores 100 with minimal tier', () => {
  const evalResult = evaluateEnvironmentalLiability([]);
  assert.equal(evalResult.liabilityTier, 'minimal');
  assert.equal(evalResult.score, 100);
  assert.equal(evalResult.phaseOneRecommended, false);
});

test('EPA Hazard: Spatial query handles API response and caches', async () => {
  const testCache = path.join(TEMP_CACHE_DIR, 'epa-test-cache.json');
  let fetchCalled = 0;

  const mockFetch = async () => {
    fetchCalled++;
    return {
      ok: true,
      json: async () => ({
        Facility: [
          {
            RegistryId: '110001234567',
            PrimaryName: 'Acme Chemical Processing',
            LocationAddress: '100 Industrial Way',
            Latitude83: 39.7392,
            Longitude83: -104.9903,
            ProgramSysAcronyms: 'RCRAINFO, TRIS'
          }
        ]
      })
    };
  };

  const res = await queryEpaHazards({
    lat: 39.7392,
    lng: -104.9903,
    cachePath: testCache,
    fetchFn: mockFetch
  });

  assert.equal(res.status, 'success');
  assert.equal(res.fromCache, false);
  assert.equal(res.environmentalLiability.liabilityTier, 'moderate');
  assert.equal(res.facilities.length, 1);
});

test('USGS Terrain: Classifies slope categories accurately', () => {
  // 3 meters rise over 60 meters run = 5% -> gentle
  const gentle = classifySlope(3, 60);
  assert.equal(gentle.classification, 'flat_to_gentle');
  assert.equal(gentle.score, 100);
  assert.equal(gentle.slopePct, 5);

  // 7 meters rise over 60 meters run = 11.7% -> moderate
  const mod = classifySlope(7, 60);
  assert.equal(mod.classification, 'moderate_slope');
  assert.equal(mod.score, 80);

  // 12 meters rise over 60 meters run = 20% -> steep
  const steep = classifySlope(12, 60);
  assert.equal(steep.classification, 'steep_slope');
  assert.equal(steep.score, 50);

  // 20 meters rise over 60 meters run = 33.3% -> severe
  const severe = classifySlope(20, 60);
  assert.equal(severe.classification, 'severe_slope');
  assert.equal(severe.score, 20);
});

test('USGS Terrain: 5-point elevation query calculates slope gradient and caches', async () => {
  const testCache = path.join(TEMP_CACHE_DIR, 'usgs-test-cache.json');
  let fetchCalls = 0;

  const mockFetch = async (url) => {
    fetchCalls++;
    const u = new URL(url);
    const y = Number(u.searchParams.get('y'));
    // Simulate a hillside: elevation increases with latitude
    const elev = 500 + (y - 34.05) * 10000;
    return {
      ok: true,
      json: async () => ({ value: elev })
    };
  };

  const res = await queryTerrainSlope({
    lat: 34.0522,
    lng: -118.2437,
    offsetMeters: 30,
    cachePath: testCache,
    fetchFn: mockFetch
  });

  assert.equal(res.status, 'success');
  assert.equal(res.samples.length, 5);
  assert.ok(res.slopeAnalysis.slopePct >= 0);
  assert.equal(fetchCalls, 5);

  // Cache test
  const resCached = await queryTerrainSlope({
    lat: 34.0522,
    lng: -118.2437,
    cachePath: testCache,
    fetchFn: mockFetch
  });
  assert.equal(resCached.status, 'success');
  assert.equal(resCached.fromCache, true);
  assert.equal(fetchCalls, 5); // No additional calls
});

test('Federal Hazards: Composite aggregator synthesizes layers and impacts', async () => {
  const mockFetch = async (url) => {
    if (url.includes('hazards.fema.gov')) {
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              attributes: {
                FLD_ZONE: 'AE',
                SFHA_TF: 'T',
                STATIC_BFE: 12.0
              }
            }
          ]
        })
      };
    }
    if (url.includes('data.epa.gov')) {
      return {
        ok: true,
        json: async () => ({
          Facility: [
            {
              PrimaryName: 'Safe Storage',
              ProgramSysAcronyms: 'AIR'
            }
          ]
        })
      };
    }
    if (url.includes('epqs.nationalmap.gov')) {
      return {
        ok: true,
        json: async () => ({ value: 150 })
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await assessFederalHazards({
    lat: 29.95,
    lng: -90.07,
    fetchFn: mockFetch
  });

  assert.equal(result.status, 'success');
  assert.equal(result.layers.femaFlood.floodRisk.riskTier, 'high');
  assert.equal(result.underwritingImpact.nfipAnnualReserve, 1950);
  assert.equal(result.underwritingImpact.phaseOneEsaRequired, false);
  assert.equal(result.underwritingImpact.gradingContingencyRequired, false);
  assert.ok(result.compositeScore < 100);
});
