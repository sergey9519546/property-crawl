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

const STREET_SUFFIX_TOKENS = new Set([
  'STREET', 'ST', 'STR',
  'AVENUE', 'AVE', 'AV',
  'ROAD', 'RD',
  'DRIVE', 'DR',
  'BOULEVARD', 'BLVD',
  'LANE', 'LN',
  'COURT', 'CT',
  'PLACE', 'PL',
  'TERRACE', 'TER', 'TERR',
  'PARKWAY', 'PKWY', 'PKY',
  'HIGHWAY', 'HWY',
  'WAY',
  'CIRCLE', 'CIR',
  'TRAIL', 'TRL',
  'PLAZA', 'PLZ',
  'SQUARE', 'SQ',
  'ALLEY', 'ALY',
  'WALK', 'WLK',
  'CROSSING', 'XING',
  'TURNPIKE', 'TPKE', 'TPK',
  'EXPRESSWAY', 'EXPY',
  'ROUTE', 'RT', 'RTE',
]);

const DIRECTIONAL_TOKENS = new Set([
  'NORTH', 'SOUTH', 'EAST', 'WEST',
  'NORTHEAST', 'NORTHWEST', 'SOUTHEAST', 'SOUTHWEST',
]);

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
  } else if (head.includes(',')) {
    const parts = head.split(',');
    const last = parts[parts.length - 1].trim();
    if (last && !/^(?:APT|APARTMENT|UNIT|STE|SUITE|FL|FLOOR|BLDG|BUILDING|RM|ROOM|#)\b/i.test(last)) {
      head = parts.slice(0, -1).join(',').trim();
    }
  }
  return head.replace(/,+$/, '').trim();
}

function cleanStreetLineForComparison(rawAddress) {
  let raw = String(rawAddress || '').replace(/\s*,+\s*,+/g, ', ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const nkaMatch = raw.match(/\b(?:N\/?K\/?A|NOW\s+KNOWN\s+AS)\s*[:\-]?\s*(.+)$/i);
  if (nkaMatch && nkaMatch[1]) {
    raw = nkaMatch[1].trim();
  } else {
    raw = raw
      .replace(/\s*\([^)]*(?:F\/?K\/?A|FORMERLY\s+KNOWN\s+AS|A\/?K\/?A)[^)]*\)/gi, '')
      .replace(/\s*\b(?:F\/?K\/?A|FORMERLY\s+KNOWN\s+AS|A\/?K\/?A)\b[^,]*/gi, '')
      .trim();
  }

  raw = raw
    .replace(/\s*\([^)]*(?:BLOCK|BLK|LOT)[^)]*\)/gi, '')
    .replace(/\s*,+\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  raw = raw.replace(/,?\s*\b(?:NJ|NEW\s+JERSEY)\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/i, '').trim();
  raw = raw.replace(/,?\s*\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/i, '').trim();

  if (raw.includes(',')) {
    const segments = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !/^(?:BLOCK|BLK|LOT|UNIT|APT|APARTMENT)\b/i.test(s));
    raw = segments[0] || '';
  }

  raw = raw
    .replace(/\s+(?:APT|APARTMENT|UNIT|STE|SUITE|FL|FLOOR|BLDG|BUILDING|RM|ROOM)\b.*$/i, '')
    .replace(/\s+#\s*[A-Z0-9-]+\s*$/i, '')
    .replace(/,+$/, '')
    .trim();
  return raw;
}

function extractLeadingHouseNumber(rawAddress) {
  const cleaned = cleanStreetLineForComparison(rawAddress);
  if (!cleaned) return '';
  const tokens = normalizeTokens(cleaned);
  if (!tokens.length) return '';
  const match = tokens[0].match(/^\d+[A-Z]?$/);
  return match ? match[0] : '';
}

