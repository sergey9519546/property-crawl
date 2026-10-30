'use strict';

const crypto = require('crypto');
const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');
const { computeCashToClose } = require('../ai/legal-rules');
const { analyzeMunicipalViolations } = require('../intelligence/municipal-liens');
const { getHudSafmrBenchmark } = require('../enrichment/hud-safmr');

const CASH_FIELDS = [
  'registrationFunds',
  'creditedDeposit',
  'buyersPremium',
  'sheriffPoundage',
  'transferTax',
  'delinquentTaxes',
  'settlementCosts'
];

const EFFECTIVE_TAX_RATE_BY_STATE = Object.freeze({
  AL: 0.0041, AK: 0.0118, AZ: 0.0063, AR: 0.0064, CA: 0.0125, CO: 0.0051, CT: 0.0179, DE: 0.0058, DC: 0.0057, FL: 0.0089,
  GA: 0.0092, HI: 0.0029, ID: 0.0067, IL: 0.0200, IN: 0.0085, IA: 0.0152, KS: 0.0141, KY: 0.0086, LA: 0.0055, ME: 0.0124,
  MD: 0.0105, MA: 0.0114, MI: 0.0148, MN: 0.0112, MS: 0.0079, MO: 0.0097, MT: 0.0074, NE: 0.0163, NV: 0.0055, NH: 0.0186,
  NJ: 0.0223, NM: 0.0073, NY: 0.0140, NC: 0.0078, ND: 0.0098, OH: 0.0152, OK: 0.0090, OR: 0.0093, PA: 0.0149, RI: 0.0140,
  SC: 0.0057, SD: 0.0124, TN: 0.0066, TX: 0.0170, UT: 0.0058, VT: 0.0190, VA: 0.0082, WA: 0.0094, WV: 0.0059, WI: 0.0161, WY: 0.0061,
});

const INSURANCE_BASE_RATE_PER_1000 = Object.freeze({
  AK: 3.83, AL: 8.40, AR: 8.82, AZ: 3.43, CA: 2.79, CO: 5.78, CT: 4.68, DC: 3.66,
  DE: 3.29, FL: 10.37, GA: 6.24, HI: 2.34, IA: 8.56, ID: 2.99, IL: 8.95, IN: 7.00,
  KS: 12.73, KY: 7.15, LA: 13.53, MA: 3.85, MD: 4.07, ME: 3.72, MI: 4.82, MN: 6.89,
  MO: 9.15, MS: 10.77, MT: 3.83, NC: 4.39, ND: 8.17, NE: 10.96, NH: 2.96, NJ: 3.55,
  NM: 4.64, NV: 3.02, NY: 4.39, OH: 5.88, OK: 13.32, OR: 2.76, PA: 4.79, RI: 4.66,
  SC: 6.33, SD: 6.80, TN: 5.54, TX: 8.94, UT: 2.52, VA: 3.98, VT: 3.54, WA: 2.80,
  WI: 4.16, WV: 6.97, WY: 4.49,
});

const DEFAULT_NATIONAL_INSURANCE_RATE_PER_1000 = 5.52;
const DEFAULT_NATIONAL_TAX_RATE = 0.011;

function addDaysIso(baseDateStr, days) {
  if (!baseDateStr || days <= 0) return null;
  const time = Date.parse(String(baseDateStr).slice(0, 10));
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * 86400000).toISOString().slice(0, 10);
}

