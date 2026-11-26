'use strict';

/**
 * server/enrichment/deed-comps.js
 *
 * L2 Qualified Deed-Comp Benchmark Aggregator (DATA-01)
 * Computes secondary public-record deed-transfer benchmarks from observed
 * qualified arms-length sales (e.g. NJ MOD-IV / FL DOR SDF/NAL transfers).
 *
 * STRICT ZERO-FABRICATION RULES:
 * - Filters out nominal/unqualified/distressed transfers (price <= 1000,
 *   NJ non-usable NU codes, FL non-qualified QUAL_CD1 codes, invalid/missing dates).
 * - Requires at least 3 qualified arms-length sales before emitting medianSalePrice,
 *   and at least 3 qualified sales with valid positive sqft before emitting
 *   medianPricePerSqft.
 * - NEVER fabricates or overwrites estLow, estHigh, dealScore, or ARV.
 */

const MIN_QUALIFIED_COMPS = 3;
const DEFAULT_WINDOW_MONTHS = 12;
const MIN_QUALIFIED_SALE_PRICE = 1000;

const DEED_COMPS_CAVEAT =
  'L2 qualified public deed transfers only (non-usable, nominal, and distressed deeds excluded). Secondary historical market context — not an appraisal, valuation opinion, or buyer bid recommendation.';

const NJ_USABLE_NU_CODES = new Set(['', '0', '00', 'U', 'USABLE', 'NONE', 'N/A']);
const FL_QUALIFIED_CODES = new Set(['01', '02', '1', '2', 'Q', 'QUALIFIED']);
const DISTRESSED_DEED_RE =
  /\b(sheriff|foreclosure|reo|bank[\s_-]*owned|tax[\s_-]*(?:sale|deed)|quit[\s_-]*claim|corrective|intra[\s_-]*family|estate|trustee|nominal|gift|executor|probate|short[\s_-]*sale)\b/i;

function normalizeZip5(raw) {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).trim().replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 4) return `0${digits}`;
  if (digits.length >= 5) return digits.slice(0, 5);
  return null;
}

function normalizeStateCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return code || null;
}

function normalizeCountyKey(raw) {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/\bCOUNTY\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  return cleaned || null;
}

function parseFinitePositive(raw) {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const num = Number(typeof raw === 'string' ? raw.replace(/[$,\s]/g, '') : raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function validateCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const dt = new Date(ms);
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

function formatNormalizedSaleDate(record) {
  const props = record?.properties && typeof record.properties === 'object' ? record.properties : null;
  const rawAttrs = (record?.rawAttributes && typeof record.rawAttributes === 'object' ? record.rawAttributes : null)
    || (props?.rawAttributes && typeof props.rawAttributes === 'object' ? props.rawAttributes : null);
  const rawDate =
    record?.saleDate ??
    record?.lastSaleDate ??
    record?.deedDate ??
    record?.DEED_DATE ??
    props?.deedDate ??
    props?.lastSaleDate ??
    props?.saleDate ??
    rawAttrs?.DEED_DATE ??
    rawAttrs?.SALE_DATE ??
    rawAttrs?.SALEDATE ??
    rawAttrs?.LAST_SALE_DATE ??
    rawAttrs?.SALE_DT ??
    null;

  if (rawDate instanceof Date) {
    const ms = rawDate.getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
  }

  if (typeof rawDate === 'number') {
    return Number.isFinite(rawDate) && rawDate > 0 ? new Date(rawDate).toISOString().slice(0, 10) : null;
  }

  if (typeof rawDate === 'string' && rawDate.trim() !== '') {
    const s = rawDate.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (m) {
      return validateCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) !== null
        ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
        : s;
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return validateCalendarDate(Number(m[3]), Number(m[1]), Number(m[2])) !== null
        ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
        : s;
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      return validateCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) !== null
        ? `${m[1]}-${m[2]}-${m[3]}`
        : s;
    }
    return s;
  }

  const rawYear =
    record?.SALE_YR1 ??
    record?.recordedSaleYear ??
    record?.saleYear ??
    props?.recordedSaleYear ??
    props?.SALE_YR1;
  const rawMonth =
    record?.SALE_MO1 ??
    record?.recordedSaleMonth ??
    record?.saleMonth ??
    props?.recordedSaleMonth ??
    props?.SALE_MO1;
  if (rawYear !== null && rawYear !== undefined && rawMonth !== null && rawMonth !== undefined) {
    const year = Number(rawYear);
    const month = Number(String(rawMonth).trim());
    if (validateCalendarDate(year, month, 1) !== null) {
      return `${year}-${String(month).padStart(2, '0')}-01`;
    }
  }

  return null;
}

