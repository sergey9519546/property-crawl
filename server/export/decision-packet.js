'use strict';

const crypto = require('crypto');
const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');
const { calculateCompleteCashToClose } = require('../intelligence/cash-to-close');
const { analyzeMunicipalViolations } = require('../intelligence/municipal-liens');
const { calculateMacroValuation } = require('../enrichment/macro-valuation');

/**
 * Builds an auditable, evidentiary Decision Packet for an auction listing.
 *
 * @param {Object} listing - The target property listing
 * @param {Object} [operatorInput] - Operator decisions and notes
 * @param {string} [operatorInput.disposition='UNDERWRITE'] - 'BID' | 'PASS' | 'UNDERWRITE'
 * @param {number} [operatorInput.maxAllowableOffer] - Target ceiling bid
 * @param {string} [operatorInput.operatorNotes] - Due diligence comments
 * @param {string} [operatorInput.operatorId='operator-current'] - Operator ID
 * @returns {Object} Structured decision packet
 */
function buildDecisionPacket(listing = {}, operatorInput = {}) {
  const address = listing.address || 'Address Unrecorded';
  const state = String(listing.state || 'US').toUpperCase();
  const county = listing.county || 'Unspecified County';
  const openingBid = Number(listing.openingBid) || 0;

  // 1. Title Risk Arbitration
  const titleRisk = arbitrateTitleRisk(listing);

  // 2. Cash-to-Close Schedule
  const cashToClose = calculateCompleteCashToClose({
    winningBid: openingBid,
    state,
    county,
    source: listing.source,
    deposit: listing.deposit
  });

  // 3. Municipal Liens & Code Violations
  const municipalRisk = analyzeMunicipalViolations(listing.municipalViolations || [], state);

  // 4. Macroeconomic Valuation Benchmark
  const macroValuation = listing.macroValuation || calculateMacroValuation({
    historicalValue: listing.assessedValue || listing.lastSalePrice || openingBid,
    historicalYear: listing.yearBuilt ? Math.max(2015, Math.min(2023, listing.yearBuilt)) : 2018,
    state,
    basisType: listing.assessedValue ? 'TAX_ASSESSMENT' : 'OPENING_BID'
  });

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

  const disposition = (operatorInput.disposition || 'UNDERWRITE').toUpperCase();
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
      caseNumber: listing.caseNumber || listing.docketNumber || 'Unassigned',
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
        hasIrsTaxLien: titleRisk.irsTaxLienRedemption?.hasLien || false,
        irsRedemptionDays: titleRisk.irsTaxLienRedemption?.redemptionDays || 0,
        statutoryRedemptionDays: titleRisk.statutoryRedemption?.days || 0,
        hoaSuperPriorityApplies: titleRisk.hoaSuperPriority?.isSuperPriorityState || false,
        titleWarnings: titleRisk.titleWarnings || [],
        titleActionAdvice: titleRisk.titleActionAdvice || ''
      },
      cashToClose: {
        totalAcquisitionCost: cashToClose.totalAcquisitionCost,
        buyersPremium: cashToClose.buyersPremium,
        sheriffPoundage: cashToClose.sheriffPoundage,
        transferTax: cashToClose.transferTax,
        recordingFees: cashToClose.recordingFees,
        creditedDeposit: cashToClose.creditedDeposit,
        netCashDueAtSettlement: cashToClose.netCashDueAtSettlement
      },
      municipalSurvivability: {
        hasCondemnationOrder: municipalRisk.isCondemnedOrDemolitionRisk,
        estimatedSurvivingLiability: municipalRisk.estimatedSurvivingLienLiability,
        activeViolationsCount: municipalRisk.activeViolationCount,
        criticalAlerts: municipalRisk.municipalWarnings
      },
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
      maxAllowableOffer: Number(operatorInput.maxAllowableOffer) || null,
      operatorNotes: operatorInput.operatorNotes || '',
      operatorId: operatorInput.operatorId || 'operator-session',
      signedAt: packetTimestamp
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
| **Case / Docket #** | ${p.caseNumber} |
| **Property Type** | ${p.propType} |
| **Auction Date** | ${p.saleDate || 'Unscheduled'} |
| **Opening Bid** | $${p.openingBid.toLocaleString()} |