function extractCoreStreetTokens(tokens, { stripLeadingHouse = true } = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const startIndex = stripLeadingHouse && /^\d+[A-Z]?$/.test(tokens[0]) ? 1 : 0;
  const nonSuffix = tokens
    .slice(startIndex)
    .filter((token) => !STREET_SUFFIX_TOKENS.has(token));
  if (nonSuffix.length > 1) {
    const withoutDirectionals = nonSuffix.filter((token) => !DIRECTIONAL_TOKENS.has(token));
    if (withoutDirectionals.length > 0) return withoutDirectionals;
  }
  return nonSuffix;
}

function isCompatibleNjSitusAddress(listingAddress, situsAddress) {
  const cleanedSitus = cleanStreetLineForComparison(situsAddress);
  if (!cleanedSitus) return true;
  const situsTokens = normalizeTokens(cleanedSitus);
  if (!situsTokens.length || !/^\d+[A-Z]?$/.test(situsTokens[0])) return true;

  const cleanedListing = cleanStreetLineForComparison(listingAddress);
  if (!cleanedListing) return true;
  const listingTokens = normalizeTokens(cleanedListing);
  if (!listingTokens.length || !/^\d+[A-Z]?$/.test(listingTokens[0])) return true;

  if (listingTokens[0] !== situsTokens[0]) return false;

  const listingCore = extractCoreStreetTokens(listingTokens);
  const situsCore = extractCoreStreetTokens(situsTokens);
  if (listingCore.length > 0 && situsCore.length > 0) {
    const situsSet = new Set(situsCore);
    if (!listingCore.some((token) => situsSet.has(token))) return false;
  }

  return true;
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
  const candHouseMatch = candStreetTokens[0].match(/^\d+[A-Z]?$/);
  const candHouse = candHouseMatch ? candHouseMatch[0] : '';
  if (noticeHouse && listingHouse && noticeHouse !== listingHouse) return false;
  if (listingHouse && (noticeHouse || candHouse) !== listingHouse) return false;

  const streetCore = extractCoreStreetTokens(streetTokens);
  const candCore = extractCoreStreetTokens(candStreetTokens);
  if (streetCore.length > 0 && candCore.length > 0) {
    const candCoreSet = new Set(candCore);
    if (!streetCore.some((token) => candCoreSet.has(token))) return false;
  } else if (streetCore.length > 0 || candCore.length > 0) {
    return false;
  }

  const overlap = candStreetTokens.filter((token) => streetTokens.includes(token)).length;
  const required = Math.max(2, Math.ceil(candStreetTokens.length * 0.8));
  if (overlap < required) return false;

  return true;
}

