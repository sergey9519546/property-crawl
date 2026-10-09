'use strict';

/**
 * server/intelligence/second-look.js
 *
 * Second Look Distress Reconsideration Engine.
 * Automatically monitors passed or archived research cases and flags them
 * for operator reconsideration when material facts change (opening bid drops,
 * bankruptcy stays lift, upset bid windows open, or dates reschedule).
 */

const { evaluateLifecycleTransition, DISTRESS_STAGES } = require('./distress-lifecycle');
const { updateCase, getCase } = require('./research-cases');

function evaluateSecondLookTriggers(caseItem = {}, freshListing = {}) {
  const prior = caseItem.listingSnapshot || {};
  const transition = evaluateLifecycleTransition(prior, freshListing);

  const rules = caseItem.reconsideration || {};
  let shouldTrigger = false;
  let primaryReason = null;
  const triggerEvents = [];

  // 1. Price Reduction Check
  const priceChange = transition.changes.find((c) => c.type === 'PRICE_REDUCED');
  if (priceChange) {
    if (rules.openingBid) {
      if (rules.openingBid.mode === 'changed') shouldTrigger = true;
      if (rules.openingBid.mode === 'lte' && freshListing.openingBid <= rules.openingBid.threshold) shouldTrigger = true;
    } else {
      // Default trigger: any price drop >= 10%
      if (priceChange.discountPercent >= 10) shouldTrigger = true;
    }
    if (shouldTrigger && !primaryReason) {
      primaryReason = priceChange.label;
    }
    triggerEvents.push(priceChange);
  }

  // 2. Bankruptcy Stay Lifted
  const stayLifted = transition.changes.find((c) => c.type === 'BANKRUPTCY_STAY_LIFTED');
  if (stayLifted) {
    shouldTrigger = true;
    if (!primaryReason) primaryReason = stayLifted.label;
    triggerEvents.push(stayLifted);
  }

  // 3. Upset Bid Window Opened
  const upsetWindow = transition.changes.find((c) => c.type === 'UPSET_WINDOW_OPENED');
  if (upsetWindow) {
    shouldTrigger = true;
    if (!primaryReason) primaryReason = upsetWindow.label;
    triggerEvents.push(upsetWindow);
  }

  // 4. Rescheduled Auction Date
  const dateChange = transition.changes.find((c) => c.type === 'DATE_RESCHEDULED');
  if (dateChange && rules.saleDate?.mode === 'changed') {
    shouldTrigger = true;
    if (!primaryReason) primaryReason = dateChange.label;
    triggerEvents.push(dateChange);
  }

  return {
    shouldTrigger,
    caseId: caseItem.id,
    currentState: caseItem.state,
    recommendedState: 'inbox',
    primaryReason,
    transition,
    triggerEvents,
  };
}

/**
 * Re-opens a passed case into inbox when second-look triggers fire
 */
function applySecondLookReconsideration(caseId, freshListing, options = {}) {
  const existingCase = getCase(caseId, options);
  if (!existingCase) {
    throw new Error(`Research case not found: ${caseId}`);
  }

  const evaluation = evaluateSecondLookTriggers(existingCase, freshListing);
  if (!evaluation.shouldTrigger) {
    return {
      triggered: false,
      case: existingCase,
      evaluation,
    };
  }

  // Mutate case state back to inbox with reconsideration required
  const updatePayload = {
    state: 'inbox',
    reconsiderationRequired: true,
    latestTrigger: {
      type: 'second_look_event',
      reason: evaluation.primaryReason,
      events: evaluation.triggerEvents,
      triggeredAt: new Date().toISOString(),
    },
  };

  const updatedResult = updateCase(caseId, updatePayload, options);

  return {
    triggered: true,
    case: updatedResult,
    evaluation,
  };
}

module.exports = {
  evaluateSecondLookTriggers,
  applySecondLookReconsideration,
};