function computeStatutoryDeadlinesAndCarry(params = {}) {
  const st = (params.state || '').trim().toUpperCase();
  const saleDateIso = params.saleDate && Number.isFinite(Date.parse(String(params.saleDate).slice(0, 10)))
    ? String(params.saleDate).slice(0, 10)
    : null;

  let objectionOrConfirmationDays = 0;
  let objectionLabel = null;
  if (st === 'NC') {
    objectionOrConfirmationDays = 10;
    objectionLabel = 'NC 10-day rolling upset-bid window (N.C.G.S. § 45-21.27)';
  } else if (st === 'NJ') {
    objectionOrConfirmationDays = 10;
    objectionLabel = 'NJ 10-day sheriff deed objection / redemption window (R. 4:65-5)';
  } else if (st === 'FL') {
    objectionOrConfirmationDays = 10;
    objectionLabel = 'FL 10-day Certificate of Title objection window (Fla. Stat. § 45.031(5))';
  } else if (st === 'OH') {
    objectionOrConfirmationDays = 30;
    objectionLabel = 'OH 30-day court confirmation & deed delivery window (ORC § 2329.31)';
  } else if (st === 'CA') {
    objectionOrConfirmationDays = 45;
    objectionLabel = 'CA 45-day post-sale eligible bidder intent & upset period (Cal. Civ. Code § 2924m / SB 1079)';
  } else if (st === 'IL') {
    objectionOrConfirmationDays = 30;
    objectionLabel = 'IL 30-day court confirmation of judicial sale (735 ILCS 5/15-1508)';
  } else if (st === 'NY') {
    objectionOrConfirmationDays = 30;
    objectionLabel = 'NY 30-day referee report of sale & deed delivery (RPAPL § 1354)';
  }

  const irsRedemptionDays = params.hasIrsLien ? 120 : 0;
  const stateRedemptionDays = Math.max(0, Math.round(Number(params.redemptionDays) || 0));
  const effectiveLockupDays = Math.max(objectionOrConfirmationDays, irsRedemptionDays, stateRedemptionDays);
  const annualCostOfCapitalPct = Number.isFinite(Number(params.annualCostOfCapitalPct)) ? Number(params.annualCostOfCapitalPct) : 10;
  const price = typeof params.purchasePrice === 'number' && Number.isFinite(params.purchasePrice) && params.purchasePrice > 0
    ? params.purchasePrice
    : null;
  const estimatedCarryCost = price !== null && effectiveLockupDays > 0
    ? Math.round(price * (annualCostOfCapitalPct / 100) * (effectiveLockupDays / 365))
    : null;

  const effTaxRate = params.effectiveTaxRatePct !== undefined
    ? (Number(params.effectiveTaxRatePct) || 0) / 100
    : (EFFECTIVE_TAX_RATE_BY_STATE[st] || DEFAULT_NATIONAL_TAX_RATE);
  const insRatePer1000 = params.insuranceBaseRatePer1000 !== undefined
    ? (Number(params.insuranceBaseRatePer1000) || 0)
    : (INSURANCE_BASE_RATE_PER_1000[st] || DEFAULT_NATIONAL_INSURANCE_RATE_PER_1000);

  const estimatedPropertyTaxCarry = price !== null && effectiveLockupDays > 0
    ? Math.round(price * effTaxRate * (effectiveLockupDays / 365))
    : null;
  const estimatedInsuranceCarry = price !== null && effectiveLockupDays > 0
    ? Math.round(price * (insRatePer1000 / 1000) * (effectiveLockupDays / 365))
    : null;
  const totalHoldingCostCarry = estimatedCarryCost !== null
    ? estimatedCarryCost + (estimatedPropertyTaxCarry || 0) + (estimatedInsuranceCarry || 0)
    : null;
  const monthlyHoldingCost = price !== null
    ? Math.round(price * (annualCostOfCapitalPct / 100 / 12) + price * (effTaxRate / 12) + price * (insRatePer1000 / 1000 / 12))
    : null;

  return {
    saleDateIso,
    objectionOrConfirmationDays,
    objectionLabel,
    objectionDeadline: addDaysIso(saleDateIso, objectionOrConfirmationDays),
    irsRedemptionDays,
    irsRedemptionDeadline: addDaysIso(saleDateIso, irsRedemptionDays),
    stateRedemptionDays,
    stateRedemptionDeadline: addDaysIso(saleDateIso, stateRedemptionDays),
    effectiveLockupDays,
    estimatedCarryCost,
    effectiveTaxRatePct: Number((effTaxRate * 100).toFixed(2)),
    insuranceBaseRatePer1000: insRatePer1000,
    estimatedPropertyTaxCarry,
    estimatedInsuranceCarry,
    totalHoldingCostCarry,
    monthlyHoldingCost,
    annualCostOfCapitalPct,
    ...(params.computedAt ? { computedAt: params.computedAt } : {})
  };
}