function selectBestNjCadastralFeature(features, listing = {}, geocodeAttrs = {}) {
  if (!Array.isArray(features) || features.length === 0) return null;

  const listingAddress = listing?.address || listing?.street || '';
  const listingHouse = extractLeadingHouseNumber(listingAddress);
  const compatibleFeatures = listingHouse
    ? features.filter((f) => isCompatibleNjSitusAddress(
      listingAddress,
      f?.attributes?.ST_ADDRESS || f?.attributes?.PROP_LOC || '',
    ))
    : features;

  if (compatibleFeatures.length === 0) return null;

  const noticeLotBlock = parseNjNoticeLotBlock(listing);
  if (noticeLotBlock) {
    const exactNotice = compatibleFeatures.find((f) => {
      const attrs = f?.attributes || {};
      return normalizeLotOrBlockValue(attrs.PCLBLOCK) === noticeLotBlock.block
        && normalizeLotOrBlockValue(attrs.PCLLOT) === noticeLotBlock.lot;
    });
    if (exactNotice) return exactNotice;
  }

  const geoBlock = normalizeLotOrBlockValue(geocodeAttrs?.Addr_Block);
  const geoLot = normalizeLotOrBlockValue(geocodeAttrs?.Addr_Lot);
  if (geoBlock && geoLot) {
    const exactGeo = compatibleFeatures.find((f) => {
      const attrs = f?.attributes || {};
      return normalizeLotOrBlockValue(attrs.PCLBLOCK) === geoBlock
        && normalizeLotOrBlockValue(attrs.PCLLOT) === geoLot;
    });
    if (exactGeo) return exactGeo;
  }

  if (listingHouse) {
    const addressMatched = compatibleFeatures.filter((f) => {
      const situs = String(f?.attributes?.ST_ADDRESS || f?.attributes?.PROP_LOC || '').trim();
      const candHouse = extractLeadingHouseNumber(situs);
      return candHouse && candHouse === listingHouse;
    });
    if (addressMatched.length === 1) return addressMatched[0];
  }

  if (compatibleFeatures.length === 1) return compatibleFeatures[0];
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

function computeRingCentroid(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const pts = ring
    .map((pt) => (Array.isArray(pt) && pt.length >= 2 ? [Number(pt[0]), Number(pt[1])] : null))
    .filter((pt) => pt && Number.isFinite(pt[0]) && Number.isFinite(pt[1]) && Math.abs(pt[1]) <= 90 && Math.abs(pt[0]) <= 180);
  if (pts.length === 0) return null;

  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  let lat;
  let lng;
  if (Math.abs(area2) > 1e-12) {
    lng = cx / (3 * area2);
    lat = cy / (3 * area2);
  } else {
    const unique = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;
    const sum = unique.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    lng = sum[0] / unique.length;
    lat = sum[1] / unique.length;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  };
}

async function queryNjCadastralByAddress(listing = {}, { fetchFn = globalThis.fetch } = {}) {
  if (!listing || typeof listing !== 'object' || typeof fetchFn !== 'function') return null;
  const queryLine = extractNjGeocodeQuery(listing);
  if (!queryLine) return null;

  const listingZip = String(listing.zip || '').trim().slice(0, 5);
  const streetOnly = cleanStreetLineForComparison(stripCityStateZipTail(queryLine, listing.city, listingZip));
  const streetTokens = normalizeTokens(streetOnly);
  if (!streetTokens.length) return null;

  const houseMatch = streetTokens[0].match(/^\d+[A-Z]?$/);
  const houseNum = houseMatch ? houseMatch[0] : '';
  if (!houseNum) return null;

  const coreTokens = extractCoreStreetTokens(streetTokens);
  const coreStreet = coreTokens.find((token) => /^[A-Z0-9]+$/.test(token)) || '';
  if (!coreStreet) return null;

  const cleanCounty = String(listing.county || '')
    .toUpperCase()
    .replace(/\bCOUNTY\b/g, '')
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanCity = normalizeMunicipality(listing.city);
  if (!cleanCounty && !cleanCity) return null;

  const where = cleanCounty
    ? `UPPER(COUNTY) = '${cleanCounty}' AND UPPER(ST_ADDRESS) LIKE '${houseNum}%${coreStreet}%'`
    : `UPPER(MUN_NAME) LIKE '${cleanCity}%' AND UPPER(ST_ADDRESS) LIKE '${houseNum}%${coreStreet}%'`;

  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
  });
  const url = `${NJ_CADASTRAL_URL}?${params.toString()}`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
  if (!response?.ok) return null;
  const payload = await response.json();
  const features = Array.isArray(payload?.features) ? payload.features : [];
  if (!features.length) return null;

  const listingAddress = listing.address || queryLine;
  const compatible = features.filter((f) => {
    const attrs = f?.attributes || {};
    const situs = attrs.ST_ADDRESS || attrs.PROP_LOC || '';
    if (!isCompatibleNjSitusAddress(listingAddress, situs)) return false;
    if (cleanCity && attrs.MUN_NAME) {
      const candMun = normalizeMunicipality(attrs.MUN_NAME);
      if (candMun && candMun !== cleanCity) return false;
    }
    return true;
  });
  if (!compatible.length) return null;

  const feature = selectBestNjCadastralFeature(compatible, listing);
  if (!feature) return null;

  const centroid = computeRingCentroid(feature?.geometry?.rings?.[0]);
  return {
    feature,
    lat: centroid ? centroid.lat : null,
    lng: centroid ? centroid.lng : null,
  };
}

