const { normalizeOcrText } = require('../ai/notice-parser');
const { inspectImageUrl } = require('./media-policy');
const { inspectSourceRecordUrl } = require('./source-policy');
const { getRedemptionRule, detectSeniorLienSurvival } = require('../ai/legal-rules');

function cleanText(value, placeholders = []) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (placeholders.some((placeholder) => lowered === placeholder.toLowerCase())) return null;
  return text;
}

function numberOrNull(value, options = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  if (parsed < min || parsed > max) return null;
  return options.integer ? Math.trunc(parsed) : parsed;
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function observationTimestamp(value) {
  const parsed = value == null || value === '' ? NaN : Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function httpsUrlOrNull(value) {
  const candidate = cleanText(value);
  if (!candidate || candidate.length > 2_048) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) return null;
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

/** Strip non-alphanumeric characters and uppercase an APN/parcel number. */
function normalizeApn(rawApn) {
  if (rawApn === null || rawApn === undefined) return null;
  const stripped = String(rawApn).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return stripped || null;
}

/**
 * Build a stable parcel join key: `${countyFips}-${normalizedApn}` when a
 * 5-digit county FIPS is available, otherwise the normalized APN alone.
 * Returns null when no APN is present — never fabricates a key.
 */
function buildParcelKey({ apn, countyFips, stateFips } = {}) {
  const normalizedApn = normalizeApn(apn);
  if (!normalizedApn) return null;
  const county = cleanText(countyFips);
  const state = cleanText(stateFips);
  let fips5 = null;
  if (county && /^\d{5}$/.test(county)) {
    fips5 = county;
  } else if (state && county && /^\d{2}$/.test(state) && /^\d{3}$/.test(county)) {
    fips5 = `${state}${county}`;
  }
  return fips5 ? `${fips5}-${normalizedApn}` : normalizedApn;
}

function extractCountyFips(listing) {
  const candidates = [
    listing.countyFips,
    listing.provenance?.countyFips,
    listing.provenance?.sourceFacts?.countyFips,
    listing.provenance?.jurisdiction
  ];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (!text) continue;
    const fipsMatch = text.match(/(?:us-fips:)?(\d{5})$/i);
    if (fipsMatch) return fipsMatch[1];
  }
  const stateFips = cleanText(listing.stateFips || listing.provenance?.stateFips || listing.provenance?.sourceFacts?.stateFips);
  const countyFips = cleanText(listing.countyFips || listing.provenance?.countyFips || listing.provenance?.sourceFacts?.countyFips);
  if (stateFips && /^\d{2}$/.test(stateFips) && countyFips && /^\d{3}$/.test(countyFips)) {
    return `${stateFips}${countyFips}`;
  }
  return null;
}

function extractRawApn(listing) {
  const sourceFacts = asPlainObject(listing.provenance?.sourceFacts);
  const candidates = [
    listing.apn,
    listing.parcelNumber,
    listing.parcelId,
    sourceFacts.apn,
    sourceFacts.parcelNumber,
    sourceFacts.parcelId
  ];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (text) return text;
  }
  return null;
}

const REO_SOURCES = new Set([
  'hud', 'fannie', 'freddie', 'va', 'fdic', 'treasury', 'irs', 'gsa',
  'landbank', 'landbanksearch', 'usda', 'hud-homestore', 'fannie-homepath',
  'freddie-homesteps', 'va-vrm', 'fdic-asset-sales', 'usda-resales',
  'treasury-forfeiture', 'irs-auctions', 'gsa-real-estate-sales'
]);
const SCHEDULED_SOURCES = new Set(['trustee', 'county-trustee-sale', 'bid4assets']);
const SALE_PROXIMITY_SOURCES = new Set(['sheriff', 'civilview', 'ohio-sheriff-sale']);

