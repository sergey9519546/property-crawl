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
  COUNTY_ARCGIS_ENDPOINTS,
  STATEWIDE_ARCGIS_REGISTRY,
  resolveCountyKey,
  resolveCountyEndpoint,
  normalizeApn,
  normalizeArcgisAttributes,
  normalizeParcelAttributes,
  queryArcgisParcel,
  queryCountyParcel,
  selectBestFeature,
  parseNumericAttribute,
  resolveCadastralParcelIdentity
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
  assert.equal(resolveCountyKey('TX', 'Harris County'), 'TX-HARRIS');
  assert.equal(resolveCountyKey('OH', 'Cuyahoga'), 'OH-CUYAHOGA');
  assert.equal(resolveCountyKey('FL', 'Orange County'), 'FL-ORANGE');
  assert.equal(resolveCountyKey('FL', 'Alachua County'), 'FL-ALACHUA');
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

test('ArcGIS Resolver: centroid layers fall back to a small envelope after an empty point match', async () => {
  // Hamilton County's CAGIS layer carries parcel centroids, not polygons: a
  // point-intersect only matches an exact centroid, so the resolver retries
  // once with a ~44 m envelope around the same point. The retry must carry
  // the envelope geometry type and stay bounded to a single attempt.
  const requested = [];
  const mockFetch = async (url) => {
    requested.push(String(url));
    const isEnvelope = /geometryType=esriGeometryEnvelope/.test(String(url));
    return {
      ok: true,
      json: async () => ({
        features: isEnvelope
          ? [{ attributes: { PARCELID: '050002130146', CLASS: '510', MKT_TOTAL_VAL: 282790, MKTLND: 47250, MKTIMP: 235540, LGLDS1: 'LOT 14' } }]
          : []
      })
    };
  };

  const parcel = await queryArcgisParcel({
    lat: 39.1029,
    lng: -84.5150,
    state: 'OH',
    county: 'Hamilton',
    fetchFn: mockFetch
  });

  assert.ok(parcel, 'the envelope retry must recover the centroid match');
  assert.equal(parcel.rawApn, '050002130146');
  assert.equal(parcel.assessedValue.total, 282790);
  assert.equal(requested.length, 2, 'exactly one point query and one envelope retry');
  assert.match(requested[0], /geometryType=esriGeometryPoint/);
  assert.match(requested[1], /geometryType=esriGeometryEnvelope/);
});

test('ArcGIS Resolver: the envelope fallback is bounded to one retry even when it also misses', async () => {
  const requested = [];
  const mockFetch = async (url) => {
    requested.push(String(url));
    return { ok: true, json: async () => ({ features: [] }) };
  };
  const miss = await queryArcgisParcel({
    lat: 39.1029,
    lng: -84.5150,
    state: 'OH',
    county: 'Hamilton',
    fetchFn: mockFetch
  });
  assert.equal(miss, null, 'a genuine miss returns null');
  assert.equal(requested.length, 2, 'point query plus at most one envelope retry');
});

