'use strict';

/**
 * server/intelligence/post-sale-possession.js
 *
 * Post-Sale Possession & Quiet Title Timeline Engine.
 *
 * Models statutory timelines for title clearance and possession post-auction:
 *  1. Quiet Title Action Timeline – time required to quiet title / eliminate
 *     residual claims post-sale (tax deeds, contested foreclosures).
 *  2. Writ of Possession Timeline – time required to obtain and execute a writ
 *     of possession / eviction against former owners or holdover occupants.
 *  3. Holding Carry Cost Estimator – financial impact of possession delay
 *     (taxes, insurance, HOA, debt carry) across the possession gap.
 *
 * Zero-Fabrication Invariant:
 * - If openingBid is null or undefined, totalEstimatedCost returns null.
 * - If tax rate / annual tax is not provided or observed, property tax carry is null.
 * - If monthly insurance is not provided or observed, insurance carry is null.
 * - Missing carry components are explicitly listed in missingInputs; arbitrary
 *   tax rates or insurance premiums are NEVER fabricated.
 * - Quiet title timelines are only added to hold days for tax deeds or when an adverse
 *   title claim / quiet title action is explicitly required.
 *
 * States covered with verified statutory citations:
 *  FL, GA, TX, IL, NJ, OH, PA, CA, NY, MI
 */

// ---------------------------------------------------------------------------
// Statutory Data: Quiet Title Timelines
// ---------------------------------------------------------------------------

/**
 * Per-state quiet title timeline for distressed / tax sale acquisitions.
 * Sources:
 *  FL  – Fla. Stat. Ch. 65; § 197.522 (tax deed quiet title)
 *  GA  – O.C.G.A. § 23-3-40 et seq. (quiet title); § 48-4-45 (barment of redemption)
 *  TX  – Tex. Tax Code § 34.21 (statutory redemption & title suit)
 *  IL  – 35 ILCS 200/22-40; 35 ILCS 200/22-45 (tax deed petition & contest)
 *  NJ  – N.J.S.A. § 54:5-104.83 (in rem tax foreclosure)
 *  OH  – R.C. § 5303.01 (action to quiet title in court of common pleas)
 *  PA  – Pa. R.C.P. 1061–1068 (action to quiet title)
 *  CA  – C.C.P. § 760.010 et seq. (quiet title action)
 *  NY  – RPAPL § 1521 (quiet title / determination of claim to real property)
 *  MI  – MCL § 211.78m (tax-forfeiture quiet title)
 */
const QUIET_TITLE_DATA = Object.freeze({
  FL: {
    minDays: 90,
    maxDays: 365,
    statutory: 'Fla. Stat. Ch. 65; § 197.522',
    notes:
      'Tax deed quiet title action filed in circuit court under Ch. 65. ' +
      '§ 197.522 governs notice/redemption; litigation commonly 90–365 days depending on contested title.',
  },
  GA: {
    minDays: 60,
    maxDays: 180,
    statutory: 'O.C.G.A. § 23-3-40; § 48-4-45',
    notes:
      'Quiet title action under O.C.G.A. § 23-3-40 et seq. in superior court. ' +
      'Tax deed barment of redemption under § 48-4-45 requires 12-month wait, followed by 60–180 day quiet title proceeding.',
  },
  TX: {
    minDays: 30,
    maxDays: 365,
    statutory: 'Tex. Tax Code § 34.21',
    notes:
      'Tax deed matures after 6-month (homestead/ag) or 2-year (other) right of redemption under § 34.21. ' +
      'Quiet title suit to extinguish residual claims: 30–365 days.',
  },
  IL: {
    minDays: 30,
    maxDays: 120,
    statutory: '35 ILCS 200/22-40; 35 ILCS 200/22-45',
    notes:
      'Tax deed confirmation and contest governed by 35 ILCS 200/22-40 and 22-45 in circuit court. ' +
      'Summary uncontested proceedings 30–60 days; contested title challenges extend to 120 days.',
  },
  NJ: {
    minDays: 60,
    maxDays: 180,
    statutory: 'N.J.S.A. § 54:5-104.83',
    notes:
      'Tax sale certificate foreclosure quiet title under N.J.S.A. § 54:5-104.83. ' +
      '60-day minimum publication/notice period; contested matters extend to 180 days.',
  },
  OH: {
    minDays: 90,
    maxDays: 365,
    statutory: 'R.C. § 5303.01',
    notes:
      'Action to quiet title in court of common pleas under R.C. § 5303.01. ' +
      '90-day minimum with court scheduling; complex lien priority or heir challenges extend to 365 days.',
  },
  PA: {
    minDays: 60,
    maxDays: 180,
    statutory: 'Pa. R.C.P. 1061–1068',
    notes:
      'Action to Quiet Title under Pa. R.C.P. 1061 et seq. in court of common pleas. ' +
      '60-day minimum; contested adverse claims or unserved junior interests extend to 180 days.',
  },
  CA: {
    minDays: 180,
    maxDays: 365,
    statutory: 'C.C.P. § 760.010',
    notes:
      'Quiet title action under C.C.P. § 760.010 et seq. ' +
      'Publication and service requirements frequently extend timeline; contested: 180–365 days.',
  },
  NY: {
    minDays: 90,
    maxDays: 365,
    statutory: 'RPAPL § 1521',
    notes:
      'Quiet title action under RPAPL § 1521 in Supreme Court. ' +
      'NYC calendar congestion often drives total to 365 days; 90-day minimum for uncontested.',
  },
  MI: {
    minDays: 30,
    maxDays: 120,
    statutory: 'MCL § 211.78m',
    notes:
      'Tax-forfeiture quiet title under MCL § 211.78m. ' +
      'Annual foreclosure cycle creates structured timelines; contested extends to 120 days.',
  },
});

