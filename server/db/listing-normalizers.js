'use strict';

const {
  computeTriage,
  buildParcelKey,
  extractRawApn,
  extractCountyFips,
  normalizePropType,
  collectVerifiedImages,
} = require('../scrapers/normalization');
const { computeCatchSummary } = require('../intelligence/catch-summary');

// GET /api/alerts/matches pagination bounds (shared by Postgres + in-memory paths).
const ALERT_MATCHES_DEFAULT_LIMIT = 50;
const ALERT_MATCHES_MAX_LIMIT = 200;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampAlertMatchesLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return ALERT_MATCHES_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ALERT_MATCHES_MAX_LIMIT, Math.floor(n)));
}

function sameNormalizedListingAddress(a, b) {
  const norm = (x) => String(x?.address ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const addrA = norm(a);
  const addrB = norm(b);
  if (!addrA || !addrB || addrA !== addrB) return false;
  return String(a?.state ?? '').trim().toUpperCase() === String(b?.state ?? '').trim().toUpperCase();
}

function optionalFiniteNumber(value, { positive = false, nonNegative = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (positive && number <= 0) return null;
  if (nonNegative && number < 0) return null;
  return number;
}

function normalizeGeocode(latValue, lngValue) {
  const lat = optionalFiniteNumber(latValue);
  const lng = optionalFiniteNumber(lngValue);
  const valid = lat !== null && lng !== null
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
  return valid ? { lat, lng } : { lat: null, lng: null };
}

function isoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Align PG text/numeric columns with the in-memory camelCase contract. */
function mapPgListingRow(row) {
  if (!row || typeof row !== 'object') return row;
  const assessorRoll = row.provenance?.derivedFields?.assessorRoll;
  return {
    ...row,
    bidSpread: row.bidSpread == null || row.bidSpread === ''
      ? null
      : Number(row.bidSpread),
    sourceObservedAt: isoOrNull(row.sourceObservedAt),
    fetchedAt: isoOrNull(row.fetchedAt),
    // Computed fields are not columns; keep contract keys present (nullable).
    parcelKey: (Object.prototype.hasOwnProperty.call(row, 'parcelKey') && row.parcelKey != null && row.parcelKey !== '')
      ? row.parcelKey
      : (row.provenance?.parcelKey || null),
    assessorParcel: (Object.prototype.hasOwnProperty.call(row, 'assessorParcel') && row.assessorParcel != null)
      ? row.assessorParcel
      : (assessorRoll?.parcel || null),
    assessmentYear: (Object.prototype.hasOwnProperty.call(row, 'assessmentYear') && row.assessmentYear != null && row.assessmentYear !== '')
      ? row.assessmentYear
      : (assessorRoll?.assessmentYear ?? assessorRoll?.taxYear ?? null),
    triage: Object.prototype.hasOwnProperty.call(row, 'triage') ? row.triage : null,
    sourceFacts: Object.prototype.hasOwnProperty.call(row, 'sourceFacts') ? row.sourceFacts : null,
    // Deterministic "Here's the Catch" one-liner (migration 042). Aliased from
    // catch_summary so both SELECT-alias and raw-column paths normalize.
    catchSummary: (Object.prototype.hasOwnProperty.call(row, 'catchSummary') && row.catchSummary != null && row.catchSummary !== '')
      ? row.catchSummary
      : (Object.prototype.hasOwnProperty.call(row, 'catch_summary') && row.catch_summary != null && row.catch_summary !== ''
        ? row.catch_summary
        : null),
  };
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return Number.isNaN(Date.parse(str)) ? null : str;
  }
  const timestamp = Date.parse(str);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString().slice(0, 10);
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function canonicalStatus(value) {
  const raw = optionalText(value);
  if (!raw) return 'unknown';
  const normalized = raw.toLowerCase();
  if (/cancel|withdraw|dismiss|settl|discontinu|\bredeem(?:ed)?\b|\bwrit\s+expired\b|\bexpired\b|\bvacat(?:ed)?\b|\bremoved\b|\bno\s+sale\b/.test(normalized)) return 'cancelled';
  if (/postpon/.test(normalized)) return 'postponed';
  if (/\badj(?:ourn(?:ed|ment)?|d|\.)?(?:\b|$)/.test(normalized)) return 'adjourned';
  if (/\bstay(?:ed)?\b|bankr?upt?c|\b(?:on\s+)?hold\b/.test(normalized)) return 'stayed';
  if (/reverted\s+to\s+(?:plaintiff|beneficiary)|(?:purchased|sold)\s*(?:-|to|:)\s*(?:plaintiff|beneficiary)/.test(normalized)) return 'closed';
  if (/\bsold\b|purchased\s*[-:]\s*(?:3rd|third)[-\s]*party/.test(normalized)) return 'sold';
  if (/\bclosed\b|\bauctioned\b|\bpost[-\s]?auction\b|\boutbid\b|\bended\b/.test(normalized)) return 'closed';
  if (/scheduled|coming\s*soon|pre[-.\s]?auction|\bauction\s*(?:begins|starts|date)\b/.test(normalized)) return 'scheduled';
  if (/pending/.test(normalized)) return 'pending';
  if (/^(?:status\s*:\s*)?(?:active|live|open|bidding|available|re-?listed)$|\bauction\s*(?:event|ends)\b|\bbidding\s+(?:open|ends)\b/.test(normalized)) return 'active';
  return 'unknown';
}

function normalizeProvenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > 256_000) return null;
    return JSON.parse(serialized);
  } catch (_) {
    return null;
  }
}

function normalizeCashToCloseDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > 65_536) return null;
    const normalized = JSON.parse(serialized);
    return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
      ? normalized
      : null;
  } catch (_) {
    return null;
  }
}

function prepareListingForPersistence(listing = {}) {
  const openingBid = optionalFiniteNumber(listing.openingBid, { positive: true });
  const estLow = optionalFiniteNumber(listing.estLow, { positive: true });
  const estHigh = optionalFiniteNumber(listing.estHigh, { positive: true });
  const hasValidEstimateRange = estLow !== null && estHigh !== null && estHigh >= estLow;
  const mid = hasValidEstimateRange ? (estLow + estHigh) / 2 : null;
  const ratio = openingBid !== null && mid !== null && mid > 0 ? openingBid / mid : null;
  const equity = openingBid !== null && mid !== null ? Math.max(0, mid - openingBid) : null;
  const dealScore = ratio !== null
    ? Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))
    : null;
  const geocode = normalizeGeocode(listing.lat, listing.lng);
  const primaryStatus = canonicalStatus(listing.status);
  const lifecycleCanonical = canonicalStatus(listing.lifecycleStatus);
  const resolvedStatus = ['cancelled', 'closed', 'sold', 'stayed', 'adjourned', 'postponed'].includes(lifecycleCanonical)
    ? lifecycleCanonical
    : (primaryStatus !== 'unknown' ? primaryStatus : lifecycleCanonical);
  const seniorLienRisk = typeof listing.seniorLienRisk === 'string' && listing.seniorLienRisk.trim()
    ? listing.seniorLienRisk.trim().toLowerCase()
    : null;

  const normalized = {
    ...listing,
    ...geocode,
    openingBid,
    estLow,
    estHigh,
    assessed: optionalFiniteNumber(listing.assessed, { positive: true }),
    mid,
    ratio,
    equity,
    dealScore,
    county: optionalText(listing.county),
    city: optionalText(listing.city),
    zip: optionalText(listing.zip),
    propType: normalizePropType(optionalText(listing.propType)),
    saleDate: normalizeDate(listing.saleDate),
    listingDate: normalizeDate(listing.listingDate),
    beds: optionalFiniteNumber(listing.beds, { nonNegative: true }),
    baths: optionalFiniteNumber(listing.baths, { nonNegative: true }),
    sqft: optionalFiniteNumber(listing.sqft, { nonNegative: true }),
    year: optionalFiniteNumber(listing.year, { positive: true }),
    judgment: optionalFiniteNumber(listing.judgment, { nonNegative: true }),
    price: optionalFiniteNumber(listing.price, { nonNegative: true }),
    redemptionDays: optionalFiniteNumber(listing.redemptionDays, { nonNegative: true }),
    cashToClose: optionalFiniteNumber(listing.cashToClose, { nonNegative: true }),
    cashToCloseDetails: normalizeCashToCloseDetails(listing.cashToCloseDetails),
    deposit: listing.deposit || null,
    occupancy: listing.occupancy || null,
    plaintiff: optionalText(listing.plaintiff),
    defendant: optionalText(listing.defendant),
    attorney: optionalText(listing.attorney),
    photo: optionalText(listing.photo),
    images: (() => {
      const derived = collectVerifiedImages({
        photo: optionalText(listing.photo),
        gallery: listing.provenance?.media?.gallery,
        inputImages: listing.images,
        sourceValid: Boolean(listing.sourceUrl),
      });
      return derived.length > 0 ? derived : null;
    })(),
    seniorLienRisk,
    auctionProgram: optionalText(listing.auctionProgram ?? listing.provenance?.sourceFacts?.auctionProgram),
    lifecycleStatus: optionalText(listing.lifecycleStatus ?? listing.status),
    transactionOutcome: optionalText(listing.transactionOutcome),
    hasDocuments: typeof listing.hasDocuments === 'boolean' ? listing.hasDocuments
      : Array.isArray(listing.documents ?? listing.provenance?.sourceFacts?.documents)
        ? (listing.documents ?? listing.provenance.sourceFacts.documents).length > 0 : null,
    status: resolvedStatus,
    provenance: normalizeProvenance(listing.provenance),
    sourceObservedAt: normalizeTimestamp(listing.sourceObservedAt ?? listing.observedAt),
    // This is deliberately assigned at the trusted persistence boundary rather
    // than accepted from a source payload.
    fetchedAt: new Date().toISOString(),
  };
  const sourceFacts = normalized.provenance?.sourceFacts || {};
  if (normalized.parcelKey === undefined || normalized.parcelKey === null) {
    normalized.parcelKey = buildParcelKey({
      apn: extractRawApn(listing)
        ?? listing.apn ?? listing.parcelNumber ?? listing.parcelId
        ?? sourceFacts.apn ?? sourceFacts.parcelNumber ?? sourceFacts.parcelId,
      countyFips: extractCountyFips(listing)
        ?? listing.countyFips ?? sourceFacts.countyFips ?? listing.provenance?.countyFips
    });
  }
  if (normalized.parcelKey && normalized.provenance && !normalized.provenance.parcelKey) {
    normalized.provenance.parcelKey = normalized.parcelKey;
  }
  if (normalized.transactionOutcome && normalized.provenance) {
    normalized.provenance.sourceFacts = {
      ...(normalized.provenance.sourceFacts || {}),
      transactionOutcome: normalized.transactionOutcome,
    };
  }
  normalized.triage = computeTriage(normalized);
  // Deterministic "Here's the Catch" one-liner — $0, computed from fields already
  // present on the normalized record. Title warnings are sourced from the existing
  // arbitrateTitleRisk result when available in provenance; otherwise derived
  // deterministically and persisted in derivedFields for grid/CatchReveal parity.
  const explicitTitleWarnings = Array.isArray(normalized.provenance?.titleWarnings)
    ? normalized.provenance.titleWarnings
    : (Array.isArray(listing.titleWarnings) ? listing.titleWarnings : []);
  let persistedTitleWarnings = explicitTitleWarnings;
  let persistedRiskLevel = normalized.provenance?.riskLevel
    || listing.riskLevel
    || normalized.provenance?.derivedFields?.titleRiskLevel
    || null;
  if (persistedTitleWarnings.length === 0) {
    try {
      const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');
      const tr = arbitrateTitleRisk(normalized);
      if (Array.isArray(tr?.titleWarnings) && tr.titleWarnings.length > 0) {
        persistedTitleWarnings = tr.titleWarnings;
      }
      if (!persistedRiskLevel && tr?.riskLevel) {
        persistedRiskLevel = tr.riskLevel;
      }
    } catch {
      // Fall back to listing-level signals only
    }
  }
  const isActionableCatchWarning = (w) =>
    typeof w === 'string' && w.trim() && !/^(?:SENIOR FORECLOSURE|TAX SALE PRIORITY):/i.test(w.trim());
  const shouldStoreCatchWarnings = explicitTitleWarnings.length > 0
    || persistedRiskLevel === 'CRITICAL'
    || persistedRiskLevel === 'HIGH';
  const compactCatchWarnings = shouldStoreCatchWarnings
    ? persistedTitleWarnings
        .filter(isActionableCatchWarning)
        .slice(0, 6)
        .map((w) => (w.length > 220 ? `${w.slice(0, 217)}...` : w))
    : [];
  const hasExistingDerivedFields = Boolean(normalized.provenance?.derivedFields && typeof normalized.provenance.derivedFields === 'object');
  if (hasExistingDerivedFields || compactCatchWarnings.length > 0 || shouldStoreCatchWarnings) {
    normalized.provenance = {
      ...(normalized.provenance || {}),
      derivedFields: {
        ...(normalized.provenance?.derivedFields || {}),
        catchWarnings: compactCatchWarnings,
        titleRiskLevel: persistedRiskLevel,
      },
    };
  }
  normalized.catchSummary = computeCatchSummary(normalized, persistedTitleWarnings, persistedRiskLevel);
  return normalized;
}

