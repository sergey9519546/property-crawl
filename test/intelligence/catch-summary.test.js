'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { computeCatchSummary } = require('../../server/intelligence/catch-summary');
const { presentListing } = require('../../server/routes/listings');

describe('computeCatchSummary — deterministic "Here\'s the Catch" one-liner', () => {
  test('returns null for a clean record with no actionable catch signals', () => {
    const listing = {
      openingBid: 100000,
      estLow: 200000,
      estHigh: 250000,
      redemptionDays: 0,
      seniorLienRisk: 'low',
      occupancy: 'unoccupied',
      saleDate: '2027-01-15',
      deposit: 'certified funds',
    };
    assert.equal(computeCatchSummary(listing, [], null), null);
  });

  test('rule 1: CRITICAL/HIGH title risk returns the first non-redemption warning', () => {
    const listing = { openingBid: 100000, saleDate: '2027-01-15' };
    const warnings = [
      'STATUTORY REDEMPTION: 30-day window applies.',
      'SENIOR LIEN: a federal tax lien survives this sale.',
    ];
    const out = computeCatchSummary(listing, warnings, 'HIGH');
    assert.ok(out.includes('federal tax lien survives'));
    assert.ok(!out.includes('STATUTORY REDEMPTION'));
  });

  test('rule 1: falls back to first warning when all are redemption/HOA labelled', () => {
    const listing = { openingBid: 100000, saleDate: '2027-01-15' };
    const warnings = ['STATUTORY REDEMPTION: 30-day window.'];
    const out = computeCatchSummary(listing, warnings, 'CRITICAL');
    assert.ok(out.length > 0);
  });

  test('rule 1: LOW/MODERATE risk does not trigger the title-warning branch', () => {
    const listing = {
      openingBid: 100000, estLow: 200000, estHigh: 250000,
      redemptionDays: 0, seniorLienRisk: 'low', occupancy: 'unoccupied',
      saleDate: '2027-01-15', deposit: 'certified funds',
    };
    const out = computeCatchSummary(listing, ['Some warning'], 'LOW');
    assert.equal(out, null);
  });

  test('rule 2: statutory redemption window wins when no title risk', () => {
    const listing = { openingBid: 100000, saleDate: '2027-01-15', state: 'FL', redemptionDays: 45 };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /Florida law/);
    assert.match(out, /45-day statutory redemption/);
  });

  test('rule 2: a two-letter state code is spelled out, never left as "OR law"', () => {
    const out = computeCatchSummary({ state: 'OR', redemptionDays: 180 }, [], null);
    assert.match(out, /Oregon law/);
    assert.ok(!/\bOR law\b/.test(out), `"OR law" reads as the conjunction: ${out}`);
  });

  test('rule 2: an unknown state code is passed through rather than invented', () => {
    const out = computeCatchSummary({ state: 'ZZ', redemptionDays: 30 }, [], null);
    assert.match(out, /ZZ law/);
  });

  test('rule 3: senior-lien risk flagged non-low', () => {
    const listing = {
      openingBid: 100000, saleDate: '2027-01-15', seniorLienRisk: 'HIGH',
      redemptionDays: 0,
    };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /Senior-lien risk flagged as "high"/);
  });

  test('rule 4: no opening bid with judgment references the judgment amount', () => {
    const listing = { judgment: 250000, saleDate: '2027-01-15' };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /No opening bid published/);
    assert.match(out, /\$250,000/);
  });

  test('rule 4b: no opening bid without judgment is honest about unknown price', () => {
    const listing = { saleDate: '2027-01-15' };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /No opening amount published/);
  });

  test('rule 5: opening bid but no sale date', () => {
    const listing = { openingBid: 100000, estLow: 200000, estHigh: 250000 };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /Opening bid \$100,000 but no sale date/);
  });

  test('rule 6: occupancy not disclosed', () => {
    const listing = { openingBid: 100000, saleDate: '2027-01-15', estLow: 200000, estHigh: 250000 };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /Occupancy not disclosed/);
  });

  test('rule 6b: reported occupied', () => {
    const listing = {
      openingBid: 100000, saleDate: '2027-01-15', estLow: 200000, estHigh: 250000,
      occupancy: 'occupied',
    };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /Reported occupied/);
  });

  test('rule 7: deposit terms not published', () => {
    const listing = {
      openingBid: 100000, saleDate: '2027-01-15', estLow: 200000, estHigh: 250000,
      occupancy: 'unoccupied',
    };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /Deposit terms not published/);
  });

  test('rule 8: no valuation range but otherwise clean', () => {
    const listing = {
      openingBid: 100000, saleDate: '2027-01-15', occupancy: 'unoccupied', deposit: 'certified funds',
      estLow: null, estHigh: null,
    };
    const out = computeCatchSummary(listing, [], null);
    assert.match(out, /no published valuation range/);
  });

  test('returns null when every signal is clean and a valuation range exists', () => {
    const listing = {
      openingBid: 100000, estLow: 200000, estHigh: 250000, saleDate: '2027-01-15',
      occupancy: 'unoccupied', deposit: 'certified funds', redemptionDays: 0, seniorLienRisk: 'low',
    };
    assert.equal(computeCatchSummary(listing, [], null), null);
  });

  test('output is always a single line under 160 chars when non-null', () => {
    const cases = [
      { openingBid: 100000, saleDate: '2027-01-15', state: 'FL', redemptionDays: 365 },
      { openingBid: 100000, saleDate: '2027-01-15', occupancy: 'occupied by owner and tenant' },
      { judgment: 999999999 },
    ];
    for (const c of cases) {
      const out = computeCatchSummary(c, [], null);
      if (out !== null) {
        assert.ok(out.length < 160, `expected <160 chars, got ${out.length}: ${out}`);
        assert.ok(!out.includes('\n'), 'must be single line');
      }
    }
  });

  test('handles empty/null listing gracefully', () => {
    assert.equal(computeCatchSummary({}, [], null), 'No opening amount published — price unknown until sale day; confirm before bidding.');
    assert.equal(computeCatchSummary(null, [], null), 'No opening amount published — price unknown until sale day; confirm before bidding.');
  });

  test('strips SHOUT label prefix from title warning', () => {
    const listing = { openingBid: 100000, saleDate: '2027-01-15' };
    const out = computeCatchSummary(listing, ['HOA SUPER-PRIORITY LIEN: an HOA lien primes this mortgage.'], 'CRITICAL');
    assert.ok(!out.startsWith('HOA SUPER-PRIORITY'));
    assert.ok(out.length > 0);
  });

  test('truncates very long title warnings to ~155 chars', () => {
    const listing = { openingBid: 100000, saleDate: '2027-01-15' };
    const longWarning = 'A' + 'x'.repeat(300);
    const out = computeCatchSummary(listing, [longWarning], 'HIGH');
    assert.ok(out.length <= 156, `expected <=156, got ${out.length}`);
    assert.ok(out.endsWith('…'));
  });

  test('never fabricates a valuation range', () => {
    const listing = {
      openingBid: 100000, saleDate: '2027-01-15', occupancy: 'unoccupied', deposit: 'certified funds',
      estLow: null, estHigh: 250000,
    };
    const out = computeCatchSummary(listing, [], null);
    assert.ok(out.includes('no published valuation range'));
    assert.ok(!out.includes('$250,000'));
  });
  test('labels <= $500 opening bids without valuation bands as nominal starting bids', () => {
    const out = computeCatchSummary({ openingBid: 100, saleDate: '2027-01-15' }, [], null);
    assert.match(out, /Nominal \$100 starting bid \(reserve undisclosed\)/);
    assert.ok(out.length < 160);
  });

  test('suppresses state redemption baseline for federal REO sources unless IRS tax lien', () => {
    const hud = computeCatchSummary({ source: 'hud', state: 'MI', redemptionDays: 180, openingBid: 120000, saleDate: '2027-01-15' }, [], null);
    assert.doesNotMatch(hud, /statutory redemption window/);
  });
});