test('ArcGIS Resolver: enrolled statewide and high-volume county registries resolve with valid FIPS and https endpoints', () => {
  assert.equal(COUNTY_ARCGIS_ENDPOINTS, COUNTY_ARCGIS_REGISTRY);
  assert.equal(normalizeParcelAttributes, normalizeArcgisAttributes);
  assert.equal(queryCountyParcel, queryArcgisParcel);

  const expectedCounties = [
    // NJ statewide MOD-IV counties
    ['NJ', 'Bergen County', 'NJ-BERGEN', '34003'],
    ['NJ', 'Passaic', 'NJ-PASSAIC', '34031'],
    ['NJ', 'Hudson County', 'NJ-HUDSON', '34017'],
    ['NJ', 'Monmouth', 'NJ-MONMOUTH', '34025'],
    ['NJ', 'Essex', 'NJ-ESSEX', '34013'],
    ['NJ', 'Camden', 'NJ-CAMDEN', '34007'],
    // High-volume direct county endpoints
    ['PA', 'Philadelphia', 'PA-PHILADELPHIA', '42101'],
    ['PA', 'Chester County', 'PA-CHESTER', '42029'],
    ['PA', 'Bucks', 'PA-BUCKS', '42017'],
    ['PA', 'Berks', 'PA-BERKS', '42011'],
    ['MI', 'Wayne County', 'MI-WAYNE', '26163'],
    ['OH', 'Summit', 'OH-SUMMIT', '39153'],
    ['OH', 'Stark County', 'OH-STARK', '39151'],
    ['OH', 'Lake', 'OH-LAKE', '39085'],
    ['FL', 'Palm Beach', 'FL-PALM BEACH', '12099'],
    ['FL', 'Pinellas', 'FL-PINELLAS', '12103'],
    ['FL', 'Brevard', 'FL-BREVARD', '12009'],
    ['FL', 'Collier', 'FL-COLLIER', '12021'],
    ['FL', 'Miami-Dade', 'FL-MIAMI-DADE', '12086'],
    ['FL', 'St. Johns', 'FL-ST. JOHNS', '12109'],
    ['GA', 'DeKalb County', 'GA-DEKALB', '13089'],
    ['CA', 'San Bernardino', 'CA-SAN BERNARDINO', '06071'],
    ['WA', 'Pierce', 'WA-PIERCE', '53053'],
    ['AL', 'Jefferson', 'AL-JEFFERSON', '01073'],
    ['MN', 'Hennepin', 'MN-HENNEPIN', '27053'],
    ['MN', 'Ramsey', 'MN-RAMSEY', '27123'],
    ['UT', 'Salt Lake', 'UT-SALT LAKE', '49035'],
    // Statewide composite counties
    ['CO', 'Adams', 'CO-ADAMS', '08001'],
    ['CO', 'Arapahoe', 'CO-ARAPAHOE', '08005'],
    ['NC', 'Mecklenburg', 'NC-MECKLENBURG', '37119'],
    ['NC', 'Cumberland', 'NC-CUMBERLAND', '37051'],
    ['NY', 'Kings', 'NY-KINGS', '36047'],
    ['NY', 'Suffolk', 'NY-SUFFOLK', '36103'],
    ['WI', 'Milwaukee', 'WI-MILWAUKEE', '55079'],
    ['CT', 'Hartford', 'CT-HARTFORD', '09003'],
    ['AR', 'Pulaski', 'AR-PULASKI', '05119'],
  ];

  for (const [state, county, expectedKey, expectedFips] of expectedCounties) {
    const key = resolveCountyKey(state, county);
    assert.equal(key, expectedKey, `resolveCountyKey(${state}, ${county}) should equal ${expectedKey}`);
    const entry = COUNTY_ARCGIS_REGISTRY[key];
    assert.ok(entry, `Registry entry must exist for ${key}`);
    assert.equal(entry.fips, expectedFips, `${key} FIPS should equal ${expectedFips}`);
    assert.match(entry.endpoint, /^https:\/\//, `${key} endpoint must be https`);
    assert.ok(entry.apnField, `${key} must define apnField`);
    assert.ok(entry.assessedTotalField || entry.sumLandAndImprvForTotal, `${key} must define valuation field or sumLandAndImprvForTotal`);
  }
});

test('ArcGIS Resolver: resolveCountyEndpoint supports county-specific precedence and statewide fallback', () => {
  // FL-ORANGE has a dedicated county-specific FeatureServer that takes precedence over FL statewide centroids
  const orange = resolveCountyEndpoint('FL', 'Orange County');
  assert.ok(orange);
  assert.equal(orange.key, 'FL-ORANGE');
  assert.match(orange.endpoint, /ocpafl\.org/);

  // FL-COLLIER uses the Florida GIO statewide centroid service
  const collier = resolveCountyEndpoint('FL', 'Collier');
  assert.ok(collier);
  assert.equal(collier.key, 'FL-COLLIER');
  assert.equal(collier.fips, '12021');
  assert.equal(collier.spatialFallback, 'envelope');
  assert.match(collier.endpoint, /Florida_Statewide_Parcel_Centroid_Version/);

  // A listing in a statewide-covered state (e.g. NJ or CO) with missing county name falls back to STATEWIDE_ARCGIS_REGISTRY
  const njFallback = resolveCountyEndpoint('NJ', '');
  assert.ok(njFallback);
  assert.equal(njFallback.key, 'NJ-STATEWIDE');
  assert.equal(njFallback.statewideService, 'NJ');
  assert.match(njFallback.endpoint, /maps\.nj\.gov/);

  // Uncovered state with no county returns null
  assert.equal(resolveCountyEndpoint('WY', ''), null);
});

test('ArcGIS Resolver: normalizes NJ MOD-IV, comma-formatted strings, and sumLandAndImprvForTotal without fabricating values', () => {
  // 1. NJ MOD-IV attributes (NJ-BERGEN)
  const njConfig = COUNTY_ARCGIS_REGISTRY['NJ-BERGEN'];
  const njParcel = normalizeParcelAttributes({
    PAMS_PIN: '0206_703_8',
    PROP_CLASS: '2',
    NET_VALUE: 351000,
    LAND_VAL: 165300,
    IMPRVT_VAL: 185700,
    BLDG_DESC: '2SF',
    ST_ADDRESS: '182 COTTAGE LN'
  }, njConfig);
  assert.equal(njParcel.countyFips, '34003');
  assert.equal(njParcel.rawApn, '0206_703_8');
  assert.equal(njParcel.canonicalApn, '02067038');
  assert.equal(njParcel.situsAddress, '182 COTTAGE LN');
  assert.equal(njParcel.assessedValue.total, 351000);
  assert.equal(njParcel.assessedValue.land, 165300);
  assert.equal(njParcel.assessedValue.improvements, 185700);

  // 2. Comma-formatted string values + sumLandAndImprvForTotal (CA-SAN BERNARDINO)
  const sbConfig = COUNTY_ARCGIS_REGISTRY['CA-SAN BERNARDINO'];
  const sbParcel = normalizeParcelAttributes({
    ParcelNumber: '3104-611-12',
    AssessClass: 'SINGLE FAMILY RESIDENTIAL',
    LandValue: '78,030',
    ImprovementValue: '396,080',
    ZoningDescription: 'City of Victorville'
  }, sbConfig);
  assert.equal(sbParcel.countyFips, '06071');
  assert.equal(sbParcel.canonicalApn, '310461112');
  assert.equal(sbParcel.assessedValue.land, 78030);
  assert.equal(sbParcel.assessedValue.improvements, 396080);
  assert.equal(sbParcel.assessedValue.total, 474110);

  // 3. Zero-fabrication guard: when land or improvement is missing on a sumLandAndImprvForTotal layer, total is not imputed
  const sbMissing = normalizeParcelAttributes({
    ParcelNumber: '3104-611-13',
    AssessClass: 'VACANT',
    LandValue: null,
    ImprovementValue: null
  }, sbConfig);
  assert.equal(sbMissing.assessedValue.total, null);
  assert.equal(sbMissing.assessedValue.land, null);
  assert.equal(sbMissing.assessedValue.improvements, null);
});

test('ArcGIS Resolver: resolveCadastralParcelIdentity resolves countyFips, canonicalApn, and parcelKey across spatial and APN lookups', async () => {
  // Spatial lookup on NJ-BERGEN
  const spatialIdentity = await resolveCadastralParcelIdentity(
    {
      state: 'NJ',
      county: 'Bergen',
      lat: 40.81479,
      lng: -73.99048
    },
    {
      fetchFn: async (url) => {
        assert.match(String(url), /maps\.nj\.gov/);
        assert.match(String(url), /geometryType=esriGeometryPoint/);
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                PAMS_PIN: '0206_703_8',
                PROP_CLASS: '2',
                NET_VALUE: 351000,
                LAND_VAL: 165300,
                IMPRVT_VAL: 185700,
                ST_ADDRESS: '182 COTTAGE LN'
              }
            }]
          })
        };
      }
    }
  );
  assert.ok(spatialIdentity);
  assert.equal(spatialIdentity.countyFips, '34003');
  assert.equal(spatialIdentity.rawApn, '0206_703_8');
  assert.equal(spatialIdentity.canonicalApn, '02067038');
  assert.equal(spatialIdentity.parcelKey, '34003-02067038');
  assert.equal(spatialIdentity.matchBasis, 'cadastral_point_in_polygon');

  // APN lookup on statewide service with countyFilterField and dynamic 3-digit FIPS extraction (CO)
  const apnIdentity = await resolveCadastralParcelIdentity(
    {
      state: 'CO',
      county: 'Adams',
      apn: '01825-071-12-004'
    },
    {
      fetchFn: async (url) => {
        assert.match(String(url), /gis\.colorado\.gov/);
        assert.match(decodeURIComponent(String(url)), /UPPER\(countyName\)\+LIKE\+'%ADAMS%'/);
        return {
          ok: true,
          json: async () => ({
            features: [{
              attributes: {
                parcel_id: '0182507112004',
                countyFips: '001',
                apprValTot: '421000',
                landUseDsc: 'Residential'
              }
            }]
          })
        };
      }
    }
  );
  assert.ok(apnIdentity);
  assert.equal(apnIdentity.countyFips, '08001');
  assert.equal(apnIdentity.canonicalApn, '0182507112004');
  assert.equal(apnIdentity.parcelKey, '08001-0182507112004');
  assert.equal(apnIdentity.matchBasis, 'cadastral_apn_lookup');
});

