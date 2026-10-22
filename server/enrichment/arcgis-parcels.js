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
  },
  'FL-ALACHUA': {
    name: 'Alachua County Property Appraiser (Gainesville)',
    fips: '12001',
    endpoint: 'https://maps.alachuacounty.us/server/rest/services/Hosted/ParcelsACGM/FeatureServer/0/query',
    apnField: 'parcel',
    landUseField: 'flucode',
    assessedTotalField: 'justvalue',
    assessedLandField: 'justvalue',
    assessedImprvField: 'justvalue',
    legalDescField: 'zonelink'
  },
  'TX-HARRIS': {
    name: 'Harris County Appraisal District (HCAD)',
    fips: '48201',
    endpoint: 'https://gis.hcad.org/arcgis/rest/services/Public/Parcels/MapServer/0/query',
    apnField: 'HCAD_NUM',
    landUseField: 'State_Class',
    assessedTotalField: 'Tot_Appr_Val',
    assessedLandField: 'Land_Val',
    assessedImprvField: 'Bld_Val',
    legalDescField: 'Legal_Desc'
  },
  // Endpoints below were verified live against each service's layer metadata
  // and a sampled spatial query on 2026-10-21 (see
  // reports/assessor-enrollment-2026-10-21.md). Where a lookup was verified
  // but the value semantics were not, the county is converted nowhere — see
  // WITHHOLD in server/enrichment/assessor-reading.js.
  'OH-FRANKLIN': {
    name: 'Franklin County Auditor (Columbus)',
    fips: '39049',
    endpoint: 'https://gis.franklincountyohio.gov/hosting/rest/services/ParcelFeatures/Parcel_Features/MapServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'PCLASSDSCRP',
    assessedTotalField: 'TOTVALUEBASE',
    assessedLandField: 'LNDVALUEBASE',
    assessedImprvField: 'BLDVALUEBASE'
  },
  'OH-HAMILTON': {
    name: 'Hamilton County Auditor / CAGIS (Cincinnati)',
    fips: '39061',
    endpoint: 'https://cagisonline.hamilton-co.org/arcgis/rest/services/COUNTYWIDE/Cadastral/MapServer/2/query',
    apnField: 'PARCELID',
    landUseField: 'CLASS',
    assessedTotalField: 'MKT_TOTAL_VAL',
    assessedLandField: 'MKTLND',
    assessedImprvField: 'MKTIMP',
    legalDescField: 'LGLDS1',
    // Parcel centroids, not polygons: a point-intersect matches only an exact
    // centroid coordinate, so the query falls back to a small envelope
    // around the listing point.
    spatialFallback: 'envelope'
  },
  'TX-TARRANT': {
    name: 'Tarrant Appraisal District (Fort Worth public parcels)',
    fips: '48439',
    endpoint: 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0/query',
    apnField: 'TAXPIN',
    landUseField: 'STATE_USE_CODE',
    assessedTotalField: 'APPRAISED_VALUE',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'IMPR_VAL',
    legalDescField: 'PARCEL_LEGAL_DESCRIPTION'
  },
  'NV-WASHOE': {
    name: 'Washoe County Assessor (Reno)',
    fips: '32031',
    endpoint: 'https://services.arcgis.com/iCGWaR7ZHc5saRIl/arcgis/rest/services/Nightly_OpenData_Update/FeatureServer/1/query',
    apnField: 'APN',
    landUseField: 'LAND_USE',
    assessedTotalField: 'TOTALASS',
    assessedLandField: 'LANDASS',
    assessedImprvField: 'BUILDASS',
    legalDescField: 'SUBNAME'
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
 * Reads attribute property case-insensitively from ArcGIS feature attributes.
 */
function getAttributeCaseInsensitive(attributes, fieldName) {
  if (!attributes || !fieldName) return undefined;
  if (attributes[fieldName] !== undefined) return attributes[fieldName];
  const upper = String(fieldName).toUpperCase();
  const lower = String(fieldName).toLowerCase();
  if (attributes[upper] !== undefined) return attributes[upper];
  if (attributes[lower] !== undefined) return attributes[lower];
  for (const [k, v] of Object.entries(attributes)) {
    if (k.toUpperCase() === upper) return v;
  }
  return undefined;
}

/**
 * Normalizes raw ArcGIS parcel attributes into standard domain shape.
 */
function normalizeArcgisAttributes(attributes, config) {
  if (!attributes) return null;

  const rawApn = String(getAttributeCaseInsensitive(attributes, config.apnField) || '');
  const canonicalApn = normalizeApn(rawApn);

  const total = Number(getAttributeCaseInsensitive(attributes, config.assessedTotalField));
  const land = Number(getAttributeCaseInsensitive(attributes, config.assessedLandField));
  const imprv = Number(getAttributeCaseInsensitive(attributes, config.assessedImprvField));

  return {
    source: 'ARCGIS_REST_PARCEL',
    countyFips: config.fips,
    countyName: config.name,
    rawApn,
    canonicalApn,
    landUse: String(getAttributeCaseInsensitive(attributes, config.landUseField) || 'UNKNOWN'),
    legalDescription: String(getAttributeCaseInsensitive(attributes, config.legalDescField) || ''),
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
    let features = data && Array.isArray(data.features) ? data.features : [];

    // Centroid-point layers (spatialFallback: 'envelope') cannot be matched by
    // an exact point-intersect — the listing coordinate is not the parcel's
    // centroid. Retry once with a ~44 m envelope around the same point, which
    // matches the parcel whose centroid is nearest without drifting into a
    // neighboring parcel's catchment. Bounded to one retry.
    if (!features.length && config.spatialFallback === 'envelope' && Number.isFinite(lat) && Number.isFinite(lng)) {
      const delta = 0.0004;
      queryParams.set('geometry', `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`);
      queryParams.set('geometryType', 'esriGeometryEnvelope');
      const retry = await fetchFn(`${config.endpoint}?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PropertyCrawl/2.0 (ArcGIS Open Parcel Gateway)'
        }
      });
      if (retry.ok) {
        const retryData = await retry.json();
        features = retryData && Array.isArray(retryData.features) ? retryData.features : [];
      }
    }

    if (!features.length) {
      return null;
    }

    const feature = features[0];
    return normalizeArcgisAttributes(feature.attributes, config);
  } catch (err) {
    return null;
  }
}

/**
 * Resolves a canonical parcel identity (countyFips + canonicalApn + parcelKey)
 * via county cadastral point-in-polygon or APN lookup when an ArcGIS parcel
 * layer is available for the listing's county.
 */
async function resolveCadastralParcelIdentity(listing = {}, options = {}) {
  const existingApn = listing.apn || listing.parcelNumber || listing.parcelId || listing.provenance?.parcelNumber || null;
  const parcel = await queryArcgisParcel({
    lat: Number(listing.lat),
    lng: Number(listing.lng),
    apn: existingApn,
    state: listing.state,
    county: listing.county,
    fetchFn: options.fetchFn,
  });
  if (!parcel || !parcel.canonicalApn) return null;
  const parcelKey = parcel.countyFips
    ? `${parcel.countyFips}-${parcel.canonicalApn}`
    : parcel.canonicalApn;
  return {
    countyFips: parcel.countyFips || null,
    rawApn: parcel.rawApn,
    canonicalApn: parcel.canonicalApn,
    parcelKey,
    matchBasis: Number.isFinite(Number(listing.lat)) && Number.isFinite(Number(listing.lng))
      ? 'cadastral_point_in_polygon'
      : 'cadastral_apn_lookup',
    parcel,
  };
}

module.exports = {
  COUNTY_ARCGIS_REGISTRY,
  resolveCountyKey,
  normalizeApn,
  normalizeArcgisAttributes,
  queryArcgisParcel,
  resolveCadastralParcelIdentity
};
