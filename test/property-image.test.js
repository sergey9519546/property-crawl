'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPropertyImageService,
  hasUsablePublisherPhoto,
} = require('../server/routes/property-image');

const TEST_KEY = 'test-key-never-return-this-value';

function liveListing(overrides = {}) {
  return {
    id: 'CIV-NJ-7-53',
    source: 'civilview',
    address: '19 West Park Avenue',
    city: 'Park Ridge',
    state: 'NJ',
    zip: '07656',
    lat: 40.9500000,
    lng: -74.0300000,
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

function publisherPhotoListing(overrides = {}) {
  const listing = liveListing({
    photo: 'https://salesweb.civilview.com/property/123.jpg',
    ...overrides,
  });
  return {
    ...listing,
    provenance: {
      ...listing.provenance,
      media: {
        photo: {
          origin: 'publisher_record',
          verification: 'source_extracted',
          sourceRecordUrl: listing.sourceUrl,
        },
      },
    },
  };
}

function metadataResponse(overrides = {}) {
  return new Response(JSON.stringify({
    status: 'OK',
    pano_id: 'safe_pano-id_12345',
    location: { lat: 40.9501000, lng: -74.0300000 },
    date: '2025-10',
    copyright: '© 2025 Google',
    ...overrides,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function geocodeResponse(resultOverrides = {}, payloadOverrides = {}) {
  const result = {
    partial_match: false,
    types: ['street_address'],
    geometry: {
      location_type: 'ROOFTOP',
      location: { lat: 40.9500000, lng: -74.0300000 },
    },
    address_components: [
      { long_name: '19', short_name: '19', types: ['street_number'] },
      { long_name: 'West Park Avenue', short_name: 'W Park Ave', types: ['route'] },
      { long_name: 'New Jersey', short_name: 'NJ', types: ['administrative_area_level_1'] },
      { long_name: '07656', short_name: '07656', types: ['postal_code'] },
      { long_name: 'United States', short_name: 'US', types: ['country'] },
    ],
    ...resultOverrides,
  };
  return new Response(JSON.stringify({ status: 'OK', results: [result], ...payloadOverrides }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function jpegResponse() {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(128, 1)]);
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) },
  });
}

function serviceFor({ listing = liveListing(), fetchImpl, env = {} } = {}) {
  return createPropertyImageService({
    db: { async getListingById(id) { return id === listing.id ? listing : null; } },
    fetchImpl,
    env: {
      GOOGLE_MAPS_API_KEY: TEST_KEY,
      GOOGLE_STREETVIEW_RADIUS_METERS: '50',
      GOOGLE_STREETVIEW_MAX_DISTANCE_METERS: '35',
      ...env,
    },
    now: () => Date.parse('2026-09-04T12:00:00.000Z'),
  });
}

function request(query, headers = {}) {
  return {
    method: 'GET',
    url: `http://localhost:3001/api/property-image?${query}`,
    headers: { host: 'localhost:3001', ...headers },
  };
}

function serializedResponse(result) {
  return JSON.stringify({ status: result.status, headers: result.headers, body: result.body });
}

test('metadata lookup is source-gated, proximity-checked, and never exposes the API key', async () => {
  const requestedUrls = [];
  const service = serviceFor({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return metadataResponse();
    },
  });

  const result = await service.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(result.status, 200);
  assert.equal(result.body.available, true);
  assert.equal(result.body.provider, 'Google Maps');
  assert.equal(result.body.captureDate, '2025-10');
  assert.equal(result.body.panoId, undefined);
  assert.equal(result.body.provenance.recordId, undefined);
  assert.equal(result.body.provenance.panoramaReference, 'ephemeral_not_disclosed');
  assert.ok(result.body.distanceMeters > 10 && result.body.distanceMeters < 12);
  assert.equal(result.body.provenance.exactPropertyVerified, false);
  assert.equal(result.body.provenance.matchBasis, 'source_coordinates_and_panorama_distance');
  assert.match(requestedUrls[0], /^https:\/\/maps\.googleapis\.com\/maps\/api\/streetview\/metadata\?/);
  assert.match(requestedUrls[0], /source=outdoor/);
  assert.match(requestedUrls[0], /radius=50/);
  assert.ok(!serializedResponse(result).includes(TEST_KEY));
  assert.ok(!serializedResponse(result).includes('maps.googleapis.com'));
});

test('image mode verifies metadata first, points the camera at the listing, and streams bounded image bytes', async () => {
  const requestedUrls = [];
  const service = serviceFor({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return String(url).includes('/metadata?') ? metadataResponse() : jpegResponse();
    },
  });

  const result = await service.resolve(request('listingId=CIV-NJ-7-53&mode=image'));
  assert.equal(result.status, 200);
  assert.equal(result.headers['Content-Type'], 'image/jpeg');
  assert.equal(result.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.headers['X-Property-Image-Provider'], 'Google Maps');
  assert.ok(Buffer.isBuffer(result.body));
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /\/metadata\?/);
  assert.match(requestedUrls[1], /\/streetview\?/);
  assert.match(requestedUrls[1], /pano=safe_pano-id_12345/);
  assert.match(requestedUrls[1], /return_error_code=true/);
  assert.ok(new URL(requestedUrls[1]).searchParams.has('heading'));
  assert.ok(!serializedResponse(result).includes(TEST_KEY));
  assert.ok(!Object.values(result.headers).join(' ').includes(TEST_KEY));
});

