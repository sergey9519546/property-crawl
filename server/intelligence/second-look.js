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

function normalizeThresholdPercent(rawValue) {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue <= 0) return null;
  return rawValue < 1 ? Math.round(rawValue * 10000) / 100 : rawValue;
}

function firstFinitePositive(...values) {
  for (const val of values) {
    if (val === null || val === undefined || val === '') continue;
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function resolveAssessedValue(freshListing = {}, prior = {}, caseItem = {}) {
  return firstFinitePositive(
    freshListing.assessedValue,
    freshListing.assessed,
    prior.assessedValue,
    prior.assessed,
    caseItem.dossierSnapshot?.publicRecords?.parcel?.assessedValue?.total,
    caseItem.dossierSnapshot?.publicRecords?.parcel?.properties?.assessedValue
  );
}

function evaluateRuleSpec(field, spec = {}, ctx) {
  if (!spec || typeof spec !== 'object') return { matched: false, label: null };
  const op = String(spec.operator || spec.mode || '').trim();
  const targetVal = spec.value !== undefined ? spec.value : spec.threshold;
  const { caseItem, prior, freshListing, priceChange, dateChange, isJuniorLien, hasIrsLien, isHoaSuperPriority, nowMs } = ctx;

  if (field === 'openingBid') {
    const currentBid = freshListing.openingBid;
    const priorBid = prior.openingBid;
    const bidChanged = Boolean(priceChange) || (
      typeof currentBid === 'number' && Number.isFinite(currentBid) &&
      typeof priorBid === 'number' && Number.isFinite(priorBid) &&
      currentBid !== priorBid
    );
    if (op === 'changed') {
      if (!bidChanged) return { matched: false, label: null };
      return { matched: true, label: priceChange ? priceChange.label : `Opening bid changed to $${currentBid.toLocaleString()}` };
    }
    if (op === 'lte') {
      if (typeof currentBid !== 'number' || !Number.isFinite(currentBid) || !Number.isFinite(Number(targetVal))) {
        return { matched: false, label: null };
      }
      const threshold = Number(targetVal);
      const changedOrAdded = bidChanged || priorBid === undefined || priorBid === null;
      if (changedOrAdded && currentBid <= threshold) {
        return { matched: true, label: priceChange ? priceChange.label : `Opening bid $${currentBid.toLocaleString()} <= $${threshold.toLocaleString()}` };
      }
      return { matched: false, label: null };
    }
    if (op === 'gte') {
      if (typeof currentBid !== 'number' || !Number.isFinite(currentBid) || !Number.isFinite(Number(targetVal))) {
        return { matched: false, label: null };
      }
      const threshold = Number(targetVal);
      const changedOrAdded = bidChanged || priorBid === undefined || priorBid === null;
      if (changedOrAdded && currentBid >= threshold) {
        return { matched: true, label: priceChange ? priceChange.label : `Opening bid $${currentBid.toLocaleString()} >= $${threshold.toLocaleString()}` };
      }
      return { matched: false, label: null };
    }
    if (op === 'dropped_by_pct') {
      const pct = normalizeThresholdPercent(Number(targetVal));
      const baselineBid = firstFinitePositive(caseItem.decision?.decidedOpeningBid, priorBid);
      if (pct === null || typeof currentBid !== 'number' || !Number.isFinite(currentBid) || baselineBid === null || currentBid >= baselineBid) {
        return { matched: false, label: null };
      }
      const dropPct = ((baselineBid - currentBid) / baselineBid) * 100;
      if (dropPct + 1e-9 >= pct) {
        return { matched: true, label: `Opening bid dropped ${Math.round(dropPct * 10) / 10}% (>= ${pct}%)` };
      }
      return { matched: false, label: null };
    }
    if (op === 'bid_to_assessed_lte') {
      const pct = normalizeThresholdPercent(Number(targetVal));
      const assessed = resolveAssessedValue(freshListing, prior, caseItem);
      if (pct === null || typeof currentBid !== 'number' || !Number.isFinite(currentBid) || assessed === null) {
        return { matched: false, label: null };
      }
      const ratioPct = (currentBid / assessed) * 100;
      if (ratioPct - 1e-9 <= pct) {
        return { matched: true, label: `Opening bid is ${Math.round(ratioPct * 10) / 10}% of assessed value (<= ${pct}%)` };
      }
      return { matched: false, label: null };
    }
    return { matched: false, label: null };
  }

  if (field === 'saleDate') {
    if (op === 'changed') {
      if (dateChange) return { matched: true, label: dateChange.label };
      if (freshListing.saleDate && prior.saleDate && freshListing.saleDate !== prior.saleDate) {
        return { matched: true, label: `Sale date changed from ${prior.saleDate} to ${freshListing.saleDate}` };
      }
      return { matched: false, label: null };
    }
    if (op === 'within_days') {
      if (!freshListing.saleDate || !Number.isFinite(Number(targetVal))) return { matched: false, label: null };
      const saleMs = Date.parse(String(freshListing.saleDate).trim());
      if (!Number.isFinite(saleMs)) return { matched: false, label: null };
      const daysUntil = Math.round((saleMs - nowMs) / 86_400_000);
      const maxDays = Number(targetVal);
      if (daysUntil >= 0 && daysUntil <= maxDays) {
        return { matched: true, label: `Auction sale date in ${daysUntil} days (within ${maxDays} days)` };
      }
      return { matched: false, label: null };
    }
    return { matched: false, label: null };
  }

  if (field === 'sqft') {
    const freshSqft = freshListing.sqft;
    const priorSqft = prior.sqft;
    if (typeof freshSqft !== 'number' || !Number.isFinite(freshSqft)) return { matched: false, label: null };
    if (op === 'changed') {
      if (typeof priorSqft === 'number' && Number.isFinite(priorSqft) && freshSqft !== priorSqft) {
        return { matched: true, label: `Square footage changed from ${priorSqft} to ${freshSqft}` };
      }
      return { matched: false, label: null };
    }
    if (op === 'lte') {
      const threshold = Number(targetVal);
      if (Number.isFinite(threshold) && freshSqft <= threshold) {
        return { matched: true, label: `Square footage ${freshSqft} <= ${threshold}` };
      }
      return { matched: false, label: null };
    }
    if (op === 'gte') {
      const threshold = Number(targetVal);
      if (Number.isFinite(threshold) && freshSqft >= threshold) {
        return { matched: true, label: `Square footage ${freshSqft} >= ${threshold}` };
      }
      return { matched: false, label: null };
    }
    return { matched: false, label: null };
  }

  if (field === 'status') {
    if (op === 'changed' && freshListing.status && prior.status) {
      if (String(freshListing.status).trim().toLowerCase() !== String(prior.status).trim().toLowerCase()) {
        return { matched: true, label: `Listing status changed from ${prior.status} to ${freshListing.status}` };
      }
    }
    return { matched: false, label: null };
  }

  if (field === 'titleRisk') {
    if ((op === 'junior_lien_surviving_mortgage' || op === 'junior_lien') && isJuniorLien) {
      return { matched: true, label: `CRITICAL TITLE ALERT: Junior lien foreclosure (${ctx.titleRisk.plaintiffType}). Senior 1st mortgage survives sale in full! (JUNIOR_LIEN_SURVIVING_MORTGAGE)` };
    }
    if (op === 'irs_redemption_active' && hasIrsLien) {
      return { matched: true, label: 'IRS REDEMPTION ACTIVE: 120-day super-priority IRS redemption right under 26 U.S.C. § 7425(d)' };
    }
    if (op === 'hoa_super_priority' && isHoaSuperPriority) {
      return { matched: true, label: `HOA SUPER-PRIORITY RISK: Property in ${ctx.state} subject to statutory HOA super-priority assessment` };
    }
    return { matched: false, label: null };
  }

  return { matched: false, label: null };
}

function evaluateSecondLookTriggers(caseItem = {}, freshListing = {}, options = {}) {
  const prior = caseItem.listingSnapshot || {};
  const transition = evaluateLifecycleTransition(prior, freshListing);
  const rawNow = options.now !== undefined ? options.now : (caseItem.now !== undefined ? caseItem.now : Date.now());
  const parsedNow = typeof rawNow === 'number' ? rawNow : Date.parse(String(rawNow));
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();

  const rules = caseItem.reconsideration || {};
  const hasConditionsList = Array.isArray(rules.conditions) && rules.conditions.length > 0;
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

  const isSuperState = Boolean(
    titleRisk.hoaSuperPriority?.isSuperPriorityState ||
    ['NV', 'FL'].includes(state) ||
    Boolean(HOA_SUPER_PRIORITY_STATES[state])
  );
  const isHoa = Boolean(
    titleRisk.plaintiffType === 'HOA_ASSESSMENT' ||
    /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b|master\s*association)/i.test(plaintiff)
  );
  const isHoaSuperPriority = Boolean(isSuperState && (isHoa || titleRisk.hoaSuperPriority?.isSuperPriorityState));

  const priceChange = transition.changes.find((c) => c.type === 'PRICE_REDUCED');
  const dateChange = transition.changes.find((c) => c.type === 'DATE_RESCHEDULED');

  const ruleContext = {
    caseItem,
    prior,
    freshListing,
    priceChange,
    dateChange,
    titleRisk,
    state,
    isJuniorLien,
    hasIrsLien,
    isHoaSuperPriority,
    nowMs,
  };

  let openingBidRuleEvaluated = false;
  let openingBidRuleMatched = false;

  if (hasConditionsList) {
    const results = rules.conditions.map((cond) => ({
      cond,
      eval: evaluateRuleSpec(cond.field, cond, ruleContext),
    }));
    openingBidRuleEvaluated = results.some((r) => r.cond.field === 'openingBid');
    openingBidRuleMatched = results.some((r) => r.cond.field === 'openingBid' && r.eval.matched);
    const mode = rules.mode === 'all' ? 'all' : 'any';
    const matchedResults = results.filter((r) => r.eval.matched);
    const conditionsSatisfied = mode === 'all'
      ? matchedResults.length === results.length
      : matchedResults.length > 0;
    if (conditionsSatisfied) {
      shouldTrigger = true;
      for (const item of matchedResults) {
        if (!primaryReason && item.eval.label) primaryReason = item.eval.label;
        triggerEvents.push({
          type: `${String(item.cond.field || 'rule').toUpperCase()}_CONDITION_MATCHED`,
          field: item.cond.field,
          operator: item.cond.operator || item.cond.mode,
          label: item.eval.label,
        });
      }
    }
  } else {
    if (rules.openingBid) {
      openingBidRuleEvaluated = true;
      const bidEval = evaluateRuleSpec('openingBid', rules.openingBid, ruleContext);
      openingBidRuleMatched = bidEval.matched;
      if (bidEval.matched) {
        shouldTrigger = true;
        if (!primaryReason) primaryReason = bidEval.label;
        if (!priceChange) {
          triggerEvents.push({
            type: 'OPENING_BID_RULE_MATCHED',
            label: bidEval.label,
            operator: rules.openingBid.operator || rules.openingBid.mode,
          });
        }
      }
    } else if (priceChange && priceChange.discountPercent >= 10) {
      shouldTrigger = true;
      if (!primaryReason) primaryReason = priceChange.label;
    }

    if (rules.sqft) {
      const sqftEval = evaluateRuleSpec('sqft', rules.sqft, ruleContext);
      if (sqftEval.matched) {
        shouldTrigger = true;
        if (!primaryReason) primaryReason = sqftEval.label;
        triggerEvents.push({ type: 'SQFT_RULE_MATCHED', label: sqftEval.label });
      }
    }

    if (rules.status) {
      const statusEval = evaluateRuleSpec('status', rules.status, ruleContext);
      if (statusEval.matched) {
        shouldTrigger = true;
        if (!primaryReason) primaryReason = statusEval.label;
        triggerEvents.push({ type: 'STATUS_CHANGED', label: statusEval.label });
      }
    }

    if (rules.saleDate) {
      const dateOp = rules.saleDate.operator || rules.saleDate.mode;
      if (dateOp !== 'changed') {
        const dateEval = evaluateRuleSpec('saleDate', rules.saleDate, ruleContext);
        if (dateEval.matched) {
          shouldTrigger = true;
          if (!primaryReason) primaryReason = dateEval.label;
          triggerEvents.push({ type: 'SALE_DATE_WITHIN_DAYS', label: dateEval.label });
        }
      }
    }
  }

  // 1. Price Reduction / Junior Lien Alert
  if (priceChange) {
    triggerEvents.push(priceChange);

    // Junior Lien Foreclosure dropping price into apparent bargain territory.
    // Never let junior lien detection override an explicit failing openingBid rule or failed 'all' policy.
    const canTriggerFromPriceDrop = hasConditionsList
      ? shouldTrigger
      : (!openingBidRuleEvaluated || openingBidRuleMatched);
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
      if (canTriggerFromPriceDrop) {
        shouldTrigger = true;
        primaryReason = juniorAlertEvent.label;
      }
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
  if (dateChange && (rules.saleDate?.mode === 'changed' || rules.saleDate?.operator === 'changed')) {
    shouldTrigger = true;
    if (!primaryReason) primaryReason = dateChange.label;
    triggerEvents.push(dateChange);
  }

  // 5. Active IRS Federal Tax Lien Check (26 U.S.C. § 7425(d))
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
  if (isHoaSuperPriority) {
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
  const loaded = getCase(caseId, options);
  const existingCase = loaded && typeof loaded === 'object' && loaded.case ? loaded.case : loaded;
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

  const expectedRevision = options.expectedRevision !== undefined
    ? options.expectedRevision
    : existingCase.revision;

  const reasonNote = evaluation.primaryReason
    ? String(evaluation.primaryReason).slice(0, 1950)
    : 'Second-look reconsideration triggered';

  // Mutate case state back to inbox with reconsideration required while preserving optimistic locking
  const updatePayload = {
    state: 'inbox',
    expectedRevision,
    note: reasonNote,
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
