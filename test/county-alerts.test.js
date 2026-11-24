'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PROPERTY_WORKSPACE_ID = process.env.PROPERTY_WORKSPACE_ID || 'operator';
process.env.SCRAPER_ADMIN_TOKEN = process.env.SCRAPER_ADMIN_TOKEN || 'test-secret'; process.env.PROPERTY_INVENTORY_BACKEND = process.env.PROPERTY_INVENTORY_BACKEND || 'memory';

const { validateFilters } = require('../server/routes/saved-searches');
const {
  matchListingAgainstSearch,
  hasAnyFilter,
  _internals: { normalizedCounties }
} = require('../server/intelligence/saved-search-alerts');
const handleAlerts = require('../server/routes/alerts');
const db = require('../server/db/client');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

function makeReq(method = 'GET', url = '/api/alerts', body = null) {
  return {
    method,
    url,
    headers: {
      cookie: 'pp_watchlist=test_device_12345',
      authorization: 'Bearer test-secret'
    },
    body
  };
}

test('validateFilters: accepts valid county arrays and rejects invalid shapes', () => {
  // Valid county arrays
  assert.deepEqual(validateFilters({ counties: ['Travis'] }), { ok: true });
  assert.deepEqual(validateFilters({ counties: ['Travis', 'Harris', 'Miami-Dade'] }), { ok: true });
  assert.deepEqual(validateFilters({ counties: [] }), { ok: true });

  // Invalid shapes
  assert.deepEqual(validateFilters({ counties: 'Travis' }), {
    ok: false,
    reason: 'counties_must_be_array_of_strings'
  });
  assert.deepEqual(validateFilters({ counties: [123] }), {
    ok: false,
    reason: 'counties_must_be_array_of_strings'
  });
  assert.deepEqual(validateFilters({ counties: [''] }), {
    ok: false,
    reason: 'counties_must_be_array_of_strings'
  });
  assert.deepEqual(validateFilters({ counties: ['   '] }), {
    ok: false,
    reason: 'counties_must_be_array_of_strings'
  });
  assert.deepEqual(validateFilters({ counties: ['A'.repeat(65)] }), {
    ok: false,
    reason: 'counties_must_be_array_of_strings'
  });
  assert.deepEqual(validateFilters({ counties: null }), {
    ok: false,
    reason: 'counties_must_be_array_of_strings'
  });
});

test('saved-search-alerts: normalizedCounties helper trims, deduplicates, and lowercases', () => {
  assert.equal(normalizedCounties({}), null);
  assert.equal(normalizedCounties({ counties: [] }), null);
  assert.equal(normalizedCounties({ counties: 'not-array' }), null);
  assert.deepEqual(
    normalizedCounties({ counties: [' Travis ', 'TRAVIS', 'harris'] }),
    ['travis', 'harris']
  );
  // Nested filters support
  assert.deepEqual(
    normalizedCounties({ filters: { counties: ['Miami-Dade'] } }),
    ['miami-dade']
  );
});

test('hasAnyFilter: recognizes counties filter as a valid constraint', () => {
  assert.equal(hasAnyFilter({}), false);
  assert.equal(hasAnyFilter({ counties: [] }), false);
  assert.equal(hasAnyFilter({ counties: ['Travis'] }), true);
  assert.equal(hasAnyFilter({ filters: { counties: ['Travis'] } }), true);
});

