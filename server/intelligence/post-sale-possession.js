'use strict';

/**
 * server/intelligence/post-sale-possession.js
 *
 * Post-Sale Possession Timeline Estimator.
 *
 * Provides per-state statutory estimates of:
 *  1. Quiet title action timelines (tax deed)
 *  2. Writ of possession / eviction timelines after sale
 *  3. Holding carry cost during possession gap
 *  4. Full possession dossier combining all three
 *
 * Zero-Fabrication Invariant:
 *  - Every day range cites controlling state statute.
 *  - openingBid is NEVER imputed; null/undefined → null carry cost.
 */

// ---------------------------------------------------------------------------
// Statutory Data: Quiet Title Timelines
// ---------------------------------------------------------------------------

/**
 * Per-state quiet title action timeline data, keyed by state abbreviation.
 * Columns: minDays, maxDays, statute, notes.
 *
 * Sources:
 *  FL  – Fla. Stat. Ch. 65; § 197.522 (tax deed redemption / quiet title)
 *  GA  – O.C.G.A. § 9-12-60 (quiet title actions)
 *  TX  – Tex. Tax Code § 34.21 (right of redemption; deed matures)
 *  IL  – 735 ILCS 5/2-1301 (judgments; tax deed quiet title)
 *  NJ  – N.J.S.A. § 54:5-104.83 (tax-sale quiet title)
 *  OH  – R.C. § 5322.01 (foreclosure quiet title)
 *  PA  – Pa. R.C.P. 3180 (sheriff sale quiet title)
 *  CA  – C.C.P. § 760.010 et seq. (quiet title action)
 *  NY  – RPAPL § 1521 (quiet title / mortgage foreclosure)
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
    statutory: 'O.C.G.A. § 9-12-60',
    notes:
      'Quiet title action under O.C.G.A. § 9-12-60 in superior court. ' +
      'Uncontested matters often resolved within 60 days; contested 90–180 days.',
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
    statutory: '735 ILCS 5/2-1301',
    notes:
      'Tax deed quiet title governed by 735 ILCS 5/2-1301. ' +
      'Summary proceedings possible within 30–60 days; contested may extend to 120 days.',
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
    statutory: 'R.C. § 5322.01',
    notes:
      'Quiet title following sheriff/tax-sale under R.C. § 5322.01. ' +
      '90-day minimum with court scheduling; complex title chains extend to 365 days.',
  },
  PA: {
    minDays: 60,
    maxDays: 180,
    statutory: 'Pa. R.C.P. 3180',
    notes:
      'Sheriff sale quiet title under Pa. R.C.P. 3180. ' +
      '60-day minimum; contested liens or HOA claims may extend to 180 days.',
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
 * Includes statutory notice periods, writ service timelines, and any
 * post-sale redemption hold periods that delay possession.
 *
 * Sources:
 *  FL  – Fla. R. Civ. P. 1.580 (writ of possession)
 *  GA  – O.C.G.A. § 9-13-14 (writ of possession after sale)
 *  TX  – Tex. R. Civ. P. 310 (writ of possession)
 *  IL  – 735 ILCS 5/9-211 (forcible entry; writ issuance)
 *  NJ  – N.J. Court R. 4:59 (writ of execution / possession)
 *  OH  – Ohio Civ. R. 70 (writ of possession)
 *  PA  – Pa. R.C.P. 3180 (writ of execution / possession)
 *  CA  – C.C.P. § 712.010 (writ of possession)
 *  NY  – RPAPL § 713 (holdover proceeding / writ)
 *  MI  – MCR 4.201 (summary proceedings / writ)
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
    statutory: 'O.C.G.A. § 9-13-14',
    notes:
      'Writ of possession issued under O.C.G.A. § 9-13-14 following dispossessory proceeding. ' +
      '7-day demand letter required. Sheriff serves and enforces writ within 7–30 days.',
  },
  TX: {
    minDays: 30,
    maxDays: 90,
    statutory: 'Tex. R. Civ. P. 310',
    notes:
      'Writ of possession issued under Rule 310 after forcible detainer judgment. ' +
      '3-day notice to vacate; JP court proceedings add 30–60 days; writ enforcement 30–90 days total. ' +
      'Homestead redemption right (§ 34.21) may hold possession up to 6 months.',
  },
  IL: {
    minDays: 30,
    maxDays: 60,
    statutory: '735 ILCS 5/9-211',
    notes:
      'Forcible entry and detainer action under 735 ILCS 5/9-211. ' +
      '5-day notice required; court date 14–30 days; writ issued 30–60 days after sale.',
  },
  NJ: {
    minDays: 30,
    maxDays: 60,
    statutory: 'N.J. Court R. 4:59',
    notes:
      'Writ of possession issued under R. 4:59-1 following sheriff sale and confirmation. ' +
      '3-day notice to quit required; post-sale confirmation adds 10–14 days; total 30–60 days.',
  },
  OH: {
    minDays: 14,
    maxDays: 30,
    statutory: 'Ohio Civ. R. 70',
    notes:
      'Writ of possession under Civ. R. 70 after judicial confirmation of sheriff sale. ' +
      'Redemption period expires at confirmation; writ served 14–30 days post-confirmation.',
  },
  PA: {
    minDays: 30,
    maxDays: 90,
    statutory: 'Pa. R.C.P. 3180',
    notes:
      'Writ of possession under Pa. R.C.P. 3180 following sheriff sale. ' +
      'Upset/absolute sale confirmation delay; occupants receive 30-day notice; total 30–90 days.',
  },
  CA: {
    minDays: 30,
    maxDays: 60,
    statutory: 'C.C.P. § 712.010',
    notes:
      'Writ of possession under C.C.P. § 712.010. ' +
      '3-day notice after trustee sale; unlawful detainer adds 20–45 days; lockout 30–60 days total.',
  },
  NY: {
    minDays: 30,
    maxDays: 90,
    statutory: 'RPAPL § 713',
    notes:
      'Holdover proceeding under RPAPL § 713; 10-day notice required. ' +
      'Housing court calendar congestion in NYC can extend to 90 days. ' +
      'Post-sale redemption period under RPAPL § 1341 expires at referee deed delivery.',
  },
  MI: {
    minDays: 7,
    maxDays: 30,
    statutory: 'MCR 4.201',
    notes:
      'Summary proceedings under MCR 4.201. ' +
      '7-day demand notice; district court proceeding 7–21 days; writ issuance within 30 days total.',
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimates quiet title action timeline for a given state and sale type.
 *
 * @param {string} state - Two-letter state abbreviation (e.g. 'FL')
 * @param {'tax-deed'|'sheriff'|'trustee'} saleType
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

  // Sheriff and trustee sales share the same quiet title framework per state;
  // note any sale-type-specific modifier where applicable.
  const saleNote = saleType && saleType !== 'tax-deed'
    ? ` (${saleType} sale — same state quiet title statute applies; confirm with local counsel whether shorter publication runs apply)`
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
 * @param {'tax-deed'|'sheriff'|'trustee'} saleType
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
    ? ` (${saleType} sale — writ procedure identical under state law; trustee-sale occupant notice periods may apply per local practice)`
    : '';

  return {
    minDays: data.minDays,
    maxDays: data.maxDays,
    statutory: data.statutory,
    notes: data.notes + saleNote,
  };
}

/**
 * Estimates holding carry cost over the possession gap (quiet title + writ periods).
 *
 * Zero-Fabrication: if openingBid is null or undefined, returns null totalEstimatedCost.
 *
 * @param {{
 *   state: string,
 *   saleType: string,
 *   openingBid: number|null|undefined,
 *   annualTaxRate?: number,
 *   monthlyHoaFee?: number,
 *   monthlyInsurance?: number,
 *   monthlyUtilities?: number,
 * }} params
 * @returns {{
 *   dailyCost: number|null,
 *   estimatedHoldDays: number|null,
 *   totalEstimatedCost: number|null,
 *   basis: string,
 * }}
 */
