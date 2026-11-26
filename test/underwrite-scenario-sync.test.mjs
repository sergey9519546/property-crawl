import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  UNDERWRITE_SCENARIO_EVENT,
  UNDERWRITE_SCENARIO_LOCAL_PREFIX,
  listAllUnderwriteScenarios,
  readUnderwriteScenario,
  syncScenarioToDealFile,
  writeUnderwriteScenario,
} from '../src/lib/underwrite-scenario.ts';
import {
  SAVED_LISTINGS_DEVICE_KEY,
  addLocalWatchlistId,
  readDeviceWatchlistIds,
} from '../src/lib/watchlist-sync.ts';
import { computeSafmrRentFloor } from '../src/lib/underwriting.ts';

const require = createRequire(import.meta.url);
const { computeOpportunity } = require('../server/scrapers/listing-intelligence');

function createMemoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

function withMockBrowser(fn) {
  const prevWindow = globalThis.window;
  const prevSessionStorage = globalThis.sessionStorage;
  const localStorage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();
  const dispatched = [];

  globalThis.sessionStorage = sessionStorage;
  globalThis.window = {
    localStorage,
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    },
  };

  return Promise.resolve()
    .then(() => fn({ localStorage, sessionStorage, dispatched }))
    .finally(() => {
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
      if (prevSessionStorage === undefined) delete globalThis.sessionStorage;
      else globalThis.sessionStorage = prevSessionStorage;
    });
}

test('listAllUnderwriteScenarios returns {} during SSR or when localStorage throws', () => {
  const prevWindow = globalThis.window;
  delete globalThis.window;
  assert.deepEqual(listAllUnderwriteScenarios(), {});

  globalThis.window = {
    get localStorage() {
      throw new Error('storage blocked');
    },
  };
  assert.deepEqual(listAllUnderwriteScenarios(), {});

  if (prevWindow === undefined) delete globalThis.window;
  else globalThis.window = prevWindow;
});

test('writeUnderwriteScenario persists to localStorage and dispatches UNDERWRITE_SCENARIO_EVENT', async () => {
  await withMockBrowser(({ localStorage, dispatched }) => {
    writeUnderwriteScenario('LISTING-101', {
      rehabBudget: 32000,
      targetMargin: 25,
      customValuation: '240000',
      maxAllowableOffer: 148000,
    });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, UNDERWRITE_SCENARIO_EVENT);
    assert.equal(dispatched[0].detail.listingId, 'LISTING-101');
    assert.equal(dispatched[0].detail.scenario.maxAllowableOffer, 148000);
    assert.equal(dispatched[0].detail.scenario.rehabBudget, 32000);

    // Partial patch merges cleanly without wiping existing fields
    writeUnderwriteScenario('LISTING-101', { delinquentTaxes: '4500' });
    const restored = readUnderwriteScenario('LISTING-101');
    assert.equal(restored?.customValuation, '240000');
    assert.equal(restored?.delinquentTaxes, '4500');
    assert.equal(restored?.maxAllowableOffer, 148000);

    // Non-scenario keys & corrupt entries are skipped safely
    localStorage.setItem('unrelated:key', '{"foo":1}');
    localStorage.setItem(`${UNDERWRITE_SCENARIO_LOCAL_PREFIX}CORRUPT`, '{bad json');

    const all = listAllUnderwriteScenarios();
    assert.deepEqual(Object.keys(all), ['LISTING-101']);
    assert.equal(all['LISTING-101'].rehabBudget, 32000);
    assert.equal(all['LISTING-101'].targetMargin, 25);
  });
});

test('addLocalWatchlistId prevents duplicates and rejects empty/invalid IDs', async () => {
  await withMockBrowser(() => {
    assert.equal(addLocalWatchlistId(''), false);
    assert.equal(addLocalWatchlistId('   '), false);
    assert.equal(addLocalWatchlistId('L-PIN-1'), true);
    assert.equal(addLocalWatchlistId('L-PIN-1'), false);
    assert.deepEqual(readDeviceWatchlistIds(), ['L-PIN-1']);
  });
});