// ---------------------------------------------------------------------------
// Statutory Data: Writ of Possession Timelines
// ---------------------------------------------------------------------------

/**
 * Per-state writ of possession / eviction timeline after sale.
 * Sources:
 *  FL  – Fla. R. Civ. P. 1.580 (writ of possession)
 *  GA  – O.C.G.A. § 44-7-50; § 44-7-55 (dispossessory warrant & writ of possession)
 *  TX  – Tex. R. Civ. P. 310 (writ of possession); Prop. Code § 24.005
 *  IL  – 735 ILCS 5/15-1701; 735 ILCS 5/9-101 et seq. (mortgage foreclosure possession)
 *  NJ  – N.J. Court R. 4:59-1 (writ of possession / execution)
 *  OH  – R.C. § 2329.31; R.C. § 2329.09; Ohio Civ. R. 70 (sale confirmation & execution)
 *  PA  – Pa. R.C.P. 3180 et seq. (writ of possession upon mortgage foreclosure)
 *  CA  – C.C.P. § 712.010 (writ of possession); C.C.P. § 1161a (post-foreclosure eviction)
 *  NY  – RPAPL § 713 (holdover proceeding / writ of assistance)
 *  MI  – MCR 4.201; MCL § 600.5714 (summary proceedings for possession)
 */