describe('presentListing — presentation-layer catch derivation', () => {
  test('derives a catch for a record persisted before migration 042 (no catchSummary)', () => {
    const presented = presentListing({
      id: 'legacy:1',
      source: 'treasury',
      state: 'FL',
      address: '1 Legacy Way, Tampa, FL',
      openingBid: 100000,
      saleDate: '2027-01-15',
      redemptionDays: 45,
    });
    assert.equal(typeof presented.catchSummary, 'string');
    assert.match(presented.catchSummary, /45-day statutory redemption/);
  });

  test('a persisted catchSummary wins over the derived one', () => {
    const presented = presentListing({
      id: 'persisted:1',
      source: 'treasury',
      state: 'FL',
      address: '2 Persisted Way, Tampa, FL',
      openingBid: 100000,
      saleDate: '2027-01-15',
      catchSummary: 'Publisher-flagged catch from ingest.',
    });
    assert.equal(presented.catchSummary, 'Publisher-flagged catch from ingest.');
  });

  test('a clean record derives null rather than inventing a catch', () => {
    const presented = presentListing({
      id: 'clean:1',
      source: 'treasury',
      state: 'FL',
      address: '3 Clean Way, Tampa, FL',
      openingBid: 100000,
      estLow: 200000,
      estHigh: 250000,
      saleDate: '2027-01-15',
      occupancy: 'unoccupied',
      deposit: 'certified funds',
      redemptionDays: 0,
      seniorLienRisk: 'low',
    });
    assert.equal(presented.catchSummary, null);
  });

  test('never reads the raw notice to build a catch', () => {
    const presented = presentListing({
      id: 'raw:1',
      source: 'treasury',
      state: 'FL',
      address: '4 Raw Way, Tampa, FL',
      openingBid: 100000,
      saleDate: '2027-01-15',
      raw: 'SHERIFF\'S SALE NOTICE — 200 pages of statutory text '.repeat(20),
    });
    assert.ok(presented.catchSummary === null || typeof presented.catchSummary === 'string');
    assert.ok(!String(presented.catchSummary).includes('SHERIFF'));
  });
});