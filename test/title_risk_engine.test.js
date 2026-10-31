'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HOA_SUPER_PRIORITY_STATES,
  classifyForeclosingParty,
  detectIrsFederalTaxLien,
  arbitrateTitleRisk,
} = require('../server/intelligence/title-risk-engine');

test('classifies foreclosing plaintiff party type accurately', () => {
  assert.equal(classifyForeclosingParty('Wells Fargo Bank, N.A.'), 'FIRST_MORTGAGE');
  assert.equal(classifyForeclosingParty('Fannie Mae'), 'FIRST_MORTGAGE');
  assert.equal(classifyForeclosingParty('Discover Home Equity Line of Credit'), 'SECOND_MORTGAGE_HELOC');
  assert.equal(classifyForeclosingParty('Second Mortgage Loan Trust'), 'SECOND_MORTGAGE_HELOC');
  assert.equal(classifyForeclosingParty('Sunset Palms Homeowners Association, Inc.'), 'HOA_ASSESSMENT');
  assert.equal(classifyForeclosingParty('Franklin County Treasurer'), 'TAX_AUTHORITY');
  assert.equal(classifyForeclosingParty('Ygrene Energy Fund California PACE Program'), 'PACE_LIEN');
  assert.equal(classifyForeclosingParty('Apex Roofing & Construction Contractors, LLC Claim of Lien'), 'MECHANICS_LIEN');
  assert.equal(classifyForeclosingParty('John Doe Enterprises'), 'UNKNOWN');
});

test("PACE clean energy lien foreclosure warns of senior municipal assessment super-priority", () => {
  const listing = {
    id: 'prop-pace-01',
    plaintiff: 'California HERO Program Clean Energy Financing Assessment District',
    state: 'CA',
    openingBid: 18000,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'HIGH');
  assert.equal(risk.plaintiffType, 'PACE_LIEN');
  assert.ok(risk.titleWarnings.some((w) => w.includes('PACE ASSESSMENT SUPER-PRIORITY')));
});

test("mechanic's construction lien foreclosure trips CRITICAL warning and senior mortgage survival", () => {
  const listing = {
    id: 'prop-mech-01',
    plaintiff: "Buckeye Foundation & Masonry Contractors Mechanic's Lien Foreclosure",
    state: 'OH',
    openingBid: 9500,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'CRITICAL');
  assert.equal(risk.firstMortgageSurvives, true);
  assert.equal(risk.canProceedWithBid, false);
  assert.equal(risk.plaintiffType, 'MECHANICS_LIEN');
  assert.ok(risk.titleWarnings.some((w) => w.includes("Mechanic's/Construction lien foreclosure")));
  assert.match(risk.titleActionAdvice, /DO NOT BID/);
});

test('junior mortgage foreclosure trips CRITICAL title defect and warns senior mortgage survives', () => {
  const listing = {
    id: 'prop-heloc-01',
    plaintiff: 'Springleaf Financial Services 2nd Mortgage LLC',
    state: 'OH',
    openingBid: 15000,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'CRITICAL');
  assert.equal(risk.firstMortgageSurvives, true);
  assert.equal(risk.canProceedWithBid, false);
  assert.ok(risk.titleWarnings.some((w) => w.includes('Senior 1st mortgage survives sale in full')));
  assert.match(risk.titleActionAdvice, /DO NOT BID/);
});

test('first mortgage foreclosure confirms senior position and wipes junior liens', () => {
  const listing = {
    id: 'prop-first-01',
    plaintiff: 'JPMorgan Chase Bank, N.A.',
    state: 'OH',
    openingBid: 85000,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'LOW');
  assert.equal(risk.firstMortgageSurvives, false);
  assert.equal(risk.canProceedWithBid, true);
  assert.ok(risk.titleWarnings.some((w) => w.includes('SENIOR FORECLOSURE')));
  assert.doesNotMatch(risk.titleActionAdvice, /verified acceptable/i);
});

test('HOA foreclosure in super-priority state (NV) evaluates statutory assessment priority', () => {
  const listing = {
    id: 'prop-hoa-nv-01',
    plaintiff: 'Summerlin North Community Association',
    state: 'NV',
    openingBid: 12000,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'HIGH');
  assert.equal(risk.hoaSuperPriority.isSuperPriorityState, true);
  assert.equal(risk.hoaSuperPriority.monthsProtected, 9);
  assert.equal(risk.hoaSuperPriority.statute, 'NRS 116.3116');
  assert.ok(risk.titleWarnings.some((w) => w.includes('Nevada 9-month HOA super-priority')));
});

