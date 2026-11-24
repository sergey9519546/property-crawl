'use strict';

/**
 * server/intelligence/auction-microstructure.js
 *
 * Auction Microstructure & Docket Clearing-Rate Engine.
 *
 * Implements:
 * 1. Docket clearing-rate analytics from empirical county sheriff/trustee sales dockets.
 * 2. Pre-auction proceed probability evaluation taking into account statutory adjournment
 *    exhaustion (e.g. New Jersey N.J.S.A. § 2A:17-36: two 14-day statutory adjournments).
 * 3. Empirical liquidation rates vs. plaintiff buyback (credit bid) rates.
 *
 * Zero-Fabrication Invariant:
 * If countyStats are missing, null, or have zero sample history, returns
 * probability: null with confidence: 'INSUFFICIENT_DOCKET_HISTORY'.
 */

const DOCKET_OUTCOMES = Object.freeze([
  'scheduled',
  'postponed',
  'stayed',
  'sold_plaintiff',
  'sold_third_party',
  'cancelled',
  'unknown',
]);

const NON_AUCTION_DISPOSITION_SOURCES = Object.freeze([
  'hud',
  'gsa',
  'usda',
  'fannie',
  'freddie',
  'va',
  'fdic',
]);

const DECISIVE_DOCKET_OUTCOMES = new Set([
  'sold_third_party',
  'sold_plaintiff',
  'cancelled',
  'stayed',
  'postponed',
]);

function isNonAuctionDispositionSource(source) {
  if (typeof source !== 'string') return false;
  const normalized = source.trim().toLowerCase();
  return Boolean(normalized && NON_AUCTION_DISPOSITION_SOURCES.includes(normalized));
}

function classifyDocketText(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return 'scheduled';

  // Stay / Bankruptcy
  if (/stay|bankruptcy|injunction|chapter\s*(?:7|11|13)|automatic\s*stay/i.test(text)) {
    return 'stayed';
  }

  // Cancelled / Dismissed / Satisfied
  if (/cancel|dismiss|withdrawn|satisfied|vacat|settled|redeemed\s*prior|cancelled/i.test(text)) {
    return 'cancelled';
  }

  // Postponed / Adjourned / Continued
  if (/postpone|adjourn|continued|reschedul|held\s*over/i.test(text)) {
    return 'postponed';
  }

  // Sold to Plaintiff (Credit bid, Bank, Lender, REO, Reverted to Beneficiary/Plaintiff)
  if (/sold_plaintiff|reverted?\s+to\s+(?:beneficiary|plaintiff)|plaintiff|credit\s*bid|bank\s*buy|revert|lender|reo\s*buyback/i.test(text)) {
    return 'sold_plaintiff';
  }

  // Sold to Third Party
  if (/sold_third_party|sold_to_third_party|\b(?:3rd|third)[_\s-]?party\b|sold\s*(?:to)?\s*(?:investor|bidder|public)|competitive\s*bid|\bsold\b/i.test(text)) {
    return 'sold_third_party';
  }

  // Generic closed without 3rd-party or plaintiff clarity
  if (/auction\s+is\s+closed|\bclosed\b/i.test(text)) {
    return 'unknown';
  }

  // Scheduled / Active
  if (/schedul|active|pend|calendar|upcoming/i.test(text)) {
    return 'scheduled';
  }

  return 'unknown';
}

/**
 * Normalizes raw event status / disposition into canonical docket outcome.
 *
 * @param {string|object} event
 * @returns {string} One of DOCKET_OUTCOMES
 */
function normalizeDocketOutcome(event) {
  if (!event) return 'scheduled';
  if (typeof event === 'string') {
    return classifyDocketText(event);
  }
  if (typeof event !== 'object') {
    return classifyDocketText(String(event));
  }

  const primary = event.outcome
    || event.transactionOutcome
    || event.transaction_outcome
    || '';
  if (String(primary).trim()) {
    const primaryOutcome = classifyDocketText(primary);
    if (primaryOutcome !== 'unknown' || !event.lifecycleStatus && !event.lifecycle_status) {
      return primaryOutcome;
    }
  }

  const candidates = [
    event.lifecycleStatus,
    event.lifecycle_status,
    event.disposition,
    event.status,
    event.fields?.status,
  ];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      const classified = classifyDocketText(candidate);
      if (DECISIVE_DOCKET_OUTCOMES.has(classified)) {
        return classified;
      }
    }
  }

  const fallback = event.status || event.disposition || event.lifecycleStatus || event.lifecycle_status || event.fields?.status || '';
  return classifyDocketText(fallback);
}

