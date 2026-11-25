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

test('Alert Digest: generateInvestorDigestReport escapes HTML XSS and strips subject newlines', async () => {
  const report = generateInvestorDigestReport({
    hunt: { id: 'HUNT-XSS', name: 'Evil <script>alert(1)</script> Hunt' },
    evaluation: {
      evaluatedAt: '2026-11-02T10:00:00.000Z',
      results: [{ identityKey: 'k1', listingId: 'L-XSS', status: 'match' }],
      baseline: { records: { k1: { snapshot: { openingBid: 100000 } } } },
    },
    listings: [{
      id: 'L-XSS',
      address: '<img src=x onerror=alert(2)> 100 Main',
      county: '<b>Bad</b>',
      state: 'OH',
      openingBid: 80000,
      dealScore: 'not-a-number',
    }],
  });
  assert.equal(report.html.includes('<script>'), false);
  assert.equal(report.html.includes('<img src=x'), false);
  assert.equal(report.html.includes('<b>Bad</b>'), false);
  assert.equal(report.html.includes('NaN/99'), false);
  assert.match(report.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(report.priceDropsCount, 1);

  let sentPayload = null;
  await dispatchInvestorAlertDigest({
    recipient: 'member@example.com',
    hunt: { id: 'HUNT-CRLF', name: "Line1\r\nBcc: evil@attacker.com" },
    evaluation: { results: [{ identityKey: 'k1', listingId: 'L-XSS', status: 'match' }] },
    listings: [{ id: 'L-XSS', address: '100 Main', openingBid: 80000 }],
    options: {
      apiKey: 're_test_123',
      fetchFn: async (_url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ id: 'email_1' }) };
      },
    },
  });
  assert.equal(/[\r\n]/.test(sentPayload.subject), false);
});

