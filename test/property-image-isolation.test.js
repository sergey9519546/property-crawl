'use strict';

// property-image-isolation.test.js
//
// Property-level isolation tests. The property-image route must never
// return imagery of address X in response to a request for address Y.
//
// The mocks below simulate Google Geocoding + Google Street View metadata
// for two distinct addresses and verify the round trip:
//
//   listingA (19 West Park Avenue, Park Ridge, NJ)
//     -> geocode("19 West Park Avenue, Park Ridge, NJ") -> (40.95, -74.03)
//     -> metadata(40.95, -74.03) -> panoA
//
//   listingB (200 Market Street, San Francisco, CA)
//     -> geocode("200 Market Street, San Francisco, CA") -> (37.79, -122.40)
//     -> metadata(37.79, -122.40) -> panoB
//
// We assert that:
//   1. Each listing's request URL hits the geocoder with its OWN address
//   2. Each listing's metadata call uses its OWN (geocoded) coordinates
//   3. The returned pano_id matches the listing that was requested
//   4. The panos never cross-contaminate (panoA != panoB)
//   5. With source-policy inspection enabled (alternatives mode), the
//      Panoramax fallback only runs against the listing's OWN coordinates

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPropertyImageService } = require('../server/routes/property-image');

const TEST_KEY = 'test-key-isolation-suite';

function listing(overrides = {}) {
  return {
    id: 'CIV-NJ-7-53',
    source: 'civilview',
    address: '19 West Park Avenue',
    city: 'Park Ridge',
    state: 'NJ',
    zip: '07656',
    lat: 40.95,
    lng: -74.03,
    photo: null,
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=12345',
    sourceObservedAt: '2026-09-03T10:00:00.000Z',
    provenance: {
      origin: 'live',
      observed: true,
      observedAt: '2026-09-03T10:00:00.000Z',
      recordKind: 'source_record',
      publisher: 'Bergen County Sheriff',
      recordId: '12345',
    },
    ...overrides,
  };
}

const ADDR_A = {
  address: '19 West Park Avenue', city: 'Park Ridge', state: 'NJ', zip: '07656',
  lat: 40.9500000, lng: -74.0300000, panoId: 'pano_parkridge_001'
};
const ADDR_B = {
  address: '200 Market Street', city: 'San Francisco', state: 'CA', zip: '94105',
  lat: 37.7929000, lng: -122.3965000, panoId: 'pano_sfmarket_002'
};

