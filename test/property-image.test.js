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

function serviceFor({ listing = liveListing(), fetchImpl, env = {}, now = () => Date.parse('2026-09-04T12:00:00.000Z') } = {}) {
  return createPropertyImageService({
    db: { async getListingById(id) { return id === listing.id ? listing : null; } },
    fetchImpl,
    env: {
      GOOGLE_MAPS_API_KEY: TEST_KEY,
      GOOGLE_STREETVIEW_RADIUS_METERS: '50',
      GOOGLE_STREETVIEW_MAX_DISTANCE_METERS: '35',
      ...env,
    },
    now,
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
  assert.equal(result.body.panoramaId, 'safe_pano-id_12345');
  assert.deepEqual(result.body.panoramaLocation, { lat: 40.9501, lng: -74.03 });
  assert.equal(result.body.targetHeading, result.body.heading);
  const launch=new URL(result.body.mapsLaunchUrl);
  assert.equal(launch.origin,'https://www.google.com');
  assert.equal(launch.searchParams.get('map_action'),'pano');
  assert.equal(launch.searchParams.get('pano'),'safe_pano-id_12345');
  assert.equal(result.body.interactiveReady,false);
  assert.equal(result.body.interactive.reason,'public_browser_key_not_configured');
  assert.equal(result.body.provenance.recordId, undefined);
  assert.equal(result.body.provenance.panoramaReference, 'provider_identifier');
  assert.ok(result.body.distanceMeters > 10 && result.body.distanceMeters < 12);
  assert.equal(result.body.provenance.exactPropertyVerified, false);
  assert.equal(result.body.provenance.matchBasis, 'source_coordinates_and_panorama_distance');
  assert.match(requestedUrls[0], /^https:\/\/maps\.googleapis\.com\/maps\/api\/streetview\/metadata\?/);
  assert.match(requestedUrls[0], /source=outdoor/);
  assert.match(requestedUrls[0], /radius=50/);
  assert.ok(!serializedResponse(result).includes(TEST_KEY));
  assert.ok(!serializedResponse(result).includes('maps.googleapis.com'));
});

test('metadata lookups coalesce and a restricted public browser key only changes readiness',async()=>{
  let requests=0,release;const pending=new Promise(resolve=>{release=resolve;});
  const service=serviceFor({env:{NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:'public-browser-key'},fetchImpl:async()=>{requests++;await pending;return metadataResponse();}});
  const first=service.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));const second=service.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));release();
  const [a,b]=await Promise.all([first,second]);assert.equal(requests,1);assert.equal(a.body.interactiveReady,true);assert.equal(b.body.panoramaId,a.body.panoramaId);
  assert.ok(!serializedResponse(a).includes('public-browser-key'));assert.ok(!serializedResponse(a).includes(TEST_KEY));
});

test('completed panorama metadata is released and subsequent requests resolve current provider evidence',async()=>{
  let requests=0;const service=serviceFor({fetchImpl:async()=>{requests++;return metadataResponse();}});
  await service.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(service.panoramaInFlight.size, 0);
  await service.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(requests,2);
  assert.equal(service.panoramaInFlight.size, 0);
});

test('an archive record uses only an exact address rooftop match for context',async()=>{
  const listing=liveListing({lat:40.95,lng:-74.03,provenance:{...liveListing().provenance,origin:'archive',snapshotKind:'imported_snapshot'}});const urls=[];
  const service=serviceFor({listing,fetchImpl:async url=>{urls.push(String(url));return String(url).includes('/geocode/json?')?geocodeResponse():metadataResponse();}});
  const result=await service.resolve(request(`listingId=${listing.id}&mode=metadata`));assert.equal(result.status,200);assert.equal(urls.length,2);assert.match(urls[0],/\/geocode\/json\?/);assert.match(result.body.provenance.matchBasis,/source_observed_address_rooftop_geocode/);
});