test('a panorama outside the strict distance threshold is rejected before image retrieval', async () => {
  let requests = 0;
  const service = serviceFor({
    fetchImpl: async () => {
      requests += 1;
      return metadataResponse({ location: { lat: 40.9510000, lng: -74.0300000 } });
    },
  });

  const result = await service.resolve(request('listingId=CIV-NJ-7-53&mode=image'));
  assert.equal(result.status, 422);
  assert.equal(result.body.available, false);
  assert.equal(result.body.error, 'panorama_mismatch');
  assert.equal(requests, 1);
  assert.ok(!serializedResponse(result).includes(TEST_KEY));
});

test('ZERO_RESULTS fails closed without attempting to retrieve an image', async () => {
  let requests = 0;
  const service = serviceFor({
    fetchImpl: async () => {
      requests += 1;
      return metadataResponse({ status: 'ZERO_RESULTS', pano_id: undefined, location: undefined });
    },
  });

  const result = await service.resolve(request('listingId=CIV-NJ-7-53&mode=image'));
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'street_view_unavailable');
  assert.equal(requests, 1);
});

test('publisher photos, demo records, incomplete locations, and generic photos are handled truthfully', async () => {
  assert.equal(hasUsablePublisherPhoto(publisherPhotoListing()), true);
  assert.equal(hasUsablePublisherPhoto(liveListing({ photo: 'https://publisher.example/property/123.jpg' })), false);
  const wrongRecord = publisherPhotoListing();
  wrongRecord.provenance.media.photo.sourceRecordUrl = 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99999';
  assert.equal(hasUsablePublisherPhoto(wrongRecord), false);
  assert.equal(hasUsablePublisherPhoto(liveListing({ photo: 'https://images.unsplash.com/random-house.jpg' })), false);
  assert.equal(hasUsablePublisherPhoto(liveListing({ photo: 'https://publisher.example/no-image.png' })), false);

  for (const [listing, expectedCode] of [
    [publisherPhotoListing(), 'publisher_photo_available'],
    [liveListing({ provenance: { origin: 'snapshot', observed: false, recordKind: 'demo' } }), 'listing_not_source_observed'],
    [liveListing({ lat: null, lng: null, address: 'Vacant parcel' }), 'exact_location_unavailable'],
    [liveListing({ sourceUrl: 'https://salesweb.civilview.com/Sales/Search' }), 'invalid_source_record'],
  ]) {
    let fetched = false;
    const service = serviceFor({ listing, fetchImpl: async () => { fetched = true; return metadataResponse(); } });
    const result = await service.resolve(request(`listingId=${listing.id}&mode=metadata`));
    assert.equal(result.body.error, expectedCode);
    assert.equal(fetched, false);
  }
});

test('a missing source coordinate can use one ephemeral exact ROOFTOP address match', async () => {
  const requestedUrls = [];
  const listing = liveListing({ lat: null, lng: null, address: '19 West Park Avenue, Park Ridge, NJ 07656' });
  const service = serviceFor({
    listing,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return String(url).includes('/geocode/json?') ? geocodeResponse() : metadataResponse();
    },
  });

  const result = await service.resolve(request(`listingId=${listing.id}&mode=metadata`));
  assert.equal(result.status, 200);
  assert.equal(result.body.available, true);
  assert.equal(result.body.provenance.matchBasis, 'source_observed_address_rooftop_geocode_and_panorama_distance');
  assert.deepEqual(result.body.provenance.coordinateResolution, {
    origin: 'google_geocoding_ephemeral',
    locationType: 'ROOFTOP',
    partialMatch: false,
    persisted: false,
  });
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /^https:\/\/maps\.googleapis\.com\/maps\/api\/geocode\/json\?/);
  assert.match(new URL(requestedUrls[0]).searchParams.get('address'), /19 West Park Avenue/);
  assert.ok(!serializedResponse(result).includes(TEST_KEY));
});

