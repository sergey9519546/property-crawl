'use strict';

// test/routes/parcel-boundary-helpers.test.js
//
// Pure-function coverage for the cadastral parcel-boundary helpers exported
// by server/routes/parcel-boundary.js. The HTTP route handler is heavier
// (it issues outbound fetches to the ArcGIS REST layer), but the geometry
// validators, the observed-properties projection, and the hasObservedListing-
// Coordinates gate are all pure functions that benefit from direct unit
// coverage. They back the public "is this geometry trustworthy enough to
// surface?" decision and silent drift in either direction is a real risk:
//   - too loose: we publish polygons that the source never actually returned
//   - too strict: legitimate CAD features get filtered and the UI shows
//     "no parcel data" for properties that the state GIS layer does have
//
// Tests pin:
//   - coordinate(): lat/lng finite-number + range validation
//   - textValue(): null/empty/whitespace handling
//   - numberValue(): positive-only enforcement
//   - firstValue(): null-stop ordering across keys
//   - isPosition() / isClosedRing(): GeoJSON polygon ring contract
//   - isCadastralGeometry(): Polygon + MultiPolygon shape, closes rings
//   - observedProperties(): source-field extraction + derived acre/sqft
//   - hasObservedListingCoordinates(): provenance gate that disqualifies
//     demo / snapshot / geocode-derived listings from showing a boundary

const assert = require('node:assert/strict');
const test = require('node:test');

  const {
  hasObservedListingCoordinates,
  isCadastralGeometry,
  observedProperties,
  ARCGIS_REGISTRY,
  computePolygonMetrics,
  queryArcGisRest,
  resolveBoundaryEndpoints,
} = require('../../server/routes/parcel-boundary');

// --- coordinate / textValue / numberValue are private; exercise through ---
// --- observedProperties which uses all three.                            ---

// --- firstValue (private) exercised indirectly through observedProperties ---

// --- isCadastralGeometry ------------------------------------------------

test('isCadastralGeometry: returns false for non-objects', () => {
  assert.equal(isCadastralGeometry(null), false);
  assert.equal(isCadastralGeometry(undefined), false);
  assert.equal(isCadastralGeometry('Polygon'), false);
  assert.equal(isCadastralGeometry(42), false);
});

test('isCadastralGeometry: rejects Polygon with no rings', () => {
  assert.equal(isCadastralGeometry({ type: 'Polygon', coordinates: [] }), false);
});

test('isCadastralGeometry: rejects Polygon whose outer ring is not closed', () => {
  const unclosed = {
    type: 'Polygon',
    coordinates: [
      [
        [-81.7, 41.5],
        [-81.6, 41.5],
        [-81.6, 41.4],
        [-81.7, 41.4]
        // last point != first point, so unclosed
      ]
    ]
  };
  assert.equal(isCadastralGeometry(unclosed), false);
});

test('isCadastralGeometry: accepts a closed-ring Polygon', () => {
  const closed = {
    type: 'Polygon',
    coordinates: [
      [
        [-81.7, 41.5],
        [-81.6, 41.5],
        [-81.6, 41.4],
        [-81.7, 41.4],
        [-81.7, 41.5]
      ]
    ]
  };
  assert.equal(isCadastralGeometry(closed), true);
});

test('isCadastralGeometry: rejects Polygon with fewer than 4 ring vertices', () => {
  assert.equal(isCadastralGeometry({
    type: 'Polygon',
    coordinates: [[[-81.7, 41.5], [-81.7, 41.5]]], // 2 points, ring not closed
  }), false);
});

test('isCadastralGeometry: rejects Polygon whose positions are out of lat/lng range', () => {
  const bad = {
    type: 'Polygon',
    coordinates: [
      [
        [200, 100],   // invalid lng/lat
        [201, 100],
        [201, 99],
        [200, 99],
        [200, 100]
      ]
    ]
  };
  assert.equal(isCadastralGeometry(bad), false);
});

test('isCadastralGeometry: accepts MultiPolygon whose every ring is closed', () => {
  const ring = [[-81.7, 41.5], [-81.6, 41.5], [-81.6, 41.4], [-81.7, 41.4], [-81.7, 41.5]];
  const multi = {
    type: 'MultiPolygon',
    coordinates: [[ring], [ring]]
  };
  assert.equal(isCadastralGeometry(multi), true);
});

test('isCadastralGeometry: rejects MultiPolygon with one bad ring', () => {
  const goodRing = [[-81.7, 41.5], [-81.6, 41.5], [-81.6, 41.4], [-81.7, 41.4], [-81.7, 41.5]];
  const badRing = [[-81.7, 41.5], [-81.6, 41.5], [-81.6, 41.4], [-81.7, 41.4]];
  const multi = {
    type: 'MultiPolygon',
    coordinates: [[goodRing], [badRing]]
  };
  assert.equal(isCadastralGeometry(multi), false);
});