test('matchListingAgainstSearch: evaluates counties filter correctly', () => {
  const search = {
    filters: {
      counties: ['Travis', 'Williamson']
    }
  };

  // Positive match
  const matchingListing = {
    id: 'L-1',
    address: '100 Main St',
    county: 'Travis',
    dealScore: 75
  };
  assert.deepEqual(matchListingAgainstSearch(matchingListing, search), { match: true });

  // Case-insensitive & trimmed positive match
  const matchingListingCase = {
    id: 'L-2',
    address: '200 Oak Ave',
    county: '  williamson  ',
    dealScore: 75
  };
  assert.deepEqual(matchListingAgainstSearch(matchingListingCase, search), { match: true });

  // County mismatch
  const mismatchListing = {
    id: 'L-3',
    address: '300 Pine Rd',
    county: 'Harris',
    dealScore: 75
  };
  assert.deepEqual(matchListingAgainstSearch(mismatchListing, search), {
    match: false,
    reason: 'county_mismatch'
  });

  // Missing county on listing
  const missingCountyListing = {
    id: 'L-4',
    address: '400 Elm St',
    dealScore: 75
  };
  assert.deepEqual(matchListingAgainstSearch(missingCountyListing, search), {
    match: false,
    reason: 'county_mismatch'
  });

  // Search without county filter does not filter on county
  const searchNoCounty = {
    filters: {
      states: ['TX']
    }
  };
  assert.deepEqual(
    matchListingAgainstSearch({ state: 'TX', county: 'Harris' }, searchNoCounty),
    { match: true }
  );

  // Search with empty county array does not filter on county
  const searchEmptyCounty = {
    filters: {
      states: ['TX'],
      counties: []
    }
  };
  assert.deepEqual(
    matchListingAgainstSearch({ state: 'TX', county: 'Harris' }, searchEmptyCounty),
    { match: true }
  );
});

