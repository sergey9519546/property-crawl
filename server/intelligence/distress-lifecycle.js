'use strict';

/**
 * server/intelligence/distress-lifecycle.js
 *
 * Distressed Property Auction & Foreclosure Lifecycle State Machine.
 * Tracks statutory phases from pre-foreclosure through bankruptcy stays,
 * upset bid windows, statutory redemption, and final conveyance.
 */

const DISTRESS_STAGES = Object.freeze({
  PRE_FORECLOSURE: 'PRE_FORECLOSURE',
  SCHEDULED_AUCTION: 'SCHEDULED_AUCTION',
  STAYED_BANKRUPTCY: 'STAYED_BANKRUPTCY',
  ADJOURNED: 'ADJOURNED',
  SOLD_UPSET_WINDOW: 'SOLD_UPSET_WINDOW',
  SOLD_REDEMPTION_ACTIVE: 'SOLD_REDEMPTION_ACTIVE',
  DEED_CONVEYED: 'DEED_CONVEYED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
});

function detectLifecycleStage(listing = {}, rawText = '') {
  const text = `${listing.status || ''} ${listing.raw || ''} ${rawText}`.toLowerCase();

  // 1. Bankruptcy Stay (11 U.S.C. § 362)
  if (/(?:bankruptcy|stayed|chap(?:ter)?\s*(?:7|11|13)|automatic\s*stay|11\s*u\.?s\.?c\.?\s*§?\s*362)/i.test(text)) {
    return DISTRESS_STAGES.STAYED_BANKRUPTCY;
  }

  // 2. Cancelled or Dismissed
  if (/(?:cancelled|canceled|dismissed|withdrawn|vacated|satisfied|redeemed\s*prior)/i.test(text)) {
    return DISTRESS_STAGES.CANCELLED;
  }

  // 3. Adjourned or Postponed
  if (/(?:adjourned|postponed|continued|rescheduled|held\s*over)/i.test(text)) {
    return DISTRESS_STAGES.ADJOURNED;
  }

  // 4. North Carolina Upset Bid Window
  if (String(listing.state || '').toUpperCase() === 'NC' && /(?:upset\s*bid|open\s*for\s*upset|g\.?s\.?\s*45-21\.27)/i.test(text)) {
    return DISTRESS_STAGES.SOLD_UPSET_WINDOW;
  }

  // 5. Post-Sale Statutory Redemption Active
  if (/(?:redemption\s*period|redemption\s*active|subject\s*to\s*redemption)/i.test(text)) {
    return DISTRESS_STAGES.SOLD_REDEMPTION_ACTIVE;
  }

  // 6. Deed Conveyed / Finalized
  if (/(?:deed\s*(?:recorded|delivered)|conveyed|certificate\s*of\s*title|sold\s*to\s*third\s*party)/i.test(text)) {
    return DISTRESS_STAGES.DEED_CONVEYED;
  }

  // 7. Scheduled Auction
  if (listing.saleDate || /(?:scheduled|order\s*of\s*sale|notice\s*of\s*sale|to\s*be\s*sold)/i.test(text)) {
    return DISTRESS_STAGES.SCHEDULED_AUCTION;
  }

  // 8. Pre-Foreclosure
  if (/(?:lis\s*pendens|notice\s*of\s*default|pre-foreclosure|nod)/i.test(text)) {
    return DISTRESS_STAGES.PRE_FORECLOSURE;
  }

  return DISTRESS_STAGES.UNKNOWN;
}

/**
 * Compares prior listing snapshot against fresh observation to detect material lifecycle events
 */
function evaluateLifecycleTransition(prior = {}, fresh = {}) {
  const priorStage = prior.lifecycleStage || detectLifecycleStage(prior);
  const freshStage = fresh.lifecycleStage || detectLifecycleStage(fresh);

  const changes = [];
  let isMaterialChange = false;

  if (priorStage !== freshStage) {
    isMaterialChange = true;
    changes.push({
      type: 'STAGE_CHANGED',
      from: priorStage,
      to: freshStage,
      label: `Lifecycle stage transitioned from ${priorStage} to ${freshStage}`,
    });

    // Special high-priority triggers
    if (priorStage === DISTRESS_STAGES.STAYED_BANKRUPTCY && freshStage === DISTRESS_STAGES.SCHEDULED_AUCTION) {
      changes.push({
        type: 'BANKRUPTCY_STAY_LIFTED',
        label: 'CRITICAL: Bankruptcy stay was lifted; property rescheduled for auction!',
      });
    }

    if (freshStage === DISTRESS_STAGES.SOLD_UPSET_WINDOW) {
      changes.push({
        type: 'UPSET_WINDOW_OPENED',
        label: 'ACTIONABLE: Statutory 10-day upset bid period opened!',
      });
    }
  }

  // Opening Bid Reduction Check
  const priorBid = Number(prior.openingBid || 0);
  const freshBid = Number(fresh.openingBid || 0);

  if (priorBid > 0 && freshBid > 0 && freshBid < priorBid) {
    const discountPercent = Math.round(((priorBid - freshBid) / priorBid) * 100);
    isMaterialChange = true;
    changes.push({
      type: 'PRICE_REDUCED',
      from: priorBid,
      to: freshBid,
      discountPercent,
      label: `Opening bid reduced by ${discountPercent}% (from $${priorBid.toLocaleString()} to $${freshBid.toLocaleString()})`,
    });
  }

  // Sale Date Rescheduling Check
  if (prior.saleDate && fresh.saleDate && prior.saleDate !== fresh.saleDate) {
    isMaterialChange = true;
    changes.push({
      type: 'DATE_RESCHEDULED',
      from: prior.saleDate,
      to: fresh.saleDate,
      label: `Auction rescheduled from ${prior.saleDate} to ${fresh.saleDate}`,
    });
  }

  return {
    priorStage,
    freshStage,
    isMaterialChange,
    changes,
  };
}

module.exports = {
  DISTRESS_STAGES,
  detectLifecycleStage,
  evaluateLifecycleTransition,
};
