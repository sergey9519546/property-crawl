'use strict';

/**
 * Inventory test: every `/api/...` path the UI fetches must either
 * (a) have a first-class Next route that does NOT go through property-api
 *     (contact/newsletter/form stores), or
 * (b) be accepted by Next's property-api allowlist AND have an App Router
 *     route that can proxy it to the listing API.
 * Template-literal fetches are inventoried by static prefix.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const API_PATH_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/property-api.ts'), 'utf8');
const regexMatch = API_PATH_SRC.match(/const API_PATH = (\/\^[\s\S]+\$\/);/);
assert.ok(regexMatch, 'API_PATH regex not found in property-api.ts');
const API_PATH = eval(regexMatch[1]);

const NEXT_NATIVE_PREFIXES = ['/api/contact', '/api/newsletter'];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function extractFromSource(source) {
  const calls = new Set();
  const prefixes = new Set();
  const re = /fetch\(\s*[`'"](\/api\/[^`'"?]+)[`'"]/g;
  let match;
  while ((match = re.exec(source))) {
    const raw = match[1];
    if (raw.includes('${')) {
      const cut = raw.indexOf('${');
      const prefix = raw.slice(0, cut).replace(/\/$/, '');
      if (prefix.startsWith('/api/')) prefixes.add(prefix);
      continue;
    }
    calls.add(raw.replace(/\/$/, ''));
  }
  return { calls, prefixes };
}

function collectAll() {
  const calls = new Map();
  const prefixes = new Map();
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file);
    const found = extractFromSource(fs.readFileSync(file, 'utf8'));
    for (const c of found.calls) {
      if (!calls.has(c)) calls.set(c, rel);
    }
    for (const p of found.prefixes) {
      if (!prefixes.has(p)) prefixes.set(p, rel);
    }
  }
  return { calls, prefixes };
}

function isNextNative(apiPath) {
  return NEXT_NATIVE_PREFIXES.some((prefix) => apiPath === prefix || apiPath.startsWith(`${prefix}/`));
}

function nextRouteExists(apiPath) {
  const rel = apiPath.replace(/^\/api\//, '');
  const direct = path.join(ROOT, 'src/app/api', rel, 'route.ts');
  if (fs.existsSync(direct)) return true;
  const segments = rel.split('/');
  let current = path.join(ROOT, 'src/app/api');
  for (let i = 0; i < segments.length; i++) {
    const entries = fs.existsSync(current) ? fs.readdirSync(current) : [];
    const exact = path.join(current, segments[i]);
    if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) {
      current = exact;
      continue;
    }
    const catchAll = entries.find((name) => /^\[\.\.\..+\]$/.test(name)
      && fs.statSync(path.join(current, name)).isDirectory());
    if (catchAll) return fs.existsSync(path.join(current, catchAll, 'route.ts'));
    const dynamic = entries.find((name) => /^\[[^.\]].+\]$/.test(name)
      && fs.statSync(path.join(current, name)).isDirectory());
    if (!dynamic) return false;
    current = path.join(current, dynamic);
  }
  return fs.existsSync(path.join(current, 'route.ts'));
}

test('UI fetch paths are accepted by Next API_PATH allowlist (or are Next-native)', () => {
  const { calls, prefixes } = collectAll();
  const missing = [];
  for (const [call, file] of calls) {
    if (isNextNative(call)) continue;
    if (!API_PATH.test(call)) missing.push(`${call} (${file})`);
  }
  for (const [prefix, file] of prefixes) {
    if (isNextNative(prefix)) continue;
    const samples = [prefix, `${prefix}/x`, `${prefix}/job_0123456789abcdef01234567`];
    if (!samples.some((s) => API_PATH.test(s))) missing.push(`${prefix}/* template (${file})`);
  }
  assert.deepEqual(missing, [],
    `UI calls blocked by API_PATH:\n${missing.map((m) => `  ${m}`).join('\n')}`);
});

test('UI fetch paths have a Next App Router route that can proxy them', () => {
  const { calls, prefixes } = collectAll();
  const missing = [];
  for (const [call, file] of calls) {
    if (isNextNative(call)) continue;
    if (!nextRouteExists(call)) missing.push(`${call} (${file})`);
  }
  for (const [prefix, file] of prefixes) {
    if (isNextNative(prefix)) continue;
    if (!nextRouteExists(prefix)) missing.push(`${prefix}/* template (${file})`);
  }
  assert.deepEqual(missing, [],
    `UI calls without a Next route:\n${missing.map((m) => `  ${m}`).join('\n')}`);
});

test('allowlist covers operator document-review, unbrowse, jobs list, workspace import, hunts evaluate', () => {
  for (const p of [
    '/api/document-review',
    '/api/document-review/foo',
    '/api/source-network/unbrowse/status',
    '/api/source-network/unbrowse/intake',
    '/api/source-network/jobs',
    '/api/source-network/jobs/job_0123456789abcdef01234567',
    '/api/workspace/import/preview',
    '/api/workspace/import/commit',
    '/api/hunts/hunt_0123456789abcdef/evaluate',
    '/api/hunts/hunt_0123456789abcdef/events',
  ]) {
    assert.ok(API_PATH.test(p), `API_PATH must accept ${p}`);
  }
});