test('isCadastralGeometry: rejects unknown geometry types', () => {
  assert.equal(isCadastralGeometry({ type: 'LineString', coordinates: [] }), false);
  assert.equal(isCadastralGeometry({ type: 'Point', coordinates: [-81.7, 41.5] }), false);
});

// --- observedProperties -------------------------------------------------

test('observedProperties: returns null parcelId when no known parcel field is present', () => {
  const out = observedProperties({ PARCEL_NO: '', PARCELID: null, PIN: undefined }, ARCGIS_REGISTRY.OH);
  assert.equal(out.parcelId, null);
});

test('observedProperties: extracts parcelId from the first non-empty known key', () => {
  // PARCEL_ID is checked first by the spec; a non-empty value wins.
  const out = observedProperties({ PARCELID: '012-345678' }, ARCGIS_REGISTRY.OH);
  assert.equal(out.parcelId, '012-345678');
});

test('observedProperties: extracts lotSqft from LOT_SQFT when present', () => {
  const out = observedProperties({ LOT_SQFT: 7200 }, ARCGIS_REGISTRY.OH);
  assert.equal(out.lotSqft, 7200);
  assert.equal(out.lotAcres, Number((7200 / 43560).toFixed(4)));
});

test('observedProperties: derives lotSqft from lotAcres when LOT_SQFT is missing', () => {
  const out = observedProperties({ CALC_ACRES: 0.5 }, ARCGIS_REGISTRY.OH);
  assert.equal(out.lotAcres, 0.5);
  assert.equal(out.lotSqft, Math.round(0.5 * 43560));
});

test('observedProperties: derives lotAcres from lotSqft when CALC_ACRES is missing', () => {
  const out = observedProperties({ LOT_SF: 87120 }, ARCGIS_REGISTRY.OH);
  assert.equal(out.lotSqft, 87120);
  assert.equal(out.lotAcres, Number((87120 / 43560).toFixed(4)));
});

test('observedProperties: returns null lot dimensions when neither field is present', () => {
  const out = observedProperties({}, ARCGIS_REGISTRY.OH);
  assert.equal(out.lotSqft, null);
  assert.equal(out.lotAcres, null);
});

test('observedProperties: extracts frontage, depth, zoning, topography from the documented keys', () => {
  const out = observedProperties({
    FRONT_FT: 60,
    DEPTH_FT: 120,
    ZONING: 'R-2',
    TOPOGRAPHY: 'Level'
  }, ARCGIS_REGISTRY.FL);
  assert.equal(out.frontageFt, 60);
  assert.equal(out.depthFt, 120);
  assert.equal(out.zoning, 'R-2');
  assert.equal(out.topography, 'Level');
});

test('observedProperties: rejects non-positive numeric fields', () => {
  // numberValue() requires > 0 so that a parcel with 0 frontage doesn't
  // pretend to be a normal lot. Pin that behavior so a future "value >= 0"
  // change is visible.
  const out = observedProperties({ FRONT_FEET: 0, DEPTH_FEET: -10 }, ARCGIS_REGISTRY.OH);
  assert.equal(out.frontageFt, null);
  assert.equal(out.depthFt, null);
});

test('observedProperties: stamps the source/service/disclaimer fingerprint', () => {
  const out = observedProperties({}, ARCGIS_REGISTRY.OH);
  assert.equal(out.source, 'arcgis_rest');
  assert.equal(out.sourceName, ARCGIS_REGISTRY.OH.name);
  assert.equal(out.serviceEndpoint, ARCGIS_REGISTRY.OH.endpoint);
  assert.equal(out.evidenceStatus, 'source_observed');
  assert.equal(out.surveyStatus, 'not_a_survey');
  assert.match(out.disclaimer, /not a boundary survey/i);
  // The setbacks block is explicitly null — we publish the reference geometry
  // only and never invent setback lines.
  assert.equal(out.setbacks, null);
  assert.equal(out.setbackGeometry, null);
});

test('observedProperties: handles non-object properties argument', () => {
  const out = observedProperties(null, ARCGIS_REGISTRY.OH);
  assert.equal(out.parcelId, null);
  assert.equal(out.lotSqft, null);
  assert.equal(out.zoning, null);
});

// --- hasObservedListingCoordinates -------------------------------------

test('hasObservedListingCoordinates: returns false when provenance is missing', () => {
  assert.equal(hasObservedListingCoordinates({}), false);
  assert.equal(hasObservedListingCoordinates(null), false);
  assert.equal(hasObservedListingCoordinates({ provenance: null }), false);
});

test('hasObservedListingCoordinates: returns false when provenance.observed !== true', () => {
  assert.equal(hasObservedListingCoordinates({ provenance: { observed: false } }), false);
});