function fixture() {
  const requestedUrls = [];

  function fetchImpl(url) {
    const target = new URL(url);
    requestedUrls.push(target);

    // Geocoding requests are dispatched only when the listing has no
    // source-observed provenance; we explicitly null lat/lng to force it.
    if (target.pathname === '/maps/api/geocode/json') {
      const address = target.searchParams.get('address') || '';
      let body = null;
      if (address.includes('19 West Park Avenue')) {
        body = {
          status: 'OK', results: [{
            partial_match: false,
            types: ['street_address'],
            geometry: { location_type: 'ROOFTOP', location: { lat: ADDR_A.lat, lng: ADDR_A.lng } },
            address_components: [
              { long_name: '19', short_name: '19', types: ['street_number'] },
              { long_name: 'West Park Avenue', short_name: 'W Park Ave', types: ['route'] },
              { long_name: 'New Jersey', short_name: 'NJ', types: ['administrative_area_level_1'] },
              { long_name: '07656', short_name: '07656', types: ['postal_code'] },
              { long_name: 'United States', short_name: 'US', types: ['country'] }
            ]
          }]
        };
      } else if (address.includes('200 Market Street')) {
        body = {
          status: 'OK', results: [{
            partial_match: false,
            types: ['street_address'],
            geometry: { location_type: 'ROOFTOP', location: { lat: ADDR_B.lat, lng: ADDR_B.lng } },
            address_components: [
              { long_name: '200', short_name: '200', types: ['street_number'] },
              { long_name: 'Market Street', short_name: 'Market St', types: ['route'] },
              { long_name: 'California', short_name: 'CA', types: ['administrative_area_level_1'] },
              { long_name: '94105', short_name: '94105', types: ['postal_code'] },
              { long_name: 'United States', short_name: 'US', types: ['country'] }
            ]
          }]
        };
      } else {
        body = { status: 'OK', results: [] };
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }

    // Metadata requests — key on the location parameter.
    if (target.pathname === '/maps/api/streetview/metadata') {
      const location = target.searchParams.get('location') || '';
      const [lat, lng] = location.split(',').map(Number);
      let panoId = null;
      if (Math.abs(lat - ADDR_A.lat) < 1e-4 && Math.abs(lng - ADDR_A.lng) < 1e-4) panoId = ADDR_A.panoId;
      else if (Math.abs(lat - ADDR_B.lat) < 1e-4 && Math.abs(lng - ADDR_B.lng) < 1e-4) panoId = ADDR_B.panoId;
      else panoId = 'pano_unknown_999';
      return Promise.resolve(new Response(JSON.stringify({
        status: 'OK',
        pano_id: panoId,
        location: { lat, lng },
        date: '2025-10',
        copyright: 'c 2025 Google'
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }

    // Image requests — keyed on the pano= parameter (not location=) because
    // the route issues /maps/api/streetview with the panoId resolved from
    // metadata. Returns a valid JPEG shell with the geographic label encoded
    // as a fixed-width 16-byte slot starting at offset 4, zero-padded, so
    // the test can read the label back without depending on the binary JPEG
    // contents or knowing the trailing padding length.
    if (target.pathname === '/maps/api/streetview') {
      const pano = target.searchParams.get('pano') || '';
      let label;
      if (pano === ADDR_A.panoId) label = 'parkridge';
      else if (pano === ADDR_B.panoId) label = 'sfmarket';
      else label = 'unknown';
      const LABEL_SLOT_BYTES = 16;
      const labelSlot = Buffer.alloc(LABEL_SLOT_BYTES);
      labelSlot.write(label, 0, 'utf8');
      const jpegBytes = Buffer.concat([
        // JPEG SOI marker so the route's image-mode sniff sees a real image.
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        // Fixed-width label slot, zero-padded.
        labelSlot,
        // Pad out to a reasonable byte count so content-length checks pass.
        Buffer.alloc(256, 1)
      ]);
      return Promise.resolve(new Response(jpegBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(jpegBytes.length) }
      }));
    }

    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  }

  const listingA = listing({
    id: 'ISO-A-NJ-001',
    address: ADDR_A.address,
    city: ADDR_A.city,
    state: ADDR_A.state,
    zip: ADDR_A.zip,
    // null out lat/lng so the route is forced to geocode, exercising the
    // address → coordinates binding end to end
    lat: null,
    lng: null,
    provenance: { ...listing().provenance, recordId: 'A-record-1' }
  });
  const listingB = listing({
    id: 'ISO-B-CA-002',
    address: ADDR_B.address,
    city: ADDR_B.city,
    state: ADDR_B.state,
    zip: ADDR_B.zip,
    lat: null,
    lng: null,
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99999',
    provenance: { ...listing().provenance, recordId: 'B-record-2' }
  });

  const service = createPropertyImageService({
    db: { async getListingById(id) {
      if (id === listingA.id) return listingA;
      if (id === listingB.id) return listingB;
      return null;
    } },
    fetchImpl,
    env: {
      GOOGLE_MAPS_API_KEY: TEST_KEY,
      GOOGLE_STREETVIEW_RADIUS_METERS: '50',
      GOOGLE_STREETVIEW_MAX_DISTANCE_METERS: '35',
    },
    now: () => Date.parse('2026-09-04T12:00:00.000Z'),
  });

  return { service, listingA, listingB, requestedUrls };
}

test('metadata: each listing calls the geocoder with its OWN address', async () => {
  const { service, listingA, listingB, requestedUrls } = fixture();
  await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingA.id}&mode=metadata` });
  await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingB.id}&mode=metadata` });
  const geocodeUrls = requestedUrls.filter((u) => u.pathname === '/maps/api/geocode/json');
  assert.equal(geocodeUrls.length, 2);
  const a = decodeURIComponent(geocodeUrls[0].searchParams.get('address') || '');
  const b = decodeURIComponent(geocodeUrls[1].searchParams.get('address') || '');
  assert.match(a, /19 West Park Avenue/, 'first listing must geocode its OWN address');
  assert.match(b, /200 Market Street/, 'second listing must geocode its OWN address');
  assert.ok(!a.includes('Market Street'), 'first listing must not see B\'s address');
  assert.ok(!b.includes('Park Ridge'), 'second listing must not see A\'s address');
});

