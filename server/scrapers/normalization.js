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

  return {
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
}

module.exports = {
  cleanText,
  httpsUrlOrNull,
  numberOrNull,
  observationTimestamp,
  standardizeListingRecord
};