test('POST /api/alerts (subscribe_county_digest): subscribes to county alert digest successfully', async () => {
  const req = makeReq('POST', '/api/alerts', {
    action: 'subscribe_county_digest',
    email: 'investor@example.com',
    state: 'TX',
    county: 'Travis',
    cadence: 'daily'
  });
  const res = makeRes();

  await handleAlerts(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(typeof res.body.subscriptionId === 'string' && res.body.subscriptionId.length > 0);
  assert.equal(res.body.message, 'Subscribed to Travis, TX alerts');

  // Verify saved search was created in db
  const savedSearch = await db.getSavedSearchById(req.headers ? 'device:test_device_12345' : 'operator', res.body.subscriptionId)
    || (db.inMemoryData && db.inMemoryData.savedSearches.get(res.body.subscriptionId));
  assert.ok(savedSearch);
  assert.deepEqual(savedSearch.filters.states, ['TX']);
  assert.deepEqual(savedSearch.filters.counties, ['travis']);
  assert.equal(savedSearch.filters.email, 'investor@example.com');
  assert.equal(savedSearch.filters.notifyEmail, 'investor@example.com');
  assert.equal(savedSearch.filters.cadence, 'daily');
});

test('POST /api/alerts (subscribe_county_digest): defaults cadence to daily when omitted', async () => {
  const req = makeReq('POST', '/api/alerts', {
    action: 'subscribe_county_digest',
    email: 'buyer@example.com',
    state: 'FL',
    county: 'Miami-Dade'
  });
  const res = makeRes();

  await handleAlerts(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, 'Subscribed to Miami-Dade, FL alerts');

  const savedSearch = await db.getSavedSearchById(req.headers ? 'device:test_device_12345' : 'operator', res.body.subscriptionId)
    || (db.inMemoryData && db.inMemoryData.savedSearches.get(res.body.subscriptionId));
  assert.ok(savedSearch);
  assert.equal(savedSearch.filters.cadence, 'daily');
});

test('POST /api/alerts (subscribe_county_digest): supports instant cadence', async () => {
  const req = makeReq('POST', '/api/alerts', {
    action: 'subscribe_county_digest',
    email: 'rapid@example.com',
    state: 'OH',
    county: 'Cuyahoga',
    cadence: 'instant'
  });
  const res = makeRes();

  await handleAlerts(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  const savedSearch = await db.getSavedSearchById(req.headers ? 'device:test_device_12345' : 'operator', res.body.subscriptionId)
    || (db.inMemoryData && db.inMemoryData.savedSearches.get(res.body.subscriptionId));
  assert.ok(savedSearch);
  assert.equal(savedSearch.filters.cadence, 'instant');
});

test('POST /api/alerts (subscribe_county_digest): validates and rejects invalid email format', async () => {
  const invalidEmails = [
    '',
    'not-an-email',
    'missing-at-domain.com',
    '@nodomain.com',
    'spaces in@email.com',
    'header\rinjection@example.com',
    'header\ninjection@example.com',
    null,
    123
  ];

  for (const email of invalidEmails) {
    const req = makeReq('POST', '/api/alerts', {
      action: 'subscribe_county_digest',
      email,
      state: 'TX',
      county: 'Travis'
    });
    const res = makeRes();

    await handleAlerts(req, res);

    assert.equal(res.statusCode, 400, `Expected 400 for email: ${JSON.stringify(email)}`);
    assert.equal(res.body.error, 'Valid email is required');
  }
});

test('POST /api/alerts (subscribe_county_digest): validates state code', async () => {
  const invalidStates = ['', 'T', 'TEXAS', '12', 'TX1', null, 42];

  for (const state of invalidStates) {
    const req = makeReq('POST', '/api/alerts', {
      action: 'subscribe_county_digest',
      email: 'valid@example.com',
      state,
      county: 'Travis'
    });
    const res = makeRes();

    await handleAlerts(req, res);

    assert.equal(res.statusCode, 400, `Expected 400 for state: ${JSON.stringify(state)}`);
    assert.equal(res.body.error, 'Valid 2-letter state code is required');
  }
});

test('POST /api/alerts (subscribe_county_digest): validates county name', async () => {
  const invalidCounties = ['', '   ', 'A'.repeat(65), null, 999];

  for (const county of invalidCounties) {
    const req = makeReq('POST', '/api/alerts', {
      action: 'subscribe_county_digest',
      email: 'valid@example.com',
      state: 'TX',
      county
    });
    const res = makeRes();

    await handleAlerts(req, res);

    assert.equal(res.statusCode, 400, `Expected 400 for county: ${JSON.stringify(county)}`);
    assert.equal(res.body.error, 'Valid county is required');
  }
});

test('POST /api/alerts (subscribe_county_digest): rejects invalid cadence', async () => {
  const req = makeReq('POST', '/api/alerts', {
    action: 'subscribe_county_digest',
    email: 'valid@example.com',
    state: 'TX',
    county: 'Travis',
    cadence: 'monthly'
  });
  const res = makeRes();

  await handleAlerts(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid cadence; must be instant, daily, or weekly');
});

test('runAlertsForUser: dispatches rich email alert to county subscriber on new matches', async () => {
  const { runAlertsForUser } = require('../server/intelligence/alerts-runner');
  const sentCalls = [];
  const stubMailOptions = {
    env: { RESEND_API_KEY: 're_test_suite_key', RESEND_FROM: 'alerts@perfectproperty.org' },
    fetchImpl: async (url, init) => {
      sentCalls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'email_test_123' }) };
    }
  };

  const uidSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const userId = `device:test_device_subscriber_${uidSuffix}`;
  const createdSearch = await db.createSavedSearch(userId, {
    label: 'Wake, NC Notice Alerts',
    filters: {
      states: ['NC'],
      counties: ['wake'],
      notifyEmail: 'subscriber@example.com',
      cadence: 'daily'
    }
  });

  const sampleListing = {
    id: `NC-WAKE-TEST-${uidSuffix}`,
    address: '123 Fayetteville St',
    city: 'Raleigh',
    county: 'wake',
    state: 'NC',
    openingBid: 245000,
    dealScore: 84,
    saleDate: '2026-11-20'
  };

  const alertResult = await runAlertsForUser({
    userId,
    listings: [sampleListing],
    database: db,
    mailOptions: stubMailOptions
  });

  assert.equal(alertResult.totalNewMatches, 1);
  assert.equal(sentCalls.length, 1);
  const call = sentCalls[0];
  assert.deepEqual(call.to, ['subscriber@example.com']);
  assert.match(call.subject, /1 new notice\(s\)/);
  assert.match(call.text, /123 Fayetteville St/);
  assert.match(call.text, /\$245,000/);
  assert.match(call.text, /Score 84\/99/);
  assert.match(call.text, /Sale: 2026-11-20/);
  assert.match(call.text, new RegExp(sampleListing.id));
  assert.equal(alertResult.results[0].mailDelivery, 'sent');
});


