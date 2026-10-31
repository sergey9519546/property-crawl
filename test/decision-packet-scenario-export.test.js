'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDecisionPacket,
  formatDecisionPacketMarkdown,
  computeStatutoryDeadlinesAndCarry
} = require('../server/export/decision-packet');

test('buildDecisionPacket: captures underwriting assumptions and computes carry based on maxAllowableOffer || openingBid', () => {
  const listingWithBid = {
    id: 'SHERIFF-PA-PHI-101',
    address: '123 Market St',
    city: 'Philadelphia',
    state: 'PA',
    county: 'Philadelphia',
    zip: '19106',
    openingBid: 125000,
    saleDate: '2026-11-20',
    source: 'sheriff'
  };

  // 1. With explicit maxAllowableOffer and custom underwriting assumptions
  const packetWithMao = buildDecisionPacket(listingWithBid, {
    disposition: 'UNDERWRITE',
    maxAllowableOffer: 110000,
    rehabBudget: 35000,
    targetMargin: 25,
    operatorNotes: 'Simulated underwriting scenario for auction committee.'
  });

  assert.ok(packetWithMao.underwritingAssumptions);
  assert.equal(packetWithMao.underwritingAssumptions.rehabBudget, 35000);
  assert.equal(packetWithMao.underwritingAssumptions.targetMarginPct, 25);
  assert.equal(packetWithMao.underwritingAssumptions.maxAllowableOffer, 110000);
  assert.equal(packetWithMao.underwritingAssumptions.disposition, 'UNDERWRITE');

  // Carry should be computed based on maxAllowableOffer ($110,000)
  const carryMao = packetWithMao.underwriting.statutoryDeadlinesAndCarry;
  assert.ok(carryMao);
  assert.equal(carryMao.effectiveLockupDays, 30);
  assert.equal(typeof carryMao.totalHoldingCostCarry, 'number');
  assert.ok(carryMao.totalHoldingCostCarry > 0);
  // PA: 30 days lockup, $110,000 * 10% * (30 / 365) = ~904 capital carry
  assert.equal(carryMao.estimatedCarryCost, Math.round(110000 * 0.10 * (30 / 365)));

  // 2. Without explicit maxAllowableOffer, fall back to openingBid ($125,000)
  const packetWithBidFallback = buildDecisionPacket(listingWithBid, {
    disposition: 'UNDERWRITE'
  });

  assert.equal(packetWithBidFallback.underwritingAssumptions.maxAllowableOffer, null);
  assert.equal(packetWithBidFallback.underwritingAssumptions.rehabBudget, 0); // default fallback
  assert.equal(packetWithBidFallback.underwritingAssumptions.targetMarginPct, 30); // default 30%
  const carryBid = packetWithBidFallback.underwriting.statutoryDeadlinesAndCarry;
  assert.ok(carryBid);
  assert.equal(typeof carryBid.totalHoldingCostCarry, 'number');
  assert.ok(carryBid.totalHoldingCostCarry > 0);
  assert.equal(carryBid.estimatedCarryCost, Math.round(125000 * 0.10 * (30 / 365)));

  // 3. Without openingBid and without maxAllowableOffer, dollar carry must be withheld (zero fabrication)
  const unpricedListing = {
    id: 'SHERIFF-PA-PHI-102',
    address: '456 Chestnut St',
    state: 'PA',
    saleDate: '2026-11-20',
    source: 'sheriff'
  };
  const unpricedPacket = buildDecisionPacket(unpricedListing, {});
  const unpricedCarry = unpricedPacket.underwriting.statutoryDeadlinesAndCarry;
  assert.ok(unpricedCarry);
  assert.equal(unpricedCarry.estimatedCarryCost, null);
  assert.equal(unpricedCarry.totalHoldingCostCarry, null);
  assert.equal(unpricedCarry.monthlyHoldingCost, null);
});