function mergeListingForInMemoryUpsert(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing, ...incoming };
  const incomingHasEstimateBand = incoming.estLow !== null && incoming.estHigh !== null;
  if (!incomingHasEstimateBand && existing.estLow !== null && existing.estHigh !== null) {
    merged.estLow = existing.estLow;
    merged.estHigh = existing.estHigh;
  }
  const sameAddr = sameNormalizedListingAddress(existing, incoming);
  if (incoming.lat === null || incoming.lng === null) {
    if (sameAddr && existing.lat !== null && existing.lng !== null) {
      merged.lat = existing.lat;
      merged.lng = existing.lng;
    } else {
      merged.lat = null;
      merged.lng = null;
    }
  }
  if (existing.provenance || incoming.provenance) {
    const baseExistingProv = { ...(existing.provenance || {}) };
    if (!sameAddr) {
      delete baseExistingProv.coordinates;
    }
    merged.provenance = { ...baseExistingProv, ...(incoming.provenance || {}) };
    if (existing.provenance?.derivedFields || incoming.provenance?.derivedFields) {
      const baseExistingDerived = { ...(existing.provenance?.derivedFields || {}) };
      if (!sameAddr) {
        delete baseExistingDerived.geocode;
      }
      merged.provenance.derivedFields = {
        ...baseExistingDerived,
        ...(incoming.provenance?.derivedFields || {}),
      };
    }
    if (sameAddr
        && existing.provenance?.coordinates
        && typeof existing.provenance.coordinates === 'object'
        && (!incoming.provenance || !incoming.provenance.coordinates || typeof incoming.provenance.coordinates !== 'object')
        && (incoming.lat === null || (incoming.lat === existing.lat && incoming.lng === existing.lng))) {
      merged.provenance.coordinates = existing.provenance.coordinates;
    }
  }
  for (const field of [
    'county', 'city', 'zip', 'beds', 'baths', 'sqft', 'year', 'assessed',
    'openingBid', 'saleDate', 'deposit', 'occupancy', 'redemptionDays',
    'seniorLienRisk', 'cashToClose', 'cashToCloseDetails', 'price',
    'listingDate', 'sourceObservedAt', 'auctionProgram', 'lifecycleStatus',
    'transactionOutcome',
  ]) {
    if (incoming[field] === null && existing[field] !== null && existing[field] !== undefined) {
      merged[field] = existing[field];
    }
  }
  if (incoming.status === 'unknown' && existing.status && existing.status !== 'unknown') {
    merged.status = existing.status;
  }
  const existingInit = optionalFiniteNumber(existing.initialOpeningBid ?? existing.openingBid, { positive: true });
  const incomingBid = optionalFiniteNumber(merged.openingBid, { positive: true });
  merged.initialOpeningBid = existingInit ?? incomingBid;
  const existingPeak = optionalFiniteNumber(existing.peakOpeningBid ?? existing.openingBid, { positive: true });
  merged.peakOpeningBid = existingPeak !== null && incomingBid !== null
    ? Math.max(existingPeak, incomingBid)
    : (existingPeak ?? incomingBid);
  if ((!incoming.propType || incoming.propType === 'Unknown') && existing.propType && existing.propType !== 'Unknown') {
    merged.propType = existing.propType;
  }
  if (incoming.hasDocuments !== true && existing.hasDocuments === true) {
    merged.hasDocuments = true;
  }
  // Detect an opening-bid decrease versus the prior observation so triage can
  // surface priceDropped without a separate history table.
  if (existing.openingBid != null && incoming.openingBid != null
      && Number(incoming.openingBid) < Number(existing.openingBid)) {
    merged.priorOpeningBid = existing.openingBid;
    merged.priceDropped = true;
  } else if (existing.priceDropped && merged.priorOpeningBid == null) {
    merged.priorOpeningBid = existing.priorOpeningBid ?? existing.openingBid;
    merged.priceDropped = true;
  }
  return prepareListingForPersistence(merged);
}

