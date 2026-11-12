'use strict';

const { normalizeApn, buildParcelKey } = require('../scrapers/normalization');

const NJ_GEOCODE_URL = 'https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer/findAddressCandidates';
const NJ_CADASTRAL_URL = 'https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0/query';

const NJ_COUNTY_FIPS = Object.freeze({
  ATLANTIC: '34001',
  BERGEN: '34003',
  BURLINGTON: '34005',
  CAMDEN: '34007',
  'CAPE MAY': '34009',
  CUMBERLAND: '34011',
  ESSEX: '34013',
  GLOUCESTER: '34015',
  HUDSON: '34017',
  HUNTERDON: '34019',
  MERCER: '34021',
  MIDDLESEX: '34023',
  MONMOUTH: '34025',
  MORRIS: '34027',
  OCEAN: '34029',
  PASSAIC: '34031',
  SALEM: '34033',
  SOMERSET: '34035',
  SUSSEX: '34037',
  UNION: '34039',
  WARREN: '34041',
});

const TOKEN_ABBREV = Object.freeze({
  N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST',
  NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST',
  ST: 'STREET', STR: 'STREET',
  AVE: 'AVENUE', AV: 'AVENUE',
  RD: 'ROAD',
  DR: 'DRIVE',
  LN: 'LANE',
  CT: 'COURT',
  PL: 'PLACE',
  TER: 'TERRACE', TERR: 'TERRACE',
  BLVD: 'BOULEVARD',
  PKWY: 'PARKWAY', PKY: 'PARKWAY',
  HWY: 'HIGHWAY',
  WLK: 'WALK',
  TRL: 'TRAIL',
  CIR: 'CIRCLE',
  SQ: 'SQUARE',
  PLZ: 'PLAZA',
  XING: 'CROSSING',
  ALY: 'ALLEY',
  TRCE: 'TRACE',
  CV: 'COVE',
  RDG: 'RIDGE',
  TPKE: 'TURNPIKE', TPK: 'TURNPIKE',
  EXPY: 'EXPRESSWAY',
  RTE: 'ROUTE', RT: 'ROUTE',
});

const MUNICIPAL_SUFFIX_RE = /\b(BORO|BOROUGH|TWP|TOWNSHIP|TOWN|CITY|VILLAGE|VLG)\b/g;

function normalizeCountyFipsNj(countyName, listingCountyFips) {
  if (listingCountyFips && /^34\d{3}$/.test(String(listingCountyFips).trim())) {
    return String(listingCountyFips).trim();
  }
  const clean = String(countyName || '')
    .toUpperCase()
    .replace(/\bCOUNTY\b/g, '')
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return NJ_COUNTY_FIPS[clean] || null;
}

function normalizeTokens(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_ABBREV[token] || token);
}

function extractNjGeocodeQuery(listing = {}) {
  let raw = String(listing.address || '').replace(/\s*,+\s*,+/g, ', ').replace(/\s+/g, ' ').trim();
  if (!raw) {
    raw = [listing.street, listing.city, listing.state, listing.zip].filter(Boolean).join(', ').trim();
  }
  if (!raw) return '';

  const nkaMatch = raw.match(/\b(?:N\/?K\/?A|NOW\s+KNOWN\s+AS)\s*[:\-]?\s*(.+)$/i);
  if (nkaMatch && nkaMatch[1]) {
    raw = nkaMatch[1].trim();
  } else {
    raw = raw.replace(/\s*\b(?:F\/?K\/?A|FORMERLY\s+KNOWN\s+AS|A\/?K\/?A)\b[^,]*/gi, '').trim();
  }

  raw = raw.replace(/\s*\((?:BLOCK|LOT)[^)]*\)/gi, '').replace(/\s*,+\s*,+/g, ', ').replace(/\s+/g, ' ').trim();
  const hasStateZip = /\bNJ\b(?:\s+\d{5})?/i.test(raw);
  if (!hasStateZip) {
    const tail = [listing.city, listing.state || 'NJ', listing.zip].filter(Boolean).join(' ').trim();
    if (tail) raw = `${raw.replace(/,+$/, '')}, ${tail}`;
  }
  return raw;
}

