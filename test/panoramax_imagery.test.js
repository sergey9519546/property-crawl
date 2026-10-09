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
  const mockFetch = async (url) => {
    assert.match(url, /api\.panoramax\.xyz\/api\/search\?bbox=/);
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
  assert.match(imagery.viewerUrl, /pic=photo-uuid-1234/);
  assert.match(imagery.thumbnailUrl, /thumb\.jpg/);
  assert.equal(imagery.attribution, 'Panoramax contributors (CC-BY-SA-4.0)');
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
  // Case A: Publisher photo exists
  const tier1 = await resolveListingVisual({
    imageUrl: 'https://sheriff.cuyahogacounty.us/photos/101.jpg',
    source: 'sheriff'
  });
  assert.equal(tier1.tier, 'PUBLISHER');
  assert.equal(tier1.isFallback, false);

  // Case B: No publisher photo, Panoramax available
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      features: [{ id: 'pano-1', properties: { license: 'CC-BY-SA-4.0' } }]
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