test('hasObservedListingCoordinates: returns false for snapshot origin', () => {
  assert.equal(hasObservedListingCoordinates({ provenance: { observed: true, origin: 'snapshot' } }), false);
});

test('hasObservedListingCoordinates: returns false for demo recordKind', () => {
  assert.equal(hasObservedListingCoordinates({ provenance: { observed: true, recordKind: 'demo' } }), false);
});

test('hasObservedListingCoordinates: returns true when observed with no derived fields', () => {
  assert.equal(hasObservedListingCoordinates({ provenance: { observed: true } }), true);
});

test('hasObservedListingCoordinates: returns false when derived.geocode is true', () => {
  assert.equal(hasObservedListingCoordinates({
    provenance: { observed: true, derivedFields: { geocode: true } }
  }), false);
});

test('hasObservedListingCoordinates: returns false when derived.coordinates is set', () => {
  assert.equal(hasObservedListingCoordinates({
    provenance: { observed: true, derivedFields: { coordinates: [-81.7, 41.5] } }
  }), false);
});

test('hasObservedListingCoordinates: returns false when derived.location is set', () => {
  assert.equal(hasObservedListingCoordinates({
    provenance: { observed: true, derivedFields: { location: 'Cleveland, OH' } }
  }), false);
});

test('hasObservedListingCoordinates: returns true when derived fields are empty object', () => {
  assert.equal(hasObservedListingCoordinates({
    provenance: { observed: true, derivedFields: {} }
  }), true);
});

// --- computePolygonMetrics ---------------------------------------------

test('computePolygonMetrics: calculates perimeter and coordinate count for valid Polygon', () => {
  const geom = {
    type: 'Polygon',
    coordinates: [
      [
        [-80.192, 25.761],
        [-80.191, 25.761],
        [-80.191, 25.762],
        [-80.192, 25.762],
        [-80.192, 25.761]
      ]
    ]
  };
  const metrics = computePolygonMetrics(geom);
  assert.equal(metrics.coordinatesCount, 5);
  assert.ok(typeof metrics.perimeterFt === 'number' && metrics.perimeterFt > 0);

  const out = observedProperties({ ACRES: 0.5 }, ARCGIS_REGISTRY.FL, geom);
  assert.equal(out.coordinatesCount, 5);
  assert.equal(out.perimeterFt, metrics.perimeterFt);
  assert.equal(out.lotAcres, 0.5);
});