test('ArcGIS Resolver: FL-ALACHUA enforces Zero-Fabrication Underwriting', () => {
  const alachuaConfig = COUNTY_ARCGIS_REGISTRY['FL-ALACHUA'];
  assert.ok(alachuaConfig);
  assert.equal(alachuaConfig.assessedTotalField, 'justvalue');
  assert.equal(alachuaConfig.assessedLandField, null);
  assert.equal(alachuaConfig.assessedImprvField, null);

  const attributes = {
    parcel: '01234-000-000',
    flucode: 'SFR',
    justvalue: 285000,
    zonelink: 'RSF-2'
  };

  const normalized = normalizeArcgisAttributes(attributes, alachuaConfig);
  assert.ok(normalized);
  assert.equal(normalized.rawApn, '01234-000-000');
  assert.equal(normalized.canonicalApn, '01234000000');
  assert.equal(normalized.assessedValue.total, 285000);
  assert.equal(normalized.assessedValue.land, null, 'FL-ALACHUA must not map justvalue to land');
  assert.equal(normalized.assessedValue.improvements, null, 'FL-ALACHUA must not map justvalue to improvements');
});

test('ArcGIS Resolver: sanitizes county names with apostrophes and prevents SQL comment injection', async () => {
  const capturedUrls = [];
  const mockFetch = async (url) => {
    capturedUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({ features: [] })
    };
  };

  // Test 1: Apostrophe in county name ("Prince George's") on a statewide service with countyFilterField (NC)
  await queryArcgisParcel({
    state: 'NC',
    county: "Prince George's County",
    apn: '12345',
    fetchFn: mockFetch
  });

  // Test 2: Curly apostrophe ("Queen Anne’s")
  await queryArcgisParcel({
    state: 'NC',
    county: 'Queen Anne\u2019s Parish',
    apn: '67890',
    fetchFn: mockFetch
  });

  // Test 3: SQL comment injection attempt ("Wake' -- injection")
  await queryArcgisParcel({
    state: 'NC',
    county: "Wake' -- injection",
    apn: '99999',
    fetchFn: mockFetch
  });

  assert.equal(capturedUrls.length, 3);

  const url1 = decodeURIComponent(capturedUrls[0]);
  assert.match(url1, /UPPER\(cntyname\)\+LIKE\+'%PRINCE\+GEORGES%'/);
  assert.doesNotMatch(url1, /PRINCE.*'.*GEORGES/, 'Must strip apostrophe from county name');

  const url2 = decodeURIComponent(capturedUrls[1]);
  assert.match(url2, /UPPER\(cntyname\)\+LIKE\+'%QUEEN\+ANNES%'/);
  assert.doesNotMatch(url2, /\u2019/, 'Must strip curly apostrophe from county name');

  const url3 = decodeURIComponent(capturedUrls[2]);
  assert.match(url3, /UPPER\(cntyname\)\+LIKE\+'%WAKE\+\+INJECTION%'/);
  assert.doesNotMatch(url3, /--/, 'Must strip SQL comment dashes');
});