test('walkthrough finds a nearby street without weakening the static image distance gate', async () => {
  const radii = [];
  const service = serviceFor({ env: { NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY: 'public-embed-test' }, fetchImpl: async url => {
    const radius = new URL(url).searchParams.get('radius'); radii.push(radius);
    return radius === '50' ? metadataResponse({status: 'ZERO_RESULTS'}) : metadataResponse({location: {lat: 40.952, lng: -74.03}});
  }});
  const result = await service.resolve(request('listingId=CIV-NJ-7-53&mode=walkthrough'));
  assert.equal(result.status, 200);
  assert.equal(result.body.coverage, 'nearby_street');
  assert.equal(result.body.targetLabel, 'Nearby street walkthrough');
  assert.ok(result.body.distanceMeters > 200 && result.body.distanceMeters < 250);
  assert.equal(result.body.provenance.exactPropertyVerified, false);
  assert.equal(result.body.interactive.provider, 'google_maps_javascript');
  assert.equal(result.body.interactiveReady, false);
  assert.equal(result.body.interactive.reason, 'public_browser_key_not_configured');
  assert.deepEqual(radii, ['50', '500']);
  assert.ok(!serializedResponse(result).includes('public-embed-test'));
  const image = await service.resolve(request('listingId=CIV-NJ-7-53&mode=image'));
  assert.equal(image.status, 404);
  assert.deepEqual(radii, ['50', '500', '50']);
});