test('Alert Digest: runAllHuntDigests loads filePath store, uses previousBaseline, routes to hunt.notifyEmail, skips disabled/unconfigured, and avoids repeat spam', async () => {
  const os = require('node:os');
  const hunts = require('../../server/intelligence/hunts');
  const { runAllHuntDigests } = require('../../server/delivery/alert-digest');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-file-'));
  const filePath = path.join(dir, 'hunts.json');

  try {
    const memberHunt = hunts.createHunt({
      name: 'Member OH Hunt',
      enabled: true,
      notifyEmail: 'member@buyer.io',
      criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'OH' }] },
    }, { filePath, now: '2026-11-01T00:00:00.000Z' });
    hunts.createHunt({
      name: 'Paused Hunt',
      enabled: false,
      notifyEmail: 'paused@buyer.io',
      criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'OH' }] },
    }, { filePath, now: '2026-11-01T00:00:00.000Z' });
    hunts.createHunt({
      name: 'Unconfigured Hunt',
      enabled: true,
      criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'OH' }] },
    }, { filePath, now: '2026-11-01T00:00:00.000Z' });

    const makeListing = (bid, observedAt) => ({
      id: 'CIV-OH-1',
      source: 'civilview',
      state: 'OH',
      county: 'Cuyahoga',
      city: 'Cleveland',
      address: '100 Euclid Ave, Cleveland, OH',
      openingBid: bid,
      saleDate: '2026-12-01',
      raw: 'Official Ohio sheriff sale notice for 100 Euclid Ave.',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1',
      sourceObservedAt: observedAt,
      provenance: {
        origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView',
        recordId: '1', observedAt,
      },
    });

    const sentEmails = [];
    const fetchFn = async (_url, opts) => {
      sentEmails.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: `email_${sentEmails.length}` }) };
    };

    // Run 1: initial baseline created, sends to member@buyer.io (not dropped when operatorEmail unset), skips paused & unconfigured
    const run1 = await runAllHuntDigests({
      listings: [makeListing(100000, '2026-11-01T10:00:00.000Z')],
      options: { filePath, now: '2026-11-01T12:00:00.000Z', apiKey: 're_test', fetchFn },
    });
    assert.equal(run1.totalHunts, 3);
    assert.equal(run1.digestsDispatched, 1);
    assert.deepEqual(sentEmails[0].to, ['member@buyer.io']);
    assert.equal(run1.results.find((r) => r.huntName === 'Paused Hunt').skipped, true);
    assert.equal(run1.results.find((r) => r.huntName === 'Paused Hunt').reason, 'HUNT_DISABLED');
    assert.equal(run1.results.find((r) => r.huntName === 'Unconfigured Hunt').dispatchResult.reason, 'NO_RECIPIENT');

    // Run 2: unchanged listing -> NO spam
    const run2 = await runAllHuntDigests({
      listings: [makeListing(100000, '2026-11-01T10:00:00.000Z')],
      options: { filePath, now: '2026-11-01T18:00:00.000Z', apiKey: 're_test', fetchFn },
    });
    assert.equal(run2.digestsDispatched, 0);
    assert.equal(run2.results.find((r) => r.huntId === memberHunt.id).dispatchResult.reason, 'NO_NEW_CHANGES');

    // Run 3: bid dropped from 100k -> 80k -> previousBaseline loaded, price drop detected, email sent
    const run3 = await runAllHuntDigests({
      listings: [makeListing(80000, '2026-11-02T10:00:00.000Z')],
      options: { filePath, now: '2026-11-02T12:00:00.000Z', apiKey: 're_test', fetchFn },
    });
    assert.equal(run3.digestsDispatched, 1);
    assert.equal(run3.results.find((r) => r.huntId === memberHunt.id).priceDropsCount, 1);
    assert.equal(run3.totalPriceDrops, 2);
    assert.match(sentEmails[1].html, /20%/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Alert Digest: runAllHuntDigests supports PgHuntStore / durableStore and scrapers dispatch-digests forwards database and env', async () => {
  const { runAllHuntDigests } = require('../../server/delivery/alert-digest');
  const { createScrapersHandler } = require('../../server/routes/scrapers');
  const savedCalls = [];
  const hunt = {
    id: 'hunt_aaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Durable Member Hunt',
    enabled: true,
    version: 1,
    notifyEmail: 'durable-member@fund.io',
    criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'OH' }] },
  };
  const listing = {
    id: 'CIV-OH-99',
    source: 'civilview',
    state: 'OH',
    county: 'Cuyahoga',
    city: 'Cleveland',
    address: '99 Superior Ave, Cleveland, OH',
    openingBid: 75000,
    saleDate: '2026-12-01',
    raw: 'Official Ohio sheriff sale notice for 99 Superior Ave.',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99',
    sourceObservedAt: '2026-11-02T10:00:00.000Z',
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView',
      recordId: '99', observedAt: '2026-11-02T10:00:00.000Z',
    },
  };
  let baselineLookups = 0;
  const durableStore = {
    async list() { return [hunt]; },
    async baseline(id) {
      baselineLookups++;
      return {
        huntVersion: 1,
        records: {
          [require('../../server/intelligence/hunts').identityKey('civilview', '99')]: {
            identityKey: require('../../server/intelligence/hunts').identityKey('civilview', '99'),
            listingId: 'CIV-OH-99',
            sourceId: 'civilview',
            recordId: '99',
            observedAt: '2026-11-01T10:00:00.000Z',
            status: 'match',
            snapshot: { openingBid: 100000 },
            valueHash: 'old',
            evaluationHash: 'old',
            clauseResults: [],
          },
        },
      };
    },
    async saveEvaluation(h, evaluated) {
      savedCalls.push({ huntId: h.id, events: evaluated.events.length });
      return evaluated.response;
    },
  };

  const sent = [];
  const report = await runAllHuntDigests({
    listings: [listing],
    options: {
      durableStore,
      now: '2026-11-02T12:00:00.000Z',
      apiKey: 're_test',
      fetchFn: async (_url, opts) => {
        sent.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ id: 'email_pg_1' }) };
      },
    },
  });
  assert.equal(baselineLookups, 1);
  assert.equal(savedCalls.length, 1);
  assert.equal(savedCalls[0].events, 1);
  assert.equal(report.totalPriceDrops, 1);
  assert.equal(report.digestsDispatched, 1);
  assert.deepEqual(sent[0].to, ['durable-member@fund.io']);

  // Also check scrapers route action=dispatch-digests passes durableStore/database/env
  const handler = createScrapersHandler({
    database: { isPg: false, getListings: async () => ({ listings: [listing] }) },
    durableStore,
    env: { SCRAPER_ADMIN_TOKEN: 'tok', RESEND_API_KEY: '' },
  });
  let statusCode = 200;
  let body = null;
  await handler(
    {
      method: 'POST',
      url: '/api/scrapers/run?action=dispatch-digests',
      headers: { authorization: 'Bearer tok' },
      body: {},
    },
    {
      setHeader() {},
      status(c) { statusCode = c; return this; },
      json(v) { body = v; return v; },
    },
  );
  assert.equal(statusCode, 200);
  assert.equal(body.action, 'dispatch-digests');
  assert.equal(body.report.totalHunts, 1);
  assert.equal(baselineLookups, 2);
});