const WRIT_OF_POSSESSION_DATA = Object.freeze({
  FL: {
    minDays: 5,
    maxDays: 30,
    statutory: 'Fla. R. Civ. P. 1.580',
    notes:
      'Clerk issues writ of possession under Rule 1.580 after foreclosure sale confirmed. ' +
      '3-day notice to vacate required. Writ typically served 5–30 days post-issuance. ' +
      'No post-sale statutory redemption delay for judicial foreclosure once title transferred.',
  },
  GA: {
    minDays: 7,
    maxDays: 30,
    statutory: 'O.C.G.A. § 44-7-50; § 44-7-55',
    notes:
      'Dispossessory proceeding under O.C.G.A. § 44-7-50 following foreclosure sale. ' +
      'Occupant given 7 days to answer summons; writ of possession issues under § 44-7-55 within 7–30 days.',
  },
  TX: {
    minDays: 30,
    maxDays: 90,
    statutory: 'Tex. R. Civ. P. 310; Prop. Code § 24.005',
    notes:
      'Writ of possession issued under Rule 310 following forcible detainer judgment. ' +
      '3-day statutory notice to vacate; JP court hearing adds 14–30 days; writ execution 30–90 days total.',
  },
  IL: {
    minDays: 30,
    maxDays: 60,
    statutory: '735 ILCS 5/15-1701; 735 ILCS 5/9-101',
    notes:
      'Order of possession entered with foreclosure confirmation order under 735 ILCS 5/15-1701. ' +
      'Statutory 30-day stay of enforcement standard; sheriff eviction execution 30–60 days total.',
  },
  NJ: {
    minDays: 30,
    maxDays: 60,
    statutory: 'N.J. Court R. 4:59-1',
    notes:
      'Writ of possession issued under R. 4:59-1 following sheriff sale and confirmation. ' +
      'Post-sale objection window is 10 days; sheriff delivery and eviction execution 30–60 days.',
  },
  OH: {
    minDays: 14,
    maxDays: 30,
    statutory: 'R.C. § 2329.31; R.C. § 2329.09; Civ. R. 70',
    notes:
      'Foreclosure sale confirmation under R.C. § 2329.31 transfers legal title and terminates redemption. ' +
      'Writ of possession issued under R.C. § 2329.09 / Civ. R. 70 and executed by sheriff in 14–30 days.',
  },
  PA: {
    minDays: 30,
    maxDays: 90,
    statutory: 'Pa. R.C.P. 3180',
    notes:
      'Writ of possession under Pa. R.C.P. 3180 following sheriff sale and delivery of sheriff deed. ' +
      'Occupants receive statutory notice; sheriff scheduling and execution 30–90 days total.',
  },
  CA: {
    minDays: 30,
    maxDays: 60,
    statutory: 'C.C.P. § 712.010; C.C.P. § 1161a',
    notes:
      'Post-foreclosure unlawful detainer under C.C.P. § 1161a requires 3-day notice to quit. ' +
      'Writ of possession under C.C.P. § 712.010 executed by sheriff; total possession gap 30–60 days.',
  },
  NY: {
    minDays: 30,
    maxDays: 90,
    statutory: 'RPAPL § 713',
    notes:
      'Post-foreclosure holdover proceeding under RPAPL § 713; 10-day notice to quit required. ' +
      'Housing court calendar congestion in NYC can extend to 90 days post-referee deed delivery.',
  },
  MI: {
    minDays: 7,
    maxDays: 30,
    statutory: 'MCR 4.201; MCL § 600.5714',
    notes:
      'Summary proceedings under MCR 4.201 following expiration of statutory redemption period. ' +
      '7-day demand notice; district court judgment and writ issuance within 7–30 days.',
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimates quiet title action timeline for a given state and sale type.
 *
 * @param {string} state - Two-letter state abbreviation (e.g. 'FL')
 * @param {'tax-deed'|'sheriff'|'trustee'} [saleType]
 * @returns {{ minDays: number|null, maxDays: number|null, statutory: string|null, notes: string|null }}
 */
function estimateQuietTitleTimeline(state, saleType) {
  const stateUpper = (state || '').toString().toUpperCase().trim();
  const data = QUIET_TITLE_DATA[stateUpper];

  if (!data) {
    return {
      minDays: null,
      maxDays: null,
      statutory: null,
      notes: `No statutory quiet title data encoded for state: ${state}. Consult local real property counsel.`,
    };
  }

  const saleNote = saleType && saleType !== 'tax-deed'
    ? ` (${saleType} sale — judicial or deed-of-trust conveyances convey legal title directly; quiet title is required only if title defects, adverse possession, or junior lien challenges arise)`
    : '';

  return {
    minDays: data.minDays,
    maxDays: data.maxDays,
    statutory: data.statutory,
    notes: data.notes + saleNote,
  };
}

/**
 * Estimates writ of possession / eviction timeline after sale.
 *
 * @param {string} state - Two-letter state abbreviation
 * @param {'tax-deed'|'sheriff'|'trustee'} [saleType]
 * @returns {{ minDays: number|null, maxDays: number|null, statutory: string|null, notes: string|null }}
 */
function estimateWritOfPossessionTimeline(state, saleType) {
  const stateUpper = (state || '').toString().toUpperCase().trim();
  const data = WRIT_OF_POSSESSION_DATA[stateUpper];

  if (!data) {
    return {
      minDays: null,
      maxDays: null,
      statutory: null,
      notes: `No statutory writ of possession data encoded for state: ${state}. Consult local real property counsel.`,
    };
  }

  const saleNote = saleType && saleType !== 'sheriff'
    ? ` (${saleType} sale — statutory writ procedure applies; local court confirmation rules may govern timing)`
    : '';

  return {
    minDays: data.minDays,
    maxDays: data.maxDays,
    statutory: data.statutory,
    notes: data.notes + saleNote,
  };
}

/**
 * Estimates holding carry cost over the possession gap.
 *
 * Zero-Fabrication:
 * - If openingBid is null, totalEstimatedCost returns null.
 * - Tax rate and insurance premiums are NEVER fabricated.
 * - If tax or insurance parameters are omitted, corresponding daily cost is null
 *   and missingInputs lists them explicitly.
 * - Quiet title duration is only included if saleType === 'tax-deed' or
 *   requiresQuietTitle === true.
 *
 * @param {{
 *   state: string,
 *   saleType?: string,
 *   openingBid: number|null|undefined,
 *   annualTaxRate?: number|null,
 *   annualPropertyTax?: number|null,
 *   monthlyHoaFee?: number|null,
 *   monthlyInsurance?: number|null,
 *   monthlyUtilities?: number|null,
 *   requiresQuietTitle?: boolean,
 * }} params
 * @returns {{
 *   dailyCost: number|null,
 *   minHoldDays: number|null,
 *   maxHoldDays: number|null,
 *   estimatedHoldDays: number|null,
 *   minTotalCost: number|null,
 *   maxTotalCost: number|null,
 *   totalEstimatedCost: number|null,
 *   requiresQuietTitle: boolean,
 *   missingInputs: string[],
 *   basis: string,
 * }}
 */
function estimateHoldingCarryCost(params) {
  const p = params || {};
  const state = p.state;
  const saleType = p.saleType;
  const openingBid = p.openingBid;

  const bidIsNull =
    openingBid == null ||
    (typeof openingBid === 'number' && !Number.isFinite(openingBid));

  const quietTitle = estimateQuietTitleTimeline(state, saleType);
  const writ = estimateWritOfPossessionTimeline(state, saleType);

  const needsQuietTitle =
    p.requiresQuietTitle === true ||
    (p.requiresQuietTitle === undefined && saleType === 'tax-deed');

  let minHoldDays = null;
  let maxHoldDays = null;
  let estimatedHoldDays = null;

  if (writ.minDays != null && writ.maxDays != null) {
    if (needsQuietTitle && quietTitle.minDays != null && quietTitle.maxDays != null) {
      minHoldDays = writ.minDays + quietTitle.minDays;
      maxHoldDays = writ.maxDays + quietTitle.maxDays;
      estimatedHoldDays = Math.round(
        (quietTitle.minDays + quietTitle.maxDays) / 2 +
        (writ.minDays + writ.maxDays) / 2
      );
    } else {
      minHoldDays = writ.minDays;
      maxHoldDays = writ.maxDays;
      estimatedHoldDays = Math.round((writ.minDays + writ.maxDays) / 2);
    }
  }

  if (bidIsNull) {
    return {
      dailyCost: null,
      minHoldDays,
      maxHoldDays,
      estimatedHoldDays,
      minTotalCost: null,
      maxTotalCost: null,
      totalEstimatedCost: null,
      requiresQuietTitle: needsQuietTitle,
      missingInputs: ['openingBid'],
      basis:
        'openingBid is null — carry cost cannot be computed without a verified acquisition price. ' +
        'Zero-Fabrication Invariant: costs are never imputed from assessed value or comparable bids.',
    };
  }

  const daysPerYear = 365;
  const daysPerMonth = 365 / 12; // ~30.4375

  const missingInputs = [];

  // Property Tax component
  let dailyTax = null;
  if (typeof p.annualPropertyTax === 'number' && Number.isFinite(p.annualPropertyTax) && p.annualPropertyTax >= 0) {
    dailyTax = p.annualPropertyTax / daysPerYear;
  } else if (typeof p.annualTaxRate === 'number' && Number.isFinite(p.annualTaxRate) && p.annualTaxRate >= 0) {
    dailyTax = (openingBid * p.annualTaxRate) / daysPerYear;
  } else {
    missingInputs.push('annualPropertyTax_or_annualTaxRate');
  }

  // Insurance component
  let dailyInsurance = null;
  if (typeof p.monthlyInsurance === 'number' && Number.isFinite(p.monthlyInsurance) && p.monthlyInsurance >= 0) {
    dailyInsurance = p.monthlyInsurance / daysPerMonth;
  } else {
    missingInputs.push('monthlyInsurance');
  }

  // HOA & Utilities (default to 0 if provided or null if unknown)
  const dailyHoa =
    typeof p.monthlyHoaFee === 'number' && Number.isFinite(p.monthlyHoaFee) && p.monthlyHoaFee >= 0
      ? p.monthlyHoaFee / daysPerMonth
      : 0;

  const dailyUtilities =
    typeof p.monthlyUtilities === 'number' && Number.isFinite(p.monthlyUtilities) && p.monthlyUtilities >= 0
      ? p.monthlyUtilities / daysPerMonth
      : 0;

  // If both tax and insurance are missing, we cannot establish dailyCost
  if (dailyTax === null && dailyInsurance === null && dailyHoa === 0 && dailyUtilities === 0) {
    return {
      dailyCost: null,
      minHoldDays,
      maxHoldDays,
      estimatedHoldDays,
      minTotalCost: null,
      maxTotalCost: null,
      totalEstimatedCost: null,
      requiresQuietTitle: needsQuietTitle,
      missingInputs,
      basis:
        'Zero-Fabrication Invariant: Tax rate and insurance premiums were not provided or observed. ' +
        'Missing inputs: ' + missingInputs.join(', ') + '.',
    };
  }

  const knownDailyCost = (dailyTax || 0) + (dailyInsurance || 0) + dailyHoa + dailyUtilities;
  const dailyCostRounded = Math.round(knownDailyCost * 100) / 100;

  // Total cost is only complete if all major carry inputs were provided
  const isComplete = missingInputs.length === 0;

  const minTotalCost =
    isComplete && minHoldDays != null ? Math.round(knownDailyCost * minHoldDays * 100) / 100 : null;
  const maxTotalCost =
    isComplete && maxHoldDays != null ? Math.round(knownDailyCost * maxHoldDays * 100) / 100 : null;
  const totalEstimatedCost =
    isComplete && estimatedHoldDays != null ? Math.round(knownDailyCost * estimatedHoldDays * 100) / 100 : null;

  const basisParts = [];
  if (dailyTax !== null) basisParts.push(`daily tax: \$${dailyTax.toFixed(2)}`);
  if (dailyInsurance !== null) basisParts.push(`daily insurance: \$${dailyInsurance.toFixed(2)}`);
  if (dailyHoa > 0) basisParts.push(`daily HOA: \$${dailyHoa.toFixed(2)}`);
  if (dailyUtilities > 0) basisParts.push(`daily utilities: \$${dailyUtilities.toFixed(2)}`);
  if (missingInputs.length > 0) basisParts.push(`missing inputs: ${missingInputs.join(', ')}`);

  const basis =
    `Known daily carry: \$${dailyCostRounded}. ${basisParts.join('; ')}. ` +
    `Hold days (${minHoldDays ?? '?'}–${maxHoldDays ?? '?'} d, mid: ${estimatedHoldDays ?? '?'}) ` +
    `reflects ${needsQuietTitle ? 'quiet title + writ of possession' : 'writ of possession only'} per ${state} statutes.`;

  return {
    dailyCost: dailyCostRounded,
    minHoldDays,
    maxHoldDays,
    estimatedHoldDays,
    minTotalCost,
    maxTotalCost,
    totalEstimatedCost,
    requiresQuietTitle: needsQuietTitle,
    missingInputs,
    basis,
  };
}

/**
 * Builds a full structured possession dossier for a given property record.
 *
 * @param {{
 *   state: string,
 *   saleType?: string,
 *   openingBid?: number|null,
 *   [key: string]: any
 * }} property
 * @returns {{
 *   state: string|null,
 *   saleType: string|null,
 *   quietTitle: object,
 *   writOfPossession: object,
 *   carryCost: object,
 *   summary: string,
 *   generatedAt: string,
 * }}
 */
function buildPossessionDossier(property) {
  const { state, saleType, openingBid } = property || {};

  const quietTitle = estimateQuietTitleTimeline(state, saleType);
  const writOfPossession = estimateWritOfPossessionTimeline(state, saleType);
  const carryCost = estimateHoldingCarryCost({
    state,
    saleType,
    openingBid,
    annualTaxRate: property.annualTaxRate,
    annualPropertyTax: property.annualPropertyTax,
    monthlyHoaFee: property.monthlyHoaFee,
    monthlyInsurance: property.monthlyInsurance,
    monthlyUtilities: property.monthlyUtilities,
    requiresQuietTitle: property.requiresQuietTitle,
  });

  const qtRange = quietTitle.minDays != null
    ? `${quietTitle.minDays}–${quietTitle.maxDays} days`
    : 'unknown (state not encoded)';

  const writRange = writOfPossession.minDays != null
    ? `${writOfPossession.minDays}–${writOfPossession.maxDays} days`
    : 'unknown (state not encoded)';

  const costLine = carryCost.totalEstimatedCost != null
    ? `Estimated total carry: \$${carryCost.totalEstimatedCost.toLocaleString()} over ~${carryCost.estimatedHoldDays} days.`
    : carryCost.missingInputs.length > 0
    ? `Carry cost incomplete (missing: ${carryCost.missingInputs.join(', ')} — Zero-Fabrication Invariant).`
    : 'Carry cost not computable.';

  const summary =
    `[${state || 'UNKNOWN'} / ${saleType || 'unknown'}] ` +
    `Quiet title: ${qtRange} (${quietTitle.statutory || 'N/A'}). ` +
    `Writ of possession: ${writRange} (${writOfPossession.statutory || 'N/A'}). ` +
    costLine;

  return {
    state: state || null,
    saleType: saleType || null,
    quietTitle,
    writOfPossession,
    carryCost,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  estimateQuietTitleTimeline,
  estimateWritOfPossessionTimeline,
  estimateHoldingCarryCost,
  buildPossessionDossier,
  QUIET_TITLE_DATA,
  WRIT_OF_POSSESSION_DATA,
};
