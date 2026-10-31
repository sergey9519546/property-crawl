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
  TX: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: "Tex. Loc. Gov't Code § 214.0015 & § 342.007",
    label: 'Texas municipal assessment for dangerous building demolition and health/safety nuisance abatement is privileged and prior to all liens except tax liens',
  },
  CA: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'Cal. Gov. Code § 38773.5 & § 25845',
    label: 'California nuisance abatement and substandard structure demolition assessments collected on county tax roll survive foreclosure',
  },
  NJ: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'N.J.S.A. § 40:48-2.5 & § 40:48-2.14',
    label: 'New Jersey municipal emergency repair and demolition liens of unfit buildings have priority over all private mortgages',
  },
  MI: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'MCL § 125.541',
    label: 'Michigan dangerous building demolition and repair costs certified to the county tax roll prime all private mortgage liens',
  },
  MD: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'Md. Code Real Prop. § 14-804/806 & Baltimore City Code Art. 13',
    label: 'Maryland municipal water/sewer charges and dangerous building demolition citations prime private mortgages as tax roll liens',
  },
  MO: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'RSMo § 67.410 & § 67.398',
    label: 'Missouri municipal special tax bills for dangerous building repair or demolition are a lien on the property on equal footing with taxes',
  },
  GA: {
    waterSewerSurvives: true,
    demolitionSurvives: true,
    nuisanceSurvives: true,
    statute: 'O.C.G.A. § 41-2-9(b) & § 36-60-17',
    label: 'Georgia municipal demolition and nuisance abatement liens are coequal with ad valorem taxes and prime security deeds',
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

    if (
      v.isCondemned ||
      v.isDemolitionRisk ||
      isDemolitionOrCondemnation(v.violationType || '') ||
      isDemolitionOrCondemnation(v.description || '')
    ) {
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