test('Alert Digest: runCountyAlertDigests strictly skips unverified subscriptions and dispatches only verified:true via dispatch-digests', async () => {
  const { runCountyAlertDigests } = require('../../server/delivery/alert-digest');
  const { createScrapersHandler } = require('../../server/routes/scrapers');

  const recordedMatches = [];
  const searches = [
    {
      id: 'sub_unverified_false',
      userId: 'device:guest_1',
      label: 'Travis, TX Digest',
      isActive: true,
      filters: {
        states: ['TX'],
        counties: ['travis'],
        notifyEmail: 'unverified@example.com',
        verified: false,
      },
    },
    {
      id: 'sub_unverified_string',
      userId: 'device:guest_2',
      label: 'Travis, TX Digest',
      isActive: true,
      filters: {
        states: ['TX'],
        counties: ['travis'],
        notifyEmail: 'stringtrue@example.com',
        verified: 'true',
      },
    },
    {
      id: 'sub_verified',
      userId: 'device:guest_3',
      label: 'Travis, TX Digest',
      isActive: true,
      filters: {
        states: ['TX'],
        counties: ['travis'],
        notifyEmail: 'verified@example.com',
        verified: true,
      },
    },
  ];

  const stubDb = {
    isPg: false,
    async getListings() { return { listings: [txListing] }; },
    async listSavedSearchUserIds() {
      return [...new Set(searches.map((s) => s.userId))];
    },
    async listSavedSearches(userId) {
      return searches.filter((s) => s.userId === userId && s.isActive);
    },
    async recordAlertMatches(userId, searchId, listingIds) {
      const out = listingIds.map((listingId) => ({ userId, searchId, listingId }));
      recordedMatches.push(...out);
      return out;
    },
  };

  const txListing = {
    id: 'TX-TRAVIS-77',
    source: 'sheriff',
    state: 'TX',
    county: 'Travis',
    city: 'Austin',
    address: '77 Congress Ave, Austin, TX',
    openingBid: 185000,
    dealScore: 83,
    saleDate: '2026-12-15',
  };

  const sentPayloads = [];
  const report = await runCountyAlertDigests({
    listings: [txListing],
    options: {
      database: stubDb,
      apiKey: 're_test_county_digest',
      fetchFn: async (_url, opts) => {
        sentPayloads.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ id: 'email_verified_1' }) };
      },
    },
  });

  assert.equal(report.totalSubscriptions, 3);
  assert.equal(report.skippedUnverified, 2);
  assert.equal(report.verifiedSubscriptions, 1);
  assert.equal(report.digestsDispatched, 1);
  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads[0].to, ['verified@example.com']);
  assert.equal(recordedMatches.length, 1);
  assert.equal(recordedMatches[0].searchId, 'sub_verified');

  // Verify scrapers action=dispatch-digests includes countyAlerts in report
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-scrapers-county-'));
  try {
    const handler = createScrapersHandler({
      database: stubDb,
      filePath: path.join(dir, 'hunts.json'),
      env: { SCRAPER_ADMIN_TOKEN: 'tok', RESEND_API_KEY: '' },
    });
    let statusCode = 200;
    let body = null;
    await handler(
      {
        method: 'POST',
        url: '/api/scrapers/run?action=dispatch-digests',
        headers: { authorization: 'Bearer tok' },
        body: {},
      },
      {
        setHeader() {},
        status(c) { statusCode = c; return this; },
        json(v) { body = v; return v; },
      },
    );
    assert.equal(statusCode, 200);
    assert.ok(body.report.countyAlerts);
    assert.equal(body.report.countyAlerts.totalSubscriptions, 3);
    assert.equal(body.report.countyAlerts.skippedUnverified, 2);
    assert.equal(body.report.countyAlerts.verifiedSubscriptions, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Alert Digest: dispatch-digests scans >1000 listings, uses [PerfectProperty], and enforces cadence & entitlement', async () => {
  const { runAllHuntDigests, runCountyAlertDigests } = require('../../server/delivery/alert-digest');
  const { createScrapersHandler } = require('../../server/routes/scrapers');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-wave1c-'));
  try {
    // 1. >1,000 listings scan via action=dispatch-digests
    const totalListings = 1250;
    const allListings = Array.from({ length: totalListings }, (_, idx) => ({
      id: `L-${idx}`,
      source: 'civilview',
      state: idx === 1200 ? 'NV' : 'CA',
      county: idx === 1200 ? 'Clark' : 'Los Angeles',
      address: `${100 + idx} Test Way`,
      openingBid: 50000,
      dealScore: 80,
      saleDate: '2026-12-20',
      raw: 'Official sheriff sale notice for 100 Test Way.',
      sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${idx}`,
      sourceObservedAt: '2026-11-25T00:00:00.000Z',
      provenance: { origin: 'live', observed: true, recordKind: 'source_record', publisher: 'Treasury', recordId: String(idx), observedAt: '2026-11-25T00:00:00.000Z' },
    }));
    const pagedDb = {
      isPg: false,
      async getListings({ limit = 1000, offset = 0 } = {}) {
        return { total: allListings.length, listings: allListings.slice(offset, offset + limit) };
      },
      async listSavedSearchUserIds() { return ['device:d1']; },
      async listSavedSearches() {
        return [{
          id: 'sub_nv',
          userId: 'device:d1',
          label: 'Clark NV',
          isActive: true,
          filters: { states: ['NV'], counties: ['clark'], notifyEmail: 'nv@example.com', verified: true, cadence: 'daily' },
        }];
      },
      async recordAlertMatches(_u, _s, ids) { return ids.map((listingId) => ({ listingId })); },
    };
    const sent = [];
    const handler = createScrapersHandler({
      database: pagedDb,
      filePath: path.join(dir, 'hunts.json'),
      env: { SCRAPER_ADMIN_TOKEN: 'tok', RESEND_API_KEY: '' },
    });
    let statusCode = 200;
    let body = null;
    await handler(
      { method: 'POST', url: '/api/scrapers/run?action=dispatch-digests', headers: { authorization: 'Bearer tok' }, body: {} },
      { setHeader() {}, status(c) { statusCode = c; return this; }, json(v) { body = v; return v; } },
    );
    assert.equal(statusCode, 200);
    assert.equal(body.report.countyAlerts.totalMatches, 1, 'listing at index 1200 must be scanned and matched');

    // 2. [PerfectProperty] subject prefix + cadence cooldown + entitlement gate
    const fetchFn = async (_url, opts) => {
      sent.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: `mail_${sent.length}` }) };
    };
    const accounts = {
      async get(id) {
        if (id === 'acct_entitled_111111111111111111111111') return { id, entitled: true };
        return { id, entitled: false };
      },
    };
    const durableHunts = [
      {
        id: 'hunt_111111111111111111111111',
        name: 'Entitled Hunt',
        enabled: true,
        version: 1,
        owner: 'acct_entitled_111111111111111111111111',
        notifyEmail: 'pro@example.com',
        cadence: 'daily',
        lastDigestAt: '2026-11-24T00:00:00.000Z',
        criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NV' }] },
      },
      {
        id: 'hunt_222222222222222222222222',
        name: 'Canceled Hunt',
        enabled: true,
        version: 1,
        owner: 'acct_canceled_222222222222222222222222',
        notifyEmail: 'canceled@example.com',
        cadence: 'daily',
        criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NV' }] },
      },
      {
        id: 'hunt_333333333333333333333333',
        name: 'Cooldown Hunt',
        enabled: true,
        version: 1,
        owner: 'acct_entitled_111111111111111111111111',
        notifyEmail: 'cooldown@example.com',
        cadence: 'daily',
        lastDigestAt: '2026-11-25T10:00:00.000Z',
        criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NV' }] },
      },
    ];
    const durableStore = {
      async list() { return durableHunts; },
      async baseline() { return null; },
      async saveEvaluation(_hunt, evaluated) { return evaluated.response; },
    };
    const huntReport = await runAllHuntDigests({
      listings: [allListings[1200]],
      options: {
        durableStore,
        accounts,
        now: '2026-11-25T12:00:00.000Z',
        apiKey: 're_test',
        fetchFn,
        includeCountyAlerts: false,
      },
    });
    assert.equal(huntReport.digestsDispatched, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /^\[PerfectProperty\]/);
    assert.equal(huntReport.results.find((r) => r.huntId === 'hunt_222222222222222222222222').reason, 'ACCOUNT_NOT_ENTITLED');
    assert.equal(huntReport.results.find((r) => r.huntId === 'hunt_333333333333333333333333').reason, 'CADENCE_COOLDOWN');

    const countyCooldown = await runCountyAlertDigests({
      listings: [allListings[1200]],
      options: {
        now: '2026-11-25T12:00:00.000Z',
        accounts,
        database: {
          async listSavedSearchUserIds() { return ['device:d1', 'account:acct_canceled_222222222222222222222222']; },
          async listSavedSearches(uid) {
            return [{
              id: `sub_${uid}`,
              userId: uid,
              label: 'NV',
              isActive: true,
              filters: {
                states: ['NV'],
                notifyEmail: 'x@example.com',
                verified: true,
                cadence: 'daily',
                lastSentAt: '2026-11-25T10:00:00.000Z',
              },
            }];
          },
        },
        apiKey: 're_test',
        fetchFn,
      },
    });
    assert.equal(countyCooldown.digestsDispatched, 0);
    assert.equal(countyCooldown.results[0].reason, 'CADENCE_COOLDOWN');
    assert.equal(countyCooldown.results[1].reason, 'ACCOUNT_NOT_ENTITLED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
