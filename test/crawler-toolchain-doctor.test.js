'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  PINNED_SCRAPLING,
  PINNED_CAMOUFOX,
  REQUIREMENTS,
  readPinnedDependency,
  checkUnbrowseReadiness,
  checkScraplingReadiness,
  checkCamoufoxReadiness,
  auditCrawlerToolchain,
} = require('../scripts/crawler-toolchain-doctor.cjs');

test('readPinnedDependency extracts pinned version or returns null', () => {
  assert.equal(readPinnedDependency('scrapling'), PINNED_SCRAPLING);
  assert.equal(readPinnedDependency('camoufox'), PINNED_CAMOUFOX);
  assert.equal(readPinnedDependency('nonexistent_package_xyz'), null);
});

test('checkUnbrowseReadiness verifies installation and config', () => {
  const result = checkUnbrowseReadiness();
  assert.equal(result.name, 'unbrowse');
  assert.equal(typeof result.ok, 'boolean');
  if (result.ok) {
    assert.equal(result.installed, true);
    assert.equal(result.setupReady, true);
    assert.equal(result.tosAccepted, true);
  }
});

test('checkUnbrowseReadiness handles missing package gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-doc-test-'));
  try {
    const result = checkUnbrowseReadiness({ packageRoot: tmpDir, configDir: tmpDir });
    assert.equal(result.ok, false);
    assert.equal(result.installed, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('checkScraplingReadiness fails closed when python runtime is missing', () => {
  const result = checkScraplingReadiness({ python: null });
  assert.equal(result.ok, false);
  assert.equal(result.name, 'scrapling');
  assert.equal(result.checks.find(c => c.name === 'python-runtime').ok, false);
});

test('checkScraplingReadiness validates runner output', () => {
  const mockRunner = () => JSON.stringify({
    version: PINNED_SCRAPLING,
    parser_ok: true,
    stealth_ok: true,
    ok: true,
  });
  const result = checkScraplingReadiness({ python: process.execPath, runner: mockRunner });
  assert.equal(result.ok, true);
  assert.equal(result.version, PINNED_SCRAPLING);
  assert.equal(result.stealthReady, true);
  assert.equal(result.parserReady, true);
});

test('checkScraplingReadiness fails when stealth fetcher fails', () => {
  const mockRunner = () => JSON.stringify({
    version: PINNED_SCRAPLING,
    parser_ok: true,
    stealth_ok: false,
    error: 'Missing curl_cffi',
    ok: false,
  });
  const result = checkScraplingReadiness({ python: process.execPath, runner: mockRunner });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(c => c.name === 'scrapling-stealth').ok, false);
});

test('checkCamoufoxReadiness fails closed when python runtime is missing', () => {
  const result = checkCamoufoxReadiness({ python: null });
  assert.equal(result.ok, false);
  assert.equal(result.name, 'camoufox');
  assert.equal(result.checks.find(c => c.name === 'python-runtime').ok, false);
});

test('checkCamoufoxReadiness validates runner output and binary presence', () => {
  const mockRunner = () => JSON.stringify({
    version: PINNED_CAMOUFOX,
    browser_installed: true,
    browser_version: '156.0.1-beta.36',
    launch_path: '/path/to/camoufox',
    ok: true,
  });
  const result = checkCamoufoxReadiness({ python: process.execPath, runner: mockRunner });
  assert.equal(result.ok, true);
  assert.equal(result.version, PINNED_CAMOUFOX);
  assert.equal(result.browserInstalled, true);
  assert.equal(result.browserVersion, '156.0.1-beta.36');
});

test('checkCamoufoxReadiness fails when browser binary is not downloaded', () => {
  const mockRunner = () => JSON.stringify({
    version: PINNED_CAMOUFOX,
    browser_installed: false,
    browser_version: null,
    launch_path: null,
    ok: false,
  });
  const result = checkCamoufoxReadiness({ python: process.execPath, runner: mockRunner });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(c => c.name === 'camoufox-browser-binary').ok, false);
});

test('auditCrawlerToolchain returns aggregate status for unbrowse, scrapling, and camoufox', () => {
  const result = auditCrawlerToolchain();
  assert.equal(typeof result.ready, 'boolean');
  assert.ok(result.tools.unbrowse);
  assert.ok(result.tools.scrapling);
  assert.ok(result.tools.camoufox);
  assert.equal(result.tools.unbrowse.name, 'unbrowse');
  assert.equal(result.tools.scrapling.name, 'scrapling');
  assert.equal(result.tools.camoufox.name, 'camoufox');
});