test('ArcGIS Resolver: calculates total for vacant lot when improvements is null and sumLandAndImprvForTotal is true', () => {
  const sbConfig = COUNTY_ARCGIS_REGISTRY['CA-SAN BERNARDINO'];
  assert.ok(sbConfig.sumLandAndImprvForTotal);

  // Vacant lot: land is positive, improvements is null
  const vacantLot = normalizeArcgisAttributes({
    ParcelNumber: '3104-611-99',
    AssessClass: 'VACANT LAND',
    LandValue: '65,000',
    ImprovementValue: null,
    ZoningDescription: 'Residential Vacant'
  }, sbConfig);

  assert.ok(vacantLot);
  assert.equal(vacantLot.canonicalApn, '310461199');
  assert.equal(vacantLot.assessedValue.land, 65000);
  assert.equal(vacantLot.assessedValue.improvements, null);
  assert.equal(vacantLot.assessedValue.total, 65000, 'Vacant lot with null improvements must have total equal to land value');

  // Vacant lot: improvements is 0
  const vacantLotZero = normalizeArcgisAttributes({
    ParcelNumber: '3104-611-98',
    AssessClass: 'VACANT LAND',
    LandValue: 42000,
    ImprovementValue: 0
  }, sbConfig);

  assert.equal(vacantLotZero.assessedValue.land, 42000);
  assert.equal(vacantLotZero.assessedValue.improvements, 0);
  assert.equal(vacantLotZero.assessedValue.total, 42000);
});