test('GET /api/alerts (format=digest): generates structured investor digest report for saved watchlist', async () => {
  const req = makeReq('GET', '/api/alerts?format=digest');
  const res = makeRes();
  const userId = 'workspace:operator';

  const inventory = (await db.getListings({ limit: 2 })).listings;
  assert.ok(inventory.length >= 2, 'Expected at least 2 listings in inventory');
  const listingA = inventory[0];
  const listingB = inventory[1];
  await db.saveDeal(userId, listingA.id);
  await db.saveDeal(userId, listingB.id);

  await handleAlerts(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body);
  assert.equal(res.body.matchedCount, 2);
  assert.ok(res.body.markdown.includes('Institutional Deal Alert Digest'));
  assert.ok(res.body.markdown.includes(listingA.address));
  assert.ok(res.body.markdown.includes(listingB.address));
  assert.ok(res.body.html.includes('Hunt Digest'));
});

test('POST /api/alerts (dispatch_digest): fails closed with RESEND_API_KEY_UNSET when key is not configured', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  try {
    const userId = 'workspace:operator';
    const inventory = (await db.getListings({ limit: 1 })).listings;
    assert.ok(inventory.length >= 1, 'Expected at least 1 listing in inventory');
    const listing = inventory[0];
    await db.saveDeal(userId, listing.id);

    const req = makeReq('POST', '/api/alerts', {
      action: 'dispatch_digest',
      recipientEmail: 'investor@example.com',
    });
    const res = makeRes();

    await handleAlerts(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.delivered, false);
    assert.equal(res.body.reason, 'RESEND_API_KEY_UNSET');
    assert.equal(res.body.dryRun, true);
    assert.ok(res.body.report);
    assert.ok(res.body.report.matchedCount >= 1);
  } finally {
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
  }
});

test('POST /api/alerts (dispatch_digest): delivers via Resend when RESEND_API_KEY is configured', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_test_suite_key_configured';
  const originalFetch = globalThis.fetch;
  let sentOpts = null;
  globalThis.fetch = async (url, opts) => {
    sentOpts = opts;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_digest_test_9988' }),
    };
  };

  try {
    const userId = 'workspace:operator';
    const inventory = (await db.getListings({ limit: 1 })).listings;
    assert.ok(inventory.length >= 1, 'Expected at least 1 listing in inventory');
    const listing = inventory[0];
    await db.saveDeal(userId, listing.id);

    const req = makeReq('POST', '/api/alerts', {
      action: 'dispatch_digest',
      recipientEmail: 'investor@example.com',
    });
    const res = makeRes();

    await handleAlerts(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.delivered, true);
    assert.equal(res.body.id, 'email_digest_test_9988');
    assert.ok(sentOpts);
    const sentBody = JSON.parse(sentOpts.body);
    assert.deepEqual(sentBody.to, ['investor@example.com']);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
    else delete process.env.RESEND_API_KEY;
  }
});

test('POST /api/alerts (dispatch_digest): rejects unauthenticated anonymous device sessions (401)', async () => {
  const req = {
    method: 'POST',
    url: '/api/alerts',
    headers: { cookie: 'pp_watchlist=anon_device_token_123456' },
    body: { action: 'dispatch_digest', recipientEmail: 'victim@example.com' },
  };
  const res = makeRes();

  await handleAlerts(req, res);

  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /sign in/i);
});


