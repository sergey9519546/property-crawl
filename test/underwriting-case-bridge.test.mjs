import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { terminalFiltersToDiscovery } from '../src/lib/discovery-query.ts';
import { buildHuntFromSavedSearch } from '../src/lib/saved-searches.ts';
import { computeCashToClose } from '../src/lib/underwriting.ts';
import {
  createCase,
  listCases,
  buildPacket,
  packetToMarkdown,
} from '../server/intelligence/research-cases.js';

test('terminalFiltersToDiscovery maps all terminal filters to workbench discovery parameters', () => {
  const url = terminalFiltersToDiscovery({
    searchQuery: 'lakefront colonial',
    selectedState: 'OH',
    selectedSource: 'sheriff',
    observedOnly: true,
    sortBy: 'triage',
    minDealScore: 75,
    minEquity: 30,
    maxOpeningBid: 250000,
    propertyType: 'Single Family',
    occupancy: 'vacant',
    seniorLienFilter: 'clean',
    redemptionFilter: 'immediate',
  }, { view: 'map' });

  const parsed = new URL(url, 'http://localhost');
  assert.equal(parsed.pathname, '/listings');
  assert.equal(parsed.searchParams.get('q'), 'lakefront colonial');
  assert.equal(parsed.searchParams.get('state'), 'OH');
  assert.equal(parsed.searchParams.get('source'), 'sheriff');
  assert.equal(parsed.searchParams.get('freshness'), 'observed');
  assert.equal(parsed.searchParams.get('sort'), 'triage');
  assert.equal(parsed.searchParams.get('minScore'), '75');
  assert.equal(parsed.searchParams.get('minEquity'), '30');
  assert.equal(parsed.searchParams.get('maxBid'), '250000');
  assert.equal(parsed.searchParams.get('type'), 'Single Family');
  assert.equal(parsed.searchParams.get('occupancy'), 'vacant');
  assert.equal(parsed.searchParams.get('seniorLien'), 'clean');
  assert.equal(parsed.searchParams.get('redemption'), 'immediate');
  assert.equal(parsed.searchParams.get('view'), 'map');
});

test('terminalFiltersToDiscovery preserves clean default URLs without unneeded params', () => {
  const url = terminalFiltersToDiscovery({
    searchQuery: '',
    selectedState: 'all',
    selectedSource: 'all',
    observedOnly: false,
    minDealScore: 0,
    minEquity: 0,
    maxOpeningBid: null,
    propertyType: 'all',
    occupancy: 'all',
    seniorLienFilter: 'all',
    redemptionFilter: 'all',
  });
  assert.equal(url, '/listings');
});

test('buildHuntFromSavedSearch normalizes state filters to uppercase USPS codes', () => {
  const hunt1 = buildHuntFromSavedSearch({
    id: 's1',
    name: 'Ohio Sheriff Deals',
    state: 'OH',
    minScore: 70,
    maxBid: 150000,
    createdAt: new Date().toISOString(),
  });
  assert.equal(hunt1.criteria.discoveryFilters.state, 'OH');

  const hunt2 = buildHuntFromSavedSearch(
    { id: 's2', name: 'Server Stated', state: 'All', minScore: 60, maxBid: 200000, createdAt: '' },
    { id: 'srv1', label: 'Test', filters: { states: ['ca', 'nv'] }, createdAt: '' }
  );
  assert.equal(hunt2.criteria.discoveryFilters.state, 'CA,NV');
});