function mapDistressStage(source, saleDate) {
  const key = (source || '').toLowerCase();
  if (REO_SOURCES.has(key)) return 'reo';
  if (SCHEDULED_SOURCES.has(key)) return 'scheduled';
  if (SALE_PROXIMITY_SOURCES.has(key)) {
    const saleTime = saleDate ? Date.parse(saleDate) : NaN;
    if (Number.isFinite(saleTime)) {
      const daysUntilSale = (saleTime - Date.now()) / 86_400_000;
      return daysUntilSale <= 30 ? 'scheduled' : 'pre_foreclosure';
    }
    return 'pre_foreclosure';
  }
  if (key === 'tax_sale' || /tax[-_]?sale|tax[-_]?deed/.test(key)) return 'tax_sale';
  return 'unknown';
}

function daysSince(timestamp, now = Date.now()) {
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / 86_400_000));
}

function computeTriage(listing = {}, options = {}) {
  const now = options.now ?? Date.now();
  const firstSeenCandidate = listing.firstSeenAt ?? listing.updatedAt
    ?? listing.sourceObservedAt ?? listing.fetchedAt
    ?? listing.provenance?.observedAt;
  const firstSeenTime = Date.parse(firstSeenCandidate || '');
  const isNew = Number.isFinite(firstSeenTime) && (now - firstSeenTime) <= 48 * 3_600_000;

  const lastObservedCandidate = listing.lastObservedAt ?? listing.updatedAt
    ?? listing.sourceObservedAt ?? listing.fetchedAt
    ?? listing.provenance?.observedAt;
  const stale = daysSince(lastObservedCandidate, now);

  const documents = listing.documents ?? listing.provenance?.sourceFacts?.documents;
  const hasDocs = typeof listing.hasDocuments === 'boolean'
    ? listing.hasDocuments
    : Array.isArray(documents) ? documents.length > 0 : false;

  const occupancy = cleanText(listing.occupancy);
  const occupancyKnown = Boolean(occupancy);

  const priorBid = numberOrNull(listing.priorOpeningBid, { min: 0 });
  const currentBid = numberOrNull(listing.openingBid, { min: 0 });
  const priceDropped = listing.priceDropped === true
    || (priorBid !== null && currentBid !== null && currentBid < priorBid);

  return {
    isNew,
    priceDropped,
    staleDays: stale === null ? -1 : stale,
    hasDocs,
    occupancyKnown,
    distressStage: mapDistressStage(listing.source, listing.saleDate)
  };
}

function attachParcelIdentity(listing) {
  const rawApn = extractRawApn(listing);
  const countyFips = extractCountyFips(listing);
  return buildParcelKey({ apn: rawApn, countyFips });
}