test('walkthrough never expands beyond 500m or retries a provider denial', async () => {
  const far = serviceFor({env: {GOOGLE_WALKTHROUGH_RADIUS_METERS: '99999'}, fetchImpl: async url => {
    assert.ok(Number(new URL(url).searchParams.get('radius')) <= 500);
    return metadataResponse({location: {lat: 40.96, lng: -74.03}});
  }});
  const rejected = await far.resolve(request('listingId=CIV-NJ-7-53&mode=walkthrough'));
  assert.equal(rejected.status, 422);
  let calls = 0;
  const denied = serviceFor({fetchImpl: async () => {calls++; return metadataResponse({status: 'REQUEST_DENIED'});}});
  assert.equal((await denied.resolve(request('listingId=CIV-NJ-7-53&mode=walkthrough'))).status, 503);
  assert.equal(calls, 1);
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

test('requested walkthrough complements publisher photos while automatic imagery still prefers them', async () => {
  let calls = 0;
  const listing = publisherPhotoListing();
  const service = serviceFor({ listing, fetchImpl: async () => { calls++; return metadataResponse(); } });
  for (const mode of ['metadata', 'image']) {
    const result = await service.resolve(request(`listingId=${listing.id}&mode=${mode}`));
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'publisher_photo_available');
  }
  assert.equal(calls, 0);
  const walkthrough = await service.resolve(request(`listingId=${listing.id}&mode=walkthrough`));
  assert.equal(walkthrough.status, 200);
  assert.equal(walkthrough.body.available, true);
  assert.equal(calls, 1);
  const unverified = publisherPhotoListing({ provenance: { origin: 'snapshot', observed: false } });
  const blocked = serviceFor({ listing: unverified, fetchImpl: async () => { throw new Error('Must not fetch for unverified records'); } });
  assert.equal((await blocked.resolve(request(`listingId=${unverified.id}&mode=walkthrough`))).body.error, 'listing_not_source_observed');
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

test('Google Street View fallbacks execute only on Google miss/unconfigured and never overwrite a valid Google panorama', async () => {
  const panoramaxFeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: 'pnx-pic-1',
      collection: 'pnx-seq-1',
      geometry: { type: 'Point', coordinates: [-74.0301, 40.9501] },
      properties: {
        datetime: '2025-11-01T12:00:00Z',
        producer: 'OpenMapper',
        license: 'CC-BY-SA-4.0',
        'Xmp.GPano.ProjectionType': 'equirectangular',
      },
      links: [
        { rel: 'via', href: 'https://panoramax.openstreetmap.fr/api/items/pnx-pic-1' },
        { rel: 'license', href: 'https://spdx.org/licenses/CC-BY-SA-4.0.html' },
      ],
    }],
  };
  const mapillaryPayload = {
    data: [{
      id: 'mly-pic-1',
      captured_at: '2025-09-12T12:00:00.000Z',
      thumb_1024_url: 'https://images.mapillary.com/fallback-1024.jpg',
      sequence: 'mly-seq-1',
      compass_angle: 88,
      creator: { id: 42, username: 'mly-user' },
      geometry: { type: 'Point', coordinates: [-74.0301, 40.9501] },
      image_type: 'flat',
    }],
  };

  // 1. Google OK + fallback flag enabled must preserve Google Street View.
  const googleFirst = serviceFor({
    env: { PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1' },
    fetchImpl: async (url) => {
      if (String(url).includes('maps.googleapis.com')) return metadataResponse();
      throw new Error('Panoramax fallback must not be called when Google returned a valid panorama');
    },
  });
  const googleRes = await googleFirst.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(googleRes.status, 200);
  assert.equal(googleRes.body.provider, 'Google Maps');

  // 2. Google ZERO_RESULTS + Panoramax fallback flag returns 200 panoramax_fallback.
  const pnxFallback = serviceFor({
    env: { PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1' },
    fetchImpl: async (url) => {
      if (String(url).includes('maps.googleapis.com')) {
        return metadataResponse({ status: 'ZERO_RESULTS', pano_id: undefined, location: undefined });
      }
      if (String(url).includes('api.panoramax.xyz')) {
        return new Response(JSON.stringify(panoramaxFeatureCollection), {
          status: 200,
          headers: { 'content-type': 'application/geo+json' },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const pnxRes = await pnxFallback.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(pnxRes.status, 200);
  assert.equal(pnxRes.body.available, true);
  assert.equal(pnxRes.body.provider, 'panoramax_fallback');
  assert.equal(pnxRes.body.primaryUnavailableReason, 'street_view_unavailable');
  assert.equal(pnxRes.body.candidate?.pictureId, 'pnx-pic-1');

  // 3. Google ZERO_RESULTS + Mapillary fallback flag + MAPILLARY_RADIUS_METERS=200 clamps cleanly to 100m.
  const mlyFallback = serviceFor({
    env: {
      PROPERTY_IMAGE_GOOGLE_MAPILLARY_FALLBACK: '1',
      MAPILLARY_ACCESS_TOKEN: 'MLY|test|token',
      MAPILLARY_RADIUS_METERS: '200',
    },
    fetchImpl: async (url) => {
      if (String(url).includes('maps.googleapis.com')) {
        return metadataResponse({ status: 'ZERO_RESULTS', pano_id: undefined, location: undefined });
      }
      if (String(url).includes('graph.mapillary.com')) {
        return new Response(JSON.stringify(mapillaryPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const mlyRes = await mlyFallback.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(mlyRes.status, 200);
  assert.equal(mlyRes.body.available, true);
  assert.equal(mlyRes.body.provider, 'mapillary_fallback');
  assert.equal(mlyRes.body.queriedRadiusMeters, 100);
  assert.equal(mlyRes.body.candidate?.thumbUrl, 'https://images.mapillary.com/fallback-1024.jpg');

  // 4. Unconfigured Google key + opt-in Panoramax fallback serves current-source-record coords cleanly.
  const unconfiguredWithFallback = serviceFor({
    env: { GOOGLE_MAPS_API_KEY: '', PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1' },
    fetchImpl: async (url) => {
      assert.match(String(url), /api\.panoramax\.xyz/);
      return new Response(JSON.stringify(panoramaxFeatureCollection), {
        status: 200,
        headers: { 'content-type': 'application/geo+json' },
      });
    },
  });
  const unconfRes = await unconfiguredWithFallback.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(unconfRes.status, 200);
  assert.equal(unconfRes.body.available, true);
  assert.equal(unconfRes.body.provider, 'panoramax_fallback');
  assert.equal(unconfRes.body.primaryUnavailableReason, 'not_configured');

  // 5. Unconfigured Google key + opt-in fallback serves archived_source_record with sourceCoordinates cleanly,
  // and fails closed with 503 not_configured if fallback returns nothing.
  const archiveWithCoords = liveListing({
    provenance: {
      origin: 'archive',
      observed: true,
      observedAt: '2026-09-03T10:00:00.000Z',
      publisher: 'Bergen County Sheriff',
      recordId: '12345',
    },
  });
  const unconfiguredArchiveFallback = serviceFor({
    listing: archiveWithCoords,
    env: { GOOGLE_MAPS_API_KEY: '', PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1' },
    fetchImpl: async (url) => {
      assert.match(String(url), /api\.panoramax\.xyz/);
      return new Response(JSON.stringify(panoramaxFeatureCollection), {
        status: 200,
        headers: { 'content-type': 'application/geo+json' },
      });
    },
  });
  const archiveFallbackRes = await unconfiguredArchiveFallback.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(archiveFallbackRes.status, 200);
  assert.equal(archiveFallbackRes.body.provider, 'panoramax_fallback');
  assert.equal(archiveFallbackRes.body.primaryUnavailableReason, 'not_configured');

  const unconfiguredArchiveMiss = serviceFor({
    listing: archiveWithCoords,
    env: { GOOGLE_MAPS_API_KEY: '', PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1' },
    fetchImpl: async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
      status: 200,
      headers: { 'content-type': 'application/geo+json' },
    }),
  });
  const archiveMissRes = await unconfiguredArchiveMiss.resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(archiveMissRes.status, 503);
  assert.equal(archiveMissRes.body.error, 'not_configured');
});

test('panoramicMetadata strips unapproved licenses and attaches viewerUrl across fallback and alternatives modes', async () => {
  const mixedCollection = {
    type: 'FeatureCollection',
    features: [
      {
        id: 'pnx-approved',
        collection: 'seq-approved',
        geometry: { type: 'Point', coordinates: [-74.0301, 40.9501] },
        properties: { datetime: '2025-08-01T12:00:00.000Z', license: 'CC-BY-SA-4.0', field_of_view: 360 },
        links: [{ rel: 'license', href: 'https://spdx.org/licenses/CC-BY-SA-4.0.html' }],
      },
      {
        id: 'pnx-proprietary',
        collection: 'seq-proprietary',
        geometry: { type: 'Point', coordinates: [-74.03005, 40.95005] },
        properties: { datetime: '2025-08-02T12:00:00.000Z', license: 'proprietary', field_of_view: 360 },
      },
    ],
  };

  const fetchImpl = async (url) => {
    if (String(url).includes('maps.googleapis.com')) {
      return metadataResponse({ status: 'ZERO_RESULTS', pano_id: undefined, location: undefined });
    }
    if (String(url).includes('api.panoramax.xyz')) {
      return new Response(JSON.stringify(mixedCollection), {
        status: 200,
        headers: { 'content-type': 'application/geo+json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const fallbackRes = await serviceFor({
    env: { PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1' },
    fetchImpl,
  }).resolve(request('listingId=CIV-NJ-7-53&mode=metadata'));
  assert.equal(fallbackRes.status, 200);
  assert.deepEqual(fallbackRes.body.panoramicMetadata.map((item) => item.pictureId), ['pnx-approved']);
  assert.match(fallbackRes.body.panoramicMetadata[0].viewerUrl, /^https:\/\/api\.panoramax\.xyz\/\?focus=pic&pic=pnx-approved/);

  const altRes = await serviceFor({
    listing: publisherPhotoListing(),
    env: { GOOGLE_MAPS_API_KEY: '' },
    fetchImpl,
  }).resolve(request('listingId=CIV-NJ-7-53&mode=alternatives'));
  assert.equal(altRes.status, 200);
  assert.deepEqual(altRes.body.panoramicMetadata.map((item) => item.pictureId), ['pnx-approved']);
  assert.match(altRes.body.panoramicMetadata[0].viewerUrl, /^https:\/\/api\.panoramax\.xyz\/\?focus=pic&pic=pnx-approved/);
});

test('alternatives mode supports archived_source_record and falls back to rooftop geocoding when source coordinates are absent', async () => {
  const panoramaxFeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      id: 'pnx-archive-1',
      collection: 'seq-1',
      geometry: { type: 'Point', coordinates: [-74.0301, 40.9501] },
      properties: { datetime: '2025-08-01T12:00:00.000Z', license: 'ETALAB-2.0', field_of_view: 360 },
      links: [{ rel: 'license', href: 'https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf' }],
    }],
  };

  const archivedWithCoords = liveListing({
    provenance: {
      origin: 'archive',
      observed: true,
      observedAt: '2026-09-03T10:00:00.000Z',
      publisher: 'Bergen County Sheriff',
      recordId: '12345',
    },
  });
  const archivedLocalRes = await serviceFor({
    listing: archivedWithCoords,
    env: { GOOGLE_MAPS_API_KEY: '' },
    fetchImpl: async (url) => {
      assert.match(String(url), /api\.panoramax\.xyz/);
      return new Response(JSON.stringify(panoramaxFeatureCollection), {
        status: 200,
        headers: { 'content-type': 'application/geo+json' },
      });
    },
  }).resolve(request('listingId=CIV-NJ-7-53&mode=alternatives'));
  assert.equal(archivedLocalRes.status, 200);
  assert.equal(archivedLocalRes.body.available, true);
  assert.equal(archivedLocalRes.body.coordinateBasis, 'source_coordinates');
  assert.equal(archivedLocalRes.body.candidate?.pictureId, 'pnx-archive-1');

  const archivedNoCoords = { ...archivedWithCoords, lat: null, lng: null };
  const geocodedAltRes = await serviceFor({
    listing: archivedNoCoords,
    fetchImpl: async (url, init) => {
      assert.equal(init?.redirect, 'error');
      if (String(url).includes('/maps/api/geocode/json')) return geocodeResponse();
      if (String(url).includes('api.panoramax.xyz')) {
        return new Response(JSON.stringify(panoramaxFeatureCollection), {
          status: 200,
          headers: { 'content-type': 'application/geo+json' },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }).resolve(request('listingId=CIV-NJ-7-53&mode=alternatives'));
  assert.equal(geocodedAltRes.status, 200);
  assert.equal(geocodedAltRes.body.available, true);
  assert.equal(geocodedAltRes.body.coordinateBasis, 'source_observed_address_rooftop_geocode');

  // Non-rooftop geocode fails closed with 422 before calling alternative providers.
  const approxRes = await serviceFor({
    listing: archivedNoCoords,
    fetchImpl: async (url) => {
      if (String(url).includes('/maps/api/geocode/json')) {
        return geocodeResponse({ geometry: { location_type: 'APPROXIMATE', location: { lat: 40.95, lng: -74.03 } } });
      }
      throw new Error('Panoramax must not be fetched when rooftop geocode fails closed');
    },
  }).resolve(request('listingId=CIV-NJ-7-53&mode=alternatives'));
  assert.equal(approxRes.status, 422);
  assert.equal(approxRes.body.error, 'geocode_mismatch');

  // Missing geocode key fails closed with 503 not_configured without exposing secrets.
  const noKeyRes = await serviceFor({
    listing: archivedNoCoords,
    env: { GOOGLE_MAPS_API_KEY: '', GOOGLE_GEOCODING_API_KEY: '' },
    fetchImpl: async () => { throw new Error('Should not fetch without key'); },
  }).resolve(request('listingId=CIV-NJ-7-53&mode=alternatives'));
  assert.equal(noKeyRes.status, 503);
  assert.equal(noKeyRes.body.error, 'not_configured');
});


test('geocoding circuit reports address verification errors separately and LOT-prefixed street addresses resolve', async () => {
  const { sourceObservedAddress } = require('../server/routes/property-image');
  const recovered = sourceObservedAddress({
    address: 'LOT 2: 139-B Farless Road, Merry Hill, NC 27957',
    city: 'Merry Hill',
    state: 'NC',
    zip: '27957',
  });
  assert.ok(recovered);
  assert.equal(recovered.streetNumber, '139b');
  assert.equal(recovered.route, 'farless rd');
  assert.equal(sourceObservedAddress({ address: 'Vacant parcel', city: 'Merry Hill', state: 'NC', zip: '27957' }), null);
  assert.equal(sourceObservedAddress({ address: 'Lot 5, Main St', city: 'Merry Hill', state: 'NC', zip: '27957' }), null);

  const deniedNoCoords = liveListing({
    id: 'TRSY-27-66-813',
    source: 'treasury',
    sourceUrl: 'https://www.treasury.gov/auctions/treasury/rp/realprop.shtml?id=813',
    address: 'LOT 2: 139-B Farless Road',
    city: 'Merry Hill',
    state: 'NC',
    zip: '27957',
    lat: null,
    lng: null,
  });
  const svc = serviceFor({
    listing: deniedNoCoords,
    fetchImpl: async (url) => {
      if (String(url).includes('/maps/api/geocode/json')) {
        return geocodeResponse({}, { status: 'REQUEST_DENIED', results: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const firstDenied = await svc.resolve(request(`listingId=${deniedNoCoords.id}&mode=metadata`));
  assert.equal(firstDenied.status, 503);
  assert.equal(firstDenied.body.error, 'geocoding_denied');
  const secondCircuit = await svc.resolve(request(`listingId=${deniedNoCoords.id}&mode=metadata`));
  assert.equal(secondCircuit.status, 503);
  assert.equal(secondCircuit.body.error, 'circuit_open');
  assert.equal(secondCircuit.body.reason, 'Address verification is temporarily unavailable.');
});

test('alternatives mode falls back to US Census Geocoder for current_source_record when Google Geocoding fails or is unset, and stays strict', async () => {
  const noCoordLive = liveListing({ lat: null, lng: null, address: '19 West Park Avenue', city: 'Park Ridge', state: 'NJ', zip: '07656' });
  const censusOkPayload = {
    result: {
      addressMatches: [{
        matchedAddress: '19 WEST PARK AVE, PARK RIDGE, NJ, 07656',
        coordinates: { x: -74.0301, y: 40.9501 },
        addressComponents: { streetName: 'WEST PARK', suffixType: 'AVE', state: 'NJ', zip: '07656' },
      }],
    },
  };
  const panoramaxCollection = {
    type: 'FeatureCollection',
    features: [{
      id: 'pnx-census-1',
      collection: 'seq-1',
      geometry: { type: 'Point', coordinates: [-74.0301, 40.9501] },
      properties: { datetime: '2025-10-01T12:00:00Z', license: 'CC-BY-SA-4.0', field_of_view: 360 },
      links: [{ rel: 'license', href: 'https://spdx.org/licenses/CC-BY-SA-4.0.html' }],
    }],
  };

  // 1. Google Geocoding returns REQUEST_DENIED -> Census Geocoder recovers coords for alternatives
  const deniedToCensus = serviceFor({
    listing: noCoordLive,
    fetchImpl: async (url) => {
      if (String(url).includes('/maps/api/geocode/json')) return geocodeResponse({}, { status: 'REQUEST_DENIED', results: [] });
      if (String(url).includes('geocoding.geo.census.gov')) return new Response(JSON.stringify(censusOkPayload), { status: 200, headers: { 'content-type': 'application/json' } });
      if (String(url).includes('api.panoramax.xyz')) return new Response(JSON.stringify(panoramaxCollection), { status: 200, headers: { 'content-type': 'application/geo+json' } });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const recovered = await deniedToCensus.resolve(request(`listingId=${noCoordLive.id}&mode=alternatives`));
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.available, true);
  assert.equal(recovered.body.coordinateBasis, 'source_observed_address_census_geocode');
  assert.equal(recovered.body.candidate?.pictureId, 'pnx-census-1');

  // 2. Census state mismatch rejects cleanly and surfaces the Google denial
  const censusMismatch = serviceFor({
    listing: noCoordLive,
    fetchImpl: async (url) => {
      if (String(url).includes('/maps/api/geocode/json')) return geocodeResponse({}, { status: 'REQUEST_DENIED', results: [] });
      if (String(url).includes('geocoding.geo.census.gov')) {
        return new Response(JSON.stringify({
          result: {
            addressMatches: [{
              matchedAddress: '19 WEST PARK AVE, PARK RIDGE, NY, 07656',
              coordinates: { x: -74.0301, y: 40.9501 },
              addressComponents: { streetName: 'WEST PARK', suffixType: 'AVE', state: 'NY', zip: '07656' },
            }],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const rejected = await censusMismatch.resolve(request(`listingId=${noCoordLive.id}&mode=alternatives`));
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.error, 'geocoding_denied');

  // 3. Opt-in Census fallback works with missing Google keys on current_source_record
  const unsetKeyLive = serviceFor({
    listing: noCoordLive,
    env: { GOOGLE_MAPS_API_KEY: '', GOOGLE_GEOCODING_API_KEY: '', PROPERTY_IMAGE_CENSUS_GEOCODER_FALLBACK: '1' },
    fetchImpl: async (url) => {
      if (String(url).includes('geocoding.geo.census.gov')) return new Response(JSON.stringify(censusOkPayload), { status: 200, headers: { 'content-type': 'application/json' } });
      if (String(url).includes('api.panoramax.xyz')) return new Response(JSON.stringify(panoramaxCollection), { status: 200, headers: { 'content-type': 'application/geo+json' } });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const okWithoutGoogle = await unsetKeyLive.resolve(request(`listingId=${noCoordLive.id}&mode=alternatives`));
  assert.equal(okWithoutGoogle.status, 200);
  assert.equal(okWithoutGoogle.body.candidate?.pictureId, 'pnx-census-1');
});

test('walkthrough falls back to Panoramax on Google denial or miss only when opt-in fallback is enabled', async () => {
  const panoramaxCollection = {
    type: 'FeatureCollection',
    features: [{
      id: 'pnx-walk-1',
      collection: 'seq-1',
      geometry: { type: 'Point', coordinates: [-74.0301, 40.9501] },
      properties: { datetime: '2025-10-01T12:00:00Z', license: 'CC-BY-SA-4.0', field_of_view: 360 },
      links: [{ rel: 'license', href: 'https://spdx.org/licenses/CC-BY-SA-4.0.html' }],
    }],
  };
  let googleCalls = 0;
  const walkthroughFallback = serviceFor({
    env: { PROPERTY_IMAGE_GOOGLE_PANORAMAX_FALLBACK: '1' },
    fetchImpl: async (url) => {
      if (String(url).includes('maps.googleapis.com')) {
        googleCalls += 1;
        return metadataResponse({ status: 'REQUEST_DENIED', pano_id: undefined, location: undefined });
      }
      if (String(url).includes('api.panoramax.xyz')) {
        return new Response(JSON.stringify(panoramaxCollection), { status: 200, headers: { 'content-type': 'application/geo+json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const res = await walkthroughFallback.resolve(request('listingId=CIV-NJ-7-53&mode=walkthrough'));
  assert.equal(googleCalls, 1, 'must not retry Google Street View after REQUEST_DENIED');
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'panoramax_fallback');
  assert.equal(res.body.primaryUnavailableReason, 'upstream_denied');
  assert.equal(res.body.candidate?.pictureId, 'pnx-walk-1');
});

function largeJpegResponse() {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 7)]);
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) },
  });
}

function tinyBlankPngResponse() {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(128, 0)]);
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
  });
}

test('aerial mode serves 100% public-domain USGS primary with EPSG:3857 bbox, precision headers, and USDA NAIP CONUS fallback', async () => {
  const requestedUrls = [];
  const primarySvc = serviceFor({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      assert.doesNotMatch(String(url), /arcgisonline\.com|geocode\.arcgis\.com/i);
      if (String(url).includes('basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly')) {
        return largeJpegResponse();
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const primaryRes = await primarySvc.resolve(request('listingId=CIV-NJ-7-53&mode=aerial'));
  assert.equal(primaryRes.status, 200);
  assert.equal(primaryRes.headers['X-Property-Image-Provider'], 'USGS National Map');
  assert.equal(primaryRes.headers['X-Property-Image-Coordinate-Basis'], 'source_coordinates');
  assert.equal(primaryRes.headers['X-Property-Image-Coordinate-Precision'], 'source_observed');
  assert.match(primaryRes.headers['Cache-Control'], /public, max-age=604800/);
  const parsedPrimaryUrl = new URL(requestedUrls[0]);
  assert.equal(parsedPrimaryUrl.searchParams.get('bboxSR'), '3857');
  assert.equal(parsedPrimaryUrl.searchParams.get('imageSR'), '3857');
  assert.equal(parsedPrimaryUrl.searchParams.get('size'), '640,480');

  // When USGS returns a tiny < 2048 blank tile in CONUS, fall back cleanly to USDA NAIP
  const cascadeUrls = [];
  const fallbackSvc = serviceFor({
    fetchImpl: async (url) => {
      cascadeUrls.push(String(url));
      if (String(url).includes('basemap.nationalmap.gov')) return tinyBlankPngResponse();
      if (String(url).includes('gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME')) return largeJpegResponse();
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const naipRes = await fallbackSvc.resolve(request('listingId=CIV-NJ-7-53&mode=aerial'));
  assert.equal(naipRes.status, 200);
  assert.equal(naipRes.headers['X-Property-Image-Provider'], 'USDA NAIP');
  assert.equal(cascadeUrls.length, 2);
});

test('aerial mode skips USDA NAIP outside CONUS, rejects unverified/out-of-state listings, and authenticates x-pp-client-ip', async () => {
  const hiListing = liveListing({ id: 'HI-1', state: 'HI', lat: 21.3069, lng: -157.8583 });
  const hiUrls = [];
  const hiSvc = serviceFor({
    listing: hiListing,
    fetchImpl: async (url) => {
      hiUrls.push(String(url));
      return tinyBlankPngResponse();
    },
  });
  const hiRes = await hiSvc.resolve(request('listingId=HI-1&mode=aerial'));
  assert.equal(hiRes.status, 502);
  assert.equal(hiRes.body.error, 'upstream_non_image');
  assert.equal(hiUrls.some((u) => u.includes('usda.gov')), false);

  // Snapshot and out-of-state coordinates are rejected with 422 before hitting external providers
  let netCalls = 0;
  const badCoordSvc = serviceFor({
    listing: liveListing({ id: 'GA-SCOT', state: 'GA', lat: 55.953252, lng: -3.188267, address: 'P.O. Box 99', city: '', zip: '' }),
    fetchImpl: async () => { netCalls += 1; return largeJpegResponse(); },
  });
  const badRes = await badCoordSvc.resolve(request('listingId=GA-SCOT&mode=aerial'));
  assert.equal(badRes.status, 422);
  assert.equal(badRes.body.error, 'exact_location_unavailable');
  assert.equal(netCalls, 0);

  // Timing-safe x-edge-secret required to honor x-pp-client-ip
  const { FixedWindowRateLimiter } = require('../server/routes/property-image');
  const forged = { headers: { 'x-pp-client-ip': '203.0.113.9' }, socket: { remoteAddress: '10.0.0.2' } };
  const wrongSecret = { headers: { 'x-pp-client-ip': '203.0.113.9', 'x-edge-secret': 'wrong' }, socket: { remoteAddress: '10.0.0.2' } };
  const validSecret = { headers: { 'x-pp-client-ip': '203.0.113.9', 'x-edge-secret': 'shared-secret-123' }, socket: { remoteAddress: '10.0.0.2' } };
  assert.equal(FixedWindowRateLimiter.clientIp(forged, 0, 'shared-secret-123'), '10.0.0.2');
  assert.equal(FixedWindowRateLimiter.clientIp(wrongSecret, 0, 'shared-secret-123'), '10.0.0.2');
  assert.equal(FixedWindowRateLimiter.clientIp(validSecret, 0, 'shared-secret-123'), '203.0.113.9');
});
