'use strict';
/**
 * signals.js — Transparent Opportunity-Signal Evaluator
 *
 * Implements Priority Upgrade 3 from docs/reference-audit/propertyradar.md:
 * Deterministic signal evaluation outputting actionable reasons, exact evidence
 * classifications, observed timestamps, and next research actions.
 * Calculates an explainable triage priority with published component weights.
 */

const SIGNAL_WEIGHTS = Object.freeze({
  bidToValueRatio: 0.30,
  saleDateKnown: 0.20,
  bidReduction: 0.20,
  areaDiscrepancy: 0.10,
  returnedToMarket: 0.10,
  dataCompleteness: 0.10,
});

function isKnown(value) {
  return value !== null && value !== undefined && value !== '' && !Number.isNaN(value);
}

function evaluateOpportunitySignals(listing = {}, options = {}) {
  const {
    observations = { records: {}, signals: [] },
    publicRecords = null,
    now = Date.now(),
  } = options;

  const observedAt = listing.sourceObservedAt || listing.provenance?.observedAt || listing.fetchedAt || new Date(now).toISOString();
  const sourceUrl = listing.sourceUrl || null;
  const signals = [];

  // 1. Sale Date Known
  const rawSaleDate = listing.saleDate;
  if (isKnown(rawSaleDate)) {
    const parsedSale = Date.parse(String(rawSaleDate).slice(0, 10));
    const today = Date.parse(new Date(now).toISOString().slice(0, 10));
    if (parsedSale >= today) {
      signals.push({
        key: 'sale_date_known',
        label: 'Published sale date is confirmed',
        status: 'supported',
        evidenceClass: 'publisher_reported',
        sourceUrl,
        observedAt,
        reason: `Active auction scheduled for ${String(rawSaleDate).slice(0, 10)}.`,
        nextAction: 'Monitor publisher calendar and docket for postponement or stay notices.',
      });
    } else {
      signals.push({
        key: 'sale_date_known',
        label: 'Recorded sale date has passed',
        status: 'unknown',
        evidenceClass: 'publisher_reported',
        sourceUrl,
        observedAt,
        reason: `Recorded date ${String(rawSaleDate).slice(0, 10)} has passed; post-sale disposition is unconfirmed.`,
        nextAction: 'Check whether auction occurred, postponed, or adjourned.',
      });
    }
  } else {
    signals.push({
      key: 'sale_date_known',
      label: 'Sale date unresolved',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Auction sale date is not published in current record.',
      nextAction: 'Check official county court docket or publisher listing.',
    });
  }

  // 2. Bid Reduction
  const hasObservationReduction = Array.isArray(observations.signals) && observations.signals.some((sig) =>
    (sig.listingId === listing.id || sig.recordId === String(listing.provenance?.recordId))
    && (sig.type === 'bid_reduced' || /bid.*reduc|drop|lower/i.test(sig.type || sig.label || ''))
  );
  if (hasObservationReduction) {
    signals.push({
      key: 'bid_reduction',
      label: 'Opening bid reduced on record',
      status: 'supported',
      evidenceClass: 'exact_source_observation',
      sourceUrl,
      observedAt,
      reason: 'Opening bid was decreased on the same verified source record over time.',
      nextAction: 'Review prior bid observation history and confirm updated reserve requirements.',
    });
  } else {
    signals.push({
      key: 'bid_reduction',
      label: 'No bid reduction observed',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'No downward price adjustment recorded between observations.',
      nextAction: 'Watch source feed for publisher reserve cuts prior to sale.',
    });
  }

  // 3. Returned to Market
  const rawNotice = String(listing.raw || listing.rawNotice || '');
  const statusStr = String(listing.status || listing.lifecycleStatus || '');
  const isReturned = /return|re-?list|adjourn.*active|reschedul/i.test(statusStr)
    || /returned to market|re-?listed|back on market/i.test(rawNotice);
  if (isReturned) {
    signals.push({
      key: 'returned_to_market',
      label: 'Returned to market',
      status: 'supported',
      evidenceClass: 'publisher_reported',
      sourceUrl,
      observedAt,
      reason: 'Publisher record indicates property was re-listed or returned following a prior postponement.',
      nextAction: 'Review docket for bankruptcy relief, bankruptcy dismissals, or creditor motions.',
    });
  } else {
    signals.push({
      key: 'returned_to_market',
      label: 'Standard offering status',
      status: 'unknown',
      evidenceClass: 'publisher_reported',
      sourceUrl,
      observedAt,
      reason: 'Property is in initial or standard active scheduling.',
      nextAction: 'Monitor for status changes.',
    });
  }

  // 4. Bid-to-Supported-Value Ratio
  const bid = Number(listing.openingBid);
  const mid = Number(listing.mid) || ((Number(listing.estLow) + Number(listing.estHigh)) / 2);
  if (bid > 0 && mid > 0) {
    const ratio = bid / mid;
    const discountPct = Math.round((1 - ratio) * 100);
    if (ratio <= 1) {
      signals.push({
        key: 'bid_to_value_ratio',
        label: 'Bid-to-supported-value ratio established',
        status: 'supported',
        evidenceClass: 'calculated_ratio',
        sourceUrl,
        observedAt,
        reason: `Opening bid ($${bid.toLocaleString()}) represents ${(ratio * 100).toFixed(1)}% of valuation midpoint ($${mid.toLocaleString()}) — ${discountPct}% spread.`,
        nextAction: 'Calculate Max Allowable Offer (MAO) incorporating repair and holding allowances.',
      });
    } else {
      signals.push({
        key: 'bid_to_value_ratio',
        label: 'Opening bid exceeds supported valuation midpoint',
        status: 'contradicted',
        evidenceClass: 'calculated_ratio',
        sourceUrl,
        observedAt,
        reason: `Opening bid ($${bid.toLocaleString()}) is ${(ratio * 100).toFixed(1)}% of valuation midpoint ($${mid.toLocaleString()}) — ${-discountPct}% above.`,
        nextAction: 'Re-verify the valuation band and comparable sales before modeling this as an opportunity.',
      });
    }
  } else {
    signals.push({
      key: 'bid_to_value_ratio',
      label: 'Valuation ratio unavailable',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Opening bid or valuation estimate band is missing; ratio cannot be computed.',
      nextAction: 'Gather verified comp sales and publisher opening bid.',
    });
  }

  // 5. Building Area Discrepancy
  const parcel = publicRecords?.parcel;
  const advertisedSqft = Number(listing.sqft);
  const recordSqft = Number(parcel?.properties?.livingAreaSqft || parcel?.livingAreaSqft);
  if (advertisedSqft > 0 && recordSqft > 0) {
    const diff = Math.abs(advertisedSqft - recordSqft);
    const diffPct = diff / Math.max(advertisedSqft, recordSqft);
    if (diffPct > 0.10) {
      signals.push({
        key: 'building_area_discrepancy',
        label: 'Building area discrepancy detected',
        status: 'contradicted',
        evidenceClass: 'official_parcel_roll',
        sourceUrl: parcel?.source?.url || sourceUrl,
        observedAt,
        reason: `Advertised sqft (${advertisedSqft}) disagrees with official cadastral record (${recordSqft}) by ${Math.round(diffPct * 100)}%.`,
        nextAction: 'Compare building permits and property card for unpermitted additions or recording errors.',
      });
    } else {
      signals.push({
        key: 'building_area_discrepancy',
        label: 'Building area verified by official records',
        status: 'supported',
        evidenceClass: 'official_parcel_roll',
        sourceUrl: parcel?.source?.url || sourceUrl,
        observedAt,
        reason: `Advertised sqft (${advertisedSqft}) matches official cadastral record (${recordSqft}) within 10%.`,
        nextAction: 'Proceed with verified physical square footage.',
      });
    }
  } else {
    signals.push({
      key: 'building_area_discrepancy',
      label: 'Building area uncorroborated',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Official parcel cadastral record is not matched for square footage cross-check.',
      nextAction: 'Lookup county property appraiser card.',
    });
  }

  // 6. Title and Equity Unresolved
  const hasSeniorRisk = isKnown(listing.seniorLienRisk);
  const hasRedemption = isKnown(listing.redemptionDays);
  const hasCashToClose = isKnown(listing.cashToClose);
  if (hasSeniorRisk && hasRedemption && hasCashToClose) {
    signals.push({
      key: 'title_equity_unresolved',
      label: 'Core title and settlement facts available',
      status: 'supported',
      evidenceClass: 'derived_unverified',
      sourceUrl,
      observedAt,
      reason: `Statutory redemption (${listing.redemptionDays} days), lien-risk signal (${listing.seniorLienRisk}), and estimated cash-to-close are available but not docket-verified.`,
      nextAction: 'Confirm payoff figures and certificate of sale requirements.',
    });
  } else {
    signals.push({
      key: 'title_equity_unresolved',
      label: 'Title encumbrances and fees need research',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Senior lien survival, statutory redemption window, or cash-to-close terms remain unconfirmed.',
      nextAction: 'Examine docket for junior liens, tax certificates, and HOA super-priority claims.',
    });
  }

  // Compute Triage Priority (0-100)
  let priorityScore = 0;

  // 1. Ratio component (up to 30 pts)
  const ratioSignal = signals.find((s) => s.key === 'bid_to_value_ratio');
  if (ratioSignal?.status === 'supported' && bid > 0 && mid > 0) {
    const discountFraction = Math.max(0, Math.min(1, 1 - (bid / mid)));
    priorityScore += discountFraction * 100 * SIGNAL_WEIGHTS.bidToValueRatio;
  }

  // 2. Sale date component (up to 20 pts)
  const saleSignal = signals.find((s) => s.key === 'sale_date_known');
  if (saleSignal?.status === 'supported') {
    priorityScore += 100 * SIGNAL_WEIGHTS.saleDateKnown;
  }

  // 3. Bid reduction component (up to 20 pts)
  const bidRedSignal = signals.find((s) => s.key === 'bid_reduction');
  if (bidRedSignal?.status === 'supported') {
    priorityScore += 100 * SIGNAL_WEIGHTS.bidReduction;
  }

  // 4. Area corroboration component (up to 10 pts). A matched cadastral record
  //    that agrees with the publisher proves the advertised square footage and is
  //    rewarded. A conflicting ("contradicted") record is a flag surfaced in the
  //    ledger, not a score bonus — red flags never raise the triage score.
  const areaSignal = signals.find((s) => s.key === 'building_area_discrepancy');
  if (areaSignal?.status === 'supported') {
    priorityScore += 100 * SIGNAL_WEIGHTS.areaDiscrepancy;
  }

  // 5. Return to market (up to 10 pts)
  const returnSignal = signals.find((s) => s.key === 'returned_to_market');
  if (returnSignal?.status === 'supported') {
    priorityScore += 100 * SIGNAL_WEIGHTS.returnedToMarket;
  }

  // 6. Data completeness (up to 10 pts)
  const supportedCount = signals.filter((s) => s.status === 'supported').length;
  priorityScore += (supportedCount / signals.length) * 100 * SIGNAL_WEIGHTS.dataCompleteness;

  const roundedPriority = Math.max(1, Math.min(99, Math.round(priorityScore)));

  return {
    listingId: listing.id,
    generatedAt: new Date(now).toISOString(),
    triagePriority: roundedPriority,
    weights: SIGNAL_WEIGHTS,
    signals,
    summary: {
      supported: signals.filter((s) => s.status === 'supported').length,
      unknown: signals.filter((s) => s.status === 'unknown').length,
      contradicted: signals.filter((s) => s.status === 'contradicted').length,
    },
    disclaimer: 'Triage priority only — not an appraisal, likelihood, or distress prediction.',
  };
}

module.exports = {
  evaluateOpportunitySignals,
  SIGNAL_WEIGHTS,
};
