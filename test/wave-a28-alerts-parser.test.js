'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { runAlertsForUser } = require('../server/intelligence/alerts-runner');
const { runWatchlistPriceDropDigests } = require('../server/delivery/alert-digest');
const { parseLegalNoticeAsync } = require('../server/ai/notice-parser');
const handleParse = require('../server/routes/parse');

function makeDurableCacheDb(poolQueryHandler) {
  const kvStore = new Map();
  return {
    isPg: true,
    kvStore,
    pool: {
      async query(sql, params = []) {
        if (sql.includes('FROM durable_kv_cache') && sql.startsWith('SELECT')) {
          const key = `${params[0]}::${params[1]}`;
          const entry = kvStore.get(key);
          return { rows: entry ? [{ payload: entry }] : [] };
        }
        if (sql.includes('INSERT INTO durable_kv_cache')) {
          const key = `${params[0]}::${params[1]}`;
          kvStore.set(key, JSON.parse(params[2]));
          return { rowCount: 1, rows: [] };
        }
        if (typeof poolQueryHandler === 'function') {
          return poolQueryHandler(sql, params);
        }
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

test('alerts-runner attaches priceDrops count and formats drop callout when openingBid < peakOpeningBid', async () => {
  const sentEmails = [];
  const storedMatches = [];
  const db = {
    async listSavedSearches() {
      return [{
        id: 'S-DROP-1',
        label: 'TX Drops',
        userId: 'user-1',
        isActive: true,
        filters: {
          states: ['TX'],
          notifyEmail: 'investor@example.com',
          verified: true,
        },
      }];
    },
    async recordAlertMatches(userId, searchId, listingIds) {
      return listingIds.map((listingId) => {
        const rec = { userId, searchId, listingId };
        storedMatches.push(rec);
        return rec;
      });
    },
  };

  const result = await runAlertsForUser({
    userId: 'user-1',
    listings: [
      {
        id: 'L-DROP-1',
        state: 'TX',
        city: 'Austin',
        address: '100 Congress Ave',
        openingBid: 80000,
        peakOpeningBid: 100000,
        dealScore: 82,
        saleDate: '2026-12-01',
      },
      {
        id: 'L-FLAT-1',
        state: 'TX',
        city: 'Dallas',
        address: '200 Elm St',
        openingBid: 90000,
        peakOpeningBid: 90000,
        dealScore: 70,
        saleDate: '2026-12-05',
      },
    ],
    database: db,
    mailOptions: {
      env: { RESEND_API_KEY: 're_test_key', RESEND_FROM: 'alerts@perfectproperty.bid' },
      fetchImpl: async (_url, init) => {
        sentEmails.push(JSON.parse(init.body));
        return { ok: true, status: 200, async json() { return { id: 'msg_1' }; } };
      },
    },
  });

  assert.equal(result.totalNewMatches, 2);
  assert.equal(result.results[0].priceDrops, 1);
  assert.equal(result.results[0].mailDelivery, 'sent');
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].text, /Down 20% from \$100,000/);
});

test('runWatchlistPriceDropDigests sends once and deduplicates repeat runs via durable_kv_cache', async () => {
  const sentEmails = [];
  const db = makeDurableCacheDb(async (sql) => {
    if (sql.includes('WITH watched AS')) {
      return {
        rows: [
          {
            userId: 'acct_verified',
            notifyEmail: 'verified@example.com',
            listingId: 'L-100',
            address: '42 Maple Rd',
            city: 'Columbus',
            state: 'OH',
            openingBid: 75000,
            peakOpeningBid: 100000,
            initialOpeningBid: 95000,
            dealScore: 85,
            saleDate: '2026-12-15',
          },
          {
            userId: 'acct_unverified',
            notifyEmail: null,
            listingId: 'L-101',
            address: '99 Oak St',
            city: 'Columbus',
            state: 'OH',
            openingBid: 50000,
            peakOpeningBid: 70000,
            initialOpeningBid: 70000,
            dealScore: 78,
            saleDate: '2026-12-16',
          },
        ],
      };
    }
    return { rows: [] };
  });

  const opts = {
    now: '2026-11-26T12:00:00.000Z',
    env: { RESEND_API_KEY: 're_test_key', RESEND_FROM: 'alerts@perfectproperty.bid' },
    fetchImpl: async (_url, init) => {
      sentEmails.push(JSON.parse(init.body));
      return { ok: true, status: 200, async json() { return { id: 'msg_drop_1' }; } };
    },
  };

  const first = await runWatchlistPriceDropDigests(db, opts);
  assert.equal(first.checked, 2);
  assert.equal(first.sent, 1);
  assert.equal(first.skippedUnverified, 1);
  assert.equal(first.deduplicated, 0);
  assert.equal(sentEmails.length, 1);
  assert.deepEqual(sentEmails[0].to, ['verified@example.com']);
  assert.match(sentEmails[0].text, /dropped 25% from \$100,000 to \$75,000/i);

  const second = await runWatchlistPriceDropDigests(db, opts);
  assert.equal(second.checked, 2);
  assert.equal(second.sent, 0);
  assert.equal(second.deduplicated, 1);
  assert.equal(second.skippedUnverified, 1);
  assert.equal(sentEmails.length, 1);
});

test('parseLegalNoticeAsync accepts verbatim-quoted LLM fields, rejects hallucinated quotes, and caches in durable_kv_cache', async () => {
  const db = makeDurableCacheDb();
  const sparseNotice = [
    'PUBLIC AUCTION NOTICE.',
    'Premises commonly known as 742 Evergreen Terrace, Springfield, IL 62704.',
    'Civil File 2026-CH-8841.',
    'Tax Parcel 14-22-301-009.',
    'To be auctioned on December 18, 2026.',
    'Required earnest funds: $10,000 cashier check at sale.',
  ].join(' ');

  let llmCalls = 0;
  const llmExtractFn = async () => {
    llmCalls++;
    return {
      candidates: {
        apn: { value: '14-22-301-009', quote: 'Tax Parcel 14-22-301-009' },
        case_number: { value: '2026-CH-8841', quote: 'Civil File 2026-CH-8841' },
        sale_date: { value: 'December 18, 2026', quote: 'December 18, 2026' },
        deposit_terms: { value: '$10,000 cashier check', quote: '$10,000 cashier check at sale' },
        // Hallucinated quote not present verbatim in notice -> MUST be rejected
        opening_bid: { value: 250000, quote: 'Minimum opening bid of $250,000' },
        plaintiff_or_seller: { value: 'Fake Bank N.A.', quote: 'Fake Bank N.A. v. Doe' },
      },
    };
  };

  const first = await parseLegalNoticeAsync(sparseNotice, {
    allowAiFallback: true,
    db,
    llmExtractFn,
  });

  assert.equal(llmCalls, 1);
  assert.equal(first.length, 1);
  assert.equal(first[0]._strategy, 'hybrid_citation_locked');
  assert.equal(first[0].apn, '14-22-301-009');
  assert.equal(first[0].case_number, '2026-CH-8841');
  assert.equal(first[0].sale_date, 'December 18, 2026');
  assert.equal(first[0].deposit_terms, '$10,000 cashier check');
  assert.equal(first[0].evidenceSpans.apn.verified, true);
  assert.equal(first[0].evidenceSpans.case_number.verified, true);
  // Hallucinated fields rejected
  assert.equal(first[0].opening_bid, 0);
  assert.equal(first[0].plaintiff_or_seller, '');
  assert.equal(first[0].evidenceSpans.opening_bid, undefined);
  assert.equal(first[0].evidenceSpans.plaintiff_or_seller, undefined);

  // Second call should hit durable_kv_cache without calling llmExtractFn again
  const second = await parseLegalNoticeAsync(sparseNotice, {
    allowAiFallback: true,
    db,
    llmExtractFn,
  });
  assert.equal(llmCalls, 1);
  assert.equal(second[0]._strategy, 'hybrid_citation_locked');
  assert.equal(second[0].apn, '14-22-301-009');
});

test('handleParse routes allowAiFallback=true through parseLegalNoticeAsync for authorized operator', async () => {
  const db = makeDurableCacheDb();
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer op-secret' },
    body: {
      noticeText: 'PUBLIC AUCTION NOTICE. Premises 742 Evergreen Terrace, Springfield, IL 62704. Civil File 2026-CH-8841.',
      allowAiFallback: true,
    },
  };
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  const memoryCache = {
    async get() { return null; },
    async set() { return true; },
  };

  await handleParse(req, res, {
    env: { SCRAPER_ADMIN_TOKEN: 'op-secret' },
    db,
    cache: memoryCache,
    llmExtractFn: async () => ({
      candidates: {
        case_number: { value: '2026-CH-8841', quote: 'Civil File 2026-CH-8841' },
      },
    }),
  });

  assert.equal(statusCode, 200);
  assert.equal(jsonBody.strategy, 'hybrid_citation_locked');
  assert.equal(Array.isArray(jsonBody.parcels), true);
  assert.equal(jsonBody.parcels[0].case_number, '2026-CH-8841');
});