function makeIsolatedTestDb() {
  const workspacePersistence = require('../server/db/workspace-persistence');
  const client = {
    isPg: false,
    workspaceStorePath: null,
    _persistWorkspaceStore() {},
    refreshLiveCache() {},
    inMemoryData: {
      listings: [],
      savedDeals: new Map(),
      savedSearches: new Map(),
      alertMatches: new Map(),
    },
    async createSavedSearch(userId, payload) { return workspacePersistence.createSavedSearch(this, userId, payload); },
    async listSavedSearchUserIds() { return workspacePersistence.listSavedSearchUserIds(this); },
    async listSavedSearches(userId, options) { return workspacePersistence.listSavedSearches(this, userId, options); },
    async getSavedSearchById(userId, id) { return workspacePersistence.getSavedSearchById(this, userId, id); },
    async updateSavedSearch(userId, id, updates) { return workspacePersistence.updateSavedSearch(this, userId, id, updates); },
    async deleteSavedSearch(userId, id) { return workspacePersistence.deleteSavedSearch(this, userId, id); },
    async recordAlertMatches(userId, searchId, listingIds) { return workspacePersistence.recordAlertMatches(this, userId, searchId, listingIds); },
  };
  return client;
}

test('Guest subscribe_county_digest starts verified:false, sends signed confirmation link, and is skipped during dispatch until confirmed', async () => {
  const { createAlertsHandler, verifyCountyConfirmToken } = handleAlerts;
  const { runCountyAlertDigests } = require('../server/delivery/alert-digest');

  const sentConfirmationMails = [];
  let fixedNow = Date.parse('2026-11-24T12:00:00.000Z');
  const testEnv = {
    SCRAPER_ADMIN_TOKEN: 'test-secret',
    RESEND_API_KEY: 're_test_confirm_key',
    RESEND_FROM: 'alerts@perfectproperty.bid',
    PUBLIC_APP_ORIGIN: 'https://perfectproperty.bid',
  };

  const isolatedDb = makeIsolatedTestDb();
  const handler = createAlertsHandler({
    database: isolatedDb,
    env: testEnv,
    now: () => fixedNow,
    mailIsConfigured: () => true,
    sendOutboundMail: async (payload) => {
      sentConfirmationMails.push(payload);
      return { delivery: 'sent', sent: true, id: 'confirm_mail_1' };
    },
  });

  const guestCookie = `pp_watchlist=guest_double_opt_in_${Date.now()}`;
  const req = {
    method: 'POST',
    url: '/api/alerts',
    headers: { cookie: guestCookie },
    body: {
      action: 'subscribe_county_digest',
      email: 'GuestBuyer@Example.com',
      state: 'OH',
      county: 'Franklin',
      cadence: 'daily',
    },
  };
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.pendingConfirmation, true);
  assert.equal(res.body.verified, false);
  assert.equal(res.body.mailDelivery, 'sent');
  assert.ok(res.body.subscriptionId);

  const userId = `device:${guestCookie.slice('pp_watchlist='.length)}`;
  const storedBefore = await isolatedDb.getSavedSearchById(userId, res.body.subscriptionId);
  assert.ok(storedBefore);
  assert.equal(storedBefore.filters.verified, false);
  assert.equal(storedBefore.filters.verificationRequestedAt, '2026-11-24T12:00:00.000Z');
  assert.equal(storedBefore.filters.notifyEmail, 'guestbuyer@example.com');

  assert.equal(sentConfirmationMails.length, 1);
  assert.equal(sentConfirmationMails[0].to, 'guestbuyer@example.com');
  const urlMatch = sentConfirmationMails[0].text.match(/https:\/\/perfectproperty\.bid\/states\/OH\/franklin\?confirm_alert=([^\s]+)/);
  assert.ok(urlMatch, 'Expected signed confirmation URL in outbound email');
  const confirmToken = decodeURIComponent(urlMatch[1]);
  const verifiedPayload = verifyCountyConfirmToken(confirmToken, { env: testEnv, now: fixedNow });
  assert.equal(verifiedPayload.ok, true);
  assert.equal(verifiedPayload.payload.sid, res.body.subscriptionId);

  // Dispatch before confirmation MUST skip unverified subscription
  const digestCallsBefore = [];
  const sampleListing = {
    id: `OH-FRANKLIN-DOUBLE-OPT-${Date.now()}`,
    address: '55 High St',
    city: 'Columbus',
    county: 'Franklin',
    state: 'OH',
    openingBid: 92000,
    dealScore: 81,
    saleDate: '2026-12-10',
  };
  const dispatchBefore = await runCountyAlertDigests({
    listings: [sampleListing],
    options: {
      database: isolatedDb,
      env: testEnv,
      apiKey: 're_test_digest',
      fetchFn: async (_url, init) => {
        digestCallsBefore.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ id: 'should_not_send' }) };
      },
    },
  });
  const unverifiedRow = dispatchBefore.results.find((r) => r.searchId === res.body.subscriptionId);
  assert.ok(unverifiedRow);
  assert.equal(unverifiedRow.skipped, true);
  assert.equal(unverifiedRow.reason, 'UNVERIFIED_SUBSCRIPTION');
  assert.equal(digestCallsBefore.length, 0);

  // Confirm via GET /api/alerts?action=confirm_county_digest&token=... (even without cookie)
  const confirmReq = {
    method: 'GET',
    url: `/api/alerts?action=confirm_county_digest&token=${encodeURIComponent(confirmToken)}`,
    headers: {},
  };
  const confirmRes = makeRes();
  await handler(confirmReq, confirmRes);

  assert.equal(confirmRes.statusCode, 200);
  assert.equal(confirmRes.body.ok, true);
  assert.equal(confirmRes.body.verified, true);
  assert.equal(confirmRes.body.subscriptionId, res.body.subscriptionId);

  const storedAfter = await isolatedDb.getSavedSearchById(userId, res.body.subscriptionId);
  assert.equal(storedAfter.filters.verified, true);
  assert.equal(storedAfter.filters.verifiedAt, '2026-11-24T12:00:00.000Z');

  // Re-confirming is idempotent
  const repeatRes = makeRes();
  await handler(confirmReq, repeatRes);
  assert.equal(repeatRes.statusCode, 200);
  assert.equal(repeatRes.body.alreadyVerified, true);

  // Dispatch after confirmation MUST deliver digest to guestbuyer@example.com
  const digestCallsAfter = [];
  const dispatchAfter = await runCountyAlertDigests({
    listings: [sampleListing],
    options: {
      database: isolatedDb,
      env: testEnv,
      apiKey: 're_test_digest',
      fetchFn: async (_url, init) => {
        digestCallsAfter.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ id: 'digest_sent_after_confirm' }) };
      },
    },
  });
  const verifiedRow = dispatchAfter.results.find((r) => r.searchId === res.body.subscriptionId);
  assert.ok(verifiedRow);
  assert.equal(verifiedRow.matchedCount, 1);
  assert.equal(verifiedRow.dispatchResult.delivered, true);
  assert.ok(digestCallsAfter.some((c) => c.to.includes('guestbuyer@example.com')));
});