test('formatDecisionPacketMarkdown: renders underwriting assumptions and strategy in markdown memo', () => {
  const listing = {
    id: 'TEST-SIM-GA-001',
    address: '500 Peachtree St NE',
    city: 'Atlanta',
    state: 'GA',
    county: 'Fulton',
    zip: '30308',
    openingBid: 180000,
    saleDate: '2026-12-01',
    source: 'sheriff'
  };

  const packet = buildDecisionPacket(listing, {
    disposition: 'UNDERWRITE',
    maxAllowableOffer: 165000,
    rehabBudget: 28000,
    targetMargin: 20
  });

  const md = formatDecisionPacketMarkdown(packet);

  assert.match(md, /## 4\. Underwriting Assumptions & Strategy/);
  assert.match(md, /\*\*Target Purchase Ceiling \(MAO\)\*\*: \$165,000/);
  assert.match(md, /\*\*Estimated Rehab Budget\*\*: \$28,000/);
  assert.match(md, /\*\*Target Profit Margin\*\*: 20%/);
  assert.match(md, /\*\*Disposition Recommendation\*\*: `UNDERWRITE`/);
  assert.match(md, /## 5\. Operator Due Diligence Sign-Off/);
});

test('computeStatutoryDeadlinesAndCarry: correctly identifies expanded 13+ state statutory schedule', () => {
  const baseDate = '2026-11-01';
  const price = 200000;

  const testCases = [
    { state: 'PA', expectedDays: 30, citationPattern: /Pa\.\s*R\.C\.P\.\s*3136/i },
    { state: 'GA', expectedDays: 30, citationPattern: /O\.C\.G\.A\.\s*§?\s*44-14-161/i },
    { state: 'TX', expectedDays: 20, citationPattern: /Tex\.\s*Prop\.\s*Code\s*§?\s*51\.002/i },
    { state: 'MI', expectedDays: 21, citationPattern: /MCL\s*§?\s*600\.3240/i },
    { state: 'SC', expectedDays: 30, citationPattern: /S\.C\.\s*Code\s*§?\s*15-39-720/i },
    { state: 'TN', expectedDays: 30, citationPattern: /T\.C\.A\.\s*§?\s*67-5-2501/i },
    { state: 'MD', expectedDays: 30, citationPattern: /Md\.\s*Rule\s*14-215/i },
    { state: 'AZ', expectedDays: 30, citationPattern: /A\.R\.S\.\s*§?\s*33-811/i },
    { state: 'IN', expectedDays: 30, citationPattern: /IC\s*32-29-7-10/i },
    { state: 'MO', expectedDays: 30, citationPattern: /RSMo\s*§?\s*443\.355/i },
    { state: 'AL', expectedDays: 180, citationPattern: /Ala\.\s*Code\s*§?\s*6-5-248/i },
    { state: 'NC', expectedDays: 10, citationPattern: /N\.C\.G\.S\.\s*§?\s*45-21\.27/i },
    { state: 'NJ', expectedDays: 10, citationPattern: /R\.\s*4:65-5/i },
    { state: 'FL', expectedDays: 10, citationPattern: /Fla\.\s*Stat\.\s*§?\s*45\.031/i },
    { state: 'OH', expectedDays: 30, citationPattern: /ORC\s*§?\s*2329\.31/i },
    { state: 'CA', expectedDays: 45, citationPattern: /Cal\.\s*Civ\.\s*Code\s*§?\s*2924m/i },
    { state: 'IL', expectedDays: 30, citationPattern: /735\s*ILCS\s*5\/15-1508/i },
    { state: 'NY', expectedDays: 30, citationPattern: /RPAPL\s*§?\s*1354/i }
  ];

  for (const { state, expectedDays, citationPattern } of testCases) {
    const res = computeStatutoryDeadlinesAndCarry({
      saleDate: baseDate,
      state,
      purchasePrice: price
    });

    assert.equal(res.objectionOrConfirmationDays, expectedDays, `State ${state} should have ${expectedDays} objection/confirmation days`);
    assert.equal(res.effectiveLockupDays, expectedDays, `State ${state} should have ${expectedDays} effective lockup days`);
    assert.match(res.objectionLabel, citationPattern, `State ${state} objectionLabel should match citation ${citationPattern}`);
    assert.equal(typeof res.estimatedCarryCost, 'number', `State ${state} should compute estimatedCarryCost`);
    assert.ok(res.estimatedCarryCost > 0, `State ${state} carry cost should be positive`);
    assert.equal(typeof res.totalHoldingCostCarry, 'number', `State ${state} should compute totalHoldingCostCarry`);
  }
});

test('computeStatutoryDeadlinesAndCarry: supports price fallback hierarchy (purchasePrice -> maxAllowableOffer -> openingBid)', () => {
  const baseDate = '2026-11-01';

  // 1. purchasePrice explicitly passed
  const r1 = computeStatutoryDeadlinesAndCarry({
    saleDate: baseDate,
    state: 'PA',
    purchasePrice: 100000,
    maxAllowableOffer: 200000,
    openingBid: 300000
  });
  assert.equal(r1.estimatedCarryCost, Math.round(100000 * 0.10 * (30 / 365)));

  // 2. purchasePrice omitted; maxAllowableOffer used
  const r2 = computeStatutoryDeadlinesAndCarry({
    saleDate: baseDate,
    state: 'PA',
    maxAllowableOffer: 200000,
    openingBid: 300000
  });
  assert.equal(r2.estimatedCarryCost, Math.round(200000 * 0.10 * (30 / 365)));

  // 3. purchasePrice and maxAllowableOffer omitted; openingBid used
  const r3 = computeStatutoryDeadlinesAndCarry({
    saleDate: baseDate,
    state: 'PA',
    openingBid: 300000
  });
  assert.equal(r3.estimatedCarryCost, Math.round(300000 * 0.10 * (30 / 365)));

  // 4. All omitted -> carry is null
  const r4 = computeStatutoryDeadlinesAndCarry({
    saleDate: baseDate,
    state: 'PA'
  });
  assert.equal(r4.estimatedCarryCost, null);
  assert.equal(r4.totalHoldingCostCarry, null);
});

test('API route & BiddingSimulator: correctly wires query parameters and dynamic export URLs', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  const routeSrc = fs.readFileSync(path.join(__dirname, '../src/app/api/listings/[id]/packet/route.ts'), 'utf8');
  assert.match(routeSrc, /url\.searchParams\.get\("disposition"\)/);
  assert.match(routeSrc, /url\.searchParams\.get\("maxAllowableOffer"\)/);
  assert.match(routeSrc, /url\.searchParams\.get\("rehabBudget"\)/);
  assert.match(routeSrc, /url\.searchParams\.get\("targetMargin"\)/);
  assert.match(routeSrc, /url\.searchParams\.get\("operatorNotes"\)/);
  for (const field of ['registrationFunds', 'creditedDeposit', 'buyersPremium', 'sheriffPoundage', 'transferTax', 'delinquentTaxes', 'settlementCosts']) {
    assert.match(routeSrc, new RegExp(`"${field}"`));
  }
  assert.match(routeSrc, /buildDecisionPacket\(listing,\s*operatorInput\)/);

  const compSrc = fs.readFileSync(path.join(__dirname, '../src/components/terminal/bidding-simulator.tsx'), 'utf8');
  assert.match(compSrc, /Export Decision Packet/);
  assert.match(compSrc, /Download JSON Packet/);
  assert.match(compSrc, /Download Markdown Memo/);
  assert.match(compSrc, /\/api\/listings\/\$\{encodeURIComponent\(listing\.id\)\}\/packet\?format=json&disposition=UNDERWRITE/);
  assert.match(compSrc, /\/api\/listings\/\$\{encodeURIComponent\(listing\.id\)\}\/packet\?format=markdown&disposition=UNDERWRITE/);
  assert.match(compSrc, /maxAllowableOffer=\$\{encodeURIComponent\(String\(reverseScenario\?\.maxPurchasePrice \?\? openingBid \?\? ""\)\)\}/);
  assert.match(compSrc, /rehabBudget=\$\{encodeURIComponent\(String\(rehabBudget\)\)\}/);
  assert.match(compSrc, /targetMargin=\$\{encodeURIComponent\(String\(targetMargin\)\)\}/);
});