function compareNumbersUnknownLast(left, right, descending = true) {
  const leftKnown = Number.isFinite(Number(left)) && left !== null;
  const rightKnown = Number.isFinite(Number(right)) && right !== null;
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (!leftKnown) return 0;
  return descending ? Number(right) - Number(left) : Number(left) - Number(right);
}

/**
 * Compute a bake-off between two listings that share a parcelKey but come
 * from different sources. Prefer the fresher observation; never overwrite
 * either record — both stay in the inventory with cross-source metadata.
 */
function computeBakeOff(existing, incoming) {
  const existingTime = Date.parse(existing.sourceObservedAt || existing.provenance?.observedAt || '');
  const incomingTime = Date.parse(incoming.sourceObservedAt || incoming.provenance?.observedAt || '');
  const existingFresh = Number.isFinite(existingTime) ? existingTime : 0;
  const incomingFresh = Number.isFinite(incomingTime) ? incomingTime : 0;
  const preferred = incomingFresh >= existingFresh ? incoming : existing;
  const other = preferred === incoming ? existing : incoming;
  const ageGapHours = Math.abs(incomingFresh - existingFresh) / 3_600_000;
  // Confidence: high when the gap is >24h, medium when >1h, low otherwise.
  const confidence = ageGapHours > 24 ? 0.9 : ageGapHours > 1 ? 0.7 : 0.5;
  return {
    preferredSource: preferred.source,
    reason: `Fresher observation from ${preferred.source} (age gap ${ageGapHours < 1 ? '<1h' : `${Math.round(ageGapHours)}h`})`,
    confidence,
    otherSource: other.source,
    otherListingId: other.id,
  };
}