test('confirm_county_digest rejects tampered, malformed, and expired tokens with 400/403', async () => {
  const { createAlertsHandler, signCountyConfirmToken } = handleAlerts;
  const testEnv = { SCRAPER_ADMIN_TOKEN: 'test-secret' };
  let fixedNow = Date.parse('2026-11-24T12:00:00.000Z');

  const isolatedDb = makeIsolatedTestDb();
  const handler = createAlertsHandler({
    database: isolatedDb,
    env: testEnv,
    now: () => fixedNow,
  });

  const guestCookie = `pp_watchlist=guest_tamper_${Date.now()}`;
  const subRes = makeRes();
  await handler({
    method: 'POST',
    url: '/api/alerts',
    headers: { cookie: guestCookie },
    body: {
      action: 'subscribe_county_digest',
      email: 'target@example.com',
      state: 'TX',
      county: 'Harris',
    },
  }, subRes);
  assert.equal(subRes.statusCode, 200);
  assert.equal(subRes.body.verified, false);

  const userId = `device:${guestCookie.slice('pp_watchlist='.length)}`;
  const validToken = signCountyConfirmToken(
    { userId, subscriptionId: subRes.body.subscriptionId, email: 'target@example.com' },
    { env: testEnv, now: fixedNow, ttlMs: 60_000 },
  );

  // Tamper signature character
  const [payloadB64, sigB64] = validToken.split('.');
  const flippedChar = sigB64[0] === 'A' ? 'B' : 'A';
  const tamperedSigToken = `${payloadB64}.${flippedChar}${sigB64.slice(1)}`;
  const tamperedRes = makeRes();
  await handler({
    method: 'GET',
    url: `/api/alerts?action=confirm_county_digest&token=${encodeURIComponent(tamperedSigToken)}`,
    headers: {},
  }, tamperedRes);
  assert.equal(tamperedRes.statusCode, 403);
  assert.equal(tamperedRes.body.ok, false);

  // Tamper payload email while keeping signature
  const decodedPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  decodedPayload.email = 'attacker@example.com';
  const tamperedPayloadB64 = Buffer.from(JSON.stringify(decodedPayload), 'utf8').toString('base64url');
  const tamperedPayloadRes = makeRes();
  await handler({
    method: 'POST',
    url: '/api/alerts',
    headers: {},
    body: { action: 'confirm_county_digest', token: `${tamperedPayloadB64}.${sigB64}` },
  }, tamperedPayloadRes);
  assert.equal(tamperedPayloadRes.statusCode, 403);

  // Malformed token
  const malformedRes = makeRes();
  await handler({
    method: 'GET',
    url: '/api/alerts?action=confirm_county_digest&token=not-a-valid-token',
    headers: {},
  }, malformedRes);
  assert.equal(malformedRes.statusCode, 400);

  // Expired token
  fixedNow += 120_000;
  const expiredRes = makeRes();
  await handler({
    method: 'GET',
    url: `/api/alerts?action=confirm_county_digest&token=${encodeURIComponent(validToken)}`,
    headers: {},
  }, expiredRes);
  assert.equal(expiredRes.statusCode, 400);
  assert.match(expiredRes.body.error, /expired/i);

  // Confirm subscription remained unverified after all failed attempts
  const stillUnverified = await isolatedDb.getSavedSearchById(userId, subRes.body.subscriptionId);
  assert.equal(stillUnverified.filters.verified, false);
});

