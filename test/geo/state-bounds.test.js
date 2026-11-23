'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  STATE_BBOX,
  TERRITORY_BBOX,
  STATE_BOUNDS,
  isCoordInStateBounds,
  isConusCoord,
  detectCoincidentCoordPoison,
} = require('../../server/geo/state-bounds');
const { sanitizeListingForIngestion, validateListingForIngestion } = require('../../server/scrapers/validation');

test('STATE_BBOX, TERRITORY_BBOX, and STATE_BOUNDS cover all 50 states, DC, and 5 US territories', () => {
  assert.equal(Object.keys(STATE_BBOX).length, 51);
  assert.deepEqual(Object.keys(TERRITORY_BBOX).sort(), ['AS', 'GU', 'MP', 'PR', 'VI']);
  assert.equal(Object.keys(STATE_BOUNDS).length, 56);
});

test('isCoordInStateBounds accepts valid states, border cushion, DC, and AK antimeridian box', () => {
  // Ellerslie, MD border town (~0.001 deg near PA line) passes within 0.08° state cushion
  assert.equal(isCoordInStateBounds(39.7209, -78.782, 'MD').ok, true);
  // Washington, DC inside tight 0.03° cushion
  assert.equal(isCoordInStateBounds(38.8977, -77.0365, 'DC').ok, true);
  // Outside DC tight cushion
  assert.equal(isCoordInStateBounds(38.70, -77.20, 'DC').ok, false);
  // Alaska eastern hemisphere Aleutians
  assert.equal(isCoordInStateBounds(52.8, 173.1, 'AK').ok, true);
  // Puerto Rico territory
  assert.equal(isCoordInStateBounds(18.4655, -66.1057, 'PR').ok, true);
});

test('isCoordInStateBounds rejects observed production cross-state / foreign poison coords', () => {
  // Edinburgh, Scotland on a Georgia listing
  const gaScotland = isCoordInStateBounds(55.953252, -3.188267, 'GA');
  assert.equal(gaScotland.ok, false);
  assert.match(gaScotland.reason, /coords_outside_state_bbox/);

  // Washington DC on a New York listing
  assert.equal(isCoordInStateBounds(38.9071923, -77.0368707, 'NY').ok, false);
  // Madison WI on a Missouri listing
  assert.equal(isCoordInStateBounds(43.0721661, -89.4007501, 'MO').ok, false);
  // Null island & invalid states
  assert.equal(isCoordInStateBounds(0, 0, 'NJ').ok, false);
  assert.equal(isCoordInStateBounds(40.95, -74.03, '').ok, false);
  assert.equal(isCoordInStateBounds(40.95, -74.03, 'US').ok, false);
});

test('isConusCoord gates CONUS-only datasets (USDA NAIP) away from HI, AK, PR', () => {
  assert.equal(isConusCoord(40.7357, -74.1724), true); // Newark, NJ
  assert.equal(isConusCoord(25.7617, -80.1918), true); // Miami, FL
  assert.equal(isConusCoord(21.3069, -157.8583), false); // Honolulu, HI
  assert.equal(isConusCoord(61.2181, -149.9003), false); // Anchorage, AK
  assert.equal(isConusCoord(18.4655, -66.1057), false); // San Juan, PR
  assert.equal(isConusCoord(NaN, -74.0), false);
});

test('detectCoincidentCoordPoison flags 3 distinct buildings at one point but spares multi-unit condos', () => {
  const poisoned = detectCoincidentCoordPoison([
    { address: '101 Pine St', zip: '30303', state: 'GA', lat: 33.749, lng: -84.388 },
    { address: '202 Oak Ave', zip: '30303', state: 'GA', lat: 33.749, lng: -84.388 },
    { address: '303 Maple Rd', zip: '30303', state: 'GA', lat: 33.749, lng: -84.388 },
  ]);
  assert.equal(poisoned.has('33.74900,-84.38800'), true);

  const multiUnitCondo = detectCoincidentCoordPoison([
    { address: '100 Main St Apt 1A', zip: '07656', state: 'NJ', lat: 40.95, lng: -74.03 },
    { address: '100 Main St Unit 2B', zip: '07656', state: 'NJ', lat: 40.95, lng: -74.03 },
    { address: '100 Main St #3C', zip: '07656', state: 'NJ', lat: 40.95, lng: -74.03 },
    { address: '100 Main St Ste 4', zip: '07656', state: 'NJ', lat: 40.95, lng: -74.03 },
  ]);
  assert.equal(multiUnitCondo.size, 0);
});

test('sanitizeListingForIngestion strips out-of-state coords while preserving out-of-range WGS84 rejection', () => {
  const base = {
    id: 'SERV-GA-1',
    source: 'servicelink',
    state: 'GA',
    address: '101 Peachtree St, Atlanta, GA 30303',
    sourceUrl: 'https://www.servicelinkauction.com/property/101',
    sourceObservedAt: '2026-09-03T10:00:00Z',
    raw: 'Sample live property notice text with sufficient detail for ingestion check.',
    provenance: {
      origin: 'live',
      observed: true,
      observedAt: '2026-09-03T10:00:00Z',
      publisher: 'ServiceLink',
      recordId: '101',
      coordinates: { lat: 55.953252, lng: -3.188267 },
    },
  };

  const sanitizedBadState = sanitizeListingForIngestion({ ...base, lat: 55.953252, lng: -3.188267 });
  assert.equal(sanitizedBadState.lat, null);
  assert.equal(sanitizedBadState.lng, null);
  assert.equal(sanitizedBadState.provenance.coordinates, undefined);
  assert.equal(sanitizedBadState.provenance.coordinatesRejected.state, 'GA');
  assert.match(sanitizedBadState.provenance.coordinatesRejected.reason, /coords_outside_state_bbox/);

  // Out-of-range WGS84 must still be caught and rejected by validateListingForIngestion
  const invalidRangeResult = validateListingForIngestion({ ...base, lat: 120, lng: -84.38 });
  assert.equal(invalidRangeResult.isValid, false);
});