---

## 2. Statutory Title Risk & Lien Survival Matrix
- **Foreclosing Party**: \`${t.plaintiffType}\`
- **Underwriting Risk Level**: **${t.riskLevel}** (${t.canProceedWithBid ? 'BID CLEARABLE' : 'BID PROHIBITED / DEFECTIVE TITLE'})
- **1st Mortgage Status**: ${t.firstMortgageSurvives ? '⚠️ **SURVIVES FORECLOSURE (SENIOR LIEN INTACT)**' : '✅ Foreclosed & Wiped'}
- **IRS Federal Tax Lien (26 U.S.C. § 7425)**: ${t.hasIrsTaxLien ? `⚠️ Active (${t.irsRedemptionDays}-day redemption period)` : 'None detected'}
- **State Statutory Redemption Period**: ${t.statutoryRedemptionDays} days
- **HOA Assessment Priority**: ${t.hoaSuperPriorityApplies ? 'Super-priority statutory assessment applies' : 'Subordinate to senior mortgage'}

### Critical Title Warnings & Notices:
${(t.titleWarnings && t.titleWarnings.length > 0) ? t.titleWarnings.map((w) => `- ⚠️ ${w}`).join('\n') : '- No active title defect flags detected.'}
- **Underwriting Recommendation**: ${t.titleActionAdvice}

---

## 3. Comprehensive Cash-to-Close Schedule
| Settlement Cost Line Item | Statutory Basis | Amount Due |
|---|---|---|
| **Winning Bid (Hammer Price)** | Base auction bid | $${p.openingBid.toLocaleString()} |
| **Buyer's Premium** | Online Marketplace Fee | $${c.buyersPremium.toLocaleString()} |
| **Sheriff Poundage** | County Sheriff Fee | $${c.sheriffPoundage.toLocaleString()} |
| **Documentary Transfer Taxes** | State / County Transfer Tax | $${c.transferTax.toLocaleString()} |
| **Deed Prep & Recording** | County Recorder Fee | $${c.recordingFees.toLocaleString()} |
| **Total Acquisition Cost** | Gross certified funds | **$${c.totalAcquisitionCost.toLocaleString()}** |
| **Credited Deposit** | Bidding registration deposit | -$${c.creditedDeposit.toLocaleString()} |
| **NET CASH DUE AT SETTLEMENT** | **Due in certified funds within 24-48 hrs** | **$${c.netCashDueAtSettlement.toLocaleString()}** |

---

## 4. Valuation Context (FHFA Macro Trend)
${u.macroValuation ? `- **Estimated Macro Range**: $${u.macroValuation.estLow.toLocaleString()} – $${u.macroValuation.estHigh.toLocaleString()} (Midpoint: $${u.macroValuation.estimatedMacroValue.toLocaleString()})
- **Historical Basis**: ${u.macroValuation.basis.type} ($${u.macroValuation.basis.historicalValue.toLocaleString()})
- *Honest Disclosure*: ${u.macroValuation.disclaimer}` : '- Valuation estimate band currently unavailable.'}

---

## 5. Operator Due Diligence Sign-Off
- **Disposition Decision**: **\`${d.decision}\`**
- **Max Allowable Offer (MAO)**: ${d.maxAllowableOffer ? `$${d.maxAllowableOffer.toLocaleString()}` : 'Not Specified'}
- **Operator ID**: \`${d.operatorId}\`
- **Timestamp**: ${d.signedAt}
- **Operator Notes**:
> ${d.operatorNotes || 'No operator commentary recorded.'}
`;
}

module.exports = {
  buildDecisionPacket,
  formatDecisionPacketMarkdown
};