test('ArcGIS Resolver: rejects negative valuation sentinels as null', () => {
  assert.ok(Number.isNaN(parseNumericAttribute('-100')));
  assert.ok(Number.isNaN(parseNumericAttribute(-50)));
  assert.ok(Number.isNaN(parseNumericAttribute('-$250')));
  assert.equal(parseNumericAttribute('0'), 0);
  assert.equal(parseNumericAttribute(0), 0);
  assert.equal(parseNumericAttribute('150000'), 150000);

  const config = COUNTY_ARCGIS_REGISTRY['TX-BEXAR'];
  const attributesWithSentinels = {
    PROP_ID: '99999-000-0000',
    STATE_CD: 'A1',
    APPRAISED_VAL: '-100',
    LAND_VAL: -50,
    IMPRV_VAL: '-999',
    LEGAL_DESC: 'TEST SENTINEL'
  };

  const normalized = normalizeArcgisAttributes(attributesWithSentinels, config);
  assert.ok(normalized);
  assert.equal(normalized.assessedValue.total, null, 'Negative sentinel total must become null');
  assert.equal(normalized.assessedValue.land, null, 'Negative sentinel land must become null');
  assert.equal(normalized.assessedValue.improvements, null, 'Negative sentinel improvements must become null');
});

test('ArcGIS Resolver: selects closest feature using returned geometry coordinates and verifies returnGeometry parameter', async () => {
  const centerLat = 39.1029;
  const centerLng = -84.5150;

  // Feature 1 is ~200m away, Feature 2 is ~10m away
  const features = [
    {
      attributes: { PARCELID: 'FAR_PARCEL', MKT_TOTAL_VAL: 100000 },
      geometry: { x: -84.5130, y: 39.1045 } // Farther
    },
    {
      attributes: { PARCELID: 'CLOSE_PARCEL', MKT_TOTAL_VAL: 250000 },
      geometry: { x: -84.5151, y: 39.1029 } // Closer
    }
  ];

  const best = selectBestFeature(features, centerLat, centerLng);
  assert.ok(best);
  assert.equal(best.attributes.PARCELID, 'CLOSE_PARCEL');

  // Verify queryArcgisParcel passes returnGeometry=true for spatial point queries and includes timeout signal
  let capturedUrl = null;
  let capturedInit = null;
  const mockFetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return {
      ok: true,
      json: async () => ({
        features: [
          {
            attributes: { PARCELID: '050002130146', MKT_TOTAL_VAL: 282790 },
            geometry: { x: -84.5150, y: 39.1029 }
          }
        ]
      })
    };
  };

  await queryArcgisParcel({
    lat: centerLat,
    lng: centerLng,
    state: 'OH',
    county: 'Hamilton',
    fetchFn: mockFetch
  });

  assert.ok(capturedUrl);
  assert.match(capturedUrl, /returnGeometry=true/, 'Spatial query must set returnGeometry=true');
  assert.ok(capturedInit && capturedInit.signal, 'fetchFn must receive an abort signal');
});

test('Adversarial robustness: null, primitive, and corrupt object resilience', async () => {
  const { extractCountyFips, extractRawApn, mapDistressStage, numberOrNull, normalizeApn: normApn } = require('../server/scrapers/normalization');

  // Null inputs to parcel identity and extractors
  assert.equal(await resolveCadastralParcelIdentity(null), null);
  assert.equal(await resolveCadastralParcelIdentity(undefined), null);
  assert.equal(extractCountyFips(null), null);
  assert.equal(extractCountyFips(undefined), null);
  assert.equal(extractRawApn(null), null);
  assert.equal(extractRawApn(undefined), null);

  // Non-primitive input to normalization
  assert.equal(normApn({}), null);
  assert.equal(normApn([]), null);
  assert.equal(normalizeApn({}), '');
  assert.equal(numberOrNull([]), null);
  assert.equal(numberOrNull({}), null);

  // Non-string source to distress stage
  assert.equal(mapDistressStage(123), 'unknown');
  assert.equal(mapDistressStage(null), 'unknown');
  assert.equal(mapDistressStage({}), 'unknown');

  // Corrupt feature list with null or attributes-free elements in queryArcgisParcel
  const mockFetchCorrupt = async () => ({
    ok: true,
    json: async () => ({ features: [null, {}, { geometry: {} }] })
  });
  const res = await queryArcgisParcel({
    lat: 39.1,
    lng: -84.5,
    state: 'OH',
    county: 'Hamilton',
    fetchFn: mockFetchCorrupt
  });
  assert.equal(res, null);
});
