'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isDemolitionOrCondemnation,
  parseSocrataRecord,
  SOCRATA_PORTALS,
} = require('../server/sources/socrata-code-enforcement');

const {
  MUNICIPAL_SURVIVAL_RULES,
  analyzeMunicipalViolations,
} = require('../server/intelligence/municipal-liens');

test('detects condemnation and demolition terminology accurately', () => {
  assert.equal(isDemolitionOrCondemnation('Unsafe structure order to demolish'), true);
  assert.equal(isDemolitionOrCondemnation('Building condemned - emergency board up required'), true);
  assert.equal(isDemolitionOrCondemnation('Grass height over 12 inches'), false);
  assert.equal(isDemolitionOrCondemnation('Minor paint peeling on exterior trim'), false);
});

test('parses Socrata code violation records from municipal open data endpoints', () => {
  const rawOrlando = {
    case_address: '421 N Orange Ave',
    violation_type: 'Order to Demolish Substandard Structure',
    case_status: 'OPEN',
    opened_date: '2026-08-14',
    total_fees: 3500,
  };

  const parsed = parseSocrataRecord(rawOrlando, 'orlando');
  assert.equal(parsed.city, 'Orlando');
  assert.equal(parsed.state, 'FL');
  assert.equal(parsed.address, '421 N Orange Ave');
  assert.equal(parsed.fineAmount, 3500);
  assert.equal(parsed.isCondemned, true);
  assert.equal(parsed.isDemolitionRisk, true);
});

test('municipal lien analyzer flags active code violations and computes liability', () => {
  const listing = {
    id: 'listing-fl-01',
    address: '100 Main St',
    state: 'FL',
  };

  const violations = [
    {
      violationType: 'Unsafe Electrical Wiring',
      status: 'OPEN',
      fineAmount: 1250,
      isCondemned: false,
    },
    {
      violationType: 'Weed and Overgrowth Abatement',
      status: 'OPEN',
      fineAmount: 500,
      isCondemned: false,
    },
    {
      violationType: 'Resolved Trash Citation',
      status: 'CLOSED', // should be excluded
      fineAmount: 250,
      isCondemned: false,
    },
  ];

  const analysis = analyzeMunicipalViolations(listing, violations);
  assert.equal(analysis.hasMunicipalViolations, true);
  assert.equal(analysis.activeViolationCount, 2);
  assert.equal(analysis.isCondemnedOrDemolitionRisk, false);
  assert.equal(analysis.estimatedSurvivingLienLiability, 1750);
  assert.ok(analysis.municipalWarnings.some((w) => w.includes('Fla. Stat. § 153.67')));
});

test('municipal lien analyzer trips CRITICAL alert on active condemnation orders', () => {
  const listing = {
    id: 'listing-oh-01',
    address: '2248 E 55th St',
    state: 'OH',
  };

  const violations = [
    {
      violationType: 'Condemned Structure - Imminent Collapse Hazard',
      status: 'ACTIVE',
      fineAmount: 4200,
      isCondemned: true,
    },
  ];

  const analysis = analyzeMunicipalViolations(listing, violations);
  assert.equal(analysis.isCondemnedOrDemolitionRisk, true);
  assert.ok(analysis.estimatedSurvivingLienLiability >= 19000, 'Must include demolition risk escrow');
  assert.ok(analysis.municipalWarnings.some((w) => w.includes('CRITICAL MUNICIPAL ALERT: Active condemnation')));
  assert.match(analysis.actionRequired, /DO NOT BID/);
});

test('municipal survival statutes exist for FL, OH, IL, PA', () => {
  assert.equal(MUNICIPAL_SURVIVAL_RULES.FL.demolitionSurvives, true);
  assert.equal(MUNICIPAL_SURVIVAL_RULES.OH.demolitionSurvives, true);
  assert.equal(MUNICIPAL_SURVIVAL_RULES.IL.demolitionSurvives, true);
  assert.equal(MUNICIPAL_SURVIVAL_RULES.PA.demolitionSurvives, true);
});