function standardizeListingRecord(raw = {}, options = {}) {
  const input = asPlainObject(raw);
  const configuredSource = cleanText(options.sourceKey);
  const source = (cleanText(input.source) || configuredSource || '').toLowerCase() || null;
  const state = (cleanText(input.state, ['US']) || '').toUpperCase() || null;
  const rawNotice = input.raw == null ? null : cleanText(normalizeOcrText(String(input.raw)));
  const sourceUrl = httpsUrlOrNull(input.sourceUrl);
  const photoField = ['photo', 'photoUrl', 'imageUrl'].find((field) => typeof input[field] === 'string' && input[field].trim());
  const imageCandidate = inspectImageUrl(photoField ? input[photoField] : null);
  const sourceInspection = inspectSourceRecordUrl(source, sourceUrl);
  let photo = imageCandidate.accepted && sourceInspection.isValid ? imageCandidate.url : null;

  const openingBid = numberOrNull(input.openingBid, { min: Number.EPSILON });
  const estLow = numberOrNull(input.estLow, { min: Number.EPSILON });
  const estHigh = numberOrNull(input.estHigh, { min: Number.EPSILON });
  const validEstimateRange = estLow !== null && estHigh !== null && estHigh >= estLow;
  const mid = validEstimateRange ? (estLow + estHigh) / 2 : null;
  const ratio = openingBid !== null && mid !== null && mid > 0 ? openingBid / mid : null;
  const bidSpread = openingBid !== null && mid !== null ? Math.max(0, mid - openingBid) : null;
  const dealScore = ratio !== null
    ? Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))
    : null;

  const rawLat = numberOrNull(input.lat, { min: -90, max: 90 });
  const rawLng = numberOrNull(input.lng, { min: -180, max: 180 });
  const hasObservedGeocode = rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);
  const lat = hasObservedGeocode ? rawLat : null;
  const lng = hasObservedGeocode ? rawLng : null;

  const derivedFields = {};
  if (mid !== null) {
    derivedFields.valuationMetrics = {
      model: 'observed-valuation-range-v1',
      inputs: ['openingBid', 'estLow', 'estHigh'],
      note: 'Bid Spread and Deal Score use the source-provided range only. Deal Score is a triage indicator, not an appraisal.'
    };
  }

  let redemptionDays = numberOrNull(input.redemptionDays, { min: 0, integer: true });
  let redemptionWarning = cleanText(input.redemptionWarning);
  if (state && /^[A-Z]{2}$/.test(state) && redemptionDays === null) {
    const redemption = getRedemptionRule(state);
    redemptionDays = redemption.days;
    redemptionWarning = redemption.warning;
    derivedFields.redemption = {
      model: 'state-statutory-rule-lookup-v1',
      inputs: ['state'],
      note: 'State-level baseline only; sale type and docket must be verified.'
    };
  }

  let seniorLienRisk = cleanText(input.seniorLienRisk);
  let seniorLienWarning = cleanText(input.seniorLienWarning);
  if (!seniorLienRisk && (cleanText(input.plaintiff) || rawNotice)) {
    const seniorLien = detectSeniorLienSurvival(input.plaintiff || '', rawNotice || '');
    seniorLienRisk = seniorLien.riskLevel;
    seniorLienWarning = seniorLien.warning;
    derivedFields.seniorLienRisk = {
      model: 'legal-text-pattern-v1',
      inputs: ['plaintiff', 'raw'],
      note: 'Pattern flag only; not a title opinion.'
    };
  }

  const suppliedCashToClose = numberOrNull(input.cashToClose, { min: 0 });
  const suppliedCashBasis = cleanText(input.cashToCloseBasis);
  let cashToClose = null;
  let cashToCloseDetails = asPlainObject(input.cashToCloseDetails);
  const cashModel = cleanText(cashToCloseDetails.model);
  const cashBasis = asPlainObject(cashToCloseDetails.basis);
  const isExplicitScenario = cashModel === 'explicit-cash-requirements-v2'
    && Object.values(cashBasis).some((value) => value === 'published' || value === 'assumption');
  const isPublishedTotal = suppliedCashToClose !== null
    && (suppliedCashBasis === 'published' || suppliedCashBasis === 'assumption');
  if (isExplicitScenario) {
    cashToClose = numberOrNull(
      cashToCloseDetails.totalAcquisitionCost ?? cashToCloseDetails.totalCashToClose,
      { min: 0 }
    );
  } else if (isPublishedTotal) {
    cashToClose = suppliedCashToClose;
    cashToCloseDetails = {
      model: 'reported-cash-requirement-v1',
      modelStatus: 'reported_total_only',
      totalCashToClose: suppliedCashToClose,
      totalAcquisitionCost: suppliedCashToClose,
      basis: { totalAcquisitionCost: suppliedCashBasis },
      missingInputs: ['registrationFunds', 'creditedDeposit', 'buyersPremium', 'sheriffPoundage', 'transferTax', 'delinquentTaxes', 'settlementCosts']
    };
  } else {
    // Retire v1 source/state fee guesses and un-attributed totals at ingestion.
    // The source record stays intact; only the unsupported calculation is removed.
    cashToCloseDetails = {};
  }
  if (Object.keys(cashToCloseDetails).length === 0) cashToCloseDetails = null;

  const baseProvenance = asPlainObject(input.provenance);
  const existingDerived = asPlainObject(baseProvenance.derivedFields);
  const combinedDerived = { ...existingDerived, ...derivedFields };
  const sourceObservedAt = observationTimestamp(
    input.sourceObservedAt ?? input.observedAt ?? baseProvenance.observedAt ?? options.observedAt
  );
  const auctionProgram = cleanText(input.auctionProgram);
  const lifecycleStatus = cleanText(input.lifecycleStatus);
  const transactionOutcome = cleanText(input.transactionOutcome);
  const hasDocuments = typeof input.hasDocuments === 'boolean' ? input.hasDocuments : null;
  const provenance = {
    origin: 'live',
    observed: true,
    recordKind: 'source_record',
    ...baseProvenance,
    observedAt: sourceObservedAt,
    ...(Object.keys(combinedDerived).length > 0 ? { derivedFields: combinedDerived } : {})
  };
  const existingMedia = asPlainObject(baseProvenance.media);
  const previousPhoto = asPlainObject(existingMedia.photo);
  const imageSource = previousPhoto.sourceRecordUrl
    ? inspectSourceRecordUrl(source, previousPhoto.sourceRecordUrl)
    : null;
  if ((imageSource && (!imageSource.isValid || imageSource.url !== sourceInspection.url))
      || provenance.observed !== true || provenance.origin !== 'live'
      || !cleanText(provenance.publisher) || !cleanText(provenance.recordId)) photo = null;
  if (photo) {
    provenance.media = {
      ...existingMedia,
      photo: {
        ...previousPhoto,
        url: photo,
        provider: cleanText(baseProvenance.publisher) || source,
        origin: 'publisher_record',
        verification: 'source_extracted',
        sourceRecordUrl: sourceUrl,
        observedAt: sourceObservedAt,
        host: new URL(photo).hostname,
        extraction: previousPhoto.extraction || { field: photoField, association: 'same_source_record' }
      }
    };
  } else {
    provenance.media = {
      ...existingMedia,
      photo: null,
      photoStatus: {
        state: imageCandidate.reason === 'missing_image' ? 'not_published' : 'rejected',
        reason: imageCandidate.reason || 'missing_or_mismatched_source_evidence',
        observedAt: sourceObservedAt
      }
    };
  }

  const normalizedRecord = {
    id: cleanText(input.id),
    source,
    state,
    county: cleanText(input.county, ['County', 'Unknown']),
    city: cleanText(input.city, ['City', 'Unknown']),
    zip: cleanText(input.zip, ['00000', 'Unknown']),
    address: cleanText(input.address),
    lat,
    lng,
    beds: numberOrNull(input.beds, { min: 0 }),
    baths: numberOrNull(input.baths, { min: 0 }),
    sqft: numberOrNull(input.sqft, { min: 0 }),
    year: numberOrNull(input.year, { min: 1000, max: new Date().getFullYear() + 2, integer: true }),
    propType: cleanText(input.propType, ['Unknown']),
    openingBid,
    estLow,
    estHigh,
    assessed: numberOrNull(input.assessed, { min: 0 }),
    mid,
    ratio,
    bidSpread,
    equity: bidSpread,
    dealScore,
    redemptionDays,
    redemptionWarning,
    seniorLienRisk,
    seniorLienWarning,
    cashToClose,
    cashToCloseDetails,
    saleDate: cleanText(input.saleDate),
    plaintiff: cleanText(input.plaintiff, ['—', 'Unknown']),
    defendant: cleanText(input.defendant, ['—', 'Unknown']),
    judgment: numberOrNull(input.judgment, { min: 0 }),
    attorney: cleanText(input.attorney, ['—', 'Unknown']),
    occupancy: cleanText(input.occupancy, ['Unknown']),
    deposit: cleanText(input.deposit, ['Unknown']),
    photo,
    sourceUrl,
    raw: rawNotice,
    price: numberOrNull(input.price, { min: 0 }),
    listingDate: cleanText(input.listingDate),
    status: cleanText(input.status),
    auctionProgram,
    lifecycleStatus,
    transactionOutcome,
    hasDocuments,
    provenance,
    sourceObservedAt
  };
  normalizedRecord.parcelKey = attachParcelIdentity({
    ...normalizedRecord,
    apn: input.apn,
    parcelNumber: input.parcelNumber,
    parcelId: input.parcelId,
    countyFips: input.countyFips,
    stateFips: input.stateFips
  });
  normalizedRecord.triage = computeTriage(normalizedRecord);
  return normalizedRecord;
}

module.exports = {
  cleanText,
  httpsUrlOrNull,
  numberOrNull,
  observationTimestamp,
  standardizeListingRecord,
  normalizeApn,
  buildParcelKey,
  computeTriage,
  mapDistressStage
};
