'use strict';

// test/verify-gate-classify.test.js
//
// Pins the blast-radius classifier in scripts/verify-gate.js.
//
// Why this matters more than it looks: the classifier decides *which* suites run
// before anyone can call a change "done". The original version only recognised
// server/routes, server/scrapers, server/ai, server/db, and src/. Everything
// else fell through to "trivial", which runs a single fast unit suite.
//
// That meant server/discovery/query.js, server/intelligence/signals.js,
// server/security/workspace-identity.js, server/sources/catalog.js, every
// migration, package.json, and every Docker file were certified after running
// one small suite. Real defects in exactly those modules passed the gate green.
// Widening a suite's file list is not cosmetic either — it changes the
// verification surface, which is why package.json is schema-relevant.
//
// A classifier that silently degrades is worse than no gate, so these cases are
// pinned explicitly. If a new top-level directory appears, the "no unclassified
// runtime path" test forces a decision rather than defaulting to trivial.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { classifyChange, getGate } = require('../scripts/verify-gate');

const ROOT = path.resolve(__dirname, '..');

// Every one of these was previously classified "trivial" and therefore
// certified after a single fast suite. They are the regression set.
const MUST_NOT_BE_TRIVIAL = [
  'server/discovery/query.js',
  'server/discovery/run-report.js',
  'server/discovery/store.js',
  'server/intelligence/signals.js',
  'server/intelligence/hunts.js',
  'server/intelligence/portfolio-dashboard.js',
  'server/security/workspace-identity.js',
  'server/security/operator-token.js',
  'server/security/sanitizer.js',
  'server/sources/catalog.js',
  'server/sources/observations.js',
  'server/public-records/florida.js',
  'server/db/migrations/015_status_contract.sql',
  'server/db/migrations/006_discovery_brain.sql',
  'src/lib/db/schema.sql',
  'src/lib/workspace-proxy.ts',
  'package.json',
  'package-lock.json',
  '.dockerignore',
  'docker-compose.yml',
  'Dockerfile.production',
  'Dockerfile.discovery',
  'next.config.mjs',
  'scripts/build-data.js',
];

test('no runtime or build path is silently classified as trivial', () => {
  const misclassified = MUST_NOT_BE_TRIVIAL.filter((f) => classifyChange([f]) === 'trivial');
  assert.deepEqual(
    misclassified,
    [],
    'these files run application code or determine the build, but the gate treats '
      + 'them as trivial (one fast suite). That is how real defects passed unnoticed.',
  );
});

test('classification of representative files matches intent', () => {
  const cases = [
    // agent tooling outranks everything
    ['.kilo/thing.md', 'agent'],
    ['memory/episodes/x.md', 'agent'],
    ['scripts/verify-gate.js', 'agent'],
    ['scripts/gen-skills-index.js', 'agent'],
    // schema + generated inventory
    ['data.js', 'schema'],
    ['server/db/schema.sql', 'schema'],
    ['server/db/client.js', 'schema'],
    ['server/db/migrations/013_discovery_run_coverage.sql', 'schema'],
    ['src/lib/db/schema.sql', 'schema'],
    ['package.json', 'schema'],
    ['CONTEXT.md', 'schema'],
    // scrapers
    ['server/scrapers/treasury.js', 'scraper'],
    ['server/ai/legal-rules.js', 'scraper'],
    ['test/scrapers/federal-scrapers.test.js', 'scraper'],
    // runtime
    ['server/routes/parse.js', 'runtime'],
    ['server/server.js', 'runtime'],
    ['src/app/page.tsx', 'runtime'],
    ['src/components/terminal/bidding-simulator.tsx', 'runtime'],
    ['scripts/build-data.js', 'runtime'],
    ['.dockerignore', 'runtime'],
    ['docker-compose.yml', 'runtime'],
    // genuinely trivial
    ['docs/hunts-workflow.md', 'trivial'],
    ['README.md', 'trivial'],
    ['test/some-suite.test.js', 'trivial'],
    ['test/ai/notice-parser.test.js', 'trivial'],
  ];
  for (const [file, expected] of cases) {
    assert.equal(classifyChange([file]), expected, `${file} should classify as ${expected}`);
  }
});

test('no change set classifies as trivial', () => {
  assert.equal(classifyChange([]), 'trivial');
});

test('the most severe classification wins across a mixed change set', () => {
  // A change that touches agent tooling and the UI still gets the agent gate.
  assert.equal(classifyChange(['README.md', '.agents/x.md']), 'agent');
  // Schema outranks runtime: a migration + a route is a schema change.
  assert.equal(classifyChange(['server/routes/parse.js', 'data.js']), 'schema');
  // Scraper outranks runtime: a scraper + a route is a scraper change.
  assert.equal(classifyChange(['server/routes/parse.js', 'server/scrapers/irs.js']), 'scraper');
  // One runtime file among docs is still runtime.
  assert.equal(classifyChange(['README.md', 'server/sources/catalog.js']), 'runtime');
});

test('every non-trivial gate runs at least one suite', () => {
  for (const type of ['trivial', 'scraper', 'schema', 'runtime', 'agent', 'full']) {
    const gate = getGate(type);
    assert.ok(gate, `${type} must have a gate`);
    assert.ok(Array.isArray(gate.suites) && gate.suites.length > 0, `${type} must run a suite`);
  }
});

test('the runtime gate covers hardening, which is the test the a58f76f audit needed', () => {
  // A regression in bidding-simulator.tsx was caught by test:unit's client-AI
  // guard. The runtime gate must keep a suite that would notice that class of
  // change, or a UI-only edit certifies itself with the fast suite alone.
  const cmds = getGate('runtime').suites.join('\n');
  assert.match(cmds, /suite\.test\.js|hardening\.test\.js|server\.test\.js/);
});

test('every top-level server directory is classified, none silently trivial', () => {
  // Discovers directories that did not exist when this test was written.
  const serverDir = path.join(ROOT, 'server');
  const subdirs = fs
    .readdirSync(serverDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.ok(subdirs.length > 0);

  const triviallyTreated = [];
  for (const dir of subdirs) {
    const sample = `server/${dir}/probe.js`;
    if (classifyChange([sample]) === 'trivial') triviallyTreated.push(sample);
  }
  assert.deepEqual(
    triviallyTreated,
    [],
    'a new server/ subdirectory defaults to the trivial gate. Add it to classifyChange '
      + 'so changes inside it are verified proportionally.',
  );
});