/**
 * Calculates empirical docket clearing analytics from an array of historical auction events.
 *
 * Zero-Fabrication: When totalDockets is 0, rates return null rather than 0.
 *
 * @param {Array<object|string>} historicalEvents
 * @param {object} [options={}]
 * @param {number} [options.minSample=1]
 * @param {string} [options.county]
 * @param {string} [options.state]
 * @returns {object} Docket clearing analytics report
 */
function calculateDocketClearingAnalytics(historicalEvents, options = {}) {
  const minSample = Number.isFinite(options.minSample) && options.minSample > 0 ? options.minSample : 1;

  const counts = {
    scheduled: 0,
    postponed: 0,
    stayed: 0,
    sold_plaintiff: 0,
    sold_third_party: 0,
    cancelled: 0,
    unknown: 0,
  };

  if (!Array.isArray(historicalEvents) || historicalEvents.length === 0) {
    return {
      totalDockets: 0,
      outcomeCounts: counts,
      clearingRate: null,
      postponementRate: null,
      stayRate: null,
      plaintiffBuybackRate: null,
      saleRate: null,
      cancellationRate: null,
      sampleSufficient: false,
      sampleSize: 0,
    };
  }

  const normalizeCountyToken = (val) => String(val || '')
    .trim()
    .toLowerCase()
    .replace(/\s+(?:county|parish|borough)$/i, '')
    .trim();

  let filtered = historicalEvents;
  if (options.county) {
    const targetCountyNorm = normalizeCountyToken(options.county);
    filtered = filtered.filter((e) => {
      if (typeof e !== 'object' || !e) return false;
      const rawCounty = String(e.county || e.countyName || '').trim();
      if (!rawCounty) return true;
      return normalizeCountyToken(rawCounty) === targetCountyNorm;
    });
  }

  if (options.state) {
    const targetState = String(options.state).trim().toUpperCase();
    filtered = filtered.filter((e) => {
      if (typeof e !== 'object' || !e) return false;
      const s = String(e.state || e.stateCode || '').trim().toUpperCase();
      return s === targetState;
    });
  }

  const totalDockets = filtered.length;
  if (totalDockets === 0) {
    return {
      totalDockets: 0,
      outcomeCounts: counts,
      clearingRate: null,
      postponementRate: null,
      stayRate: null,
      plaintiffBuybackRate: null,
      saleRate: null,
      cancellationRate: null,
      sampleSufficient: false,
      sampleSize: 0,
    };
  }

  for (const item of filtered) {
    const outcome = normalizeDocketOutcome(item);
    if (counts[outcome] !== undefined) {
      counts[outcome] += 1;
    } else {
      counts.unknown += 1;
    }
  }

  const soldPlaintiff = counts.sold_plaintiff;
  const soldThirdParty = counts.sold_third_party;
  const totalSales = soldPlaintiff + soldThirdParty;

  // Formula per Master Blueprint Track 9 specification:
  // clearingRate: thirdPartySales / (soldPlaintiff + soldThirdParty || 1)
  // postponementRate: postponed / totalDockets
  // stayRate: stayed / totalDockets
  // plaintiffBuybackRate: soldPlaintiff / (soldPlaintiff + soldThirdParty || 1)
  const clearingRate = totalSales > 0 ? Number((soldThirdParty / totalSales).toFixed(4)) : null;
  const plaintiffBuybackRate = totalSales > 0 ? Number((soldPlaintiff / totalSales).toFixed(4)) : null;
  const postponementRate = Number((counts.postponed / totalDockets).toFixed(4));
  const stayRate = Number((counts.stayed / totalDockets).toFixed(4));
  const cancellationRate = Number((counts.cancelled / totalDockets).toFixed(4));
  const saleRate = Number((totalSales / totalDockets).toFixed(4));

  return {
    totalDockets,
    outcomeCounts: counts,
    clearingRate,
    postponementRate,
    stayRate,
    plaintiffBuybackRate,
    saleRate,
    cancellationRate,
    sampleSufficient: totalDockets >= minSample,
    sampleSize: totalDockets,
  };
}