function parseSaleTimestamp(record) {
  const props = record?.properties && typeof record.properties === 'object' ? record.properties : null;
  const rawAttrs = (record?.rawAttributes && typeof record.rawAttributes === 'object' ? record.rawAttributes : null)
    || (props?.rawAttributes && typeof props.rawAttributes === 'object' ? props.rawAttributes : null);
  const rawDate =
    record?.saleDate ??
    record?.lastSaleDate ??
    record?.deedDate ??
    record?.DEED_DATE ??
    props?.deedDate ??
    props?.lastSaleDate ??
    props?.saleDate ??
    rawAttrs?.DEED_DATE ??
    rawAttrs?.SALE_DATE ??
    rawAttrs?.SALEDATE ??
    rawAttrs?.LAST_SALE_DATE ??
    rawAttrs?.SALE_DT ??
    null;

  if (rawDate instanceof Date) {
    const ms = rawDate.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof rawDate === 'number') {
    return Number.isFinite(rawDate) && rawDate > 0 ? rawDate : null;
  }

  if (typeof rawDate === 'string' && rawDate.trim() !== '') {
    const s = rawDate.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (m) {
      return validateCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return validateCalendarDate(Number(m[3]), Number(m[1]), Number(m[2]));
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      return validateCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    return null;
  }

  const rawYear = record?.recordedSaleYear ?? record?.SALE_YR1 ?? record?.saleYear ?? props?.recordedSaleYear;
  const rawMonth = record?.recordedSaleMonth ?? record?.SALE_MO1 ?? record?.saleMonth ?? props?.recordedSaleMonth;
  if (rawYear !== null && rawYear !== undefined && rawMonth !== null && rawMonth !== undefined) {
    const year = Number(rawYear);
    const month = Number(String(rawMonth).trim());
    if (Number.isInteger(year) && Number.isInteger(month)) {
      return validateCalendarDate(year, month, 1);
    }
  }

  return null;
}

function isNjNonUsable(record) {
  const props = record?.properties && typeof record.properties === 'object' ? record.properties : null;
  const hasNuField =
    (record &&
      (Object.prototype.hasOwnProperty.call(record, 'nuCode') ||
        Object.prototype.hasOwnProperty.call(record, 'nu_code') ||
        Object.prototype.hasOwnProperty.call(record, 'NU_CODE') ||
        Object.prototype.hasOwnProperty.call(record, 'SALE_NU') ||
        Object.prototype.hasOwnProperty.call(record, 'saleNuCode') ||
        Object.prototype.hasOwnProperty.call(record, 'nonUsableCode'))) ||
    (props &&
      (Object.prototype.hasOwnProperty.call(props, 'nuCode') ||
        Object.prototype.hasOwnProperty.call(props, 'NU_CODE')));
  if (!hasNuField) return false;
  const raw =
    record.nuCode ??
    record.nu_code ??
    record.NU_CODE ??
    record.SALE_NU ??
    record.saleNuCode ??
    record.nonUsableCode ??
    props?.nuCode ??
    props?.NU_CODE;
  if (raw === null || raw === undefined) return false;
  const normalized = String(raw).trim().toUpperCase();
  return !NJ_USABLE_NU_CODES.has(normalized);
}

function isFlUnqualified(record) {
  const props = record?.properties && typeof record.properties === 'object' ? record.properties : null;
  const hasExplicitQualField =
    Boolean(
      record &&
        (Object.prototype.hasOwnProperty.call(record, 'QUAL_CD1') ||
          Object.prototype.hasOwnProperty.call(record, 'saleQualificationCode'))
    ) ||
    Boolean(
      props &&
        (Object.prototype.hasOwnProperty.call(props, 'QUAL_CD1') ||
          Object.prototype.hasOwnProperty.call(props, 'saleQualificationCode'))
    );
  const hasNormalizedQualField =
    Boolean(record && Object.prototype.hasOwnProperty.call(record, 'qualCode')) ||
    Boolean(props && Object.prototype.hasOwnProperty.call(props, 'qualCode'));
  if (!hasExplicitQualField && !hasNormalizedQualField) return false;

  const raw =
    record?.QUAL_CD1 ??
    record?.qualCode ??
    record?.saleQualificationCode ??
    props?.QUAL_CD1 ??
    props?.qualCode ??
    props?.saleQualificationCode;
  if (raw === null || raw === undefined) {
    return hasExplicitQualField;
  }
  const normalized = String(raw).trim().toUpperCase();
  if (!normalized) return true;
  return !FL_QUALIFIED_CODES.has(normalized);
}

function isFlaggedDistressedOrUnqualified(record) {
  if (!record || typeof record !== 'object') return true;
  if (
    record.distressed === true ||
    record.isDistressed === true ||
    record.nominal === true ||
    record.isNominal === true ||
    record.isArmsLength === false ||
    record.armsLength === false ||
    record.qualified === false ||
    record.isUsable === false
  ) {
    return true;
  }
  const typeText = [record.deedType, record.saleType, record.transactionType]
    .filter((v) => typeof v === 'string' && v.trim() !== '')
    .join(' ');
  return Boolean(typeText && DISTRESSED_DEED_RE.test(typeText));
}

function normalizeCandidateDeedRecord(record, context = {}) {
  if (!record || typeof record !== 'object') return null;

  const props = record.properties && typeof record.properties === 'object' ? record.properties : null;
  const rawAttrs = (record.rawAttributes && typeof record.rawAttributes === 'object' ? record.rawAttributes : null)
    || (props?.rawAttributes && typeof props.rawAttributes === 'object' ? props.rawAttributes : null);
  const rawPrice =
    record.salePrice ??
    record.lastSalePrice ??
    record.recordedSalePrice ??
    record.price ??
    record.SALE_PRICE ??
    record.SALE_PRC1 ??
    props?.recordedSalePrice ??
    props?.lastSalePrice ??
    props?.salePrice ??
    props?.SALE_PRC1 ??
    rawAttrs?.SALE_PRICE ??
    rawAttrs?.SALE_AMT ??
    rawAttrs?.SALEPRICE ??
    rawAttrs?.LAST_SALE_PRICE ??
    rawAttrs?.CONSIDERATION ??
    rawAttrs?.TASP ??
    rawAttrs?.SALE_PRC1;

  const salePrice = parseFinitePositive(rawPrice);
  const saleDate = formatNormalizedSaleDate(record);

  if (context.requireSaleEvidence) {
    const hasExplicitPrice =
      rawPrice !== undefined && rawPrice !== null && (typeof rawPrice !== 'string' || rawPrice.trim() !== '');
    if (salePrice === null && saleDate === null && !(hasExplicitPrice && Number(rawPrice) > 0)) {
      return null;
    }
  }

  const sqft = parseFinitePositive(
    record.sqft ??
      record.buildingSqft ??
      record.livingAreaSqft ??
      record.TOT_LVG_AREA ??
      record.TOT_LVG_AR ??
      props?.livingAreaSqft ??
      props?.TOT_LVG_AREA ??
      props?.TOT_LVG_AR ??
      rawAttrs?.SQFT ??
      rawAttrs?.BLDG_SQFT ??
      rawAttrs?.LIVING_AREA ??
      rawAttrs?.HEATED_AREA ??
      rawAttrs?.TOT_LVG_AREA ??
      rawAttrs?.SFLA
  );

  const hasNuField =
    Object.prototype.hasOwnProperty.call(record, 'nuCode') ||
    Object.prototype.hasOwnProperty.call(record, 'nu_code') ||
    Object.prototype.hasOwnProperty.call(record, 'NU_CODE') ||
    Object.prototype.hasOwnProperty.call(record, 'SALE_NU') ||
    Object.prototype.hasOwnProperty.call(record, 'saleNuCode') ||
    Object.prototype.hasOwnProperty.call(record, 'nonUsableCode') ||
    Boolean(
      props &&
        (Object.prototype.hasOwnProperty.call(props, 'nuCode') ||
          Object.prototype.hasOwnProperty.call(props, 'NU_CODE'))
    );
  const rawNu =
    record.nuCode ??
    record.nu_code ??
    record.NU_CODE ??
    record.SALE_NU ??
    record.saleNuCode ??
    record.nonUsableCode ??
    props?.nuCode ??
    props?.NU_CODE;
  const nuCode = hasNuField && rawNu !== null && rawNu !== undefined ? String(rawNu).trim().toUpperCase() : null;

  const hasQualField =
    Object.prototype.hasOwnProperty.call(record, 'QUAL_CD1') ||
    Object.prototype.hasOwnProperty.call(record, 'qualCode') ||
    Object.prototype.hasOwnProperty.call(record, 'saleQualificationCode') ||
    Boolean(
      props &&
        (Object.prototype.hasOwnProperty.call(props, 'QUAL_CD1') ||
          Object.prototype.hasOwnProperty.call(props, 'qualCode') ||
          Object.prototype.hasOwnProperty.call(props, 'saleQualificationCode'))
    );
  const rawQual =
    record.QUAL_CD1 ??
    record.qualCode ??
    record.saleQualificationCode ??
    props?.QUAL_CD1 ??
    props?.qualCode ??
    props?.saleQualificationCode;
  const qualCode = hasQualField
    ? rawQual === null || rawQual === undefined
      ? ''
      : String(rawQual).trim().toUpperCase()
    : null;

  const sourceFromRecord =
    typeof record.source === 'string'
      ? record.source.trim()
      : typeof record.source?.id === 'string'
        ? record.source.id.trim()
        : null;
  const isFlLike =
    hasQualField ||
    record.SALE_PRC1 !== undefined ||
    record.SALE_YR1 !== undefined ||
    record.TOT_LVG_AREA !== undefined ||
    record.TOT_LVG_AR !== undefined;
  const isNjLike =
    nuCode !== null ||
    record.lastSalePrice !== undefined ||
    record.lastSaleDate !== undefined ||
    record.DEED_DATE !== undefined ||
    record.SALE_PRICE !== undefined;
  const source =
    sourceFromRecord ||
    context.source ||
    (isFlLike ? 'FLORIDA_DOR_STATEWIDE' : isNjLike ? 'NJGIN_MODIV_CADASTRAL' : 'public_record_deed');

  const rawApn =
    record.apn ??
    record.canonicalApn ??
    record.rawApn ??
    record.parcelId ??
    record.PAMS_PIN ??
    record.PARCEL_ID ??
    record.identity?.normalizedParcelId ??
    record.identity?.rawParcelId ??
    context.apn ??
    null;
  const apn = rawApn !== null && rawApn !== undefined && String(rawApn).trim() !== '' ? String(rawApn).trim() : null;

  const rawAddress =
    record.address ??
    record.situsAddress ??
    record.physicalAddress ??
    record.ST_ADDRESS ??
    record.PROP_LOC ??
    record.PHY_ADDR1 ??
    props?.physicalAddress ??
    props?.situsAddress ??
    context.address ??
    null;
  const address =
    rawAddress !== null && rawAddress !== undefined && String(rawAddress).trim() !== ''
      ? String(rawAddress).trim()
      : null;

  const qualified = !(isNjNonUsable(record) || isFlUnqualified(record) || isFlaggedDistressedOrUnqualified(record));

  const normalized = {
    salePrice,
    saleDate,
    sqft,
    qualified,
    nuCode,
    qualCode,
    source,
    apn,
    address,
  };

  if (context.preserveZip) {
    const zip = normalizeZip5(record.zip ?? record.ZIP5 ?? record.postalCode ?? props?.zip);
    if (zip) normalized.zip = zip;
  }

  return normalized;
}

function unwrapRecordList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.records)) return raw.records;
    if (Array.isArray(raw.comps)) return raw.comps;
    if (Array.isArray(raw.sales)) return raw.sales;
  }
  return [];
}

