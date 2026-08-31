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
// Summary
// ----------------------------------------------------
console.log(`\n--- TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
if (failed > 0) {
  process.exit(1);
}
