'use strict';

/**
 * server/intelligence/second-look.js
 *
 * Second Look Distress Reconsideration Engine.
 * Automatically monitors passed or archived research cases and flags them
 * for operator reconsideration when material facts change (opening bid drops,
 * bankruptcy stays lift, upset bid windows open, or dates reschedule).
 * Wires Title Risk Engine signals for junior lien survival alerts, IRS redemption,
 * and HOA super-priority assessment risk.
 */

const { evaluateLifecycleTransition, DISTRESS_STAGES } = require('./distress-lifecycle');
const { updateCase, getCase } = require('./research-cases');
const { arbitrateTitleRisk } = require('./title-risk-engine');
const { HOA_SUPER_PRIORITY_STATES } = require('./hoa-super-lien');

function evaluateSecondLookTriggers(caseItem = {}, freshListing = {}) {
  const prior = caseItem.listingSnapshot || {};
  const transition = evaluateLifecycleTransition(prior, freshListing);

  const rules = caseItem.reconsideration || {};
  let shouldTrigger = false;
  let primaryReason = null;
  const triggerEvents = [];
  const alerts = [];
  const flags = [];

  const titleRisk = arbitrateTitleRisk(freshListing);
  const plaintiff = String(freshListing.plaintiff || '');
  const state = String(freshListing.state || prior.state || 'OH').toUpperCase();

  const isJuniorLien = Boolean(titleRisk.firstMortgageSurvives && (
    titleRisk.plaintiffType === 'SECOND_MORTGAGE_HELOC' ||
    titleRisk.plaintiffType === 'MECHANICS_LIEN' ||
    titleRisk.instrumentPriority?.explicitlySubjectToSeniorMortgage ||
    /(?:second[_\s]*mortgage|heloc|mechanic'?s?[_\s]*lien)/i.test(plaintiff)
  ));

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

    // Junior Lien Foreclosure dropping price into apparent bargain territory
    if (isJuniorLien) {
      alerts.push('JUNIOR_LIEN_SURVIVING_MORTGAGE');
      const juniorAlertEvent = {
        type: 'JUNIOR_LIEN_SURVIVING_MORTGAGE',
        severity: 'CRITICAL',
        label: `CRITICAL TITLE ALERT: Foreclosing plaintiff is a junior lienholder (${titleRisk.plaintiffType}). Price reduction is an apparent bargain value trap — Senior 1st mortgage survives sale in full! (JUNIOR_LIEN_SURVIVING_MORTGAGE)`,
        plaintiffType: titleRisk.plaintiffType,
        firstMortgageSurvives: true,
      };
      triggerEvents.push(juniorAlertEvent);
      shouldTrigger = true;
      primaryReason = juniorAlertEvent.label;
    }
  } else if (isJuniorLien && (rules.titleRisk?.operator === 'junior_lien_surviving_mortgage' || rules.titleRisk?.mode === 'junior_lien')) {
    alerts.push('JUNIOR_LIEN_SURVIVING_MORTGAGE');
    const juniorAlertEvent = {
      type: 'JUNIOR_LIEN_SURVIVING_MORTGAGE',
      severity: 'CRITICAL',
      label: `CRITICAL TITLE ALERT: Junior lien foreclosure (${titleRisk.plaintiffType}). Senior 1st mortgage survives sale in full! (JUNIOR_LIEN_SURVIVING_MORTGAGE)`,
      plaintiffType: titleRisk.plaintiffType,
      firstMortgageSurvives: true,
    };
    triggerEvents.push(juniorAlertEvent);
    shouldTrigger = true;
    if (!primaryReason) primaryReason = juniorAlertEvent.label;
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

  // 5. Active IRS Federal Tax Lien Check (26 U.S.C. § 7425(d))
  const hasIrsLien = Boolean(
    titleRisk.irsTaxLienRedemption?.hasIrsLien ||
    titleRisk.irsNoticeEvaluation?.hasFederalTaxLien ||
    freshListing.hasIrsLien ||
    freshListing.hasFederalTaxLien ||
    titleRisk.plaintiffType === 'IRS_TAX_LIEN' ||
    /(?:internal\s*revenue|\birs\b|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(
      `${freshListing.raw || ''} ${freshListing.description || ''} ${plaintiff}`
    )
  );
  if (hasIrsLien) {
    flags.push('IRS_REDEMPTION_WINDOW_ACTIVE');
    const irsEvent = {
      type: 'IRS_REDEMPTION_WINDOW_ACTIVE',
      severity: 'HIGH',
      label: 'IRS REDEMPTION ACTIVE: 120-day super-priority IRS redemption right under 26 U.S.C. § 7425(d)',
      redemptionDays: 120,
      statute: '26 U.S.C. § 7425(d)',
    };
    triggerEvents.push(irsEvent);
    if (rules.titleRisk?.operator === 'irs_redemption_active' || rules.irsRedemption) {
      shouldTrigger = true;
      if (!primaryReason) primaryReason = irsEvent.label;
    }
  }

  // 6. HOA Super-Priority Assessment Risk (UCIOA / NV / FL)
  const isSuperState = Boolean(
    titleRisk.hoaSuperPriority?.isSuperPriorityState ||
    ['NV', 'FL'].includes(state) ||
    Boolean(HOA_SUPER_PRIORITY_STATES[state])
  );
  const isHoa = Boolean(
    titleRisk.plaintiffType === 'HOA_ASSESSMENT' ||
    /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b|master\s*association)/i.test(plaintiff)
  );
  if (isSuperState && (isHoa || titleRisk.hoaSuperPriority?.isSuperPriorityState)) {
    flags.push('HOA_SUPER_PRIORITY_RISK');
    const hoaEvent = {
      type: 'HOA_SUPER_PRIORITY_RISK',
      severity: state === 'NV' ? 'CRITICAL' : 'HIGH',
      label: `HOA SUPER-PRIORITY RISK: Property in ${state} subject to statutory HOA super-priority assessment (${titleRisk.hoaSuperPriority?.statute || 'UCIOA / State Statute'})`,
      statute: titleRisk.hoaSuperPriority?.statute || 'UCIOA Statutory Assessment',
      state,
      monthsProtected: titleRisk.hoaSuperPriority?.monthsProtected || null,
      seniorMortgageExtinguished: Boolean(titleRisk.hoaSuperPriority?.seniorMortgageExtinguished),
    };
    triggerEvents.push(hoaEvent);
    if (rules.titleRisk?.operator === 'hoa_super_priority' || rules.hoaSuperPriority) {
      shouldTrigger = true;
      if (!primaryReason) primaryReason = hoaEvent.label;
    }
  }

  return {
    shouldTrigger,
    caseId: caseItem.id,
    currentState: caseItem.state,
    recommendedState: 'inbox',
    primaryReason,
    transition,
    triggerEvents,
    alerts,
    flags,
    titleRisk,
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
      alerts: evaluation.alerts,
      flags: evaluation.flags,
      titleRiskAlert: evaluation.alerts.includes('JUNIOR_LIEN_SURVIVING_MORTGAGE') ? 'JUNIOR_LIEN_SURVIVING_MORTGAGE' : null,
      irsRedemptionActive: evaluation.flags.includes('IRS_REDEMPTION_WINDOW_ACTIVE'),
      hoaSuperPriorityRisk: evaluation.flags.includes('HOA_SUPER_PRIORITY_RISK'),
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