function peerListingMatchesTarget(listing, peer, options = {}) {
  if (!peer || typeof peer !== 'object') return false;
  const targetState = normalizeStateCode(listing?.state ?? options.state);
  const peerState = normalizeStateCode(peer.state ?? peer.assessorParcel?.state);
  if (!targetState || !peerState || peerState !== targetState) return false;

  const targetCounty = normalizeCountyKey(listing?.county ?? options.county);
  const peerCounty = normalizeCountyKey(peer.county ?? peer.assessorParcel?.countyName ?? peer.assessorParcel?.county);
  const targetZip = normalizeZip5(listing?.zip ?? options.zip);
  const peerZip = normalizeZip5(peer.zip ?? peer.assessorParcel?.zip ?? peer.assessorParcel?.ZIP5);

  const countyMatches = Boolean(targetCounty && peerCounty && targetCounty === peerCounty);
  const zipMatches = Boolean(targetZip && peerZip && targetZip === peerZip);
  return countyMatches || zipMatches;
}

/**
 * Collects and normalizes candidate deed transfer records from listing fields,
 * NJ MOD-IV / FL DOR assessor parcels, publicRecords, and matching peer listings.
 *
 * @param {Object} [listing]
 * @param {Object} [options]
 * @returns {Array<Object>} Deduplicated normalized deed records
 */
