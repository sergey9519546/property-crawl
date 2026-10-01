'use strict';

// test/env-docs.test.js
//
// Pins the operator-facing environment variables that .env.example must
// document.
//
// Measured against the tree, code reads 178 environment variables and
// .env.example listed 82 — 99 were undocumented. Most of that gap is benign
// (OS variables like TEMP, local store-path overrides, test-only ports). But a
// subset is not: switches that change safety or write behaviour, where an
// operator who hits the failure has no way to discover the knob.
//
// The worst case is SCRAPER_RESPECT_ROBOTS. The GSA adapter refuses to crawl a
// catalog-declared robots exclusion and its own error message says:
//
//   "Refusing to crawl ...: catalog-declared robots exclusion.
//    Set SCRAPER_RESPECT_ROBOTS=0 to override (operator-only)."
//
// and the source catalog's notes repeat the name. The code told the operator
// exactly which variable to set, and .env.example did not list it.
//
// This test pins the safety- and write-relevant subset. It deliberately does
// not try to close all 99: documenting every internal path override would bury
// the switches that actually matter and would encode assumptions about vars
// that are fine to leave implicit.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function envExample() {
  return fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
}

function documentedNames(text) {
  return new Set([...text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]));
}

// Operator-actionable switches: safety compliance, live-write opt-in, or
// a behaviour an operator must be able to change deliberately.
const SAFETY_CRITICAL = [
  'SCRAPER_RESPECT_ROBOTS',
  'SCRAPLING_LIVE_WRITE',
  'RUN_REAL_SCRAPERS',
  'WORKSPACE_COOKIE_INSECURE',
];

// Operational controls an operator tunes without reading source.
const OPERATIONAL = [
  'SCRAPE_INTERVAL_HOURS',
  'UNBROWSE_PACKAGE_ROOT',
  'UNBROWSE_CONFIG_DIR',
];

// Third-party research clients: unset means the feature is unavailable.
const OPTIONAL_CLIENTS = [
  'PROPERTY_TITLE_BASE_URL',
  'PROPERTY_TITLE_API_KEY',
  'ZILLOW_MCP_BASE_URL',
  'ZILLOW_MCP_API_KEY',
];

test('every safety-critical switch is documented in .env.example', () => {
  const documented = documentedNames(envExample());
  const missing = SAFETY_CRITICAL.filter((name) => !documented.has(name));
  assert.deepEqual(
    missing,
    [],
    'undocumented safety switches. An operator hitting the failure has no way to '
      + 'discover the variable - and SCRAPER_RESPECT_ROBOTS is named in the GSA '
      + 'scraper\'s own refusal message.',
  );
});

test('every operational control is documented in .env.example', () => {
  const documented = documentedNames(envExample());
  assert.deepEqual(OPERATIONAL.filter((n) => !documented.has(n)), []);
});

test('optional third-party research clients are documented', () => {
  const documented = documentedNames(envExample());
  assert.deepEqual(OPTIONAL_CLIENTS.filter((n) => !documented.has(n)), []);
});

test('the robots override is documented with its correct default direction', () => {
  const text = envExample();
  const line = text.split('\n').find((l) => /^\s*#?\s*SCRAPER_RESPECT_ROBOTS\s*=/.test(l));
  assert.ok(line, 'SCRAPER_RESPECT_ROBOTS must have a documented line');
  // The code reads `=== '0'` as the override, so the example must not show a
  // bare "0" as the recommended setting.
  const shown = line.replace(/^\s*#?\s*SCRAPER_RESPECT_ROBOTS\s*=\s*/, '').trim();
  assert.notEqual(
    shown,
    '0',
    'the example must not present 0 as the default; 0 disables a '
      + 'publisher-declared robots restriction',
  );
});

test('the insecure-cookie escape hatch is flagged as development-only', () => {
  const text = envExample();
  const idx = text.indexOf('WORKSPACE_COOKIE_INSECURE');
  assert.ok(idx > 0, 'WORKSPACE_COOKIE_INSECURE must be documented');
  const nearby = text.slice(Math.max(0, idx - 700), idx).toLowerCase();
  assert.match(
    nearby,
    /https|cleartext|development/,
    'the doc must warn that a non-Secure session cookie is sent in cleartext',
  );
});

test('the live-write opt-in is documented as defaulting to read-only', () => {
  const text = envExample().toLowerCase();
  const idx = text.indexOf('scrapling_live_write');
  assert.ok(idx > 0, 'SCRAPLING_LIVE_WRITE must be documented');
  const nearby = text.slice(Math.max(0, idx - 500), idx);
  assert.match(nearby, /read-only|opt-in|opt in/);
});