/**
 * Evaluates the probability that an upcoming scheduled auction proceeds to sale at this gavel,
 * rather than being postponed, stayed, or cancelled.
 *
 * Factors in statutory debtor protections:
 * - New Jersey (N.J.S.A. § 2A:17-36): Debtors are entitled to two 14-day statutory adjournments.
 *   Once 2 prior debtor postponements are recorded, statutory stay is exhausted, raising proceed probability.
 *
 * Zero-Fabrication Invariant:
 * If countyStats are missing, null, or have insufficient docket history, returns:
 * { probability: null, confidence: 'INSUFFICIENT_DOCKET_HISTORY', factors: [] }
 *
 * @param {object} listing - Property listing with state, source, priorPostponements, etc.
 * @param {object|null} countyStats - Empirical docket stats from calculateDocketClearingAnalytics
 * @param {object|null} [context=null] - Optional evaluation context (e.g. { source })
 * @returns {object} Proceed probability assessment
 */
function evaluateAuctionProceedProbability(listing = {}, countyStats = null, context = null) {
  const resolvedSource = (context && typeof context === 'object' ? context.source : null) ?? listing?.source ?? null;
  if (isNonAuctionDispositionSource(resolvedSource)) {
    return {
      applicable: false,
      probability: null,
      confidence: 'NON_AUCTION_DISPOSITION',
      factors: [],
      statutoryContext: null,
      notes: 'Fixed or agency REO disposition — courthouse docket adjournment probabilities do not apply.',
    };
  }

  // Zero-Fabrication Invariant: require valid docket stats with at least minimal sample history
  if (
    !countyStats ||
    typeof countyStats !== 'object' ||
    !Number.isFinite(countyStats.totalDockets) ||
    countyStats.totalDockets <= 0 ||
    countyStats.sampleSufficient === false
  ) {
    return {
      probability: null,
      confidence: 'INSUFFICIENT_DOCKET_HISTORY',
      factors: [],
      statutoryContext: null,
      notes: 'No empirical docket history available. Proceed probability cannot be imputed (Zero-Fabrication Invariant).',
    };
  }

  const factors = [];
  const state = String(listing.state || '').trim().toUpperCase();
  const source = String(listing.source || '').trim().toLowerCase();
  const isNJ = state === 'NJ' || source === 'civilview';

  // Base proceed probability from empirical docket history:
  const empiricalSaleRate = countyStats.saleRate || (countyStats.totalDockets > 0
    ? (countyStats.outcomeCounts.sold_plaintiff + countyStats.outcomeCounts.sold_third_party) / countyStats.totalDockets
    : 0.50);

  let currentProb = empiricalSaleRate;

  factors.push({
    factor: 'COUNTY_BASE_SALE_RATE',
    impact: empiricalSaleRate >= 0.5 ? 'positive' : 'negative',
    weight: Number(empiricalSaleRate.toFixed(2)),
    description: `County baseline docket sale clearing rate is ${(empiricalSaleRate * 100).toFixed(1)}% across ${countyStats.totalDockets} dockets.`,
  });

  // Extract prior postponements from listing
  const priorPostponements = Number.isFinite(listing.priorPostponements)
    ? Math.max(0, Math.floor(listing.priorPostponements))
    : Number.isFinite(listing.adjournmentCount)
      ? Math.max(0, Math.floor(listing.adjournmentCount))
      : 0;

  let statutoryContext = null;

  // State-specific statutory adjournment rules
  if (isNJ) {
    const statutoryLimit = 2;
    const statutoryStayExhausted = priorPostponements >= statutoryLimit || Boolean(listing.statutoryStayExhausted);

    statutoryContext = {
      statute: 'N.J.S.A. § 2A:17-36',
      jurisdiction: 'New Jersey',
      statutoryAdjournmentLimit: statutoryLimit,
      priorAdjournmentsUsed: priorPostponements,
      statutoryStayExhausted,
    };

    if (statutoryStayExhausted) {
      const boost = 0.28;
      currentProb += boost;
      factors.push({
        factor: 'NJ_STATUTORY_ADJOURNMENTS_EXHAUSTED',
        impact: 'positive',
        weight: boost,
        description: `Debtor has used ${priorPostponements} statutory adjournments. Under N.J.S.A. § 2A:17-36, routine debtor delay rights are exhausted.`,
      });
    } else if (priorPostponements === 1) {
      const penalty = -0.10;
      currentProb += penalty;
      factors.push({
        factor: 'NJ_ONE_STATUTORY_ADJOURNMENT_REMAINING',
        impact: 'negative',
        weight: penalty,
        description: 'Debtor has used 1 of 2 statutory adjournments under N.J.S.A. § 2A:17-36. 1 statutory stay remains available.',
      });
    } else {
      const penalty = -0.22;
      currentProb += penalty;
      factors.push({
        factor: 'NJ_TWO_STATUTORY_ADJOURNMENTS_AVAILABLE',
        impact: 'negative',
        weight: penalty,
        description: 'Debtor has not exercised either of their two statutory 14-day adjournments under N.J.S.A. § 2A:17-36. High postponement risk.',
      });
    }
  } else {
    // Non-NJ general postponement dynamics
    if (priorPostponements >= 3) {
      const boost = 0.15;
      currentProb += boost;
      factors.push({
        factor: 'MULTIPLE_PRIOR_POSTPONEMENTS',
        impact: 'positive',
        weight: boost,
        description: `Property has ${priorPostponements} prior postponements; repeat re-schedulings indicate active creditor pursuit approaching sale gavel.`,
      });
    } else if (priorPostponements === 0 && countyStats.postponementRate > 0.35) {
      const penalty = -0.15;
      currentProb += penalty;
      factors.push({
        factor: 'FIRST_SCHEDULE_VENUE_POSTPONEMENT_RISK',
        impact: 'negative',
        weight: penalty,
        description: `First time on schedule in a venue with ${(countyStats.postponementRate * 100).toFixed(1)}% postponement rate.`,
      });
    }
  }

  // Active bankruptcy check
  const hasBankruptcy = Boolean(
    listing.bankruptcyStayActive ||
    listing.hasBankruptcySignal ||
    /bankruptcy/i.test(String(listing.titleRiskRating || listing.status || ''))
  );

  if (hasBankruptcy) {
    const penalty = -0.45;
    currentProb += penalty;
    factors.push({
      factor: 'ACTIVE_BANKRUPTCY_STAY',
      impact: 'negative',
      weight: penalty,
      description: 'Active bankruptcy proceeding triggers automatic stay under 11 U.S.C. § 362, halting sale until relief is granted.',
    });
  }

  // High venue stay rate check
  if (countyStats.stayRate > 0.15) {
    const penalty = -0.08;
    currentProb += penalty;
    factors.push({
      factor: 'ELEVATED_VENUE_STAY_RATE',
      impact: 'negative',
      weight: penalty,
      description: `County exhibits an elevated stay rate of ${(countyStats.stayRate * 100).toFixed(1)}%.`,
    });
  }

  // Clamp probability between 0.02 and 0.98
  const finalProbability = Number(Math.max(0.02, Math.min(0.98, currentProb)).toFixed(2));

  // Determine confidence from sample size
  let confidence = 'LOW';
  if (countyStats.totalDockets >= 50) {
    confidence = 'HIGH';
  } else if (countyStats.totalDockets >= 15) {
    confidence = 'MEDIUM';
  }

  return {
    probability: finalProbability,
    confidence,
    factors,
    statutoryContext,
    notes: `Calculated with ${confidence} confidence from ${countyStats.totalDockets} county docket events.`,
  };
}