function extractCandidateDeedRecords(listing = {}, options = {}) {
  const safeListing = listing && typeof listing === 'object' ? listing : {};
  const candidates = [];

  const listingContext = {
    apn: safeListing.apn ?? safeListing.parcelId ?? safeListing.provenance?.parcelNumber ?? null,
    address: safeListing.address ?? null,
  };

  for (const item of unwrapRecordList(options.deedRecords)) {
    const rec = normalizeCandidateDeedRecord(item, { preserveZip: true });
    if (rec) candidates.push(rec);
  }

  for (const item of unwrapRecordList(safeListing.deedRecords)) {
    const rec = normalizeCandidateDeedRecord(item, { preserveZip: true });
    if (rec) candidates.push(rec);
  }

  const publicDeedComps = safeListing.publicRecords?.deedComps ?? options.publicRecords?.deedComps;
  for (const item of unwrapRecordList(publicDeedComps)) {
    const rec = normalizeCandidateDeedRecord(item, { preserveZip: true });
    if (rec) candidates.push(rec);
  }

  const parcelSources = [
    { parcel: options.assessorParcel, source: 'assessor_parcel' },
    { parcel: safeListing.assessorParcel, source: 'assessor_parcel' },
    { parcel: safeListing.provenance?.derivedFields?.assessorRoll?.parcel, source: 'assessor_roll' },
  ];
  for (const { parcel, source } of parcelSources) {
    if (!parcel || typeof parcel !== 'object') continue;
    const rec = normalizeCandidateDeedRecord(parcel, {
      ...listingContext,
      source,
      requireSaleEvidence: true,
    });
    if (rec) candidates.push(rec);
  }

  const listingRollRec = normalizeCandidateDeedRecord(safeListing, {
    ...listingContext,
    source: 'listing_roll',
    requireSaleEvidence: true,
  });
  if (listingRollRec) candidates.push(listingRollRec);

  if (Array.isArray(options.peerListings)) {
    for (const peer of options.peerListings) {
      if (!peerListingMatchesTarget(safeListing, peer, options)) continue;
      const peerCtx = {
        apn: peer.apn ?? peer.parcelId ?? peer.provenance?.parcelNumber ?? null,
        address: peer.address ?? null,
      };
      for (const item of unwrapRecordList(peer.deedRecords)) {
        const rec = normalizeCandidateDeedRecord(item, { ...peerCtx, preserveZip: false });
        if (rec) candidates.push(rec);
      }
      const peerParcels = [
        peer.assessorParcel,
        peer.provenance?.derivedFields?.assessorRoll?.parcel,
        peer,
      ];
      for (const peerParcel of peerParcels) {
        if (!peerParcel || typeof peerParcel !== 'object') continue;
        const rec = normalizeCandidateDeedRecord(peerParcel, {
          ...peerCtx,
          source: 'peer_assessor_roll',
          requireSaleEvidence: true,
        });
        if (rec) candidates.push(rec);
      }
    }
  }

  const deduped = [];
  const seenKeys = new Set();

  for (const rec of candidates) {
    const normApn = rec.apn ? rec.apn.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    const normAddr = rec.address ? rec.address.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() : '';
    const normDate = rec.saleDate ? String(rec.saleDate).trim() : '';
    const normPrice = rec.salePrice !== null && rec.salePrice !== undefined ? String(rec.salePrice) : '';
    const normCode = `${rec.nuCode ?? ''}:${rec.qualCode ?? ''}`;

    const apnKey = normApn ? `apn:${normApn}|d:${normDate}|p:${normPrice}` : null;
    const addrKey = normAddr ? `addr:${normAddr}|d:${normDate}|p:${normPrice}` : null;
    const fallbackKey = !apnKey && !addrKey ? `anon:d:${normDate}|p:${normPrice}|s:${rec.sqft ?? ''}|c:${normCode}` : null;

    if ((apnKey && seenKeys.has(apnKey)) || (addrKey && seenKeys.has(addrKey)) || (fallbackKey && seenKeys.has(fallbackKey))) {
      continue;
    }

    if (apnKey) seenKeys.add(apnKey);
    if (addrKey) seenKeys.add(addrKey);
    if (fallbackKey) seenKeys.add(fallbackKey);
    deduped.push(rec);
  }

  return deduped;
}

function computeMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function resolveAsOfMs(asOf) {
  if (asOf === undefined || asOf === null) return Date.now();
  if (asOf instanceof Date && Number.isFinite(asOf.getTime())) return asOf.getTime();
  if (typeof asOf === 'number' && Number.isFinite(asOf)) return asOf;
  if (typeof asOf === 'string') {
    const parsed = Date.parse(asOf);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function subtractMonthsUtc(ms, months) {
  const dt = new Date(ms);
  const target = new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() - months, dt.getUTCDate(), 23, 59, 59, 999)
  );
  // Start of cutoff day (00:00:00Z) so exact boundary dates stay included
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 0, 0, 0, 0);
}

/**
 * Evaluates a single deed record and returns either `{ qualified: true, price, sqft, timestampMs }`
 * or `{ qualified: false, reason }`.
 */
function evaluateDeedRecord(record, { targetZip, cutoffMs, asOfEndMs }) {
  if (!record || typeof record !== 'object') {
    return { qualified: false, reason: 'invalid_record' };
  }

  if (targetZip) {
    const recordZip = normalizeZip5(
      record.zip ?? record.ZIP5 ?? record.postalCode ?? record.properties?.zip
    );
    if (recordZip && recordZip !== targetZip) {
      return { qualified: false, reason: 'zip_mismatch' };
    }
  }

  if (isNjNonUsable(record)) {
    return { qualified: false, reason: 'nj_non_usable_code' };
  }

  if (isFlUnqualified(record)) {
    return { qualified: false, reason: 'fl_unqualified_code' };
  }

  if (isFlaggedDistressedOrUnqualified(record)) {
    return { qualified: false, reason: 'distressed_or_unqualified_flag' };
  }

  const props = record.properties && typeof record.properties === 'object' ? record.properties : null;
  const price = parseFinitePositive(
    record.salePrice ??
      record.lastSalePrice ??
      record.recordedSalePrice ??
      record.price ??
      record.SALE_PRICE ??
      record.SALE_PRC1 ??
      props?.recordedSalePrice
  );
  if (price === null || price <= MIN_QUALIFIED_SALE_PRICE) {
    return { qualified: false, reason: 'nominal_or_invalid_price' };
  }

  const timestampMs = parseSaleTimestamp(record);
  if (timestampMs === null) {
    return { qualified: false, reason: 'missing_or_invalid_date' };
  }
  if (timestampMs > asOfEndMs) {
    return { qualified: false, reason: 'future_sale_date' };
  }
  if (cutoffMs !== null && timestampMs < cutoffMs) {
    return { qualified: false, reason: 'outside_window' };
  }

  const sqft = parseFinitePositive(
    record.sqft ??
      record.buildingSqft ??
      record.livingAreaSqft ??
      record.TOT_LVG_AREA ??
      record.TOT_LVG_AR ??
      props?.livingAreaSqft ??
      props?.TOT_LVG_AREA ??
      props?.TOT_LVG_AR ??
      rawAttrs?.SQFT ??
      rawAttrs?.BLDG_SQFT ??
      rawAttrs?.LIVING_AREA ??
      rawAttrs?.HEATED_AREA ??
      rawAttrs?.TOT_LVG_AREA ??
      rawAttrs?.SFLA
  );

  return { qualified: true, price, sqft, timestampMs };
}

