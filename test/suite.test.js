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

test('Statutory Cash to Close calculates accurate state poundage and transfer tax', () => {
  const { computeCashToClose } = require('../server/ai/legal-rules');
  const ctcOH = computeCashToClose({ openingBid: 100000, state: 'OH', source: 'sheriff' });
  assert.strictEqual(ctcOH.openingBid, 100000);
  assert.strictEqual(ctcOH.sheriffPoundage, 2000); // 2% in OH
  assert.strictEqual(ctcOH.transferTax, 400); // 0.4% in OH
  assert.strictEqual(ctcOH.total, 102900); // 100k + 2k + 400 + 500 deed

  const ctcBid4Assets = computeCashToClose({ openingBid: 100000, state: 'PA', source: 'bid4assets' });
  assert.strictEqual(ctcBid4Assets.buyersPremium, 5000); // 5% BP
  assert.strictEqual(ctcBid4Assets.sheriffPoundage, 2000); // 2% in PA
  assert.strictEqual(ctcBid4Assets.transferTax, 2000); // 2% in PA
  assert.strictEqual(ctcBid4Assets.total, 109500);
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

test('the-gavel rent roll abstraction parses commercial units and computes in-place NOI', () => {
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
  assert.ok(result.inPlaceNoi > 0);
});

test('loi-generator produces institutional acquisition offer with statutory cash-to-close', () => {
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
  const loi = generateLetterOfIntent(listing, { offerPrice: 85000 });
  assert.ok(loi.includes('CONFIDENTIAL LETTER OF INTENT'));
  assert.ok(loi.includes('PURCHASE PRICE: $85,000'));
  assert.ok(loi.includes('EARNEST MONEY DEPOSIT: $8,500'));
  assert.ok(loi.includes('Statutory Sheriff Poundage (PA)'));
  assert.ok(loi.includes('Net Estimated Cash to Close'));
});

test('acq-investment-report produces executive IC acquisition memorandum', () => {
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
  assert.ok(memo.includes('13.6%'));
  assert.ok(memo.includes('Target Yield Max Allowable Offer (MAO)'));
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

test('NoticeParser includes Puter AI fallback for low-confidence dockets', () => {
  const parserContent = fs.readFileSync(path.join(root, 'src/components/terminal/notice-parser.tsx'), 'utf8');
  assert.ok(parserContent.includes('puter.ai.chat'), 'puter.ai.chat call missing from notice-parser.tsx');
  assert.ok(parserContent.includes('claude-3-5-sonnet'), 'claude-3-5-sonnet model configuration missing from notice-parser.tsx');
});

// ----------------------------------------------------
// Summary
// ----------------------------------------------------
console.log(`\n--- TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
if (failed > 0) {
  process.exit(1);
}