function explicitPositive(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function publishedIdentifier(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || /^(unassigned|unknown|n\/a|none|—|-)$/i.test(text)) continue;
    return text;
  }
  return null;
}

function explicitNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function packetCash(listing, operatorInput) {
  const openingBid = explicitPositive(listing.openingBid);
  const input = { openingBid, purchasePrice: openingBid };
  for (const field of CASH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(operatorInput, field)) continue;
    const amount = explicitNonNegative(operatorInput[field]);
    if (amount !== null) input[field] = amount;
  }
  const cash = computeCashToClose(input);
  const cashDueReady = cash.registrationFunds !== null
    && cash.creditedDeposit !== null
    && cash.cashDueAtSettlement !== null;
  return {
    model: cash.model,
    acquisitionCostStatus: cash.acquisitionCostStatus,
    fundingTimingStatus: cash.fundingTimingStatus,
    totalAcquisitionCost: cash.totalAcquisitionCost,
    buyersPremium: cash.buyersPremium,
    sheriffPoundage: cash.sheriffPoundage,
    transferTax: cash.transferTax,
    delinquentTaxes: cash.delinquentTaxes,
    settlementCosts: cash.settlementCosts,
    registrationFunds: cash.registrationFunds,
    creditedDeposit: cash.creditedDeposit,
    cashDueAtSettlement: cashDueReady ? cash.cashDueAtSettlement : null,
    netCashDueAtSettlement: cashDueReady ? cash.cashDueAtSettlement : null,
    missingInputs: cash.missingInputs,
    assumptions: cash.assumptions
  };
}

function moneyCell(value) {
  return Number.isFinite(value) ? `$${Number(value).toLocaleString()}` : 'Not entered';
}