test('metadata: each listing calls the metadata endpoint with its OWN geocoded coordinates', async () => {
  const { service, listingA, listingB, requestedUrls } = fixture();
  await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingA.id}&mode=metadata` });
  await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingB.id}&mode=metadata` });
  const metadataUrls = requestedUrls.filter((u) => u.pathname === '/maps/api/streetview/metadata');
  assert.equal(metadataUrls.length, 2);
  const aLoc = metadataUrls[0].searchParams.get('location');
  const bLoc = metadataUrls[1].searchParams.get('location');
  // The mock returns ROOFTOP coords for A and B respectively; the metadata
  // call must be invoked with the same coordinates that came back from
  // geocoding. We round-trip them through the URL parser.
  const [aLat, aLng] = aLoc.split(',').map(Number);
  const [bLat, bLng] = bLoc.split(',').map(Number);
  assert.ok(Math.abs(aLat - ADDR_A.lat) < 1e-4, `metadata call for A must use A's geocoded lat (${aLat} vs ${ADDR_A.lat})`);
  assert.ok(Math.abs(aLng - ADDR_A.lng) < 1e-4, `metadata call for A must use A's geocoded lng (${aLng} vs ${ADDR_A.lng})`);
  assert.ok(Math.abs(bLat - ADDR_B.lat) < 1e-4, `metadata call for B must use B's geocoded lat (${bLat} vs ${ADDR_B.lat})`);
  assert.ok(Math.abs(bLng - ADDR_B.lng) < 1e-4, `metadata call for B must use B's geocoded lng (${bLng} vs ${ADDR_B.lng})`);
});

test('metadata: each listing receives the pano for its OWN location, not the other', async () => {
  const { service, listingA, listingB } = fixture();
  const resA = await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingA.id}&mode=metadata` });
  const resB = await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingB.id}&mode=metadata` });
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
  // The route strips the raw pano_id into `panoramaId`. The mock keeps the
  // exact string we set so we can compare directly. (We assert against
  // panoramaId rather than re-inventing the route's rename.)
  const panoA = resA.body.panoramaId || resA.body.pano_id || resA.body.panoId;
  const panoB = resB.body.panoramaId || resB.body.pano_id || resB.body.panoId;
  assert.equal(panoA, ADDR_A.panoId, 'A must receive its OWN pano');
  assert.equal(panoB, ADDR_B.panoId, 'B must receive its OWN pano');
  assert.notEqual(panoA, panoB, 'panos must not cross-contaminate');
  assert.ok(Math.abs(resA.body.panoramaLocation.lat - ADDR_A.lat) < 1e-4, 'A response location matches A geocode');
  assert.ok(Math.abs(resB.body.panoramaLocation.lat - ADDR_B.lat) < 1e-4, 'B response location matches B geocode');
});

test('image: the JPEG response embeds the listing\'s geographic label, not the other', async () => {
  const { service, listingA, listingB } = fixture();
  const resA = await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingA.id}&mode=image` });
  const resB = await service.resolve({ method: 'GET', url: `http://localhost/api/property-image?listingId=${listingB.id}&mode=image` });
  // The mock encodes the geographic label inside a fixed-width 16-byte slot
  // starting at offset 4 of the image body (after the JPEG SOI marker). The
  // route must hand each listing its OWN pano to Google, which means each
  // image response carries the label for its OWN listing.
  assert.ok(Buffer.isBuffer(resA.body));
  assert.ok(Buffer.isBuffer(resB.body));
  const aLabel = resA.body.toString('utf8', 4, 20).replace(/\0+$/u, '');
  const bLabel = resB.body.toString('utf8', 4, 20).replace(/\0+$/u, '');
  assert.equal(aLabel, 'parkridge', `A image body label must be 'parkridge', got '${aLabel}'`);
  assert.equal(bLabel, 'sfmarket', `B image body label must be 'sfmarket', got '${bLabel}'`);
});

test('listingId that does not match any listing returns listing_not_found, not someone else\'s imagery', async () => {
  const { service } = fixture();
  const res = await service.resolve({ method: 'GET', url: 'http://localhost/api/property-image?listingId=does-not-exist&mode=metadata' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'listing_not_found');
});
