'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateBbox,
  queryPanoramaxImagery,
  generateParcelSvgBlueprint,
  resolveListingVisual
} = require('../server/enrichment/panoramax');

test('Panoramax Client: calculates spatial bounding box from coordinates', () => {
  const lat = 40.7128;
  const lng = -74.0060;
  const bbox = calculateBbox(lat, lng, 100);

  assert.equal(bbox.length, 4);
  const [minLng, minLat, maxLng, maxLat] = bbox;
  assert.ok(minLng < lng && maxLng > lng);
  assert.ok(minLat < lat && maxLat > lat);
});

test('Panoramax Client: queries open street view imagery and extracts CC-BY metadata', async () => {
  const mockFetch = async (url, init) => {
    assert.match(url, /api\.panoramax\.xyz\/api\/search\?bbox=/);
    assert.match(url, /[?&]limit=10(?:&|$)/);
    assert.equal(init?.redirect, 'error');
    return {
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            id: 'photo-uuid-1234',
            collection: 'sequence-5678',
            geometry: {
              type: 'Point',
              coordinates: [-74.0059, 40.7129]
            },
            properties: {
              datetime: '2025-05-14T10:30:00Z',
              license: 'CC-BY-SA-4.0',
              field_of_view: 360
            }
          }
        ]
      })
    };
  };

  const imagery = await queryPanoramaxImagery({
    lat: 40.7128,
    lng: -74.0060,
    fetchFn: mockFetch
  });

  assert.ok(imagery);
  assert.equal(imagery.source, 'PANORAMAX_OPEN_STREET_VIEW');
  assert.equal(imagery.id, 'photo-uuid-1234');
  assert.equal(imagery.license, 'CC-BY-SA-4.0');
  assert.equal(imagery.displayApproved, true);
  assert.ok(imagery.distanceMeters <= 100);
  assert.match(imagery.viewerUrl, /pic=photo-uuid-1234/);
  assert.match(imagery.thumbnailUrl, /thumb\.jpg/);
  assert.equal(imagery.attribution, 'Panoramax contributors (CC-BY-SA-4.0)');
});

test('Panoramax Client: defaults radius to 100m, gates license strictly, and enforces Haversine distance', async () => {
  assert.deepEqual(calculateBbox(40.7128, -74.006), calculateBbox(40.7128, -74.006, 100));

  const missingGeometry = await queryPanoramaxImagery({
    lat: 40.7128,
    lng: -74.0060,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        features: [{ id: 'no-geom', properties: { license: 'CC-BY-SA-4.0' } }]
      })
    })
  });
  assert.equal(missingGeometry, null);

  const missingOrProprietaryLicense = await queryPanoramaxImagery({
    lat: 40.7128,
    lng: -74.0060,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        features: [
          { id: 'unlicensed', geometry: { type: 'Point', coordinates: [-74.006, 40.7128] }, properties: {} },
          { id: 'proprietary', geometry: { type: 'Point', coordinates: [-74.006, 40.7128] }, properties: { license: 'proprietary' } },
        ]
      })
    })
  });
  assert.equal(missingOrProprietaryLicense, null);

  const outsideRadius = await queryPanoramaxImagery({
    lat: 40.7128,
    lng: -74.0060,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        features: [
          { id: 'too-far', geometry: { type: 'Point', coordinates: [-74.006, 40.7145] }, properties: { license: 'CC-BY-SA-4.0' } }
        ]
      })
    })
  });
  assert.equal(outsideRadius, null);

  const nearestApproved = await queryPanoramaxImagery({
    lat: 40.7128,
    lng: -74.0060,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        features: [
          { id: 'farther-ok', geometry: { type: 'Point', coordinates: [-74.0065, 40.7133] }, properties: { license: 'CC-BY-SA-4.0' } },
          { id: 'nearest-etalab', geometry: { type: 'Point', coordinates: [-74.0061, 40.71285] }, properties: { license: 'ETALAB-2.0' } }
        ]
      })
    })
  });
  assert.equal(nearestApproved?.id, 'nearest-etalab');
  assert.equal(nearestApproved?.license, 'ETALAB-2.0');
  assert.equal(nearestApproved?.attribution, 'Panoramax contributors (ETALAB-2.0)');
});

test('Parcel Blueprint Generator: produces clean vector SVG without external scripts', () => {
  const svg = generateParcelSvgBlueprint({
    address: '100 Main St',
    state: 'OH',
    county: 'Cuyahoga',
    propType: 'Single Family',
    openingBid: 65000
  });

  assert.ok(typeof svg === 'string');
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /100 Main St/);
  assert.match(svg, /OH · Cuyahoga/);
  assert.match(svg, /\$65,000/);
  assert.doesNotMatch(svg, /<script/i, 'SVG must never contain executable scripts');
});

test('Visual Tier Resolver: enforces Tier 1 (Publisher) -> Tier 2 (Panoramax) -> Tier 3 (SVG Blueprint)', async () => {
  const sourceUrl = 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=101';
  const provenance = {
    media: {
      photo: {
        origin: 'publisher_record',
        verification: 'source_extracted',
        sourceRecordUrl: sourceUrl
      }
    }
  };

  // Case A1: Provenance-verified publisher photo (.imageUrl legacy field)
  const tier1Legacy = await resolveListingVisual({
    imageUrl: 'https://salesweb.civilview.com/photos/101.jpg',
    source: 'civilview',
    sourceUrl,
    provenance
  });
  assert.equal(tier1Legacy.tier, 'PUBLISHER');
  assert.equal(tier1Legacy.isFallback, false);

  // Case A2: Provenance-verified publisher photo (.photo canonical field)
  const tier1Photo = await resolveListingVisual({
    photo: 'https://salesweb.civilview.com/photos/101-primary.jpg',
    source: 'civilview',
    sourceUrl,
    provenance
  });
  assert.equal(tier1Photo.tier, 'PUBLISHER');
  assert.equal(tier1Photo.url, 'https://salesweb.civilview.com/photos/101-primary.jpg');

  // Case A3: Unverified .imageUrl without provenance must NOT pass as Tier 1 publisher photo
  const unverifiedFallback = await resolveListingVisual(
    { imageUrl: 'https://salesweb.civilview.com/photos/101.jpg', source: 'civilview', address: '101 Unverified St' },
    { fetchFn: async () => ({ ok: true, json: async () => ({ features: [] }) }) }
  );
  assert.equal(unverifiedFallback.tier, 'BLUEPRINT_SVG');

  // Case B: No publisher photo, Panoramax available within 100m with approved license
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      features: [{
        id: 'pano-1',
        geometry: { type: 'Point', coordinates: [-74.0061, 40.7129] },
        properties: { license: 'CC-BY-SA-4.0' }
      }]
    })
  });
  const tier2 = await resolveListingVisual(
    { lat: 40.7128, lng: -74.0060, address: '200 Oak Ave' },
    { fetchFn: mockFetch }
  );
  assert.equal(tier2.tier, 'PANORAMAX_STREET_VIEW');
  assert.equal(tier2.isFallback, false);

  // Case C: Neither photo exists -> SVG Blueprint
  const emptyFetch = async () => ({
    ok: true,
    json: async () => ({ features: [] })
  });
  const tier3 = await resolveListingVisual(
    { lat: 40.7128, lng: -74.0060, address: '300 Pine St' },
    { fetchFn: emptyFetch }
  );
  assert.equal(tier3.tier, 'BLUEPRINT_SVG');
  assert.equal(tier3.isFallback, true);
  assert.match(tier3.url, /^data:image\/svg\+xml/);
});