function medianNumber(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
    : sorted[mid];
}

function parseSaleDateMs(row) {
  const raw = row?.sale_date ?? row?.saleDate ?? row?.fields?.saleDate ?? null;
  if (!raw) return null;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw).slice(0, 10));
  return Number.isFinite(ms) ? ms : null;
}

function resolveTerminalStatusText(latest) {
  if (!latest || typeof latest !== 'object') return '';
  const prioritized = [
    latest.transaction_outcome,
    latest.transactionOutcome,
    latest.outcome,
    latest.lifecycle_status,
    latest.lifecycleStatus,
    latest.observation_status,
    latest.status,
    latest.disposition,
    latest.fields?.status,
    latest.listing_status,
    latest.listingStatus,
  ];
  for (const candidate of prioritized) {
    if (candidate === null || candidate === undefined) continue;
    const str = String(candidate).trim();
    if (!str) continue;
    if (DECISIVE_DOCKET_OUTCOMES.has(classifyDocketText(str))) {
      return str;
    }
  }
  const fallbacks = [
    latest.observation_status,
    latest.status,
    latest.outcome,
    latest.disposition,
    latest.lifecycle_status,
    latest.lifecycleStatus,
    latest.transaction_outcome,
    latest.transactionOutcome,
    latest.listing_status,
    latest.listingStatus,
    latest.fields?.status,
  ];
  for (const candidate of fallbacks) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return '';
}