function normalizeLotOrBlockValue(val) {
  if (val === null || val === undefined) return '';
  const cleaned = String(val)
    .trim()
    .toUpperCase()
    .replace(/^(?:LOT|BLOCK|BLK)\s*[:#.]?\s*/i, '')
    .replace(/\s+/g, '')
    .replace(/^0+(?=\d)/, '');
  return cleaned;
}

function parseNjNoticeLotBlock(listing = {}) {
  const fromFacts = listing.provenance?.sourceFacts?.lotBlock;
  if (fromFacts && (fromFacts.block || fromFacts.lot)) {
    const block = normalizeLotOrBlockValue(fromFacts.block);
    const lot = normalizeLotOrBlockValue(fromFacts.lot);
    if (block && lot) return { block, lot };
  }
  const apnText = String(
    listing.apn || listing.parcelNumber || listing.parcelId || listing.provenance?.parcelNumber || '',
  );
  const lotBlockMatch = apnText.match(/\bLOT\s*[:#.]?\s*([A-Z0-9.-]+)\b[\s,;/]+BLOCK\s*[:#.]?\s*([A-Z0-9.-]+)\b/i);
  if (lotBlockMatch) {
    return {
      lot: normalizeLotOrBlockValue(lotBlockMatch[1]),
      block: normalizeLotOrBlockValue(lotBlockMatch[2]),
    };
  }
  const blockLotMatch = apnText.match(/\bBLOCK\s*[:#.]?\s*([A-Z0-9.-]+)\b[\s,;/]+LOT\s*[:#.]?\s*([A-Z0-9.-]+)\b/i);
  if (blockLotMatch) {
    return {
      block: normalizeLotOrBlockValue(blockLotMatch[1]),
      lot: normalizeLotOrBlockValue(blockLotMatch[2]),
    };
  }
  return null;
}

function normalizeMunicipality(city) {
  return String(city || '')
    .toUpperCase()
    .replace(MUNICIPAL_SUFFIX_RE, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function stripCityStateZipTail(queryAddress, city, zip) {
  let head = String(queryAddress || '').trim();
  head = head.replace(/,?\s*\bNJ\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/i, '').trim();
  if (zip) head = head.replace(new RegExp(`\\b${zip}\\b\\s*$`, 'i'), '').trim();
  if (city) {
    const escapedCity = String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    head = head.replace(new RegExp(`(?:,\\s*|\\s+)${escapedCity}\\s*$`, 'i'), '').trim();
  }
  return head.replace(/,+$/, '').trim();
}

function isExactNjGeocodeMatch(listing = {}, candidate = {}) {
  const attrs = candidate?.attributes || {};
  const score = Number(candidate?.score ?? attrs.Score);
  const addrType = String(attrs.Addr_type || '').trim();
  if (!Number.isFinite(score) || score < 85) return false;
  if (addrType !== 'PointAddress' && addrType !== 'Subaddress') return false;

  const x = Number(candidate?.location?.x);
  const y = Number(candidate?.location?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (y < 38.8 || y > 41.5 || x < -75.7 || x > -73.8) return false;

  const region = String(attrs.RegionAbbr || attrs.Region || '').trim().toUpperCase();
  if (region && region !== 'NJ' && region !== 'NEW JERSEY') return false;

  const listingZip = String(listing.zip || '').trim().slice(0, 5);
  const candZip = String(attrs.Postal || '').trim().slice(0, 5);
  if (listingZip && candZip && listingZip !== candZip) return false;

  const listingCity = normalizeMunicipality(listing.city);
  const candCity = normalizeMunicipality(attrs.City);
  if (listingCity && candCity && listingCity !== candCity) return false;

  const queryLine = extractNjGeocodeQuery(listing);
  const streetOnly = stripCityStateZipTail(queryLine, listing.city, listingZip);
  const streetTokens = normalizeTokens(streetOnly);
  const candStreetTokens = normalizeTokens(attrs.StAddr || candidate.address?.split(',')[0] || '');
  if (!streetTokens.length || !candStreetTokens.length) return false;

  const noticeHouse = attrs.AddNum
    ? String(attrs.AddNum).trim().toUpperCase()
    : '';
  const listingHouseMatch = streetTokens[0].match(/^\d+[A-Z]?$/);
  const listingHouse = listingHouseMatch ? listingHouseMatch[0] : '';
  if (noticeHouse && listingHouse && noticeHouse !== listingHouse) return false;

  const candSet = new Set(candStreetTokens);
  const overlap = candStreetTokens.filter((token) => streetTokens.includes(token)).length;
  const required = Math.max(2, Math.ceil(candStreetTokens.length * 0.8));
  if (overlap < required && !candSet.has(streetTokens[0])) return false;

  return true;
}

function selectBestNjCadastralFeature(features, listing = {}, geocodeAttrs = {}) {
  if (!Array.isArray(features) || features.length === 0) return null;

  const noticeLotBlock = parseNjNoticeLotBlock(listing);
  if (noticeLotBlock) {
    const exactNotice = features.find((f) => {
      const attrs = f?.attributes || {};
      return normalizeLotOrBlockValue(attrs.PCLBLOCK) === noticeLotBlock.block
        && normalizeLotOrBlockValue(attrs.PCLLOT) === noticeLotBlock.lot;
    });
    if (exactNotice) return exactNotice;
  }

  const geoBlock = normalizeLotOrBlockValue(geocodeAttrs?.Addr_Block);
  const geoLot = normalizeLotOrBlockValue(geocodeAttrs?.Addr_Lot);
  if (geoBlock && geoLot) {
    const exactGeo = features.find((f) => {
      const attrs = f?.attributes || {};
      return normalizeLotOrBlockValue(attrs.PCLBLOCK) === geoBlock
        && normalizeLotOrBlockValue(attrs.PCLLOT) === geoLot;
    });
    if (exactGeo) return exactGeo;
  }

  const listingHouse = (String(listing.address || '').trim().match(/^(\d+[A-Za-z]?)\b/) || [])[1]?.toUpperCase() || '';
  if (listingHouse) {
    const addressMatched = features.filter((f) => {
      const situs = String(f?.attributes?.ST_ADDRESS || f?.attributes?.PROP_LOC || '').trim();
      const candHouse = (situs.match(/^(\d+[A-Za-z]?)\b/) || [])[1]?.toUpperCase() || '';
      return candHouse && candHouse === listingHouse;
    });
    if (addressMatched.length === 1) return addressMatched[0];
  }

  if (features.length === 1) return features[0];
  return null;
}

function mapNjPropClassToPropType(attrs = {}) {
  const cls = String(attrs.PROP_CLASS || '').trim().toUpperCase();
  const bldgDesc = String(attrs.BLDG_DESC || attrs.PROP_USE || '').trim().toUpperCase();
  const dwell = Number(attrs.DWELL);
  if (cls === '1' || cls === '3B') return 'Land';
  if (cls === '2' || cls === '3A') {
    if (/TOWN\s*H|\bTH\b|\bROW\b/.test(bldgDesc)) return 'Town House';
    if (/CONDO|\bCND\b/.test(bldgDesc)) return 'Condo';
    if (dwell === 2) return 'Duplex';
    if (dwell === 3) return 'Triplex';
    return 'Single Family';
  }
  if (/^4[ABC]$/.test(cls) || /^15[A-F]?$/.test(cls)) return 'Commercial';
  return null;
}

function positiveFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

async function queryNjGeocode(listing, { fetchFn = globalThis.fetch } = {}) {
  const singleLine = extractNjGeocodeQuery(listing);
  if (!singleLine || typeof fetchFn !== 'function') return null;
  const url = `${NJ_GEOCODE_URL}?f=json&SingleLine=${encodeURIComponent(singleLine)}&outSR=4326&outFields=*&maxLocations=3`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
  if (!response?.ok) return null;
  const payload = await response.json();
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  return candidates.find((c) => isExactNjGeocodeMatch(listing, c)) || null;
}

async function queryNjCadastralAtPoint(lat, lng, { fetchFn = globalThis.fetch } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof fetchFn !== 'function') return [];
  const outFields = [
    'PAMS_PIN', 'PCL_MUN', 'MUN_NAME', 'COUNTY', 'PCLBLOCK', 'PCLLOT',
    'ST_ADDRESS', 'PROP_LOC', 'ZIP5', 'PROP_CLASS', 'NET_VALUE', 'LAND_VAL',
    'IMPRVT_VAL', 'YR_CONSTR', 'DWELL', 'COMM_DWELL', 'BLDG_DESC', 'LAND_DESC',
    'CALC_ACRE', 'LAST_YR_TX', 'DEED_DATE', 'SALE_PRICE',
  ].join(',');
  const url = `${NJ_CADASTRAL_URL}?f=json&geometry=${encodeURIComponent(`${lng},${lat}`)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${outFields}&returnGeometry=false`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
  if (!response?.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload?.features) ? payload.features : [];
}

function applyNjCadastralData(listing, { candidate = null, feature = null, observedAt }) {
  listing.provenance = listing.provenance || {};
  listing.provenance.derivedFields = listing.provenance.derivedFields || {};

  if (candidate && (listing.lat === null || listing.lat === undefined || listing.lng === null || listing.lng === undefined)) {
    const lat = Number(Number(candidate.location.y).toFixed(6));
    const lng = Number(Number(candidate.location.x).toFixed(6));
    listing.lat = lat;
    listing.lng = lng;
    listing.provenance.coordinates = {
      origin: 'geocoder',
      provider: 'NJGIN NJ_Geocode Composite Locator',
      verification: 'exact_address_match',
      precision: 'parcel',
      sourceRecordUrl: listing.sourceUrl,
      observedAt,
      lat,
      lng,
      geocodeScore: Number(candidate.score ?? candidate.attributes?.Score ?? 0),
      addrType: String(candidate.attributes?.Addr_type || 'PointAddress'),
      geocodedLabel: candidate.address || null,
      matchedAddress: {
        address: listing.address || '',
        city: listing.city || '',
        state: listing.state || 'NJ',
        zip: listing.zip || '',
      },
    };
  }

  const attrs = feature?.attributes || null;
  if (!attrs) return;

  const pamsPin = attrs.PAMS_PIN ? String(attrs.PAMS_PIN).trim() : '';
  const canonicalApn = normalizeApn(pamsPin);
  const countyFips = normalizeCountyFipsNj(attrs.COUNTY || listing.county, listing.countyFips);
  const netValue = positiveFinite(attrs.NET_VALUE);
  const landVal = positiveFinite(attrs.LAND_VAL);
  const imprvtVal = positiveFinite(attrs.IMPRVT_VAL);
  const yrConstr = Number(attrs.YR_CONSTR);
  const mappedType = mapNjPropClassToPropType(attrs);

  const durableParcel = {
    source: 'NJGIN_MODIV_CADASTRAL',
    countyFips,
    countyName: attrs.COUNTY ? `${attrs.COUNTY} County` : (listing.county || null),
    rawApn: pamsPin || null,
    canonicalApn: canonicalApn || null,
    block: attrs.PCLBLOCK ? String(attrs.PCLBLOCK).trim() : null,
    lot: attrs.PCLLOT ? String(attrs.PCLLOT).trim() : null,
    situsAddress: String(attrs.ST_ADDRESS || attrs.PROP_LOC || '').trim() || null,
    propClass: attrs.PROP_CLASS ? String(attrs.PROP_CLASS).trim() : null,
    landUse: attrs.PROP_CLASS ? String(attrs.PROP_CLASS).trim() : 'UNKNOWN',
    legalDescription: attrs.BLDG_DESC ? String(attrs.BLDG_DESC).trim() : '',
    assessedValue: {
      total: netValue,
      land: landVal,
      improvements: imprvtVal,
    },
    yearBuilt: Number.isInteger(yrConstr) && yrConstr >= 1650 && yrConstr <= 2100 ? yrConstr : null,
    calcAcre: positiveFinite(attrs.CALC_ACRE),
    lastYearTax: positiveFinite(attrs.LAST_YR_TX),
  };

  listing.assessorParcel = durableParcel;
  listing.provenance.derivedFields.assessorRoll = {
    parcel: durableParcel,
    countyKey: attrs.COUNTY ? `NJ-${String(attrs.COUNTY).trim().toUpperCase()}` : 'NJ-STATEWIDE',
    apn: canonicalApn || null,
    observedAt,
    basis: 'NJGIN_MODIV_CADASTRAL',
    note: 'Official NJGIN Parcels & MOD-IV assessment; assessed value only (municipal equalization ratios vary, so no market estimate is derived).',
  };

  if (canonicalApn && countyFips) {
    listing.parcelKey = buildParcelKey({ apn: pamsPin, countyFips }) || `${countyFips}-${canonicalApn}`;
    listing.provenance.parcelKey = listing.parcelKey;
    listing.provenance.derivedFields.parcelKey = true;
  }
  if (pamsPin && !listing.apn) listing.apn = pamsPin;
  if (netValue !== null && !(Number(listing.assessed) > 0)) listing.assessed = netValue;
  if (Number.isInteger(yrConstr) && yrConstr >= 1650 && yrConstr <= 2100 && !(Number(listing.year) > 0)) {
    listing.year = yrConstr;
  }
  if (mappedType && (!listing.propType || listing.propType === 'Unknown')) {
    listing.propType = mappedType;
  }
}

async function enrichNjListing(listing, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const observedAt = new Date(now).toISOString();

  if (!listing || typeof listing !== 'object' || String(listing.state || '').toUpperCase() !== 'NJ') {
    return { found: false, reason: 'not_nj' };
  }

  let candidate = null;
  let lat = Number(listing.lat);
  let lng = Number(listing.lng);
  const hasCoords = listing.lat !== null && listing.lat !== undefined && listing.lng !== null && listing.lng !== undefined
    && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  if (!hasCoords) {
    candidate = await queryNjGeocode(listing, { fetchFn });
    if (!candidate) return { found: false, reason: 'geocode_miss' };
    lat = Number(Number(candidate.location.y).toFixed(6));
    lng = Number(Number(candidate.location.x).toFixed(6));
  }

  let feature = null;
  try {
    const features = await queryNjCadastralAtPoint(lat, lng, { fetchFn });
    feature = selectBestNjCadastralFeature(features, listing, candidate?.attributes || {});
  } catch {
    feature = null;
  }

  applyNjCadastralData(listing, { candidate, feature, observedAt });
  const coordsAttached = Boolean(candidate && listing.lat !== null && listing.lng !== null);
  return {
    found: Boolean(feature || coordsAttached),
    geocoded: coordsAttached,
    cadastral: Boolean(feature),
  };
}

module.exports = {
  NJ_GEOCODE_URL,
  NJ_CADASTRAL_URL,
  NJ_COUNTY_FIPS,
  extractNjGeocodeQuery,
  parseNjNoticeLotBlock,
  isExactNjGeocodeMatch,
  selectBestNjCadastralFeature,
  mapNjPropClassToPropType,
  queryNjGeocode,
  queryNjCadastralAtPoint,
  applyNjCadastralData,
  enrichNjListing,
};
