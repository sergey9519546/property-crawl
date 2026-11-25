'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  projectToWebMercator,
  computeParcelFramedBbox,
  projectGeometryToSvgPaths,
  renderParcelCompositeSvg,
  createAerialTileCache,
} = require('../../server/media/parcel-visual-engine');
const { normalizeArcgisAttributes } = require('../../server/enrichment/arcgis-parcels');
const { createPropertyImageService } = require('../../server/routes/property-image');

const SAMPLE_PARCEL_POLYGON = {
  type: 'Polygon',
  coordinates: [[
    [-74.0820, 40.9100],
    [-74.0815, 40.9100],
    [-74.0815, 40.9104],
    [-74.0820, 40.9104],
    [-74.0820, 40.9100],
  ]],
};

const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 0x22)]);

test('computeParcelFramedBbox locks onto parcel geometry with 4:3 aspect ratio and falls back cleanly without geometry', () => {
  const locked = computeParcelFramedBbox({
    lat: 40.9102,
    lng: -74.08175,
    geometry: SAMPLE_PARCEL_POLYGON,
  });
  assert.equal(locked.parcelLocked, true);
  assert.equal(locked.width, 640);
  assert.equal(locked.height, 480);
  const ratio = (locked.maxX - locked.minX) / (locked.maxY - locked.minY);
  assert.ok(Math.abs(ratio - 4 / 3) < 0.01, `expected 4:3 ratio, got ${ratio}`);

  const unlocked = computeParcelFramedBbox({ lat: 40.9102, lng: -74.08175, geometry: null });
  assert.equal(unlocked.parcelLocked, false);
  const unlockedRatio = (unlocked.maxX - unlocked.minX) / (unlocked.maxY - unlocked.minY);
  assert.ok(Math.abs(unlockedRatio - 4 / 3) < 0.01);
});

test('projectGeometryToSvgPaths projects parcel polygon inside the 640x480 viewport', () => {
  const frame = computeParcelFramedBbox({
    lat: 40.9102,
    lng: -74.08175,
    geometry: SAMPLE_PARCEL_POLYGON,
  });
  const paths = projectGeometryToSvgPaths(SAMPLE_PARCEL_POLYGON, frame);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^M\s+\d+\.\d+,\d+\.\d+/);
  assert.match(paths[0], /Z$/);
});

test('renderParcelCompositeSvg embeds base64 ortho, parcel outline, and honest provenance without scripts', () => {
  const frame = computeParcelFramedBbox({
    lat: 40.9102,
    lng: -74.08175,
    geometry: SAMPLE_PARCEL_POLYGON,
  });
  const svg = renderParcelCompositeSvg({
    imageBuffer: FAKE_JPEG,
    contentType: 'image/jpeg',
    geometry: SAMPLE_PARCEL_POLYGON,
    frame,
    lat: 40.9102,
    lng: -74.08175,
    precision: 'source_observed',
    provider: 'USGS National Map',
    lotAcres: 0.28,
    parcelId: '02-00123-0004',
  });
  assert.match(svg, /^<svg\s/);
  assert.match(svg, /data:image\/jpeg;base64,/);
  assert.match(svg, /PARCEL-LOCKED AERIAL/);
  assert.match(svg, /0\.28 ac/);
  assert.match(svg, /USGS National Map/);
  assert.doesNotMatch(svg, /<script/i);

  // Without parcel geometry + street_interpolated -> must disclose street-interpolated uncertainty ring
  const interpFrame = computeParcelFramedBbox({ lat: 40.9102, lng: -74.08175, geometry: null });
  const interpSvg = renderParcelCompositeSvg({
    imageBuffer: FAKE_JPEG,
    contentType: 'image/jpeg',
    geometry: null,
    frame: interpFrame,
    lat: 40.9102,
    lng: -74.08175,
    precision: 'street_interpolated',
    provider: 'USDA NAIP',
  });
  assert.match(interpSvg, /STREET-INTERPOLATED/);
  assert.match(interpSvg, /stroke-dasharray/);
});

test('createAerialTileCache coalesces concurrent requests and caches bounded entries', async () => {
  const cache = createAerialTileCache({ maxEntries: 2, ttlMs: 60_000 });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 15));
    return { provider: 'USGS National Map', body: FAKE_JPEG };
  };
  const [a, b] = await Promise.all([cache.getOrLoad('k1', loader), cache.getOrLoad('k1', loader)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  const c = await cache.getOrLoad('k1', loader);
  assert.equal(calls, 1);
  assert.equal(c, a);
});