test('account session subscribe_county_digest only auto-verifies matching member email', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const { accountServiceFor } = require('../server/accounts/store');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'county-alerts-acct-'));
  const prevPath = process.env.PROPERTY_ACCOUNTS_PATH;
  process.env.PROPERTY_ACCOUNTS_PATH = path.join(tmpDir, 'accounts.json');
  try {
    const isolatedDb = makeIsolatedTestDb();
    const acctHandler = handleAlerts.createAlertsHandler({
      database: isolatedDb,
      env: { SCRAPER_ADMIN_TOKEN: 'test-secret' },
    });
    const service = accountServiceFor(isolatedDb);
    const member = await service.backend.upsertByEmail('member-verified@example.com');
    const accountId = member.id;

    // Matching member email -> immediately verified: true
    const matchRes = makeRes();
    await acctHandler({
      method: 'POST',
      url: '/api/alerts',
      headers: {
        authorization: 'Bearer test-secret',
        'x-pp-account': accountId,
      },
      body: {
        action: 'subscribe_county_digest',
        email: 'member-verified@example.com',
        state: 'TX',
        county: 'Dallas',
      },
    }, matchRes);
    assert.equal(matchRes.statusCode, 200);
    assert.equal(matchRes.body.verified, true);
    assert.equal(matchRes.body.pendingConfirmation, false);

    // Mismatched third-party email from same account -> must require double opt-in (verified: false)
    const mismatchRes = makeRes();
    await acctHandler({
      method: 'POST',
      url: '/api/alerts',
      headers: {
        authorization: 'Bearer test-secret',
        'x-pp-account': accountId,
      },
      body: {
        action: 'subscribe_county_digest',
        email: 'third-party@example.com',
        state: 'TX',
        county: 'Dallas',
      },
    }, mismatchRes);
    assert.equal(mismatchRes.statusCode, 200);
    assert.equal(mismatchRes.body.verified, false);
    assert.equal(mismatchRes.body.pendingConfirmation, true);
  } finally {
    if (prevPath === undefined) delete process.env.PROPERTY_ACCOUNTS_PATH;
    else process.env.PROPERTY_ACCOUNTS_PATH = prevPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

