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

function parseSaleTimestamp(record) {
  const props = record?.properties && typeof record.properties === 'object' ? record.properties : null;
  const rawDate = record?.saleDate ?? record?.deedDate ?? record?.DEED_DATE ?? props?.deedDate ?? null;

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
  const hasNuField =
    record &&
    (Object.prototype.hasOwnProperty.call(record, 'nuCode') ||
      Object.prototype.hasOwnProperty.call(record, 'nu_code') ||
      Object.prototype.hasOwnProperty.call(record, 'NU_CODE') ||
      Object.prototype.hasOwnProperty.call(record, 'SALE_NU') ||
      Object.prototype.hasOwnProperty.call(record, 'saleNuCode') ||
      Object.prototype.hasOwnProperty.call(record, 'nonUsableCode'));
  if (!hasNuField) return false;
  const raw =
    record.nuCode ??
    record.nu_code ??
    record.NU_CODE ??
    record.SALE_NU ??
    record.saleNuCode ??
    record.nonUsableCode;
  if (raw === null || raw === undefined) return false;
  const normalized = String(raw).trim().toUpperCase();
  return !NJ_USABLE_NU_CODES.has(normalized);
}

function isFlUnqualified(record) {
  const props = record?.properties && typeof record.properties === 'object' ? record.properties : null;
  const hasQualField =
    (record &&
      (Object.prototype.hasOwnProperty.call(record, 'QUAL_CD1') ||
        Object.prototype.hasOwnProperty.call(record, 'qualCode') ||
        Object.prototype.hasOwnProperty.call(record, 'saleQualificationCode'))) ||
    (props && Object.prototype.hasOwnProperty.call(props, 'saleQualificationCode'));
  if (!hasQualField) return false;

  const raw =
    record?.QUAL_CD1 ??
    record?.qualCode ??
    record?.saleQualificationCode ??
    props?.saleQualificationCode;
  if (raw === null || raw === undefined) return true;
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

  if (isFlaggedDistressedOrUnqualified(record)) {
    return { qualified: false, reason: 'distressed_or_unqualified_flag' };
  }

  if (isNjNonUsable(record)) {
    return { qualified: false, reason: 'nj_non_usable_code' };
  }

  if (isFlUnqualified(record)) {
    return { qualified: false, reason: 'fl_unqualified_code' };
  }

  const props = record.properties && typeof record.properties === 'object' ? record.properties : null;
  const price = parseFinitePositive(
    record.salePrice ??
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
      record.livingAreaSqft ??
      record.TOT_LVG_AR ??
      record.buildingSqft ??
      props?.livingAreaSqft
  );

  return { qualified: true, price, sqft, timestampMs };
}

/**
 * Computes L2 Qualified Deed-Comp benchmarks without fabricating valuations.
 *
 * @param {Array<Object>|Object} input - Deed records array or envelope `{ records|comps|sales, zip, windowMonths, source }`
 * @param {Object} [options]
 * @param {string|number} [options.zip]
 * @param {string} [options.source]
 * @param {number|null} [options.windowMonths=12]
 * @param {string|number|Date} [options.asOf]
 * @returns {Object} Qualified deed-comp benchmark summary
 */
function computeQualifiedDeedComps(input = [], options = {}) {
  const envelope = !Array.isArray(input) && input && typeof input === 'object' ? input : null;
  const records = Array.isArray(input)
    ? input
    : Array.isArray(envelope?.records)
      ? envelope.records
      : Array.isArray(envelope?.comps)
        ? envelope.comps
        : Array.isArray(envelope?.sales)
          ? envelope.sales
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

module.exports = {
  MIN_QUALIFIED_COMPS,
  DEFAULT_WINDOW_MONTHS,
  MIN_QUALIFIED_SALE_PRICE,
  DEED_COMPS_CAVEAT,
  computeQualifiedDeedComps,
};
