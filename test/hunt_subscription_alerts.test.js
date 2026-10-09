'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateListingAgainstHunt,
  evaluateListingAcrossHunts,
  generateHuntWebhookPayload,
  generateHuntEmailDigest
} = require('../server/intelligence/hunt-evaluator');

test('Hunt Evaluator: matches listings satisfying criteria and extracts reasons', () => {
  const hunt = {
    id: 'HUNT-OH-CUYAHOGA',
    label: 'Cuyahoga Sub-60k Foreclosures',
    filters: {
      states: ['OH'],
      maxBid: 60000,
      minScore: 70
    }
  };

  const matchingListing = {
    id: 'SHERIFF-OH-CUY-101',
    address: '1420 W 28th St',
    city: 'Cleveland',
    state: 'OH',
    county: 'Cuyahoga',
    openingBid: 45000,
    dealScore: 82,
    source: 'sheriff'
  };

  const res = evaluateListingAgainstHunt(matchingListing, hunt);
  assert.equal(res.isMatch, true);
  assert.ok(res.matchedCriteria.some((c) => c.includes('state=OH')));
  assert.ok(res.matchedCriteria.some((c) => c.includes('openingBid<=60000')));
  assert.ok(res.matchedCriteria.some((c) => c.includes('dealScore>=70')));

  // Non-matching listing (price too high)
  const expensiveListing = {
    ...matchingListing,
    id: 'SHERIFF-OH-CUY-102',
    openingBid: 85000
  };

  const resExpensive = evaluateListingAgainstHunt(expensiveListing, hunt);
  assert.equal(resExpensive.isMatch, false);
});

test('Hunt Evaluator: evaluates across fleet of active operator hunts', () => {
  const hunts = [
    { id: 'H1', label: 'Ohio Sheriff', filters: { states: ['OH'] } },
    { id: 'H2', label: 'Texas Deeds', filters: { states: ['TX'] } },
    { id: 'H3', label: 'Low Opening Bids', filters: { maxBid: 50000 } }
  ];

  const listing = {
    id: 'TEST-100',
    address: '500 Main St',
    state: 'OH',
    openingBid: 35000,
    dealScore: 78,
    source: 'sheriff'
  };

  const alerts = evaluateListingAcrossHunts(listing, hunts);
  assert.equal(alerts.length, 2, 'Should match H1 (Ohio) and H3 (Low Bid), but not H2 (Texas)');
  assert.equal(alerts[0].huntId, 'H1');
  assert.equal(alerts[1].huntId, 'H3');
  assert.equal(alerts[0].isRead, false);
});

test('Hunt Evaluator: generates compliant Webhook payload', () => {
  const hunt = { id: 'HUNT-FL', label: 'Florida REO Hunt' };
  const listing = {
    id: 'HUD-FL-ORL-99',
    address: '100 Orange Ave',
    city: 'Orlando',
    state: 'FL',
    openingBid: 120000,
    dealScore: 80,
    source: 'hud'
  };

  const payload = generateHuntWebhookPayload(hunt, listing, ['state=FL', 'dealScore>=75']);
  assert.equal(payload.event, 'hunt.listing_matched');
  assert.equal(payload.hunt.id, 'HUNT-FL');
  assert.equal(payload.listing.id, 'HUD-FL-ORL-99');
  assert.ok(payload.eventId.startsWith('EVT-'));
  assert.deepEqual(payload.matchedCriteria, ['state=FL', 'dealScore>=75']);
});

test('Hunt Evaluator: formats transactional email digest notification', () => {
  const hunt = {
    id: 'HUNT-OH',
    label: 'Cuyahoga Steals',
    subscriberEmail: 'acquisitions@realestatefund.com'
  };

  const listings = [
    { address: '123 Elm St', city: 'Cleveland', state: 'OH', openingBid: 40000, dealScore: 85 },
    { address: '456 Oak Rd', city: 'Akron', state: 'OH', openingBid: 32000, dealScore: 79 }
  ];

  const digest = generateHuntEmailDigest(hunt, listings);
  assert.equal(digest.to, 'acquisitions@realestatefund.com');
  assert.match(digest.subject, /Found 2 New Distressed Property Opportunities/);
  assert.match(digest.text, /123 Elm St/);
  assert.match(digest.text, /456 Oak Rd/);
  assert.equal(digest.matchCount, 2);
});