/**
 * Detect parcelKey collisions from different sources and annotate both
 * records with crossSourceMatches + bakeOff. Mutates the listings array
 * in place. Returns the number of listings annotated.
 */
function applyCrossSourceBakeOff(listings) {
  if (!Array.isArray(listings) || listings.length < 2) return 0;
  const byParcelKey = new Map();
  for (const listing of listings) {
    if (!listing.parcelKey) continue;
    if (!byParcelKey.has(listing.parcelKey)) byParcelKey.set(listing.parcelKey, []);
    byParcelKey.get(listing.parcelKey).push(listing);
  }
  let annotated = 0;
  for (const group of byParcelKey.values()) {
    if (group.length < 2) continue;
    // Only annotate when at least two different sources are represented.
    const sources = new Set(group.map((l) => l.source));
    if (sources.size < 2) continue;
    for (const listing of group) {
      const others = group.filter((l) => l.id !== listing.id && l.source !== listing.source);
      if (others.length === 0) continue;
      listing.crossSourceMatches = others.map((l) => ({
        source: l.source,
        listingId: l.id,
        observedAt: l.sourceObservedAt || l.provenance?.observedAt || null,
        openingBid: l.openingBid ?? null,
      }));
      // Pick the freshest other-source observation for the bake-off.
      let bestOther = others[0];
      let bestOtherTime = Date.parse(bestOther.sourceObservedAt || bestOther.provenance?.observedAt || '') || 0;
      for (const candidate of others.slice(1)) {
        const t = Date.parse(candidate.sourceObservedAt || candidate.provenance?.observedAt || '') || 0;
        if (t > bestOtherTime) { bestOther = candidate; bestOtherTime = t; }
      }
      const myTime = Date.parse(listing.sourceObservedAt || listing.provenance?.observedAt || '') || 0;
      let bakeOff;
      if (myTime === bestOtherTime) {
        const [first, second] = listing.source.localeCompare(bestOther.source) > 0 ? [bestOther, listing] : [listing, bestOther];
        bakeOff = computeBakeOff(first, second);
      } else {
        bakeOff = computeBakeOff(bestOther, listing);
      }
      listing.bakeOff = {
        preferredSource: bakeOff.preferredSource,
        reason: bakeOff.reason,
        confidence: bakeOff.confidence,
      };
      annotated++;
    }
  }
  return annotated;
}

function isFiniteTime(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t);
}

module.exports = {
  ALERT_MATCHES_DEFAULT_LIMIT,
  ALERT_MATCHES_MAX_LIMIT,
  finiteOrNull,
  clampAlertMatchesLimit,
  sameNormalizedListingAddress,
  optionalFiniteNumber,
  normalizeGeocode,
  isoOrNull,
  mapPgListingRow,
  normalizeTimestamp,
  normalizeDate,
  optionalText,
  canonicalStatus,
  normalizeProvenance,
  normalizeCashToCloseDetails,
  prepareListingForPersistence,
  mergeListingForInMemoryUpsert,
  compareNumbersUnknownLast,
  computeBakeOff,
  applyCrossSourceBakeOff,
  isFiniteTime,
};
