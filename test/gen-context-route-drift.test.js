'use strict';

// test/gen-context-route-drift.test.js
//
// gen-context.js embeds a digest of its inputs and CI runs it with --check, so
// a change to its sources "is caught mechanically instead of rotting silently".
//
// It did not do that for routes. loadRoutes() called fs.readdirSync() on
// server/routes and returned *filenames*, then returned a hardcoded
// `inline: ['sources','health']`. It never opened a file inside server/routes
// and never looked at server.js at all. So the digest moved when a route file
// was renamed, and stayed perfectly still when a route was added to, removed
// from, or had its path changed - which is what adding an endpoint looks like.
//
// The inline list was also asserted by hand and was wrong: /api/health/ready is
// served inline by server.js and was missing from it.
//
// Everything here runs against a throwaway tree via --root, so this file never
// disturbs the real CONTEXT.md. `node --test` runs files in parallel.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { computeFacts, computeDigest } = require('../scripts/gen-context');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'gen-context.js');

const BASE_SERVER = [
  "const url = new URL(req.url, 'http://localhost');",
  "if (url.pathname === '/api/sources') {",
  '  const sources = await db.getSources();',
  '  return res.json(sources);',
  '}',
  "if (url.pathname === '/api/coverage') {",
  '  return handleCoverage(req, res);',
  '}',
  // `startsWith(` puts a paren between the operator and the quote. The first
  // version of the parser required a quote immediately after the operator, so
  // every pure-startsWith branch was skipped - /api/listings among them - and
  // the table quietly under-reported the API. This fixture exists to keep that
  // shape covered.
  "if (url.pathname.startsWith('/api/listings')) return handleListings(req, res);",
  "if (url.pathname === '/api/hunts' || url.pathname.startsWith('/api/hunts/')) return handleHunts(req, res, url);",
  '',
].join('\n');

function tree(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-genctx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'server', 'routes'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'data.js'),
    'window.SOURCES = { civilview: { label: "CivilView", tier: "A" } };\nwindow.LISTINGS = [{ state: "NJ", propType: "condo" }];\n'
  );
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node -e ""' } }));
  fs.writeFileSync(path.join(dir, 'server', 'server.js'), BASE_SERVER);
  fs.writeFileSync(path.join(dir, 'server', 'routes', 'coverage.js'), 'function handleCoverage(){}\nmodule.exports=handleCoverage;\n');
  return dir;
}

function run(args) {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { passed: true, output: '' };
  } catch (error) {
    return { passed: false, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

test('adding a route to server.js makes the digest stale', (t) => {
  const dir = tree(t);
  assert.ok(run(['--root', dir]).passed, 'the initial generate must succeed');
  assert.ok(run(['--check', '--root', dir]).passed, 'a freshly generated tree must be current');

  // The most ordinary route change there is: one more endpoint in the dispatch
  // table. No file is renamed, no file is added to server/routes.
  fs.appendFileSync(
    path.join(dir, 'server', 'server.js'),
    "if (url.pathname === '/api/brand-new') { return handleBrandNew(req, res); }\n"
  );

  const result = run(['--check', '--root', dir]);
  assert.equal(
    result.passed,
    false,
    'adding a route must make --check fail; a new endpoint that leaves the digest still is exactly the rot this guard exists to catch'
  );
  assert.match(result.output, /STALE/);
});

test('changing an existing route path makes the digest stale', (t) => {
  const dir = tree(t);
  run(['--root', dir]);
  const file = path.join(dir, 'server', 'server.js');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('/api/coverage', '/api/coverage-v2'));
  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false, 'renaming a served path must move the digest');
});

test('removing a route makes the digest stale', (t) => {
  const dir = tree(t);
  run(['--root', dir]);
  // Drop the /api/coverage branch entirely. Nothing is renamed; a path simply
  // stops being served.
  fs.writeFileSync(
    path.join(dir, 'server', 'server.js'),
    "const url = new URL(req.url, 'http://localhost');\nif (url.pathname === '/api/sources') { return res.json([]); }\n"
  );
  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false, 'removing a dispatched path must move the digest');
  assert.match(result.output, /STALE/);
});