test('normalizeArcgisAttributes extracts valid HTTPS county assessor photo URLs and rejects placeholders', () => {
  const config = { name: 'Test County', apnField: 'APN', assessedTotalField: 'TOTAL' };
  const withPhoto = normalizeArcgisAttributes(
    { APN: '123-45', TOTAL: 250000, PHOTO_URL: 'https://assessor.county.gov/photos/12345.jpg' },
    config,
  );
  assert.equal(withPhoto.assessorPhotoUrl, 'https://assessor.county.gov/photos/12345.jpg');

  const withPlaceholder = normalizeArcgisAttributes(
    { APN: '123-45', TOTAL: 250000, PHOTO_URL: 'https://assessor.county.gov/images/no-image-placeholder.png' },
    config,
  );
  assert.equal(withPlaceholder.assessorPhotoUrl, null);
});

test('property-image mode=composite serves parcel-locked SVG, caches aerial fetches, and accepts email_notice origin', async () => {
  let aerialFetches = 0;
  const listing = {
    id: 'email-nj-1',
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=999999',
    address: '123 Main St',
    city: 'Hackensack',
    state: 'NJ',
    zip: '07601',
    county: 'Bergen',
    lat: 40.9102,
    lng: -74.08175,
    provenance: {
      origin: 'email_notice',
      observed: true,
      recordKind: 'source_record',
      publisher: 'NJ Public Notices',
      recordId: 'email-nj-1',
      observedAt: new Date().toISOString(),
    },
  };
  const service = createPropertyImageService({
    db: { getListingById: async (id) => (id === listing.id ? listing : null) },
    env: {},
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('USGSImageryOnly')) {
        aerialFetches += 1;
        return new Response(FAKE_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      return new Response('not found', { status: 404 });
    },
    parcelLookupImpl: async () => ({
      type: 'Feature',
      geometry: SAMPLE_PARCEL_POLYGON,
      properties: { parcelId: '02-00123-0004', lotAcres: 0.28 },
    }),
  });

  const makeReq = () => ({
    method: 'GET',
    url: `/api/property-image?listingId=${listing.id}&mode=composite`,
    headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  });

  const res1 = await service.resolve(makeReq());
  assert.equal(res1.status, 200);
  assert.equal(res1.headers['Content-Type'], 'image/svg+xml; charset=utf-8');
  assert.equal(res1.headers['X-Property-Image-Parcel-Locked'], 'true');
  assert.match(res1.body.toString('utf8'), /PARCEL-LOCKED AERIAL/);
  assert.equal(aerialFetches, 1);

  // Second request MUST hit server cache without fetching USGS again
  const res2 = await service.resolve(makeReq());
  assert.equal(res2.status, 200);
  assert.equal(aerialFetches, 1);
});

test('stripDuplicateBatchPhotos removes cross-building banner reuse while preserving multi-unit condos', () => {
  const { stripDuplicateBatchPhotos } = require('../../server/scrapers/media-policy');
  const courthouse1 = 'https://portal.example.com/static/courthouse.jpg?v=1';
  const courthouse2 = 'https://portal.example.com/static/courthouse.jpg?v=2';
  const courthouse3 = 'https://portal.example.com/static/courthouse.jpg?v=3';
  const condoPhoto = 'https://portal.example.com/condo/100-oak.jpg';
  const listings = [
    { id: '1', address: '10 Main St', state: 'NJ', zip: '07601', photo: courthouse1, images: [courthouse1] },
    { id: '2', address: '20 Elm St', state: 'NJ', zip: '07601', photo: courthouse2, images: [courthouse2] },
    { id: '3', address: '30 Pine St', state: 'NJ', zip: '07601', photo: courthouse3, images: [courthouse3] },
    { id: '4', address: '100 Oak Ave Apt 1A', state: 'NJ', zip: '07601', photo: condoPhoto },
    { id: '5', address: '100 Oak Ave Apt 2B', state: 'NJ', zip: '07601', photo: condoPhoto },
    { id: '6', address: '100 Oak Ave Apt 3C', state: 'NJ', zip: '07601', photo: condoPhoto },
  ];
  const res = stripDuplicateBatchPhotos(listings, { minDistinctBuildings: 3 });
  assert.equal(res.strippedCount, 3);
  assert.equal(listings[0].photo, null);
  assert.equal(listings[0].provenance.media.photoRejected.reason, 'duplicate_photo_url_poison');
  assert.equal(listings[3].photo, condoPhoto);
  assert.equal(listings[4].photo, condoPhoto);
  assert.equal(listings[5].photo, condoPhoto);
});