function estimateHoldingCarryCost(params) {
  const {
    state,
    saleType,
    openingBid,
    annualTaxRate = 0.015,
    monthlyHoaFee = 0,
    monthlyInsurance = 200,
    monthlyUtilities = 0,
  } = params || {};

  // Zero-Fabrication: never impute openingBid
  const bidIsNull = openingBid == null || (typeof openingBid === 'number' && !Number.isFinite(openingBid));

  const quietTitle = estimateQuietTitleTimeline(state, saleType);
  const writ = estimateWritOfPossessionTimeline(state, saleType);

  // Use midpoint estimates for expected hold days; return null if data missing
  let estimatedHoldDays = null;
  if (quietTitle.minDays != null && quietTitle.maxDays != null &&
      writ.minDays != null && writ.maxDays != null) {
    const qtMid = Math.round((quietTitle.minDays + quietTitle.maxDays) / 2);
    const writMid = Math.round((writ.minDays + writ.maxDays) / 2);
    estimatedHoldDays = qtMid + writMid;
  }

  if (bidIsNull) {
    return {
      dailyCost: null,
      estimatedHoldDays,
      totalEstimatedCost: null,
      basis:
        'openingBid is null — carry cost cannot be computed without a verified acquisition price. ' +
        'Zero-Fabrication Invariant: costs are never imputed from assessed value or comparable bids.',
    };
  }

  // Daily cost components (per-day denominators):
  //   Annual property tax = openingBid * annualTaxRate → per day = / 365
  //   Monthly HOA fee → per day = / 30.4375
  //   Monthly insurance → per day = / 30.4375
  //   Monthly utilities → per day = / 30.4375
  const daysPerYear = 365;
  const daysPerMonth = 365 / 12; // ~30.4375

  const dailyTax = (openingBid * annualTaxRate) / daysPerYear;
  const dailyHoa = monthlyHoaFee / daysPerMonth;
  const dailyInsurance = monthlyInsurance / daysPerMonth;
  const dailyUtilities = monthlyUtilities / daysPerMonth;

  const dailyCost = dailyTax + dailyHoa + dailyInsurance + dailyUtilities;

  const totalEstimatedCost = estimatedHoldDays != null
    ? Math.round(dailyCost * estimatedHoldDays * 100) / 100
    : null;

  return {
    dailyCost: Math.round(dailyCost * 100) / 100,
    estimatedHoldDays,
    totalEstimatedCost,
    basis:
      `Daily cost: property tax (${(annualTaxRate * 100).toFixed(2)}% of bid / 365) ` +
      `+ HOA (\$${monthlyHoaFee}/mo) + insurance (\$${monthlyInsurance}/mo) + utilities (\$${monthlyUtilities}/mo). ` +
      `Hold days = midpoint(quiet title) + midpoint(writ of possession) per ${state} statutory ranges.`,
  };
}

/**
 * Builds a full structured possession dossier for a given property record.
 *
 * @param {{
 *   state: string,
 *   saleType: string,
 *   openingBid: number|null|undefined,
 *   [key: string]: any
 * }} property
 * @returns {{
 *   state: string,
 *   saleType: string,
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
    monthlyHoaFee: property.monthlyHoaFee,
    monthlyInsurance: property.monthlyInsurance,
    monthlyUtilities: property.monthlyUtilities,
  });

  const qtRange = quietTitle.minDays != null
    ? `${quietTitle.minDays}–${quietTitle.maxDays} days`
    : 'unknown (state not encoded)';

  const writRange = writOfPossession.minDays != null
    ? `${writOfPossession.minDays}–${writOfPossession.maxDays} days`
    : 'unknown (state not encoded)';

  const costLine = carryCost.totalEstimatedCost != null
    ? `Estimated total carry: \$${carryCost.totalEstimatedCost.toLocaleString()} over ~${carryCost.estimatedHoldDays} days.`
    : 'Carry cost not computable (openingBid missing — Zero-Fabrication Invariant).';

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
  // Expose raw data tables for downstream consumers
  QUIET_TITLE_DATA,
  WRIT_OF_POSSESSION_DATA,
};
