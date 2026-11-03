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

/**
 * Normalizes raw event status / disposition into canonical docket outcome.
 *
 * @param {string|object} event
 * @returns {string} One of DOCKET_OUTCOMES
 */
function normalizeDocketOutcome(event) {
  if (!event) return 'scheduled';
  const raw = typeof event === 'string'
    ? event
    : String(event.outcome || event.status || event.disposition || event.lifecycleStatus || '');

  const text = raw.trim().toLowerCase();
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

  // Sold to Plaintiff (Credit bid, Bank, Lender, REO)
  if (/sold_plaintiff|plaintiff|credit\s*bid|bank\s*buy|revert|lender|reo\s*buyback/i.test(text)) {
    return 'sold_plaintiff';
  }

  // Sold to Third Party
  if (/sold_third_party|third[_\s-]?party|sold\s*(?:to)?\s*(?:investor|bidder|public)|competitive\s*bid|\bsold\b/i.test(text)) {
    return 'sold_third_party';
  }

  // Scheduled / Active
  if (/schedul|active|pend|calendar|upcoming/i.test(text)) {
    return 'scheduled';
  }

  return 'unknown';
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

  let filtered = historicalEvents;
  if (options.county) {
    const targetCounty = String(options.county).trim().toLowerCase();
    filtered = filtered.filter((e) => {
      if (typeof e !== 'object' || !e) return false;
      const c = String(e.county || e.countyName || '').trim().toLowerCase();
      return c === targetCounty;
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
 * @returns {object} Proceed probability assessment
 */
function evaluateAuctionProceedProbability(listing = {}, countyStats = null) {
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

module.exports = {
  DOCKET_OUTCOMES,
  normalizeDocketOutcome,
  calculateDocketClearingAnalytics,
  evaluateAuctionProceedProbability,
};
