'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateListingAgainstHunt,
  evaluateListingAcrossHunts,
  generateHuntWebhookPayload,
  generateHuntEmailDigest,
  deliverHuntDigest,
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

test('webhook posts hunt changes only to a resolved public https address', async () => {
  const { notifyHuntWebhook, postWebhook } = require('../server/delivery/webhook-notify');
  const publicLookup = async () => [{ address: '1.1.1.1', family: 4 }];
  const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];
  const calls = [];
  const hunt = { id: 'hunt_1', name: 'Ohio', webhookUrl: 'https://alerts.example.com/hook' };
  const evaluation = {
    evaluatedAt: '2026-10-10T00:00:00.000Z',
    baselineCreated: false,
    counts: { newMatch: 1, materialChange: 0 },
    newEvents: [{
      id: 'hevt_1',
      type: 'new_match',
      listingId: 'L1',
      address: '1 Main',
      sourceId: 'hud',
      sourceUrl: 'https://www.hudhomestore.gov/listing',
      observedAt: '2026-10-10T00:00:00.000Z',
      message: 'A validated source record now matches this hunt.',
    }],
  };
  const sent = await notifyHuntWebhook(hunt, evaluation, {
    lookup: publicLookup,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 204 };
    },
  });
  assert.equal(sent.sent, true);
  assert.equal(sent.delivery, 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'manual');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.event, 'hunt.changes');
  assert.equal(body.changes[0].listingId, 'L1');
  assert.equal(body.changes[0].address, '1 Main');
  assert.equal(Object.hasOwn(body.changes[0], 'openingBid'), false);

  const baseline = await notifyHuntWebhook(hunt, { ...evaluation, baselineCreated: true }, {
    lookup: publicLookup,
    fetchImpl: async () => { throw new Error('baseline must not post'); },
  });
  assert.equal(baseline.delivery, 'skipped');
  assert.equal(baseline.reason, 'baseline');

  const local = await postWebhook('https://127.0.0.1/hook', { event: 'x' }, {
    lookup: publicLookup,
    fetchImpl: async () => { throw new Error('loopback must not post'); },
  });
  assert.equal(local.delivery, 'refused');
  assert.equal(local.reason, 'private_host');

  const httpUrl = await postWebhook('http://alerts.example.com/hook', { event: 'x' }, {
    lookup: publicLookup,
    fetchImpl: async () => { throw new Error('http must not post'); },
  });
  assert.equal(httpUrl.reason, 'https_required');

  const resolved = await postWebhook('https://alerts.example.com/hook', { event: 'x' }, {
    lookup: privateLookup,
    fetchImpl: async () => { throw new Error('private dns must not post'); },
  });
  assert.equal(resolved.reason, 'private_resolution');

  const redirect = await postWebhook('https://alerts.example.com/hook', { event: 'x' }, {
    lookup: publicLookup,
    fetchImpl: async () => ({ status: 302 }),
  });
  assert.equal(redirect.sent, false);
  assert.equal(redirect.reason, 'redirect_refused');
});

test('Hunt digest refuses a missing or placeholder recipient', async () => {
  const missing = generateHuntEmailDigest({ id: 'HUNT-NONE', label: 'No address' }, []);
  assert.equal(missing.to, null);
  const placeholder = generateHuntEmailDigest({ id: 'HUNT-PH', subscriberEmail: 'operator@propertycrawl.com' }, []);
  assert.equal(placeholder.to, null);
  const delivered = await deliverHuntDigest(missing, {
    fetchImpl: async () => { throw new Error('network'); },
  });
  assert.equal(delivered.sent, false);
  assert.equal(delivered.delivery, 'unavailable');
});
