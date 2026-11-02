'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  formatCurrency,
  evaluatePriceDrop,
  generateInvestorDigestReport,
  dispatchInvestorAlertDigest,
} = require('../../server/delivery/alert-digest');

test('Alert Digest: formatCurrency correctly formats numbers and handles nulls', () => {
  assert.equal(formatCurrency(150000), '$150,000');
  assert.equal(formatCurrency(0), '$0');
  assert.equal(formatCurrency(null), 'Not published');
  assert.equal(formatCurrency(undefined), 'Not published');
  assert.equal(formatCurrency('invalid'), 'Not published');
});

test('Alert Digest: evaluatePriceDrop identifies genuine opening bid reductions', () => {
  const listing = { id: 'TX-1', address: '100 Main St', openingBid: 85000 };
  const baseline = { openingBid: 100000 };

  const drop = evaluatePriceDrop(listing, baseline);
  assert.ok(drop);
  assert.equal(drop.listingId, 'TX-1');
  assert.equal(drop.previousBid, 100000);
  assert.equal(drop.currentBid, 85000);
  assert.equal(drop.dropAmount, 15000);
  assert.equal(drop.dropPct, 15);
  assert.equal(drop.reconsiderationTrigger, true);

  // Equal or higher bid should not trigger a price drop
  assert.equal(evaluatePriceDrop({ openingBid: 100000 }, baseline), null);
  assert.equal(evaluatePriceDrop({ openingBid: 120000 }, baseline), null);
  assert.equal(evaluatePriceDrop({ openingBid: null }, baseline), null);
});

test('Alert Digest: generateInvestorDigestReport formats responsive Markdown and HTML tables', () => {
  const sampleHunt = {
    id: 'HUNT-OHIO-UNDERWRITE',
    name: 'Cuyahoga Sub-$100k Deals',
    version: 1,
  };

  const sampleListings = [
    {
      id: 'OH-CUY-001',
      address: '4502 Clark Ave',
      city: 'Cleveland',
      state: 'OH',
      county: 'Cuyahoga',
      openingBid: 42000,
      dealScore: 84,
      saleDate: '2026-11-20',
    },
    {
      id: 'OH-CUY-002',
      address: '11204 Detroit Ave',
      city: 'Cleveland',
      state: 'OH',
      county: 'Cuyahoga',
      openingBid: 68000,
      dealScore: 76,
      saleDate: '2026-11-22',
    },
  ];

  const sampleEvaluation = {
    evaluatedAt: '2026-11-02T10:00:00.000Z',
    results: [
      { identityKey: 'key-1', listingId: 'OH-CUY-001', status: 'match' },
      { identityKey: 'key-2', listingId: 'OH-CUY-002', status: 'match' },
    ],
    baseline: {
      records: {
        'key-1': { openingBid: 50000 }, // dropped from 50k to 42k
      },
    },
  };

  const report = generateInvestorDigestReport({
    hunt: sampleHunt,
    evaluation: sampleEvaluation,
    listings: sampleListings,
    options: { appUrl: 'https://perfectproperty.org' },
  });

  assert.equal(report.huntId, 'HUNT-OHIO-UNDERWRITE');
  assert.equal(report.matchedCount, 2);
  assert.equal(report.priceDropsCount, 1);
  assert.equal(report.priceDrops[0].dropPct, 16);

  // Verify Markdown contents
  assert.match(report.markdown, /# Institutional Deal Alert Digest: Cuyahoga Sub-\$100k Deals/);
  assert.match(report.markdown, /4502 Clark Ave/);
  assert.match(report.markdown, /\$42,000/);
  assert.match(report.markdown, /84\/99/);
  assert.match(report.markdown, /Price Drop & Reconsideration Triggers/);
  assert.match(report.markdown, /Zero-Fabrication Underwriting Notice/);

  // Verify HTML contents
  assert.match(report.html, /Hunt Digest/);
  assert.match(report.html, /2 Matches for &quot;Cuyahoga Sub-\$100k Deals&quot;/);
  assert.match(report.html, /4502 Clark Ave/);
  assert.match(report.html, /11204 Detroit Ave/);
  assert.match(report.html, /Opening Bid Price Drops Detected/);
});

test('Alert Digest: dispatchInvestorAlertDigest fails closed when RESEND_API_KEY is unset', async () => {
  const sampleHunt = { id: 'HUNT-1', name: 'Test Hunt' };
  const sampleEvaluation = {
    results: [{ listingId: 'L-1', status: 'match' }],
  };
  const listings = [{ id: 'L-1', address: '123 Test St', openingBid: 50000 }];

  const result = await dispatchInvestorAlertDigest({
    recipient: 'investor@fund.com',
    hunt: sampleHunt,
    evaluation: sampleEvaluation,
    listings,
    options: { env: { RESEND_API_KEY: '' } },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'RESEND_API_KEY_UNSET');
  assert.equal(result.dryRun, true);
  assert.ok(result.report);
  assert.equal(result.report.matchedCount, 1);
});

test('Alert Digest: dispatchInvestorAlertDigest forwards rich HTML report when apiKey is present', async () => {
  const sampleHunt = { id: 'HUNT-FL', name: 'Florida REO Hunt' };
  const sampleEvaluation = {
    results: [{ listingId: 'FL-1', status: 'match' }],
  };
  const listings = [{ id: 'FL-1', address: '500 Ocean Dr', openingBid: 125000, state: 'FL', city: 'Miami' }];

  let sentPayload = null;
  const mockFetch = async (url, opts) => {
    sentPayload = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ id: 'email_digest_9988' }),
    };
  };

  const result = await dispatchInvestorAlertDigest({
    recipient: 'acquisitions@realestate.com',
    hunt: sampleHunt,
    evaluation: sampleEvaluation,
    listings,
    options: {
      apiKey: 're_test_mock_123',
      fetchFn: mockFetch,
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.id, 'email_digest_9988');
  assert.ok(sentPayload);
  assert.deepEqual(sentPayload.to, ['acquisitions@realestate.com']);
  assert.match(sentPayload.subject, /Deal Alert Digest: Florida REO Hunt/);
  assert.match(sentPayload.html, /500 Ocean Dr/);
  assert.match(sentPayload.html, /\$125,000/);
});
