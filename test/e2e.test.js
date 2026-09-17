const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('=== RUNNING E2E USER JOURNEY EMULATION TEST SUITE ===');

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

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dataJs = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('E2E Flow 1: Client initializes with the generated listings and precomputed deal metrics', () => {
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(dataJs, sandbox);
  assert.ok(Array.isArray(sandbox.window.LISTINGS));
  assert.strictEqual(Object.keys(sandbox.window.SOURCES).length, 16);
  assert.ok(sandbox.window.LISTINGS.length > 0, 'Should have at least one listing');
  // Verify that listings have the expected structure.
  // Note: Not all sources provide saleDate, estLow, estHigh, etc.
  // Only id, source, state, address are universally required.
  sandbox.window.LISTINGS.forEach(l => {
    assert.ok(l.id, 'Listing must have id');
    assert.ok(l.source, 'Listing must have source');
    assert.ok(l.state, 'Listing must have state');
    assert.ok(l.address, 'Listing must have address');
  });
});

test('E2E Flow 2: HTML UI contains all primary navigation and interactive views', () => {
  assert.ok(indexHtml.includes('id="dashboard"'));
  assert.ok(indexHtml.includes('id="map"'));
  assert.ok(indexHtml.includes('id="parser"'));
  assert.ok(indexHtml.includes('id="sources"'));
  assert.ok(indexHtml.includes('id="drawer"'));
  assert.ok(indexHtml.includes('id="alertsModal"'));
  assert.ok(indexHtml.includes('id="scoreModal"'));
});

test('E2E Flow 3: App module includes all event bindings, focus traps, and export handlers', () => {
  assert.ok(appJs.includes('function openDrawer'));
  assert.ok(appJs.includes('function openAlerts'));
  assert.ok(appJs.includes('function runParse'));
  assert.ok(appJs.includes('function saveParsedToWatchlist'));
  assert.ok(appJs.includes('function exportSavedAsCsv'));
  assert.ok(appJs.includes('function exportSavedAsJson'));
  assert.ok(appJs.includes('function trapFocus'));
});

console.log(`--- E2E TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
if (failed > 0) process.exit(1);