test('HOA foreclosure in non-super-priority state trips CRITICAL warning that 1st mortgage survives', () => {
  const listing = {
    id: 'prop-hoa-tx-01',
    plaintiff: 'Oakridge Homeowners Association',
    state: 'TX', // Texas is not a super-priority state for HOAs over first deeds of trust
    openingBid: 8000,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'CRITICAL');
  assert.equal(risk.firstMortgageSurvives, true);
  assert.equal(risk.canProceedWithBid, false);
  assert.ok(risk.titleWarnings.some((w) => w.includes('1st mortgage recorded prior survives the auction in full')));
});

test('detects 26 U.S.C. § 7425(d) federal tax lien with 120-day IRS redemption right', () => {
  const noticeWithIrs = `
    Case No. 2026-CV-9912. Bank vs. Debtor.
    Defendants include United States of America, Internal Revenue Service,
    by virtue of Federal Tax Lien recorded under 26 U.S.C. § 7425.
  `;

  const detection = detectIrsFederalTaxLien(noticeWithIrs);
  assert.equal(detection.hasIrsLien, true);
  assert.equal(detection.redemptionDays, 120);
  assert.equal(detection.statute, '26 U.S.C. § 7425(d)');

  const listing = {
    id: 'prop-irs-01',
    plaintiff: 'PNC Bank, N.A.',
    state: 'OH',
    raw: noticeWithIrs,
  };

  const risk = arbitrateTitleRisk(listing);
  assert.equal(risk.riskLevel, 'HIGH');
  assert.equal(risk.irsTaxLienRedemption.hasIrsLien, true);
  assert.equal(risk.irsTaxLienRedemption.redemptionDays, 120);
  assert.ok(risk.titleWarnings.some((w) => w.includes('120-day right of redemption')));
});

test('statutory redemption periods match state statutes', () => {
  // Alabama 180-day redemption
  const alListing = arbitrateTitleRisk({ plaintiff: 'Bank', state: 'AL' });
  assert.equal(alListing.statutoryRedemption.days, 180);
  assert.match(alListing.statutoryRedemption.label, /Ala\. Code § 6-5-248/);

  // Michigan 6-month redemption
  const miListing = arbitrateTitleRisk({ plaintiff: 'Bank', state: 'MI' });
  assert.equal(miListing.statutoryRedemption.days, 180);
  assert.match(miListing.statutoryRedemption.label, /MCL 600\.3240/);

  // New Jersey 10-day objection period
  const njListing = arbitrateTitleRisk({ plaintiff: 'Bank', state: 'NJ' });
  assert.equal(njListing.statutoryRedemption.days, 10);
  assert.match(njListing.statutoryRedemption.label, /N\.J\. Ct\. R\. 4:65-5/);

  // North Carolina 10-day upset bid period
  const ncListing = arbitrateTitleRisk({ plaintiff: 'Bank', state: 'NC' });
  assert.equal(ncListing.statutoryRedemption.days, 10);
  assert.ok(ncListing.titleWarnings.some((w) => w.includes('NORTH CAROLINA 10-DAY UPSET BID')));
});

test('regex word boundaries prevent substring false positives on irs and hoa', () => {
  assert.equal(classifyForeclosingParty('First Horizon Home Equity Line Corporation'), 'SECOND_MORTGAGE_HELOC');
  assert.equal(classifyForeclosingParty('First National Bank'), 'FIRST_MORTGAGE');
  assert.equal(classifyForeclosingParty('Shoal Creek Mortgage Partners'), 'FIRST_MORTGAGE');
  assert.equal(classifyForeclosingParty('KeyBank National Association Second Trust Deed Division'), 'SECOND_MORTGAGE_HELOC');

  const cleanNotice = 'First National Bank vs. John Smith. Foreclosure of mortgage deed.';
  const detection = detectIrsFederalTaxLien(cleanNotice);
  assert.equal(detection.hasIrsLien, false);
  assert.equal(detection.redemptionDays, 0);
  assert.equal(detection.warning, null);
});
