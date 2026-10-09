'use strict';

/**
 * County ArcGIS REST FeatureServer / MapServer Registry
 * Maps county keys (e.g. "OH-CUYAHOGA", "TX-BEXAR", "FL-ORANGE") to public parcel layers.
 */
const COUNTY_ARCGIS_REGISTRY = {
  'TX-BEXAR': {
    name: 'Bexar County / San Antonio (BCAD)',
    fips: '48029',
    endpoint: 'https://maps.bexar.org/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
    apnField: 'PROP_ID',
    landUseField: 'STATE_CD',
    assessedTotalField: 'APPRAISED_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'IMPRV_VAL',
    legalDescField: 'LEGAL_DESC'
  },
  'OH-CUYAHOGA': {
    name: 'Cuyahoga County Fiscal Officer (Cleveland)',
    fips: '39035',
    endpoint: 'https://gis.cuyahogacounty.us/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PARCELPIN',
    landUseField: 'LUC_DESC',
    assessedTotalField: 'TOTAL_ASSESSED_VAL',
    assessedLandField: 'LAND_ASSESSED_VAL',
    assessedImprvField: 'BLDG_ASSESSED_VAL',
    legalDescField: 'LEGAL_DESC'
  },
  'FL-ORANGE': {
    name: 'Orange County Property Appraiser (Orlando)',
    fips: '12095',
    endpoint: 'https://ocpafl.org/arcgis/rest/services/Public/Parcels/FeatureServer/0/query',
    apnField: 'PARCEL_ID',
    landUseField: 'DOR_DESC',
    assessedTotalField: 'JUST_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'BLDG_VAL',
    legalDescField: 'SHORT_LEGAL'
  },
  'IL-COOK': {
    name: 'Cook County Assessor (Chicago)',
    fips: '17031',
    endpoint: 'https://datacatalog.cookcountyil.gov/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PIN',
    landUseField: 'CLASS_DESC',
    assessedTotalField: 'CERTIFIED_TOTAL',
    assessedLandField: 'CERTIFIED_LAND',
    assessedImprvField: 'CERTIFIED_BLDG',
    legalDescField: 'LEGAL_DESC'
  },
  'NV-CLARK': {
    name: 'Clark County Assessor (Las Vegas)',
    fips: '32003',
    endpoint: 'https://gisgate.co.clark.nv.us/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PARCEL_NUM',
    landUseField: 'LU_DESC',
    assessedTotalField: 'TAX_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'IMP_VAL',
    legalDescField: 'LEGAL'
  },
  'ID-BANNOCK': {
    name: 'Bannock County Assessor (Pocatello)',
    fips: '16005',
    endpoint: 'https://maps.bannockcounty.us/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'TOTAL_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'BLDG_VAL',
    legalDescField: 'LEGAL_DESC'
  }
};

/**
 * Normalizes county and state into a registry key (e.g. "TX-BEXAR").
 */
function resolveCountyKey(state, county) {
  if (!state || !county) return null;
  const st = state.trim().toUpperCase();
  const co = county.trim().toUpperCase().replace(/\s+(COUNTY|PARISH)$/i, '');
  const key = `${st}-${co}`;
  return COUNTY_ARCGIS_REGISTRY[key] ? key : null;
}

/**
 * Normalizes an APN by removing non-alphanumeric punctuation.
 */
function normalizeApn(apn) {
  if (!apn || typeof apn !== 'string') return '';
  return apn.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Normalizes raw ArcGIS parcel attributes into standard domain shape.
 */
function normalizeArcgisAttributes(attributes, config) {
  if (!attributes) return null;

  const rawApn = String(attributes[config.apnField] || '');
  const canonicalApn = normalizeApn(rawApn);

  const total = Number(attributes[config.assessedTotalField]);
  const land = Number(attributes[config.assessedLandField]);
  const imprv = Number(attributes[config.assessedImprvField]);

  return {
    source: 'ARCGIS_REST_PARCEL',
    countyFips: config.fips,
    countyName: config.name,
    rawApn,
    canonicalApn,
    landUse: String(attributes[config.landUseField] || 'UNKNOWN'),
    legalDescription: String(attributes[config.legalDescField] || ''),
    assessedValue: {
      total: Number.isFinite(total) ? total : null,
      land: Number.isFinite(land) ? land : null,
      improvements: Number.isFinite(imprv) ? imprv : null
    },
    rawAttributes: attributes
  };
}

/**
 * Queries an ArcGIS FeatureServer/MapServer for a parcel by coordinates or APN.
 *
 * @param {Object} params
 * @param {number} [params.lat] - Latitude
 * @param {number} [params.lng] - Longitude
 * @param {string} [params.apn] - Parcel identification number
 * @param {string} params.state - Two-letter state code (e.g. 'TX')
 * @param {string} params.county - County name (e.g. 'Bexar')
 * @param {Function} [params.fetchFn] - Custom fetch for testing
 * @returns {Promise<Object|null>}
 */
async function queryArcgisParcel({ lat, lng, apn, state, county, fetchFn = globalThis.fetch }) {
  const key = resolveCountyKey(state, county);
  if (!key) {
    return null; // County not yet mapped in registry
  }

  const config = COUNTY_ARCGIS_REGISTRY[key];
  let queryParams = new URLSearchParams({
    outFields: '*',
    f: 'json',
    returnGeometry: 'false'
  });

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // Spatial point intersection
    queryParams.set('geometry', `${lng},${lat}`);
    queryParams.set('geometryType', 'esriGeometryPoint');
    queryParams.set('spatialRel', 'esriSpatialRelIntersects');
    queryParams.set('inSR', '4326');
  } else if (apn) {
    // APN attribute search
    const clean = normalizeApn(apn);
    queryParams.set('where', `UPPER(${config.apnField}) LIKE '%${clean}%'`);
  } else {
    return null;
  }

  const url = `${config.endpoint}?${queryParams.toString()}`;

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PropertyCrawl/2.0 (ArcGIS Open Parcel Gateway)'
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || !Array.isArray(data.features) || data.features.length === 0) {
      return null;
    }

    const feature = data.features[0];
    return normalizeArcgisAttributes(feature.attributes, config);
  } catch (err) {
    return null;
  }
}

module.exports = {
  COUNTY_ARCGIS_REGISTRY,
  resolveCountyKey,
  normalizeApn,
  normalizeArcgisAttributes,
  queryArcgisParcel
};