test('adding a route module moves the digest too', (t) => {
  const dir = tree(t);
  run(['--root', dir]);
  fs.writeFileSync(path.join(dir, 'server', 'routes', 'brand-new.js'), 'module.exports={};\n');
  const result = run(['--check', '--root', dir]);
  assert.equal(result.passed, false, 'a new route module must move the digest');
});

test('the rendered CONTEXT.md names the routes it claims to model', (t) => {
  const dir = tree(t);
  run(['--root', dir]);
  const ctx = fs.readFileSync(path.join(dir, 'CONTEXT.md'), 'utf8');
  assert.match(ctx, /\/api\/sources/);
  assert.match(ctx, /\/api\/coverage/);
  assert.match(ctx, /handleCoverage/);
  // The inline list used to be hand-written and omitted /api/health/ready.
  // It is now derived from server.js, so an inline path must be labelled.
  assert.match(ctx, /inline/i);
  assert.doesNotMatch(ctx, /inline: \['sources', 'health'\]/);
});

test('the repo CONTEXT.md is current and lists a real dispatch table', () => {
  const result = run(['--check']);
  assert.ok(result.passed, result.output);
  const ctx = fs.readFileSync(path.join(ROOT, 'CONTEXT.md'), 'utf8');
  assert.match(ctx, /path\(s\) dispatched from/);
  assert.match(ctx, /-> inline/);
});

test('routes behind a bare startsWith() are captured, not skipped', () => {
  // Regression: the parser's pre-filter required a quote straight after the
  // comparison operator, but `.startsWith(` has a paren there. Every pure
  // startsWith branch was therefore invisible - including /api/listings, the
  // busiest route in the app - while the table still rendered a confident
  // count. A guard whose fixture only used `===` could not see it.
  const { computeFacts } = require('../scripts/gen-context');
  const routed = computeFacts().routed.map((r) => r.path);
  for (const expected of ['/api/listings', '/api/scrapers']) {
    assert.ok(routed.includes(expected), `dispatch table is missing ${expected}`);
  }
  // startsWith branches that also carry an `===` sibling record both.
  assert.ok(routed.includes('/api/hunts'), 'the `===` half of an A || B branch must be recorded');
  assert.ok(routed.includes('/api/hunts/'), 'the startsWith half must be recorded too');
  const byPath = new Map(computeFacts().routed.map((r) => [r.path, r.handler]));
  assert.equal(byPath.get('/api/listings'), 'handleListings');
});

test('CONTEXT.md does not call data.js the source of truth for the catalog', () => {
  // CONTEXT.md's whole job is telling a reader where truth lives. It was headed
  // "Data shape (source of truth)" and reported data.js's 16 SOURCES entries
  // for a catalog that actually holds 163, and its 2094 seed listings for an
  // inventory the live store and the served API both exceed. A reader following
  // that heading would badly misjudge both numbers.
  const facts = computeFacts();
  const ctx = fs.readFileSync(path.join(ROOT, 'CONTEXT.md'), 'utf8');
  assert.doesNotMatch(ctx, /## Data shape \(source of truth\)/);
  assert.match(ctx, /## Data shape/);
  assert.match(ctx, /seed snapshot/i);
  // The authoritative taxonomy must be present and named as such.
  assert.match(ctx, /server\/sources\/catalog\.js/);
  assert.ok(
    ctx.includes(`**${facts.catalogCount} catalog entries**`),
    `CONTEXT.md must state the real catalog size (${facts.catalogCount})`
  );
  assert.ok(
    facts.catalogCount > facts.sourceCount,
    'fixture assumption: the catalog is much larger than data.js SOURCES'
  );
});

test('a catalog change moves the digest', () => {
  // The catalog is now part of what CONTEXT.md claims, so changing it must
  // invalidate the document rather than leaving a stale one behind.
  const facts = computeFacts();
  // Without this, the test below would pass against a computeFacts() that has
  // no catalog field at all - it would be guarding nothing.
  assert.equal(
    typeof facts.catalogCount, 'number',
    'computeFacts must expose the catalog size for the digest to depend on it'
  );
  assert.ok(facts.catalogCount > 0);
  const before = computeDigest(facts);
  const after = computeDigest({ ...facts, catalogCount: facts.catalogCount + 1 });
  assert.notEqual(before, after, 'catalog size must participate in the digest');
});
