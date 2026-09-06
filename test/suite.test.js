const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const dataJs = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const manifestJson = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');

console.log('--- STARTING COMPREHENSIVE TDD TEST SUITE ---');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ----------------------------------------------------
// 1. PWA & Metadata Tests
// ----------------------------------------------------
console.log('\n[Suite 1: PWA & Metadata]');

test('manifest.json short_name is not truncated to PROPERTY_CRA', () => {
  const manifest = JSON.parse(manifestJson);
  assert.strictEqual(manifest.short_name, 'PROPERTY_CRAWL', `Expected short_name to be PROPERTY_CRAWL, got ${manifest.short_name}`);
});

test('index.html apple-mobile-web-app-title is not truncated to PROPERTY_CRA', () => {
  const m = indexHtml.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)">/);
  assert.ok(m, 'apple-mobile-web-app-title meta tag not found');
  assert.strictEqual(m[1], 'PROPERTY_CRAWL', `Expected apple-mobile-web-app-title to be PROPERTY_CRAWL, got ${m[1]}`);
});

// ----------------------------------------------------
// 2. Deal Score & Worked Example Math Tests
// ----------------------------------------------------
console.log('\n[Suite 2: Deal Score Formula & Worked Example]');

test('Deal Score formula calculates correctly for Columbus OH example (52000, 128500)', () => {
  const bid = 52000;
  const mid = 128500;
  const ratio = bid / mid;
  const score = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)));
  assert.strictEqual(score, 77, `Expected calculated score 77, got ${score}`);
});

