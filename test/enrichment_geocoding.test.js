'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  normalizeAddress,
  hashAddress,
  parseCensusResponse,
  geocodeAddress
} = require('../server/enrichment/geocoder');

const {
  COUNTY_ARCGIS_REGISTRY,
  resolveCountyKey,
  normalizeApn,
  normalizeArcgisAttributes,
  queryArcgisParcel
} = require('../server/enrichment/arcgis-parcels');

test('US Census Geocoder: normalizes and hashes addresses deterministically', () => {
  const raw1 = '4600 Silver Hill Rd., Washington, DC 20233';
  const raw2 = '4600  SILVER HILL RD,   WASHINGTON, DC, 20233';

  assert.equal(normalizeAddress(raw1), '4600 SILVER HILL RD WASHINGTON DC 20233');
  assert.equal(normalizeAddress(raw1), normalizeAddress(raw2));
  assert.equal(hashAddress(raw1), hashAddress(raw2));
  assert.equal(typeof hashAddress(raw1), 'string');
  assert.equal(hashAddress(raw1).length, 64); // SHA-256 hex length
});

test('US Census Geocoder: parses Census API payload correctly', () => {
  const fixture = {
    result: {
      input: { address: { address: '4600 Silver Hill Rd' } },
      addressMatches: [
        {
          matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233',
          coordinates: { x: -76.92744, y: 38.85042 },
          addressComponents: {
            fromAddress: '4600',
            toAddress: '4600',
            preDirection: '',
            streetName: 'SILVER HILL',
            suffixType: 'RD',
            city: 'WASHINGTON',
            state: 'DC',
            zip: '20233'
          }
        }
      ]
    }
  };

  const parsed = parseCensusResponse(fixture);
  assert.ok(parsed);
  assert.equal(parsed.source, 'US_CENSUS_GEOCODER');
  assert.equal(parsed.lat, 38.85042);
  assert.equal(parsed.lng, -76.92744);
  assert.equal(parsed.standardized.city, 'WASHINGTON');
  assert.equal(parsed.standardized.state, 'DC');
  assert.equal(parsed.standardized.zip, '20233');
});

test('US Census Geocoder: queries API, caches result, and serves from cache', async (t) => {
  const tmpCache = path.resolve(__dirname, '../.cache/test-geocoding-cache.json');
  if (fs.existsSync(tmpCache)) fs.unlinkSync(tmpCache);

  let fetchCallCount = 0;
  const mockFetch = async (url) => {
    fetchCallCount++;
    return {
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            {
              matchedAddress: '123 MAIN ST, COLUMBUS, OH 43215',
              coordinates: { x: -82.9988, y: 39.9612 },
              addressComponents: {
                streetName: 'MAIN',
                suffixType: 'ST',
                city: 'COLUMBUS',
                state: 'OH',
                zip: '43215'
              }
            }
          ]
        }
      })
    };
  };

  t.after(() => {
    if (fs.existsSync(tmpCache)) fs.unlinkSync(tmpCache);
  });

  // First call should invoke fetch and write cache
  const res1 = await geocodeAddress('123 Main St, Columbus, OH 43215', {
    cachePath: tmpCache,
    fetchFn: mockFetch
  });

  assert.ok(res1);
  assert.equal(res1.lat, 39.9612);
  assert.equal(res1.lng, -82.9988);
  assert.equal(res1.cached, false);
  assert.equal(fetchCallCount, 1);
  assert.ok(fs.existsSync(tmpCache));

  // Second call should return from cache without invoking fetch
  const res2 = await geocodeAddress('123 Main St, Columbus, OH 43215', {
    cachePath: tmpCache,
    fetchFn: mockFetch
  });

  assert.ok(res2);
  assert.equal(res2.cached, true);
  assert.equal(res2.lat, 39.9612);
  assert.equal(fetchCallCount, 1, 'Cache hit must not re-query remote API');
});

test('ArcGIS Resolver: normalizes APNs and county registry keys', () => {
  assert.equal(normalizeApn('123-456-789-00'), '12345678900');
  assert.equal(normalizeApn('TX.BEX. 00412'), 'TXBEX00412');

  assert.equal(resolveCountyKey('TX', 'Bexar County'), 'TX-BEXAR');
  assert.equal(resolveCountyKey('OH', 'Cuyahoga'), 'OH-CUYAHOGA');
  assert.equal(resolveCountyKey('FL', 'Orange County'), 'FL-ORANGE');
  assert.equal(resolveCountyKey('ZZ', 'Unknown'), null);
});

test('ArcGIS Resolver: executes spatial parcel queries and normalizes assessment data', async () => {
  const mockFetch = async (url) => {
    assert.match(url, /geometry=-98\.4936%2C29\.4241/);
    return {
      ok: true,
      json: async () => ({
        features: [
          {
            attributes: {
              PROP_ID: '04120-105-0010',
              STATE_CD: 'A1 - Single Family Residence',
              APPRAISED_VAL: 245000,
              LAND_VAL: 45000,
              IMPRV_VAL: 200000,
              LEGAL_DESC: 'LOT 1 BLK 5 NCB 4120'
            }
          }
        ]
      })
    };
  };

  const parcel = await queryArcgisParcel({
    lat: 29.4241,
    lng: -98.4936,
    state: 'TX',
    county: 'Bexar',
    fetchFn: mockFetch
  });

  assert.ok(parcel);
  assert.equal(parcel.source, 'ARCGIS_REST_PARCEL');
  assert.equal(parcel.countyFips, '48029');
  assert.equal(parcel.rawApn, '04120-105-0010');
  assert.equal(parcel.canonicalApn, '041201050010');
  assert.equal(parcel.assessedValue.total, 245000);
  assert.equal(parcel.assessedValue.land, 45000);
  assert.equal(parcel.assessedValue.improvements, 200000);
  assert.match(parcel.landUse, /Single Family/);
});

test('ArcGIS Resolver: fails closed on unmapped county or network error', async () => {
  const unmapped = await queryArcgisParcel({
    lat: 40.0,
    lng: -80.0,
    state: 'WY',
    county: 'Teton'
  });
  assert.equal(unmapped, null, 'Unmapped county must fail gracefully with null');

  const errorFetch = async () => {
    throw new Error('Connection refused');
  };

  const failed = await queryArcgisParcel({
    lat: 29.4241,
    lng: -98.4936,
    state: 'TX',
    county: 'Bexar',
    fetchFn: errorFetch
  });
  assert.equal(failed, null, 'Network failure must return null without crashing');
});