/**
 * Computes L2 Qualified Deed-Comp benchmarks without fabricating valuations.
 *
 * @param {Array<Object>|Object} recordsOrListing - Deed records array, envelope `{ records|comps|sales, zip, windowMonths, source }`, or a listing object
 * @param {Object} [options]
 * @param {string|number} [options.zip]
 * @param {string} [options.source]
 * @param {number|null} [options.windowMonths=12]
 * @param {string|number|Date} [options.asOf]
 * @returns {Object} Qualified deed-comp benchmark summary
 */
function computeQualifiedDeedComps(recordsOrListing = [], options = {}) {
  const envelope = !Array.isArray(recordsOrListing) && recordsOrListing && typeof recordsOrListing === 'object'
    ? recordsOrListing
    : null;
  const hasEnvelopeArray = Boolean(
    envelope &&
      (Array.isArray(envelope.records) || Array.isArray(envelope.comps) || Array.isArray(envelope.sales))
  );
  const records = Array.isArray(recordsOrListing)
    ? recordsOrListing
    : hasEnvelopeArray
      ? (Array.isArray(envelope.records)
          ? envelope.records
          : Array.isArray(envelope.comps)
            ? envelope.comps
            : envelope.sales)
      : envelope
        ? extractCandidateDeedRecords(envelope, options)
        : [];

  const zip = normalizeZip5(options.zip ?? envelope?.zip);
  const source =
    String(
      options.source ||
        envelope?.source ||
        'Public Cadastral & Deed Transfer Records (L2 Qualified Sales)'
    ).trim();

  const rawWindow = options.windowMonths !== undefined ? options.windowMonths : envelope?.windowMonths;
  const windowMonths =
    rawWindow === null
      ? null
      : Number.isFinite(Number(rawWindow)) && Number(rawWindow) > 0
        ? Math.floor(Number(rawWindow))
        : DEFAULT_WINDOW_MONTHS;

  const asOfMs = resolveAsOfMs(options.asOf ?? envelope?.asOf);
  const asOfEndMs = asOfMs + 24 * 60 * 60 * 1000;
  const cutoffMs = windowMonths !== null ? subtractMonthsUtc(asOfMs, windowMonths) : null;

  const qualifiedPrices = [];
  const qualifiedPpsf = [];
  const excludedReasons = {};
  let excludedCount = 0;

  for (const record of records) {
    const res = evaluateDeedRecord(record, { targetZip: zip, cutoffMs, asOfEndMs });
    if (!res.qualified) {
      excludedCount += 1;
      excludedReasons[res.reason] = (excludedReasons[res.reason] || 0) + 1;
      continue;
    }
    qualifiedPrices.push(res.price);
    if (res.sqft !== null) {
      qualifiedPpsf.push(res.price / res.sqft);
    }
  }

  const sampleSize = qualifiedPrices.length;
  const sqftSampleSize = qualifiedPpsf.length;

  if (sampleSize < MIN_QUALIFIED_COMPS) {
    return {
      available: false,
      reason: 'insufficient_qualified_comps',
      benchmarkType: 'PUBLIC_RECORD_DEED_COMPS',
      isAppraisal: false,
      isBidRecommendation: false,
      source,
      zip,
      sampleSize,
      sqftSampleSize,
      excludedCount,
      excludedReasons,
      medianSalePrice: null,
      medianPricePerSqft: null,
      windowMonths,
      caveat: DEED_COMPS_CAVEAT,
    };
  }

  const rawMedianPrice = computeMedian(qualifiedPrices);
  const medianSalePrice = rawMedianPrice !== null ? Math.round(rawMedianPrice * 100) / 100 : null;

  let medianPricePerSqft = null;
  if (sqftSampleSize >= MIN_QUALIFIED_COMPS) {
    const rawMedianPpsf = computeMedian(qualifiedPpsf);
    if (rawMedianPpsf !== null) {
      medianPricePerSqft = Math.round(rawMedianPpsf * 100) / 100;
    }
  }

  return {
    available: true,
    reason: null,
    benchmarkType: 'PUBLIC_RECORD_DEED_COMPS',
    isAppraisal: false,
    isBidRecommendation: false,
    source,
    zip,
    sampleSize,
    sqftSampleSize,
    excludedCount,
    excludedReasons,
    medianSalePrice,
    medianPricePerSqft,
    windowMonths,
    caveat: DEED_COMPS_CAVEAT,
  };
}