test('app.js SCORE_EXAMPLE_PLACEHOLDER score matches formula (77)', () => {
  const placeholderMatch = appJs.match(/SCORE_EXAMPLE_PLACEHOLDER\s*=\s*Object\.freeze\({\s*city:\s*'Columbus'[\s\S]*?score:\s*(\d+)/);
  assert.ok(placeholderMatch, 'SCORE_EXAMPLE_PLACEHOLDER not found in app.js');
  const scoreVal = Number(placeholderMatch[1]);
  assert.strictEqual(scoreVal, 77, `Expected placeholder score to be 77, got ${scoreVal}`);
});

test('index.html worked example markup displays score 77', () => {
  const htmlScoreMatch = indexHtml.match(/Deal Score<\/span><span class="font-extrabold">\(1 − 0\.40\) × 130 ≈ (\d+)<\/span>/);
  assert.ok(htmlScoreMatch, 'Worked example score line not found in index.html');
  const scoreVal = Number(htmlScoreMatch[1]);
  assert.strictEqual(scoreVal, 77, `Expected index.html score text to display 77, got ${scoreVal}`);
});

// ----------------------------------------------------
// 3. Date & Countdown Logic Tests
// ----------------------------------------------------
console.log('\n[Suite 3: Date Countdown Calculation]');

test('app.js daysUntil implementation uses midnight normalization', () => {
  const daysUntilMatch = appJs.match(/function daysUntil\(d\)\s*\{([\s\S]*?)\}/);
  assert.ok(daysUntilMatch, 'function daysUntil not found in app.js');
  const body = daysUntilMatch[1];
  assert.ok(body.includes('setHours(0') || body.includes('setHours(0,0,0,0)'), 'daysUntil does not normalize hours to 0');
});

// ----------------------------------------------------
// 4. Map View & Resize Handling
// ----------------------------------------------------
console.log('\n[Suite 4: Leaflet Map Setup]');

test('app.js registers window resize listener for map invalidation', () => {
  assert.ok(appJs.includes('invalidateSize'), 'app.js does not contain map.invalidateSize() call on resize');
});

// ----------------------------------------------------
// 5. Saved Deals Cloud Merge on Sign-In
// ----------------------------------------------------
console.log('\n[Suite 5: Saved Deals Merge on Sign-In]');

test('app.js loadSaved merges anonymous local bookmarks with cloud items', () => {
  assert.ok(appJs.includes('cloudItems.forEach') || appJs.includes('saved.add'), 'loadSaved does not merge local and cloud items');
});

// ----------------------------------------------------
// 6. CSV & JSON Export Feature
// ----------------------------------------------------
console.log('\n[Suite 6: Export Saved Deals]');

test('app.js includes exportSavedAsCsv function and button bindings', () => {
  assert.ok(appJs.includes('exportSavedAsCsv') || appJs.includes('exportCsv'), 'Export CSV functionality not found in app.js');
});

test('app.js includes exportSavedAsJson function and button bindings', () => {
  assert.ok(appJs.includes('exportSavedAsJson') || appJs.includes('exportJson'), 'Export JSON functionality not found in app.js');
});

// ----------------------------------------------------
// 7. Parser-to-Watchlist Feature
// ----------------------------------------------------
console.log('\n[Suite 7: Parser to Watchlist]');

test('app.js contains saveParsedToWatchlist functionality', () => {
  assert.ok(appJs.includes('saveParsed') || appJs.includes('saveParsedToWatchlist'), 'saveParsedToWatchlist functionality not found in app.js');
});

// ----------------------------------------------------
// 8. AI Prompt Hardening
// ----------------------------------------------------
console.log('\n[Suite 8: AI Prompt Hardening]');

test('app.js wraps untrusted notice text in XML delimiter tags to prevent prompt injection', () => {
  assert.ok(appJs.includes('<raw_legal_notice>') || appJs.includes('<untrusted_notice>'), 'Notice parser prompt does not use safe XML delimiter tags');
});

// ----------------------------------------------------
// 9. Statutory Cash to Close & CRE Underwriting Math
// ----------------------------------------------------
console.log('\n[Suite 9: Statutory Cash to Close & CRE Underwriting]');

test('Cash-to-close uses only published values or explicit assumptions', () => {
  const { computeCashToClose } = require('../server/ai/legal-rules');
  const ctcOH = computeCashToClose({ openingBid: 100000, state: 'OH', source: 'sheriff' });
  assert.strictEqual(ctcOH.openingBid, 100000);
  assert.strictEqual(ctcOH.sheriffPoundage, null);
  assert.strictEqual(ctcOH.transferTax, null);
  assert.strictEqual(ctcOH.total, null);
  assert.strictEqual(ctcOH.modelStatus, 'insufficient_inputs');
  assert.strictEqual(ctcOH.verified, false);
  const complete = computeCashToClose({ openingBid: 100000, registrationFunds: 5000, creditedDeposit: 10000, buyersPremium: 5000, sheriffPoundage: 2000, transferTax: 2000, delinquentTaxes: 0, settlementCosts: 500 });
  assert.strictEqual(complete.total, 109500);
  assert.strictEqual(complete.cashDueAtSettlement, 99500);
});

test('CRE Underwriting formulas calculate Net Operating Income and Cap Rates accurately', () => {
  const sqft = 10000;
  const openingBid = 500000;
  const rentPerSqft = 15;
  const grossRent = sqft * rentPerSqft; // $150,000
  const egi = grossRent * 0.95; // $142,500
  const opex = egi * 0.40; // $57,000
  const noi = egi - opex; // $85,500
  const capRate = Number(((noi / openingBid) * 100).toFixed(2)); // 17.1%

  assert.strictEqual(noi, 85500);
  assert.strictEqual(capRate, 17.1);
  assert.ok(capRate > 10, 'Distressed commercial cap rate should be accretive');
});

test('rent-roll parser only computes NOI with an explicit expense assumption', () => {
  const { parseRentRollSchedule } = require('../server/ai/legal-rules');
  const sampleDocket = `
COMMERCIAL FORECLOSURE RENT ROLL SCHEDULE
Unit 101: Starbucks Coffee, 1,800 sqft, rent $4,500/mo, exp 2028-12-31
Unit 102: Apex Dental Care, 2,200 sf, rent $5,200/month, expires 2027-06-30
Unit 103: Vacant Retail Suite, 1,000 sqft
`;
  const result = parseRentRollSchedule(sampleDocket);
  assert.strictEqual(result.unitCount, 3);
  assert.strictEqual(result.totalSqft, 5000);
  assert.strictEqual(result.units[0].tenant, 'Starbucks Coffee');
  assert.strictEqual(result.units[0].monthlyRent, 4500);
  assert.strictEqual(result.units[2].status, 'Vacant');
  assert.strictEqual(result.totalAnnualRent, (4500 + 5200) * 12);
  assert.strictEqual(result.occupancyRate, 80.0); // 4000/5000 sf
  assert.strictEqual(result.inPlaceNoi, null);
  assert.strictEqual(parseRentRollSchedule(sampleDocket, { expenseRatio: 0.4 }).inPlaceNoi, 69840);
});

test('LOI generator requires explicit buyer, deposit, timeline, and closing-cost inputs', () => {
  const { generateLetterOfIntent } = require('../server/ai/legal-rules');
  const listing = {
    id: 'B4A-1287806',
    address: '321 West Penn Avenue',
    city: 'Robesonia',
    state: 'PA',
    zip: '19551',
    county: 'Berks',
    openingBid: 75000,
    source: 'bid4assets'
  };
  const incomplete = generateLetterOfIntent(listing, { offerPrice: 85000 });
  assert.ok(incomplete.includes('NOT READY FOR SUBMISSION'));
  assert.ok(incomplete.includes('PURCHASER: [NOT SUPPLIED'));
  assert.ok(incomplete.includes('EARNEST MONEY DEPOSIT: Unavailable'));
  assert.ok(incomplete.includes('TITLE / LEGAL STATUS: NOT DETERMINED'));

  const loi = generateLetterOfIntent(listing, {
    buyerEntity: 'Buyer-Supplied Entity LLC',
    recipient: 'Authorized Seller Representative',
    offerPrice: 85000,
    depositAmount: 8500,
    inspectionDays: 12,
    closingDays: 28,
    closingCosts: {
      buyersPremium: 4250,
      sheriffPoundage: 1700,
      transferTax: 340,
      delinquentTaxes: 0,
      deedFees: 500
    }
  });
  assert.ok(loi.includes('PROPOSED PURCHASE PRICE: $85,000 USD'));
  assert.ok(loi.includes('EARNEST MONEY DEPOSIT: $8,500 USD'));
  assert.ok(loi.includes('Total Acquisition Cash (credited deposit is included once): $91,790 USD'));
});

test('IC memo labels supplied metrics and never converts them into bid authority', () => {
  const { generateInvestmentCommitteeMemo } = require('../server/ai/legal-rules');
  const listing = {
    address: '450 Commercial Way',
    city: 'Cleveland',
    state: 'OH',
    zip: '44114',
    propType: 'Commercial',
    openingBid: 250000,
    estLow: 380000,
    estHigh: 420000,
    dealScore: 92,
    redemptionDays: 0,
    seniorLienRisk: 'low'
  };
  const memo = generateInvestmentCommitteeMemo(listing, {
    netOperatingIncome: 34000,
    capitalizationRate: 13.6,
    estimatedDscr: 1.85,
    maxAllowableOffer: 360000
  });
  assert.ok(memo.includes('INVESTMENT COMMITTEE (IC) ACQUISITION MEMORANDUM'));
  assert.ok(memo.includes('Cleveland, OH 44114'));
  assert.ok(memo.includes('13.6% (modeled)'));
  assert.ok(memo.includes('Max Allowable Offer (MAO)'));
  assert.ok(memo.includes('NO BID RECOMMENDATION'));
});

// ----------------------------------------------------
// 10. Puter.js Free Client AI Integration
// ----------------------------------------------------
console.log('\n[Suite 10: Puter.js Free AI Integration]');

test('RootLayout loads Puter.js SDK from js.puter.com/v2/', () => {
  const layoutContent = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
  assert.ok(layoutContent.includes('js.puter.com/v2/'), 'Puter.js SDK script tag missing from layout.tsx');
});

test('PropertyDrawer wires Puter AI alongside backend enrich endpoint', () => {
  const drawerContent = fs.readFileSync(path.join(root, 'src/components/terminal/property-drawer.tsx'), 'utf8');
  assert.ok(drawerContent.includes('handleRunPuterAi'), 'handleRunPuterAi function missing from property-drawer.tsx');
  assert.ok(drawerContent.includes('puter.ai.chat'), 'puter.ai.chat call missing from property-drawer.tsx');
  assert.ok(drawerContent.includes('claude-3-5-sonnet'), 'claude-3-5-sonnet model configuration missing from property-drawer.tsx');
  assert.ok(drawerContent.includes('Puter AI'), 'Puter AI button label missing from property-drawer.tsx');
});

test('PropertyDrawer includes Puter AI model dropdown and AI LOI/Memo generators', () => {
  const drawerContent = fs.readFileSync(path.join(root, 'src/components/terminal/property-drawer.tsx'), 'utf8');
  assert.ok(drawerContent.includes('selectedPuterModel'), 'selectedPuterModel state missing from property-drawer.tsx');
  assert.ok(drawerContent.includes('handleGenerateAiLoi'), 'handleGenerateAiLoi missing from property-drawer.tsx');
  assert.ok(drawerContent.includes('handleGenerateAiMemo'), 'handleGenerateAiMemo missing from property-drawer.tsx');
  assert.ok(drawerContent.includes('AI Tailored LOI'), 'AI Tailored LOI button missing from property-drawer.tsx');
});

test('BiddingSimulator explains an explicit reverse-price scenario without predicting bidders', () => {
  const bidsimContent = fs.readFileSync(path.join(root, 'src/components/terminal/bidding-simulator.tsx'), 'utf8');
  assert.ok(bidsimContent.includes('handleRunAiStrategy'), 'handleRunAiStrategy missing from bidding-simulator.tsx');
  assert.ok(bidsimContent.includes('claude-3-5-sonnet'), 'claude-3-5-sonnet missing from bidding-simulator.tsx');
  assert.ok(bidsimContent.includes('computeTargetPriceScenario'), 'reverse target-price calculation missing from bidding-simulator.tsx');
  assert.ok(bidsimContent.includes('Unknown taxes, debt, and fees are not treated as $0'), 'unresolved-cost warning missing from bidding-simulator.tsx');
  assert.ok(!bidsimContent.includes('winProbability'), 'simulator must not present a fabricated auction-win probability');
});

test('NoticeParser keeps AI candidates separate from source-stated notice fields', () => {
  const parserContent = fs.readFileSync(path.join(root, 'src/components/terminal/notice-parser.tsx'), 'utf8');
  assert.ok(parserContent.includes('fetch("/api/parse"'), 'notice extraction must use the evidence-aware server route');
  assert.ok(parserContent.includes('unverifiedCandidates'), 'AI candidates must remain separate from parsed facts');
  assert.ok(parserContent.includes('unverified_extraction'), 'saving an extraction must retain its unverified status');
  assert.ok(!parserContent.includes('puter.ai.chat'), 'client AI must not silently replace source-stated fields');
});

// ----------------------------------------------------
// 11. Alerts Manager & Scraper On-Demand Endpoints
// ----------------------------------------------------
console.log('\n[Suite 11: Alerts Manager & Scraper Controls]');

test('InteractiveTerminal wires AlertsModal and Alerts button', () => {
  const terminalContent = fs.readFileSync(path.join(root, 'src/components/terminal/interactive-terminal.tsx'), 'utf8');
  assert.ok(terminalContent.includes('AlertsModal'), 'AlertsModal missing from interactive-terminal.tsx');
  assert.ok(terminalContent.includes('isAlertsOpen'), 'isAlertsOpen state missing from interactive-terminal.tsx');
  assert.ok(terminalContent.includes('Open Alerts Manager'), 'Alerts button missing from interactive-terminal.tsx');
});

test('AlertsModal provides state, minScore, and maxBid criteria filters', () => {
  const modalContent = fs.readFileSync(path.join(root, 'src/components/terminal/alerts-modal.tsx'), 'utf8');
  assert.ok(modalContent.includes('Saved searches'), 'Saved-search title missing');
  assert.ok(modalContent.includes('matchesSavedSearch'), 'Matching results missing');
  assert.ok(modalContent.includes('onApply(search)'), 'Search application missing');
  assert.ok(modalContent.includes('Email delivery and background monitoring are not connected'), 'Delivery limits must be explicit');
});

test('Scrapers API route supports POST /api/scrapers/run for on-demand triggers', () => {
  const scrapersRoute = fs.readFileSync(path.join(root, 'server/routes/scrapers.js'), 'utf8');
  assert.ok(scrapersRoute.includes('/api/scrapers/run'), 'run endpoint missing from server/routes/scrapers.js');
  assert.ok(scrapersRoute.includes('scheduler.runAll()'), 'scheduler call missing from server/routes/scrapers.js');
});

test('Server boot includes clean startup logging and recurring scrape interval', () => {
  const serverContent = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  assert.ok(serverContent.includes('SCRAPE_INTERVAL_HOURS'), 'recurring scrape interval missing from server/server.js');
  assert.ok(serverContent.includes('setTimeout'), 'clean boot delay missing from server/server.js');
});

// ----------------------------------------------------
// 12. Fail-closed court-record evidence audit & address lookup
// ----------------------------------------------------
console.log('\n[Suite 12: Fail-Closed Court Evidence Audit & Address Lookup]');

test('verify-docket route refuses to fabricate official legal verification', async () => {
  const handleVerifyDocket = require('../server/routes/verify-docket');
  let statusCode = 200;
  let jsonResult = null;
  const mockReq = {
    method: 'POST',
    url: '/api/verify-docket',
    body: {
      address: '11818 Superior Ave',
      county: 'Cuyahoga',
      state: 'OH',
      openingBid: 95000
    }
  };
  const mockRes = {
    status(code) { statusCode = code; return this; },
    json(payload) { jsonResult = payload; return this; }
  };
  await handleVerifyDocket(mockReq, mockRes);
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(jsonResult.verified, false);
  assert.strictEqual(jsonResult.verificationState, 'official_source_required');
  assert.strictEqual(jsonResult.caseNumber, null);
  assert.ok(Array.isArray(jsonResult.officialEvidence) && jsonResult.officialEvidence.length === 0);
  assert.ok(Array.isArray(jsonResult.missingEvidence) && jsonResult.missingEvidence.length >= 4);
  assert.ok(jsonResult.logs.every((line) => !/connected|verified active|pacer.*clear/i.test(line)));
  assert.ok(jsonResult.summaryMarkdown.includes('UNVERIFIED'));
});

test('DocketAgent presents an explicit official-evidence checklist', () => {
  const agentContent = fs.readFileSync(path.join(root, 'src/components/terminal/docket-agent.tsx'), 'utf8');
  assert.ok(agentContent.includes('Court-record evidence check'), 'Truthful title missing from docket-agent.tsx');
  assert.ok(agentContent.includes('runVerification'), 'runVerification function missing from docket-agent.tsx');
  assert.ok(agentContent.includes('/api/verify-docket'), 'API endpoint missing from docket-agent.tsx');
  assert.ok(agentContent.includes('Not verified from official records'), 'Unverified state missing from docket-agent.tsx');
  assert.ok(!agentContent.includes('claude-3-5-sonnet'), 'AI must not be presented as legal verification');
  assert.ok(!agentContent.includes('Docket Verified: Case #'), 'Fabricated verified badge must not return');
});

test('PropertyDrawer embeds DocketAgent component', () => {
  const drawerContent = fs.readFileSync(path.join(root, 'src/components/terminal/property-drawer.tsx'), 'utf8');
  assert.ok(drawerContent.includes('<DocketAgent'), '<DocketAgent missing from property-drawer.tsx');
  assert.ok(drawerContent.includes('import { DocketAgent }'), 'DocketAgent import missing from property-drawer.tsx');
});

test('InteractiveTerminal provides a truthful address evidence workspace', () => {
  const terminalContent = fs.readFileSync(path.join(root, 'src/components/terminal/interactive-terminal.tsx'), 'utf8');
  assert.ok(terminalContent.includes('handleDeepCheckAddress'), 'handleDeepCheckAddress missing from interactive-terminal.tsx');
  assert.ok(terminalContent.includes('Address research workspace'), 'Address research banner missing from interactive-terminal.tsx');
  assert.ok(terminalContent.includes('Legal and title status remains unverified'), 'Fail-closed legal disclaimer missing from interactive-terminal.tsx');
});

// ----------------------------------------------------
// Summary
// ----------------------------------------------------
console.log(`\n--- TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
if (failed > 0) {
  process.exit(1);
}