test('geocodeExactAddressBatch parses Census batch CSV, enforces state bounds + street number, and stamps street_interpolated', async () => {
  const { geocodeExactAddressBatch } = require('../../server/enrichment/geocoder');
  const csv = [
    '"id-ok","123 Main St, Hackensack, NJ, 07601","Match","Exact","123 MAIN ST, HACKENSACK, NJ, 07601","-74.0435,40.8859","12345","L"',
    '"id-bad-num","456 Elm St, Hackensack, NJ, 07601","Match","Exact","999 ELM ST, HACKENSACK, NJ, 07601","-74.0435,40.8859","12346","R"',
    '"id-bad-state","789 Oak St, Hackensack, NJ, 07601","Match","Exact","789 OAK ST, HACKENSACK, NJ, 07601","-118.2437,34.0522","12347","L"',
  ].join('\n');
  const results = await geocodeExactAddressBatch(
    [
      { id: 'id-ok', expected: { street: '123 Main St', streetNumber: '123', city: 'Hackensack', state: 'NJ', zip5: '07601' } },
      { id: 'id-bad-num', expected: { street: '456 Elm St', streetNumber: '456', city: 'Hackensack', state: 'NJ', zip5: '07601' } },
      { id: 'id-bad-state', expected: { street: '789 Oak St', streetNumber: '789', city: 'Hackensack', state: 'NJ', zip5: '07601' } },
    ],
    {
      fetchFn: async () => new Response(csv, { status: 200, headers: { 'content-type': 'text/plain' } }),
      skipCache: true,
    },
  );
  assert.equal(results.size, 1);
  assert.equal(results.get('id-ok').precision, 'street_interpolated');
  assert.equal(results.get('id-ok').lat, 40.8859);
  assert.equal(results.has('id-bad-num'), false);
  assert.equal(results.has('id-bad-state'), false);
});

test('property-image isolates aerial/composite rate limit from billable Street View limiter and passes AbortSignal to parcel lookup', async () => {
  let receivedSignal = null;
  const listing = {
    id: 'rate-iso-1',
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=888888',
    address: '123 Main St',
    city: 'Hackensack',
    state: 'NJ',
    zip: '07601',
    county: 'Bergen',
    lat: 40.9102,
    lng: -74.08175,
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: 'rate-iso-1',
      observedAt: new Date().toISOString(),
    },
  };
  const service = createPropertyImageService({
    db: { getListingById: async (id) => (id === listing.id ? listing : null) },
    env: { PROPERTY_IMAGE_RATE_LIMIT: '2', AERIAL_PUBLIC_RATE_LIMIT: '10' },
    fetchImpl: async (url) => {
      if (String(url).includes('USGSImageryOnly')) {
        return new Response(FAKE_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      return new Response('not found', { status: 404 });
    },
    parcelLookupImpl: async ({ signal }) => {
      receivedSignal = signal;
      return { type: 'Feature', geometry: SAMPLE_PARCEL_POLYGON, properties: { parcelId: '02-00123-0004' } };
    },
  });

  const makeReq = (mode) => ({
    method: 'GET',
    url: `/api/property-image?listingId=${listing.id}&mode=${mode}`,
    headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  });

  // 4 composite requests MUST succeed even though Street View limiter is capped at 2
  for (let i = 0; i < 4; i += 1) {
    const res = await service.resolve(makeReq('composite'));
    assert.equal(res.status, 200);
  }
  assert.ok(receivedSignal && typeof receivedSignal.aborted === 'boolean', 'parcelLookupImpl must receive AbortSignal');

  // Street View metadata limiter (cap=2) must NOT have been consumed by composite calls
  const svRes = await service.resolve(makeReq('metadata'));
  assert.notEqual(svRes.status, 429, 'composite traffic must not exhaust Street View rate limit');
});

test('ListingThumbnail and ListingMedia keep silent auto-aerial failures separate from user-triggered errors', () => {
  const fs = require('node:fs');
  const thumbSrc = fs.readFileSync(require.resolve('../../src/components/listings/listing-thumbnail.tsx'), 'utf8');
  assert.match(thumbSrc, /aerialUserRequested/, 'ListingThumbnail must distinguish auto-aerial from user-requested aerial');

  const mediaSrc = fs.readFileSync(require.resolve('../../src/components/listings/listing-media.tsx'), 'utf8');
  assert.match(mediaSrc, /aerialUserRequested/, 'ListingMedia must gate aerial error banner on explicit user request');
});