test('research case lifecycle persists underwriting scenario, emits accurate history events, and exports to markdown/json', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-research-test-'));
  const storePath = path.join(tempDir, 'cases.json');
  t.after(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  });

  const observedAt = '2026-09-05T16:00:00.000Z';
  const sampleListing = {
    id: 'civilview-2128964683',
    source: 'civilview',
    sourceId: 'civilview_2128964683',
    address: '456 Buckeye Trail, Columbus, OH 43215',
    city: 'Columbus',
    state: 'OH',
    zip: '43215',
    openingBid: 120000,
    status: 'active',
    propType: 'Single Family',
    sqft: 1200,
    assessed: 180000,
    raw: 'Test-only publisher notice record for underwriteScenario test.',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId: '2128964683',
      observedAt,
    },
  };

  const initialScenario = {
    rehabBudget: 35000,
    targetMargin: 25,
    customValuation: '310000',
    customOpeningBid: '120000',
    holdingMonths: 8,
    transferTax: '450',
    delinquentTaxes: '1200',
    settlementCosts: '1800',
    buyersPremium: '0',
    sheriffPoundage: '0',
    maxAllowableOffer: 195000,
  };

  // 1. Create case with scenario
  const created = createCase({
    listing: sampleListing,
    dossier: { facts: [{ key: 'parcel.apn', value: '010-123456', evidenceClass: 'official_record' }] },
    origin: { id: 'orig_1', type: 'manual' },
    underwriteScenario: initialScenario,
  }, { filePath: storePath, now: observedAt });

  assert.equal(created.created, true);
  assert.equal(created.case.underwriteScenario?.rehabBudget, 35000);
  assert.equal(created.case.underwriteScenario?.customValuation, '310000');
  assert.equal(created.case.underwriteScenario?.maxAllowableOffer, 195000);

  // 2. Query case by listingId
  const found = listCases({ listingId: 'civilview-2128964683' }, { filePath: storePath });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, created.case.id);

  // 3. Update underwriteScenario on existing case without adding a new origin
  const updatedScenario = {
    ...initialScenario,
    rehabBudget: 42000,
    maxAllowableOffer: 188000,
  };
  const updated = createCase({
    listing: sampleListing,
    dossier: { facts: [] },
    origin: { id: 'orig_1', type: 'manual' }, // same origin
    underwriteScenario: updatedScenario,
  }, { filePath: storePath, now: observedAt });

  assert.equal(updated.created, false);
  assert.equal(updated.case.underwriteScenario?.rehabBudget, 42000);

  // Verify history: underwrite_scenario_updated emitted, duplicate origin_recorded NOT emitted
  const packet = buildPacket(created.case.id, { filePath: storePath });
  assert.equal(packet.case.underwriteScenario?.rehabBudget, 42000);
  assert.equal(packet.case.timeline.some((e) => e.type === 'underwrite_scenario_updated'), true);
  const originRecordedEvents = packet.case.timeline.filter((e) => e.type === 'origin_recorded');
  assert.equal(originRecordedEvents.length, 0); // initial was case_created, and update didn't re-emit origin_recorded

  // 4. Record decision details
  packet.case.decision = {
    state: 'pursue',
    decidedAt: '2026-11-07T20:00:00.000Z',
    reasonCodes: ['price_below_target', 'title_clear'],
    note: 'Modeled with $42k rehab; verified 8-month carrying cost fits target yield.',
  };

  // 5. Render to Markdown and assert presence of sections
  const md = packetToMarkdown(packet);
  assert.match(md, /## Decision details/);
  assert.match(md, /- State: pursue/);
  assert.match(md, /- Reason codes: price\\_below\\_target, title\\_clear/);
  assert.match(md, /- Note: Modeled with \$42k rehab/);
  assert.match(md, /## Saved underwriting assumptions/);
  assert.match(md, /- Custom valuation: \$310000/);
  assert.match(md, /- Max allowable offer: \$188000/);
  assert.match(md, /- Rehab budget: \$42000/);
  assert.match(md, /- Target margin: 25%/);
  assert.match(md, /- Holding period: 8 months/);
});

test('computeCashToClose calculates acquisition model on buyer-assumed opening bids', () => {
  const publishedNull = null;
  const buyerAssumed = 95000;
  const effectiveBid = publishedNull ?? buyerAssumed;

  const cash = computeCashToClose({
    openingBid: effectiveBid,
    purchasePrice: effectiveBid,
    buyersPremium: 0,
    sheriffPoundage: 0,
    transferTax: 500,
    delinquentTaxes: 1500,
    settlementCosts: 2000,
  });

  assert.equal(cash.acquisitionCostStatus, 'complete');
  assert.equal(cash.totalAcquisitionCost, 99000);
});
