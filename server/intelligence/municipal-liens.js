'use strict';

/**
 * server/intelligence/municipal-liens.js
 *
 * County Municipal Lien & Code Enforcement Survivability Analyzer.
 * Detects municipal super-liens (demolition, water/sewer, weed abatement) that survive
 * mortgage foreclosures by state statute and attach directly to the purchaser.
 */

const { isDemolitionOrCondemnation } = require('../sources/socrata-code-enforcement');

const MUNICIPAL_SURVIVAL_RULES = Object.freeze({
  FL: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'Fla. Stat. § 153.67 / § 159.17',
    label: 'Florida municipal utility and special assessment super-liens survive foreclosure',
  },
  OH: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'Ohio Rev. Code § 715.261',
    label: 'Ohio municipal building removal/demolition assessments certified to tax duplicate survive',
  },
  IL: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: '65 ILCS 5/11-31-1',
    label: 'Illinois municipal demolition and emergency repair liens are superior to all prior mortgages',
  },
  PA: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: '53 P.S. § 7106',
    label: 'Pennsylvania municipal claims for water, sewer, and abatement prime all mortgages',
  },
});

function analyzeMunicipalViolations(listing = {}, violations = []) {
  const state = String(listing.state || 'OH').toUpperCase();
  const rule = MUNICIPAL_SURVIVAL_RULES[state] || null;

  const activeViolations = [];
  let totalFines = 0;
  let isCondemned = false;
  let hasDemolitionRisk = false;
  const warnings = [];

  for (const v of violations || []) {
    if (v.status && /closed|resolved|satisfied|dismissed/i.test(v.status)) {
      continue; // Skip closed or satisfied citations
    }

    activeViolations.push(v);
    totalFines += Number(v.fineAmount || 0);

    if (v.isCondemned || isDemolitionOrCondemnation(v.violationType || '')) {
      isCondemned = true;
      hasDemolitionRisk = true;
    }
  }

  // Survivability deduction estimate
  let survivingLiability = totalFines;

  if (hasDemolitionRisk) {
    warnings.push('CRITICAL MUNICIPAL ALERT: Active condemnation or demolition order on file! Immediate risk of structure forfeiture or $15k-$30k city demolition assessment.');
    // City demolition assessments typically average $15,000 to $25,000
    survivingLiability += 15000;
  }

  if (activeViolations.length > 0) {
    warnings.push(`ACTIVE CODE VIOLATIONS: ${activeViolations.length} unresolved municipal citations totaling $${totalFines.toLocaleString()} in fines.`);
    if (rule) {
      warnings.push(`STATUTORY SUPER-LIEN SURVIVAL: Under ${rule.statute}, municipal abatement and utility claims survive foreclosure sale in full.`);
    }
  }

  let actionRequired = 'No municipal violations detected on open dockets.';
  if (hasDemolitionRisk) {
    actionRequired = 'DO NOT BID without written confirmation of stay or repair permit from municipal code compliance department.';
  } else if (activeViolations.length > 0) {
    actionRequired = 'ESCROW RETENTION: Deduct estimated municipal lien liability from target bid.';
  }

  return {
    state,
    hasMunicipalViolations: activeViolations.length > 0,
    isCondemnedOrDemolitionRisk: hasDemolitionRisk,
    estimatedSurvivingLienLiability: Math.round(survivingLiability),
    activeViolationCount: activeViolations.length,
    violations: activeViolations,
    municipalWarnings: warnings,
    actionRequired,
  };
}

module.exports = {
  MUNICIPAL_SURVIVAL_RULES,
  analyzeMunicipalViolations,
};