function applyNjCadastralData(listing, { candidate = null, feature = null, observedAt, provider = null, matchedAddress = null }) {
  listing.provenance = listing.provenance || {};
  listing.provenance.derivedFields = listing.provenance.derivedFields || {};

  if (candidate && (listing.lat === null || listing.lat === undefined || listing.lng === null || listing.lng === undefined)) {
    const lat = Number(Number(candidate.location.y).toFixed(6));
    const lng = Number(Number(candidate.location.x).toFixed(6));
    listing.lat = lat;
    listing.lng = lng;
    listing.provenance.coordinates = {
      origin: 'geocoder',
      provider: provider || candidate.provider || 'NJGIN NJ_Geocode Composite Locator',
      verification: 'exact_address_match',
      precision: 'parcel',
      sourceRecordUrl: listing.sourceUrl,
      observedAt,
      lat,
      lng,
      geocodeScore: Number(candidate.score ?? candidate.attributes?.Score ?? 0),
      addrType: String(candidate.attributes?.Addr_type || 'PointAddress'),
      geocodedLabel: candidate.address || null,
      matchedAddress: matchedAddress || candidate.matchedAddress || {
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
  let geocodeErrored = false;
  let lat = Number(listing.lat);
  let lng = Number(listing.lng);
  const hasCoords = listing.lat !== null && listing.lat !== undefined && listing.lng !== null && listing.lng !== undefined
    && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  if (!hasCoords) {
    try {
      candidate = await queryNjGeocode(listing, { fetchFn });
    } catch {
      geocodeErrored = true;
      candidate = null;
    }
    if (candidate) {
      lat = Number(Number(candidate.location.y).toFixed(6));
      lng = Number(Number(candidate.location.x).toFixed(6));
    }
  }

  let feature = null;
  let pointFeatures = [];
  if (hasCoords || candidate) {
    try {
      pointFeatures = await queryNjCadastralAtPoint(lat, lng, { fetchFn });
      feature = selectBestNjCadastralFeature(pointFeatures, listing, candidate?.attributes || {});
    } catch {
      pointFeatures = [];
      feature = null;
    }
  }

  let candidateProvider = null;
  let candidateMatchedAddress = null;
  if (!feature) {
    let byAddress = null;
    try {
      byAddress = await queryNjCadastralByAddress(listing, { fetchFn });
    } catch {
      byAddress = null;
    }
    if (byAddress?.feature) {
      feature = byAddress.feature;
      if (!hasCoords) {
        if (Number.isFinite(byAddress.lat) && Number.isFinite(byAddress.lng)) {
          candidate = {
            location: { x: byAddress.lng, y: byAddress.lat },
            score: 100,
            address: feature.attributes?.ST_ADDRESS || feature.attributes?.PROP_LOC || '',
            attributes: { Addr_type: 'ParcelCentroid', Score: 100 },
          };
          candidateProvider = 'NJGIN Cadastral Parcel Centroid';
          candidateMatchedAddress = {
            address: listing.address || '',
            city: listing.city || '',
            state: listing.state || 'NJ',
            zip: listing.zip || '',
          };
        } else if (pointFeatures.length > 0) {
          candidate = null;
        }
      }
    } else if (!hasCoords && pointFeatures.length > 0) {
      candidate = null;
    }
  }

  if (!feature && !candidate) {
    return {
      found: false,
      reason: geocodeErrored ? 'geocode_error' : (pointFeatures.length > 0 ? 'cadastral_mismatch' : 'geocode_miss'),
    };
  }

  applyNjCadastralData(listing, {
    candidate,
    feature,
    observedAt,
    provider: candidateProvider,
    matchedAddress: candidateMatchedAddress,
  });
  const coordsAttached = Boolean(candidate && listing.lat !== null && listing.lat !== undefined && listing.lng !== null && listing.lng !== undefined);
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
  isCompatibleNjSitusAddress,
  isExactNjGeocodeMatch,
  selectBestNjCadastralFeature,
  mapNjPropClassToPropType,
  queryNjGeocode,
  queryNjCadastralAtPoint,
  queryNjCadastralByAddress,
  applyNjCadastralData,
  enrichNjListing,
};