function publishedRedemptionDays(listing) {
  const derived = listing?.provenance?.derivedFields?.redemption;
  if (derived != null) return null;
  const raw = listing?.redemptionDays;
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function municipalSurvivability(listing) {
  if (!Array.isArray(listing.municipalViolations)) {
    if (listing.codeEnforcement && typeof listing.codeEnforcement === 'object') {
      const ce = listing.codeEnforcement;
      return {
        hasCondemnationOrder: Boolean(ce.vacantBuildingNotice),
        estimatedSurvivingLiability: null,
        activeViolationsCount: typeof ce.openViolationsCount === 'number'
          ? ce.openViolationsCount
          : (Array.isArray(ce.violations) ? ce.violations.length : 0),
        lastInspectionDate: ce.lastInspectionDate || null,
        criticalAlerts: ce.vacantBuildingNotice ? ['VACANT_BUILDING_NOTICE_ON_RECORD'] : [],
        source: ce.source || 'MUNICIPAL_OPEN_DATA'
      };
    }
    return {
      hasCondemnationOrder: null,
      estimatedSurvivingLiability: null,
      activeViolationsCount: null,
      criticalAlerts: []
    };
  }
  const municipalRisk = analyzeMunicipalViolations(listing, listing.municipalViolations);
  return {
    hasCondemnationOrder: municipalRisk.isCondemnedOrDemolitionRisk,
    estimatedSurvivingLiability: municipalRisk.estimatedSurvivingLienLiability,
    activeViolationsCount: municipalRisk.activeViolationCount,
    criticalAlerts: municipalRisk.municipalWarnings
  };
}

function attachedValuation(macro) {
  if (!macro || typeof macro !== 'object') return null;
  if (macro.valuationMethod === 'FHFA_HPI_TREND') return null;
  const basisType = macro.basis && macro.basis.type;
  if (basisType === 'OPENING_BID' || basisType === 'AUCTION_OPENING_BID') return null;
  if (!Number.isFinite(Number(macro.estLow)) || !Number.isFinite(Number(macro.estHigh))) return null;
  return macro;
}

/**
 * Builds an auditable, evidentiary Decision Packet for an auction listing.
 *
 * @param {Object} listing - The target property listing
 * @param {Object} [operatorInput] - Operator decisions and notes
 * @param {string} [operatorInput.disposition] - Recorded 'BID' | 'PASS' | 'UNDERWRITE'. Omitted means no decision.
 * @param {number} [operatorInput.maxAllowableOffer] - Target ceiling bid
 * @param {string} [operatorInput.operatorNotes] - Due diligence comments
 * @param {string} [operatorInput.operatorId] - Operator ID. Omitted means no sign-off.
 * @returns {Object} Structured decision packet
 */
function buildDecisionPacket(listing = {}, operatorInput = {}) {
  const address = listing.address || 'Address Unrecorded';
  const state = String(listing.state || 'US').toUpperCase();
  const county = listing.county || 'Unspecified County';
  const openingBid = explicitPositive(listing.openingBid);

  // 1. Title Risk Arbitration
  const titleRisk = arbitrateTitleRisk(listing);

  // 2. Cash requirement. State, source, and a published deposit never become fees.
  const cashToClose = packetCash(listing, operatorInput);

  // 3. Municipal liens only when the caller supplied violation records.
  // A missing list is not an empty docket, and the state code is not a violation.

  // 4. Valuation stays empty unless a caller attached a non-index, non-bid basis.
  // The in-repo HPI table is not an official FHFA release and must not fill this slot.
  const macroValuation = attachedValuation(listing.macroValuation);

  // 5. Source Provenance & Integrity Hash
  const rawProvenance = listing.provenance || {};
  const provenancePayload = {
    sourceId: listing.source || 'unknown',
    sourceUrl: listing.sourceUrl || null,
    observedAt: listing.sourceObservedAt || rawProvenance.observedAt || new Date().toISOString(),
    publisher: rawProvenance.publisher || listing.source || 'Public Docket',
    recordId: String(rawProvenance.recordId || listing.id || '')
  };

  const integrityChecksum = crypto
    .createHash('sha256')
    .update(JSON.stringify({ listingId: listing.id, provenance: provenancePayload, openingBid }))
    .digest('hex');

  const disposition = typeof operatorInput.disposition === 'string' && operatorInput.disposition.trim()
    ? operatorInput.disposition.trim().toUpperCase()
    : null;
  const maxAllowableOffer = explicitPositive(operatorInput.maxAllowableOffer);
  const packetTimestamp = new Date().toISOString();
  const hudSafmr = listing.hudSafmr || (listing.zip ? getHudSafmrBenchmark({ zip: listing.zip, bedrooms: listing.beds ?? 2 }) : null);

  const statutoryDeadlinesAndCarry = computeStatutoryDeadlinesAndCarry({
    saleDate: listing.saleDate || null,
    state,
    purchasePrice: maxAllowableOffer || openingBid,
    redemptionDays: publishedRedemptionDays(listing),
    hasIrsLien: Boolean(titleRisk.irsTaxLienRedemption?.hasIrsLien || titleRisk.irsTaxLienRedemption?.hasLien)
  });

  const packet = {
    packetId: `DP-${listing.id || 'ANON'}-${Date.now()}`,
    schemaVersion: 'decision-packet/v1',
    createdAt: packetTimestamp,
    integrityChecksum,
    ...(hudSafmr ? { hudSafmr } : {}),
    property: {
      id: listing.id,
      address,
      city: listing.city || '',
      state,
      county,
      zip: listing.zip || '',
      propType: listing.propType || 'Unknown',
      caseNumber: publishedIdentifier(
        listing.caseNumber,
        listing.docketNumber,
        listing.provenance?.courtCaseNumber,
        listing.provenance?.sourceFacts?.caseNumber,
        listing.provenance?.sourceFacts?.docketNumber
      ),
      saleDate: listing.saleDate || null,
      openingBid
    },
    provenance: provenancePayload,
    underwriting: {
      titleRisk: {
        plaintiffType: titleRisk.plaintiffType,
        riskLevel: titleRisk.riskLevel,
        canProceedWithBid: titleRisk.canProceedWithBid,
        firstMortgageSurvives: titleRisk.firstMortgageSurvives,
        hasIrsTaxLien: Boolean(titleRisk.irsTaxLienRedemption?.hasIrsLien || titleRisk.irsTaxLienRedemption?.hasLien),
        irsRedemptionDays: titleRisk.irsTaxLienRedemption?.redemptionDays || 0,
        statutoryRedemptionDays: publishedRedemptionDays(listing),
        hoaSuperPriorityApplies: titleRisk.hoaSuperPriority?.isSuperPriorityState || false,
        instrumentPriority: titleRisk.instrumentPriority || null,
        titleWarnings: titleRisk.titleWarnings || [],
        titleActionAdvice: titleRisk.titleActionAdvice || ''
      },
      statutoryDeadlinesAndCarry,
      cashToClose,
      municipalSurvivability: municipalSurvivability(listing),
      macroValuation: macroValuation ? {
        estimatedMacroValue: macroValuation.estimatedMacroValue,
        estLow: macroValuation.estLow,
        estHigh: macroValuation.estHigh,
        basis: macroValuation.basis,
        isAvmAppraisal: false,
        disclaimer: macroValuation.disclaimer
      } : null
    },
    dispositionSignOff: {
      decision: disposition,
      maxAllowableOffer,
      operatorNotes: typeof operatorInput.operatorNotes === 'string' ? operatorInput.operatorNotes : '',
      operatorId: operatorInput.operatorId || null,
      signedAt: disposition ? packetTimestamp : null
    }
  };

  return packet;
}

/**
 * Formats a Decision Packet into printable GitHub-flavored Markdown.
 */
function formatDecisionPacketMarkdown(packet) {
  const p = packet.property;
  const u = packet.underwriting;
  const c = u.cashToClose;
  const t = u.titleRisk;
  const d = packet.dispositionSignOff;
  const s = u.statutoryDeadlinesAndCarry || computeStatutoryDeadlinesAndCarry({
    saleDate: p.saleDate,
    state: p.state,
    purchasePrice: p.openingBid,
    redemptionDays: t.statutoryRedemptionDays,
    hasIrsLien: Boolean(t.hasIrsTaxLien)
  });
  const priorityKnown = t.plaintiffType && t.plaintiffType !== 'UNKNOWN';
  const mortgageLine = !priorityKnown
    ? 'Not established from the published plaintiff text'
    : t.firstMortgageSurvives
      ? 'Published plaintiff text matches a junior lien. A senior mortgage is flagged as surviving. This is not a title opinion.'
      : 'No senior-lien survival flag from the published plaintiff text. This is not a title opinion.';
  const proceedLine = !priorityKnown
    ? 'No bid clearance. The plaintiff position was not established.'
    : t.canProceedWithBid
      ? 'No senior-lien block from the published plaintiff text'
      : 'Senior-lien block from the published plaintiff text';
  const irsLine = t.hasIrsTaxLien
    ? `IRS phrase in the supplied record (${t.irsRedemptionDays}-day redemption period)`
    : 'No IRS phrase in the supplied record. That is not a lien search.';
  const redemptionLine = Number.isFinite(t.statutoryRedemptionDays)
    ? `${t.statutoryRedemptionDays} days recorded in this dataset`
    : 'Not published';
  const warningBlock = Array.isArray(t.titleWarnings) && t.titleWarnings.length > 0
    ? `\n### Pattern flags from the published text\n${t.titleWarnings.map((w) => `- ${w}`).join('\n')}\n`
    : '';
  const inst = t.instrumentPriority;
  const instrumentParts = [
    inst?.instrumentNumber ? `Instrument #${inst.instrumentNumber}` : null,
    inst?.bookPage ? `Book ${inst.bookPage.book}, Page ${inst.bookPage.page}` : null,
    inst?.recordedDate ? `Recorded ${inst.recordedDate}` : null,
  ].filter(Boolean);
  const instrumentLine = instrumentParts.length > 0
    ? `\n- **Recorded Instrument Reference**: ${instrumentParts.join(' · ')}`
    : '';
  const openingLine = Number.isFinite(p.openingBid) ? `$${p.openingBid.toLocaleString()} (published opening amount)` : 'Not published';

  return `# FORECLOSURE DUE DILIGENCE DECISION PACKET
**Packet ID**: \`${packet.packetId}\`  
**Generated**: ${packet.createdAt}  
**Checksum (SHA-256)**: \`${packet.integrityChecksum}\`

---

## 1. Property & Auction Identification
| Attribute | Value |
|---|---|
| **Property ID** | ${p.id} |
| **Address** | ${p.address}, ${p.city}, ${p.state} ${p.zip} |
| **County / Court** | ${p.county} |
| **Case / Docket #** | ${p.caseNumber || 'Not published'} |
| **Property Type** | ${p.propType} |
| **Auction Date** | ${p.saleDate || 'Not published'} |
| **Opening Bid** | ${openingLine} |

---

## 2. Statutory Title Risk & Lien Survival Matrix
- **Foreclosing Party**: \`${t.plaintiffType}\`
- **Underwriting Risk Level**: **${t.riskLevel}** (${proceedLine})
- **1st Mortgage Status**: ${mortgageLine}
- **IRS Federal Tax Lien (26 U.S.C. § 7425)**: ${irsLine}
- **Recorded redemption period**: ${redemptionLine}
- **HOA Assessment Priority**: ${t.hoaSuperPriorityApplies ? 'A super-priority assessment statute is on file for this state. It is not a finding that an assessment exists on this property.' : 'No super-priority assessment statute is applied from this state code.'}${instrumentLine}
${warningBlock}
### Statutory Post-Sale Deadlines & Holding Cost Carry
- **Objection / Confirmation Window**: ${s.objectionLabel || `${s.objectionOrConfirmationDays} days`}${s.objectionDeadline ? ` (Deadline: ${s.objectionDeadline})` : ''}
- **IRS 120-Day Right of Redemption (26 U.S.C. § 7425)**: ${s.irsRedemptionDays > 0 ? `${s.irsRedemptionDays} days${s.irsRedemptionDeadline ? ` (Deadline: ${s.irsRedemptionDeadline})` : ''}` : 'No IRS lien recorded on file'}
- **State Statutory Redemption Period**: ${s.stateRedemptionDays > 0 ? `${s.stateRedemptionDays} days${s.stateRedemptionDeadline ? ` (Deadline: ${s.stateRedemptionDeadline})` : ''}` : redemptionLine}
- **Effective Capital Lockup Window**: ${s.effectiveLockupDays} days
${s.totalHoldingCostCarry !== null ? `- **Total Estimated Holding Carry**: $${s.totalHoldingCostCarry.toLocaleString()} ($${s.monthlyHoldingCost?.toLocaleString()}/mo carry at ${s.annualCostOfCapitalPct}% cost of capital)` : '- **Holding Carry**: Buyer-supplied purchase price assumption required to calculate dollar carry.'}

---

## 3. Cash requirement
No fee is inferred from the source or the state. A blank line was not entered. Registration funds are not added to cash to close.

| Line | Amount |
|---|---|
| **Published opening amount** | ${openingLine} |
| **Buyer's premium** | ${moneyCell(c.buyersPremium)} |
| **Sheriff / trustee fee** | ${moneyCell(c.sheriffPoundage)} |
| **Transfer tax** | ${moneyCell(c.transferTax)} |
| **Taxes or debt the buyer must satisfy** | ${moneyCell(c.delinquentTaxes)} |
| **Other settlement / recording costs** | ${moneyCell(c.settlementCosts)} |
| **Acquisition cost** | ${moneyCell(c.totalAcquisitionCost)} |
| **Registration funds** | ${moneyCell(c.registrationFunds)} |
| **Deposit credited to the price** | ${moneyCell(c.creditedDeposit)} |
| **Cash to close** | ${c.cashDueAtSettlement === null ? 'Blank until registration funds and the credited deposit are both entered' : moneyCell(c.cashDueAtSettlement)} |

---

## 4. Valuation band
${u.macroValuation ? `- **Estimated Macro Range**: $${u.macroValuation.estLow.toLocaleString()} – $${u.macroValuation.estHigh.toLocaleString()} (Midpoint: $${u.macroValuation.estimatedMacroValue.toLocaleString()})
- **Historical Basis**: ${u.macroValuation.basis.type} ($${u.macroValuation.basis.historicalValue.toLocaleString()})
- *Honest Disclosure*: ${u.macroValuation.disclaimer}` : '- Valuation estimate band currently unavailable.'}
${packet.hudSafmr ? `
### HUD Statutory Fair Market Rent (SAFMR) Floor
- **ZIP Code**: ${packet.hudSafmr.zip} (FY2025 Revised Section 8 FMR)
- **Voucher Payment Standard**: 90% floor to 110% ceiling (24 CFR § 888.113)

| Unit Size | Section 8 FMR Baseline | 90% Voucher Floor | 110% Voucher Ceiling |
|---|---|---|---|
| **0 Bedroom (Efficiency)** | $${packet.hudSafmr.rents?.['0br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard90?.['0br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard110?.['0br']?.toLocaleString() ?? '—'} |
| **1 Bedroom** | $${packet.hudSafmr.rents?.['1br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard90?.['1br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard110?.['1br']?.toLocaleString() ?? '—'} |
| **2 Bedroom** | $${packet.hudSafmr.rents?.['2br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard90?.['2br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard110?.['2br']?.toLocaleString() ?? '—'} |
| **3 Bedroom** | $${packet.hudSafmr.rents?.['3br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard90?.['3br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard110?.['3br']?.toLocaleString() ?? '—'} |
| **4 Bedroom** | $${packet.hudSafmr.rents?.['4br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard90?.['4br']?.toLocaleString() ?? '—'} | $${packet.hudSafmr.paymentStandard110?.['4br']?.toLocaleString() ?? '—'} |

- *Statutory Citation*: 42 U.S.C. § 1437f(o)(1)(B); official HUD Small Area Fair Market Rent schedule.` : ''}

---

## 5. Operator Due Diligence Sign-Off
- **Disposition Decision**: ${d.decision ? `**\`${d.decision}\`**` : 'Not recorded'}
- **Max Allowable Offer (MAO)**: ${Number.isFinite(d.maxAllowableOffer) ? `$${d.maxAllowableOffer.toLocaleString()}` : 'Not recorded'}
- **Operator ID**: ${d.operatorId ? `\`${d.operatorId}\`` : 'Not recorded'}
- **Timestamp**: ${d.signedAt || 'Not recorded'}
- **Operator Notes**:
> ${d.operatorNotes || 'No operator commentary recorded.'}
`;
}

module.exports = {
  buildDecisionPacket,
  formatDecisionPacketMarkdown,
  computeStatutoryDeadlinesAndCarry
};