/**
 * Aggregates raw `source_observations` rows / snapshots per (state, county) into
 * `countyStats` (clearing rate, postponement rate, median postponements) suitable
 * for `evaluateAuctionProceedProbability()`.
 *
 * @param {Array<object>} observations
 * @param {object} [options={}]
 * @returns {object}
 */
function aggregateCountyObservationStats(observations = [], options = {}) {
  const targetState = options.state ? String(options.state).trim().toUpperCase() : null;
  const targetCounty = options.county ? String(options.county).trim().toLowerCase() : null;
  const minSample = Number.isFinite(options.minSample) && options.minSample > 0 ? options.minSample : 1;

  const matchingRows = (Array.isArray(observations) ? observations : []).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const rowState = String(row.state || row.raw_payload?.state || '').trim().toUpperCase();
    const rowCounty = String(row.county || row.raw_payload?.county || '').trim().toLowerCase();
    if (targetState && rowState !== targetState) return false;
    if (targetCounty && rowCounty !== targetCounty) return false;
    return true;
  });

  if (matchingRows.length === 0) {
    return {
      ...calculateDocketClearingAnalytics([], { minSample }),
      state: targetState,
      county: options.county ? String(options.county).trim() : null,
      medianPostponements: null,
      totalObservations: 0,
      uniqueRecords: 0,
    };
  }

  const groups = new Map();
  matchingRows.forEach((row, idx) => {
    const src = row.source_key || row.source || 'src';
    const rec = row.record_id || row.recordId || row.listing_id || row.listingId || `row_${idx}`;
    const key = `${src}::${rec}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const terminalEvents = [];
  const postponementCounts = [];

  for (const group of groups.values()) {
    group.sort((a, b) => {
      const ta = Date.parse(a.observed_at || a.observedAt || 0) || 0;
      const tb = Date.parse(b.observed_at || b.observedAt || 0) || 0;
      return ta - tb;
    });

    let postponements = 0;
    let prevOutcome = null;
    let prevSaleMs = null;

    for (const obs of group) {
      const statusVal = obs.observation_status !== undefined
        ? (obs.observation_status ?? obs.status ?? obs.outcome ?? obs.disposition ?? obs.fields?.status ?? '')
        : (obs.status ?? obs.outcome ?? obs.disposition ?? obs.lifecycleStatus ?? obs.lifecycle_status ?? obs.fields?.status ?? '');
      const outcome = normalizeDocketOutcome(statusVal);
      const saleMs = parseSaleDateMs(obs);

      if (outcome === 'postponed' && prevOutcome !== 'postponed') {
        postponements += 1;
      } else if (prevSaleMs !== null && saleMs !== null && saleMs > prevSaleMs) {
        postponements += 1;
      }

      prevOutcome = outcome;
      if (saleMs !== null) prevSaleMs = saleMs;
    }

    postponementCounts.push(postponements);
    const latest = group[group.length - 1];
    terminalEvents.push({
      status: resolveTerminalStatusText(latest),
      county: latest.county || latest.raw_payload?.county || options.county || null,
      state: latest.state || latest.raw_payload?.state || targetState || null,
    });
  }

  const analytics = calculateDocketClearingAnalytics(terminalEvents, { minSample });
  return {
    ...analytics,
    state: targetState,
    county: options.county ? String(options.county).trim() : null,
    medianPostponements: medianNumber(postponementCounts),
    totalObservations: matchingRows.length,
    uniqueRecords: groups.size,
  };
}

module.exports = {
  DOCKET_OUTCOMES,
  NON_AUCTION_DISPOSITION_SOURCES,
  isNonAuctionDispositionSource,
  normalizeDocketOutcome,
  calculateDocketClearingAnalytics,
  evaluateAuctionProceedProbability,
  evaluateAuctionMicrostructure: evaluateAuctionProceedProbability,
  aggregateCountyObservationStats,
};