test('TX statewide registry points to live TxGIO StratMap identify service and parses identify rings', async () => {
  assert.equal(ARCGIS_REGISTRY.TX.operation, 'identify');
  assert.match(ARCGIS_REGISTRY.TX.endpoint, /stratmap_land_parcels_48_most_recent\/MapServer\/identify$/);

  const originalFetch = global.fetch;
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          attributes: { PROP_ID: '468776', GIS_AREA: '0.161463' },
          geometry: {
            rings: [[[-98.426, 29.328], [-98.425, 29.328], [-98.425, 29.329], [-98.426, 29.329], [-98.426, 29.328]]],
          },
        }],
      }),
    };
  };

  try {
    const feature = await queryArcGisRest(29.328126, -98.426009, 'TX', null, null);
    assert.match(capturedUrl, /stratmap_land_parcels_48_most_recent\/MapServer\/identify/);
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'Polygon');
    assert.equal(feature.properties.parcelId, '468776');
    assert.equal(feature.properties.lotAcres, 0.161463);

    await assert.rejects(
      () => queryArcGisRest(null, null, 'TX', '468776', null),
      (err) => err && err.status === 422 && err.code === 'EXACT_COORDINATES_REQUIRED',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('ARCGIS_REGISTRY and resolveBoundaryEndpoints cover all statewide boundary states (CO, NC, NY, WI, CT, AR + OH, FL, TX, NJ)', () => {
  for (const state of ['OH', 'FL', 'TX', 'NJ', 'CO', 'NC', 'NY', 'WI', 'CT', 'AR']) {
    assert.ok(ARCGIS_REGISTRY[state]?.endpoint, `${state} must be registered in ARCGIS_REGISTRY`);
    const candidates = resolveBoundaryEndpoints(state, null);
    assert.equal(candidates.length, 1, `${state} must resolve 1 statewide boundary candidate`);
    assert.equal(candidates[0].endpoint, ARCGIS_REGISTRY[state].endpoint);
  }

  // FL counties without a dedicated polygon layer must skip the Florida centroid-only statewide endpoint
  const flCollier = resolveBoundaryEndpoints('FL', 'Collier');
  assert.equal(flCollier.length, 1);
  assert.equal(flCollier[0].endpoint, ARCGIS_REGISTRY.FL.endpoint);
  assert.doesNotMatch(flCollier[0].endpoint, /Centroid/i);

  // Enrolled county registries (e.g. Maricopa AZ, Cook IL) resolve even without a statewide layer
  const azMaricopa = resolveBoundaryEndpoints('AZ', 'Maricopa');
  assert.equal(azMaricopa.length, 1);
  assert.match(azMaricopa[0].endpoint, /gis\.maricopa\.gov/);

  const ilCook = resolveBoundaryEndpoints('IL', 'Cook');
  assert.equal(ilCook.length, 1);
  assert.match(ilCook[0].endpoint, /datacatalog\.cookcountyil\.gov/);

  // Negative controls: uncovered states, unenrolled counties, and non-ArcGIS CKAN registries resolve empty
  assert.deepEqual(resolveBoundaryEndpoints('WY', null), []);
  assert.deepEqual(resolveBoundaryEndpoints('CA', 'Modoc'), []);
  assert.deepEqual(resolveBoundaryEndpoints('PA', 'Allegheny'), []);
});

test('queryArcGisRest queries statewide CO/NC/NY/WI/CT/AR and enrolled county endpoints and fails closed on non-polygon or uncovered requests', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const sampleRing = [[[-104.991, 39.739], [-104.990, 39.739], [-104.990, 39.740], [-104.991, 39.740], [-104.991, 39.739]]];

  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed);
    if (parsed.hostname.includes('cagisonline.hamilton-co.org')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-84.512, 39.103] }, properties: { PARCELID: 'HAM-1' } }],
        }),
      };
    }
    if (parsed.hostname.includes('gis.colorado.gov')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [{
            attributes: { parcel_id: 'CO-DEN-1', ACRES: 0.2 },
            geometry: { rings: sampleRing },
          }],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: sampleRing },
          properties: { parcelid: 'PARCEL-OK', PARCELID: 'OH-FALLBACK-1', PIN: 'COOK-1', APN: 'MARICOPA-1', ACRES: 0.25 },
        }],
      }),
    };
  };

  try {
    // Positive: statewide CO with ArcGIS rings normalization and standard query parameters
    const coFeature = await queryArcGisRest(39.7392, -104.9903, 'CO', null, null);
    assert.equal(coFeature.geometry.type, 'Polygon');
    assert.equal(coFeature.properties.parcelId, 'CO-DEN-1');
    const coUrl = requests[0];
    assert.equal(coUrl.searchParams.get('geometryType'), 'esriGeometryPoint');
    assert.equal(coUrl.searchParams.get('returnGeometry'), 'true');
    assert.equal(coUrl.searchParams.get('outSR'), '4326');
    assert.equal(coUrl.searchParams.get('f'), 'geojson');

    // Positive: statewide NC, WI, CT, AR and enrolled counties AZ-MARICOPA, IL-COOK
    for (const [lat, lng, state, county] of [
      [35.7796, -78.6382, 'NC', null],
      [43.0731, -89.4012, 'WI', null],
      [41.7658, -72.6734, 'CT', null],
      [34.7465, -92.2896, 'AR', null],
      [33.4484, -112.0740, 'AZ', 'Maricopa'],
      [41.8781, -87.6298, 'IL', 'Cook'],
    ]) {
      const feature = await queryArcGisRest(lat, lng, state, null, county);
      assert.equal(feature.geometry.type, 'Polygon');
    }

    // Positive: centroid-only county endpoint (OH-HAMILTON) falls back to OGRIP statewide polygons
    const ohFallback = await queryArcGisRest(39.1031, -84.5120, 'OH', null, 'Hamilton');
    assert.equal(ohFallback.geometry.type, 'Polygon');
    assert.equal(ohFallback.properties.serviceEndpoint, ARCGIS_REGISTRY.OH.endpoint);

    // Negative: uncovered state, unenrolled county, and non-ArcGIS registry reject 404 PARCEL_SOURCE_UNAVAILABLE
    for (const [state, county] of [['WY', null], ['CA', 'Modoc'], ['PA', 'Allegheny']]) {
      await assert.rejects(
        () => queryArcGisRest(40.0, -80.0, state, null, county),
        (err) => err && err.status === 404 && err.code === 'PARCEL_SOURCE_UNAVAILABLE',
      );
    }

    // Negative: Point-only response in a state without statewide polygon fallback throws PARCEL_GEOMETRY_NOT_FOUND
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-112.074, 33.448] }, properties: {} }],
      }),
    });
    await assert.rejects(
      () => queryArcGisRest(33.4484, -112.0740, 'AZ', null, 'Maricopa'),
      (err) => err && err.status === 404 && err.code === 'PARCEL_GEOMETRY_NOT_FOUND',
    );
  } finally {
    global.fetch = originalFetch;
  }
});