test('derived coordinates are ignored and independently re-resolved from the source-observed address', async () => {
  const listing = liveListing({
    lat: 1,
    lng: 1,
    provenance: {
      ...liveListing().provenance,
      derivedFields: { geocode: { provider: 'unverified_legacy' } },
    },
  });
  const requestedUrls = [];
  const service = serviceFor({
    listing,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return String(url).includes('/geocode/json?') ? geocodeResponse() : metadataResponse();
    },
  });

  const result = await service.resolve(request(`listingId=${listing.id}&mode=metadata`));
  assert.equal(result.status, 200);
  assert.match(requestedUrls[0], /\/geocode\/json\?/);
  assert.doesNotMatch(requestedUrls[1], /location=1(?:\.0+)?%2C1(?:\.0+)?/);
});

test('partial, approximate, ambiguous, and component-mismatched geocodes fail closed', async () => {
  const cases = [
    ['partial', geocodeResponse({ partial_match: true })],
    ['approximate', geocodeResponse({ geometry: { location_type: 'APPROXIMATE', location: { lat: 40.95, lng: -74.03 } } })],
    ['ambiguous', geocodeResponse({}, { results: [{}, {}] })],
    ['street number mismatch', geocodeResponse({
      address_components: [
        { long_name: '91', short_name: '91', types: ['street_number'] },
        { long_name: 'West Park Avenue', short_name: 'W Park Ave', types: ['route'] },
        { long_name: 'New Jersey', short_name: 'NJ', types: ['administrative_area_level_1'] },
        { long_name: '07656', short_name: '07656', types: ['postal_code'] },
        { long_name: 'United States', short_name: 'US', types: ['country'] },
      ],
    })],
    ['state mismatch', geocodeResponse({
      address_components: [
        { long_name: '19', short_name: '19', types: ['street_number'] },
        { long_name: 'West Park Avenue', short_name: 'W Park Ave', types: ['route'] },
        { long_name: 'New York', short_name: 'NY', types: ['administrative_area_level_1'] },
        { long_name: '07656', short_name: '07656', types: ['postal_code'] },
        { long_name: 'United States', short_name: 'US', types: ['country'] },
      ],
    })],
    ['ZIP mismatch', geocodeResponse({
      address_components: [
        { long_name: '19', short_name: '19', types: ['street_number'] },
        { long_name: 'West Park Avenue', short_name: 'W Park Ave', types: ['route'] },
        { long_name: 'New Jersey', short_name: 'NJ', types: ['administrative_area_level_1'] },
        { long_name: '07657', short_name: '07657', types: ['postal_code'] },
        { long_name: 'United States', short_name: 'US', types: ['country'] },
      ],
    })],
  ];

  for (const [label, geocode] of cases) {
    let requests = 0;
    const listing = liveListing({ lat: null, lng: null });
    const service = serviceFor({
      listing,
      fetchImpl: async () => { requests += 1; return geocode.clone(); },
    });
    const result = await service.resolve(request(`listingId=${listing.id}&mode=metadata`));
    assert.equal(result.status, 422, label);
    assert.equal(result.body.error, 'geocode_mismatch', label);
    assert.equal(requests, 1, label);
    assert.ok(!serializedResponse(result).includes(TEST_KEY), label);
  }
});

test('missing configuration, cross-origin requests, and non-image responses fail without secret leakage', async () => {
  const unconfigured = serviceFor({ env: { GOOGLE_MAPS_API_KEY: '' }, fetchImpl: async () => metadataResponse() });
  const missingConfig = await unconfigured.resolve(request('listingId=CIV-NJ-7-53'));
  assert.equal(missingConfig.status, 503);
  assert.equal(missingConfig.body.error, 'not_configured');

  const configured = serviceFor({
    fetchImpl: async (url) => String(url).includes('/metadata?')
      ? metadataResponse()
      : new Response('<html>not an image</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  const crossOrigin = await configured.resolve(request('listingId=CIV-NJ-7-53', { origin: 'https://attacker.example' }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.error, 'cross_origin_denied');

  const crossSiteHotlink = await configured.resolve(request('listingId=CIV-NJ-7-53&mode=image', {
    'sec-fetch-site': 'cross-site',
  }));
  assert.equal(crossSiteHotlink.status, 403);
  assert.equal(crossSiteHotlink.body.error, 'cross_origin_denied');

  const crossOriginReferer = await configured.resolve(request('listingId=CIV-NJ-7-53&mode=image', {
    referer: 'https://attacker.example/hotlink',
  }));
  assert.equal(crossOriginReferer.status, 403);
  assert.equal(crossOriginReferer.body.error, 'cross_origin_denied');

  const sameOriginReferer = await configured.resolve(request('listingId=CIV-NJ-7-53&mode=metadata', {
    referer: 'http://localhost:3001/listings/CIV-NJ-7-53',
    'sec-fetch-site': 'same-origin',
  }));
  assert.equal(sameOriginReferer.status, 200);

  const nonImage = await configured.resolve(request('listingId=CIV-NJ-7-53&mode=image'));
  assert.equal(nonImage.status, 502);
  assert.equal(nonImage.body.error, 'upstream_non_image');
  assert.ok(!serializedResponse(nonImage).includes(TEST_KEY));
});
