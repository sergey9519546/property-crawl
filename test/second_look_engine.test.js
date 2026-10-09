'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DISTRESS_STAGES,
  detectLifecycleStage,
  evaluateLifecycleTransition,
} = require('../server/intelligence/distress-lifecycle');

const {
  evaluateSecondLookTriggers,
} = require('../server/intelligence/second-look');

test('detects statutory foreclosure lifecycle stages from text and metadata', () => {
  assert.equal(
    detectLifecycleStage({ status: 'Active' }, 'Notice of sale: 11 U.S.C. § 362 automatic stay entered'),
    DISTRESS_STAGES.STAYED_BANKRUPTCY
  );

  assert.equal(
    detectLifecycleStage({ state: 'NC' }, 'Foreclosure sale held; open for 10-day upset bid under G.S. 45-21.27'),
    DISTRESS_STAGES.SOLD_UPSET_WINDOW
  );

  assert.equal(
    detectLifecycleStage({ saleDate: '11/04/2026' }, 'Sheriff Sale continued to future date; adjourned'),
    DISTRESS_STAGES.ADJOURNED
  );

  assert.equal(
    detectLifecycleStage({ saleDate: '11/04/2026' }, 'Notice of Sheriff Sale of Real Estate'),
    DISTRESS_STAGES.SCHEDULED_AUCTION
  );
});

test('evaluates material lifecycle transition when bankruptcy stay is lifted', () => {
  const prior = {
    lifecycleStage: DISTRESS_STAGES.STAYED_BANKRUPTCY,
    openingBid: 120000,
  };

  const fresh = {
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    openingBid: 120000,
  };

  const transition = evaluateLifecycleTransition(prior, fresh);
  assert.equal(transition.isMaterialChange, true);
  assert.ok(transition.changes.some((c) => c.type === 'BANKRUPTCY_STAY_LIFTED'));
});

test('evaluates material lifecycle transition on opening bid reductions', () => {
  const prior = {
    openingBid: 100000,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const fresh = {
    openingBid: 75000,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const transition = evaluateLifecycleTransition(prior, fresh);
  assert.equal(transition.isMaterialChange, true);

  const priceChange = transition.changes.find((c) => c.type === 'PRICE_REDUCED');
  assert.ok(priceChange);
  assert.equal(priceChange.discountPercent, 25);
  assert.equal(priceChange.from, 100000);
  assert.equal(priceChange.to, 75000);
});

test('second-look triggers re-open passed case when material price drop occurs', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123456',
    state: 'pass',
    listingSnapshot: {
      openingBid: 100000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      openingBid: { mode: 'changed' },
    },
  };

  const freshListing = {
    openingBid: 80000,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, true);
  assert.equal(evaluation.recommendedState, 'inbox');
  assert.match(evaluation.primaryReason, /Opening bid reduced/);
});

test('second-look triggers fire when bankruptcy stay lifts on passed case', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123457',
    state: 'pass',
    listingSnapshot: {
      lifecycleStage: DISTRESS_STAGES.STAYED_BANKRUPTCY,
    },
  };

  const freshListing = {
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    saleDate: '12/10/2026',
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, true);
  assert.match(evaluation.primaryReason, /Bankruptcy stay was lifted/);
});

test('second-look does NOT trigger when no material facts change', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123458',
    state: 'pass',
    listingSnapshot: {
      openingBid: 100000,
      saleDate: '11/04/2026',
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
  };

  const freshListing = {
    openingBid: 100000,
    saleDate: '11/04/2026',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, false);
});