/**
 * Loads peer listings with persisted assessor rolls from PostgreSQL for L2 deed-comp benchmarking.
 * Fails soft to an empty array if the pool is unavailable or the query errors.
 */
async function loadPeerListingsForDeedComps(pool, listing, options = {}) {
  if (!pool || typeof pool.query !== 'function' || !listing?.state) return [];
  const state = normalizeStateCode(listing.state);
  const zip = normalizeZip5(listing.zip);
  const countyNorm = listing.county
    ? String(listing.county).trim().toLowerCase().replace(/\s+county$/i, '').replace(/[^a-z0-9]+/g, ' ').trim()
    : null;
  if (!state || (!zip && !countyNorm)) return [];
  const limit = Math.max(1, Math.min(250, Number(options.limit) || 150));
  const excludeId = listing.id ? String(listing.id) : '';
  try {
    const res = await pool.query(
      `SELECT id, state, county, city, zip, address, sqft,
              provenance->'derivedFields'->'assessorRoll'->'parcel' AS assessor_parcel
         FROM listings
        WHERE state = $1
          AND id <> $2
          AND provenance->'derivedFields'->'assessorRoll'->'parcel' IS NOT NULL
          AND (
            ($3::text IS NOT NULL AND LEFT(REGEXP_REPLACE(COALESCE(zip, ''), '[^0-9]', '', 'g'), 5) = $3)
            OR ($4::text IS NOT NULL AND LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(county, ''), '\\s+county$', '', 'i'), '[^a-zA-Z0-9]+', ' ', 'g')) = $4)
          )
        ORDER BY
          CASE WHEN $3::text IS NOT NULL AND LEFT(REGEXP_REPLACE(COALESCE(zip, ''), '[^0-9]', '', 'g'), 5) = $3 THEN 0 ELSE 1 END,
          source_observed_at DESC NULLS LAST
        LIMIT $5`,
      [state, excludeId, zip, countyNorm, limit],
    );
    return (Array.isArray(res?.rows) ? res.rows : []).map((row) => ({
      id: row.id,
      state: row.state,
      county: row.county,
      city: row.city,
      zip: row.zip,
      address: row.address,
      sqft: row.sqft,
      assessorParcel: row.assessor_parcel,
    }));
  } catch {
    return [];
  }
}

module.exports = {
  MIN_QUALIFIED_COMPS,
  DEFAULT_WINDOW_MONTHS,
  MIN_QUALIFIED_SALE_PRICE,
  DEED_COMPS_CAVEAT,
  extractCandidateDeedRecords,
  normalizeCandidateDeedRecord,
  computeQualifiedDeedComps,
  loadPeerListingsForDeedComps,
};
