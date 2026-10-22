'use strict';

const crypto = require('crypto');
const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');
const { computeCashToClose } = require('../ai/legal-rules');
const { analyzeMunicipalViolations } = require('../intelligence/municipal-liens');

const CASH_FIELDS = [
  'registrationFunds',
  'creditedDeposit',
  'buyersPremium',
  'sheriffPoundage',
  'transferTax',
  'delinquentTaxes',
  'settlementCosts'
];

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

  const packet = {
    packetId: `DP-${listing.id || 'ANON'}-${Date.now()}`,
    schemaVersion: 'decision-packet/v1',
    createdAt: packetTimestamp,
    integrityChecksum,
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
  formatDecisionPacketMarkdown
};