test('syncScenarioToDealFile pins watchlist and posts /api/workspace/cases, ignoring 401/503/network errors', async () => {
  await withMockBrowser(async ({ localStorage }) => {
    const requests = [];
    const okResult = await syncScenarioToDealFile(
      'L-DEAL-1',
      {
        registrationFunds: '',
        creditedDeposit: '',
        buyersPremium: '',
        sheriffPoundage: '',
        transferTax: '',
        delinquentTaxes: '2100',
        settlementCosts: '',
        rehabBudget: 25000,
        targetMargin: 30,
        customValuation: '210000',
        customOpeningBid: '110000',
        maxAllowableOffer: 119900,
      },
      {
        fetchImpl: async (url, init) => {
          requests.push({ url, init });
          return new Response(JSON.stringify({ created: true }), { status: 201 });
        },
      },
    );

    assert.equal(okResult.watchlistAdded, true);
    assert.equal(okResult.caseSynced, true);
    assert.deepEqual(JSON.parse(localStorage.getItem(SAVED_LISTINGS_DEVICE_KEY) || '[]'), ['L-DEAL-1']);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/workspace/cases');
    assert.equal(requests[0].init.method, 'POST');
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.listingId, 'L-DEAL-1');
    assert.equal(body.thesis, 'Auto-synced from Underwriting Simulator');
    assert.deepEqual(body.underwriteScenario, {
      maxAllowableOffer: 119900,
      rehabBudget: 25000,
      delinquentTaxes: '2100',
      customValuation: '210000',
      customOpeningBid: '110000',
      targetMargin: 30,
    });

    // Second sync: already pinned -> watchlistAdded: false; 401 handled gracefully
    const unauthResult = await syncScenarioToDealFile(
      'L-DEAL-1',
      {
        registrationFunds: '',
        creditedDeposit: '',
        buyersPremium: '',
        sheriffPoundage: '',
        transferTax: '',
        delinquentTaxes: '',
        settlementCosts: '',
        rehabBudget: 25000,
        targetMargin: 30,
        maxAllowableOffer: 119900,
      },
      {
        fetchImpl: async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      },
    );
    assert.equal(unauthResult.watchlistAdded, false);
    assert.equal(unauthResult.caseSynced, false);

    // Network failure handled gracefully without throwing
    const netErrResult = await syncScenarioToDealFile(
      'L-DEAL-2',
      {
        registrationFunds: '',
        creditedDeposit: '',
        buyersPremium: '',
        sheriffPoundage: '',
        transferTax: '',
        delinquentTaxes: '',
        settlementCosts: '',
        rehabBudget: 20000,
        targetMargin: 25,
        customValuation: '',
        maxAllowableOffer: null,
      },
      {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    );
    assert.equal(netErrResult.watchlistAdded, false);
    assert.equal(netErrResult.caseSynced, false);
  });
});

test('computeOpportunity computes safmrRentFloor matching underwriting.ts and judgmentToMidRatio when openingBid is null', () => {
  const oppWithSafmrAndJudgment = computeOpportunity({
    openingBid: null,
    judgment: 145000,
    estLow: 200000,
    estHigh: 240000,
    hudSafmr: { fairMarketRent: 1800 },
  });

  assert.equal(oppWithSafmrAndJudgment.safmrRentFloor, computeSafmrRentFloor({ monthlyRent: 1800 }));
  assert.equal(oppWithSafmrAndJudgment.judgmentToMidRatio, Number((145000 / 220000).toFixed(4)));
  assert.equal(oppWithSafmrAndJudgment.bidToMidRatio, null);

  // When openingBid is present, judgmentToMidRatio must remain null
  const oppWithBid = computeOpportunity({
    openingBid: 100000,
    judgment: 145000,
    estLow: 200000,
    estHigh: 240000,
    hudSafmr: { fairMarketRent: 0 },
  });

  assert.equal(oppWithBid.safmrRentFloor, null);
  assert.equal(oppWithBid.judgmentToMidRatio, null);
  assert.equal(oppWithBid.bidToMidRatio, Number((100000 / 220000).toFixed(4)));
});

test('syncScenarioToDealFile forwards populated cash-to-close and financing fields without breaking minimal scenarios', async () => {
  await withMockBrowser(async () => {
    const requests = [];
    await syncScenarioToDealFile(
      'L-DEAL-FULL',
      {
        registrationFunds: '5000',
        creditedDeposit: '5000',
        buyersPremium: '1500',
        sheriffPoundage: '800',
        transferTax: '1200',
        delinquentTaxes: '2100',
        settlementCosts: '950',
        rehabBudget: 25000,
        targetMargin: 25,
        holdingMonths: 6,
        isHomestead: false,
        ltvPct: 75,
        interestRatePct: 8.5,
        monthlyInsurance: 220,
        redemptionProbabilityPct: 15,
        maxAllowableOffer: 140000,
      },
      {
        fetchImpl: async (url, init) => {
          requests.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ created: true }), { status: 201 });
        },
      },
    );
    assert.equal(requests.length, 1);
    const s = requests[0].underwriteScenario;
    assert.equal(s.registrationFunds, '5000');
    assert.equal(s.settlementCosts, '950');
    assert.equal(s.holdingMonths, 6);
    assert.equal(s.isHomestead, false);
    assert.equal(s.ltvPct, 75);
  });
});
