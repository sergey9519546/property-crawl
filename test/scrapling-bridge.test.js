'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { extractWithScrapling, isScraplingEnabled, PROFILES, isPrivateOrLocalHost, getScraplingRuntimeStatus } = require('../server/scrapers/scrapling-bridge');
const { readPinnedVersion, checkScraplingReadiness } = require('../scripts/scrapling-doctor');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'crawler-tools', name), 'utf8');
const python = process.env.SCRAPLING_PYTHON || path.resolve(__dirname, '..', '.cache', 'crawler-tools', 'venv', 'Scripts', 'python.exe');

test('Scrapling doctor reads the pinned dependency and reports import readiness', () => {
  assert.equal(readPinnedVersion(), '0.4.15');
  const result = checkScraplingReadiness({ python: process.execPath, runner: () => '0.4.15\n' });
  assert.equal(result.ready, true);
  assert.equal(result.checks.every(check => check.ok), true);
});

test('Scrapling doctor fails closed when runtime is absent', () => {
  const result = checkScraplingReadiness({ python: null });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find(check => check.name === 'python-runtime').ok, false);
});

test('source enablement uses an explicit case-insensitive CSV allowlist', () => {
  assert.equal(isScraplingEnabled('gsa', { SCRAPLING_SOURCES: 'hud, GSA' }), true);
  assert.equal(isScraplingEnabled('irs', { SCRAPLING_SOURCES: 'hud, GSA' }), false);
});

test('profiles set includes all known profiles', () => {
  assert.deepEqual([...PROFILES].sort(), ['gsa-detail', 'gsa-index', 'page-links', 'table-extract']);
});

test('isPrivateOrLocalHost detects SSRF targets', () => {
  assert.equal(isPrivateOrLocalHost('localhost'), true);
  assert.equal(isPrivateOrLocalHost('127.0.0.1'), true);
  assert.equal(isPrivateOrLocalHost('10.0.0.1'), true);
  assert.equal(isPrivateOrLocalHost('172.16.0.1'), true);
  assert.equal(isPrivateOrLocalHost('192.168.1.1'), true);
  assert.equal(isPrivateOrLocalHost('169.254.169.254'), true); // cloud metadata
  assert.equal(isPrivateOrLocalHost('::1'), true);
  assert.equal(isPrivateOrLocalHost('example.com'), false);
  assert.equal(isPrivateOrLocalHost('8.8.8.8'), false);
});

test('bridge rejects challenge HTML before starting Python', async () => {
  await assert.rejects(() => extractWithScrapling('gsa-index', { html: '<title>Just a moment...</title>', url: 'https://example.test', python: 'missing-python' }), error => error.code === 'UPSTREAM_BOT_CHALLENGE' && error.haltScraper);
});

test('bridge rejects unknown profiles and oversized input', async () => {
  await assert.rejects(() => extractWithScrapling('unknown', { html: '<p>x</p>', url: 'https://example.test', python }), error => error.code === 'SCRAPLING_UNKNOWN_PROFILE');
  await assert.rejects(() => extractWithScrapling('page-links', { html: 'x'.repeat(4 * 1024 * 1024 + 1), url: 'https://example.test', python }), error => error.code === 'SCRAPLING_INPUT_TOO_LARGE');
});

test('bridge rejects empty input', async () => {
  await assert.rejects(() => extractWithScrapling('page-links', { html: '   ', url: 'https://example.test', python }), error => error.code === 'SCRAPLING_EMPTY_INPUT' && error.haltScraper);
});

test('bridge rejects invalid URLs including SSRF targets', async () => {
  const valid = '<a href="/x">x</a>';
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'http://example.test', python }), error => error.code === 'SCRAPLING_INVALID_URL');
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'https://user:pass@example.test', python }), error => error.code === 'SCRAPLING_INVALID_URL');
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'https://127.0.0.1/x', python }), error => error.code === 'SCRAPLING_INVALID_URL');
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'https://localhost/x', python }), error => error.code === 'SCRAPLING_INVALID_URL');
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'not-a-url', python }), error => error.code === 'SCRAPLING_INVALID_URL');
});

test('bridge rejects invalid timeout values', async () => {
  const valid = '<a href="/x">x</a>';
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'https://example.test', python, timeoutMs: 0 }), error => error.code === 'SCRAPLING_INVALID_TIMEOUT');
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'https://example.test', python, timeoutMs: 5001 }), error => error.code === 'SCRAPLING_INVALID_TIMEOUT');
  await assert.rejects(() => extractWithScrapling('page-links', { html: valid, url: 'https://example.test', python, timeoutMs: -1 }), error => error.code === 'SCRAPLING_INVALID_TIMEOUT');
});

test('runtime validation distinguishes missing and non-file interpreters', () => {
  assert.deepEqual(getScraplingRuntimeStatus(null), { available: false, code: 'SCRAPLING_RUNTIME_MISSING', python: null });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-runtime-'));
  try { assert.equal(getScraplingRuntimeStatus(directory).code, 'SCRAPLING_RUNTIME_INVALID'); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('bridge rejects missing Python runtime', async () => {
  await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python: null }), error => error.code === 'SCRAPLING_RUNTIME_MISSING');
});

test('bridge rejects path traversal in scriptPath', async () => {
  await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: '../../etc/passwd' }), error => error.code === 'SCRAPLING_SCRIPT_NOT_FOUND');
});

test('bridge rejects nonexistent scriptPath', async () => {
  await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: path.join(os.tmpdir(), 'does-not-exist-scrapling.py') }), error => error.code === 'SCRAPLING_SCRIPT_NOT_FOUND');
});

test('bridge rejects when AbortController fires', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, signal: controller.signal }), error => error.code === 'SCRAPLING_ABORTED');
});

test('bridge rejects when AbortController fires mid-flight', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-abort-'));
  const sleeper = path.join(temp, 'sleep.py');
  fs.writeFileSync(sleeper, 'import sys,time\nsys.stdin.read()\ntime.sleep(5)\n');
  const controller = new AbortController();
  try {
    const promise = extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: sleeper, timeoutMs: 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(() => promise, error => error.code === 'SCRAPLING_ABORTED');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('genuine Scrapling parser preserves GSA card/bid association and reordered attributes', async t => {
  if (!fs.existsSync(python)) return t.skip('isolated Scrapling runtime not installed');
  const index = await extractWithScrapling('gsa-index', { html: fixture('gsa-index.html'), url: 'https://realestatesales.gov/our-listing', python });
  assert.equal(index.engine, 'scrapling');
  assert.match(index.engineVersion, /^0\.4\.15/);
  assert.deepEqual(index.items, [
    { propertyId: '41', url: 'https://realestatesales.gov/asset-details/?property_id=41', currentBid: 125000 },
    { propertyId: '72', url: 'https://realestatesales.gov/asset-details/?property_id=72', currentBid: 87500 }
  ]);
  const detail = await extractWithScrapling('gsa-detail', { html: fixture('gsa-detail.html'), url: 'https://realestatesales.gov/asset-details/?property_id=41', python });
  assert.deepEqual(detail.property, { address: '2731 Chestnut Street', city: 'New Orleans', state: 'Louisiana', zipcode: '70130' });
});

test('page-links resolves exact links and labels documents', async t => {
  if (!fs.existsSync(python)) return t.skip('isolated Scrapling runtime not installed');
  const result = await extractWithScrapling('page-links', { html: fixture('page-links.html'), url: 'https://realestatesales.gov/our-listing', python });
  assert.deepEqual(result.links, [
    { href: 'https://realestatesales.gov/asset-details/?property_id=41', text: 'Property 41', document: false },
    { href: 'https://realestatesales.gov/files/terms.pdf?rev=2', text: 'Auction terms', document: true }
  ]);
});

test('page-links filters mailto, tel, and anchor-only links', async t => {
  if (!fs.existsSync(python)) return t.skip('isolated Scrapling runtime not installed');
  const html = '<a href="mailto:ops@example.test">Email</a><a href="tel:+1234567890">Call</a><a href="#section">Anchor</a><a href="/ok">OK</a>';
  const result = await extractWithScrapling('page-links', { html, url: 'https://example.test', python });
  assert.deepEqual(result.links, [
    { href: 'https://example.test/ok', text: 'OK', document: false }
  ]);
});

test('table-extract profile extracts headers and rows', async t => {
  if (!fs.existsSync(python)) return t.skip('isolated Scrapling runtime not installed');
  const html = '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Auction</td><td>$100</td></tr><tr><td>Deposit</td><td>$500</td></tr></tbody></table>';
  const result = await extractWithScrapling('table-extract', { html, url: 'https://example.test', python });
  assert.deepEqual(result.headers, ['Name', 'Value']);
  assert.deepEqual(result.rows, [['Auction', '$100'], ['Deposit', '$500']]);
});

test('table-extract returns empty arrays when no table present', async t => {
  if (!fs.existsSync(python)) return t.skip('isolated Scrapling runtime not installed');
  const result = await extractWithScrapling('table-extract', { html: '<p>no tables here</p>', url: 'https://example.test', python });
  assert.deepEqual(result.headers, []);
  assert.deepEqual(result.rows, []);
});

test('bridge kills a timed-out child and rejects malformed protocol', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-bridge-'));
  const sleeper = path.join(temp, 'sleep.py');
  const malformed = path.join(temp, 'malformed.py');
  fs.writeFileSync(sleeper, 'import sys,time\nsys.stdin.read()\ntime.sleep(2)\n');
  fs.writeFileSync(malformed, 'import sys\nsys.stdin.read()\nprint("not-json")\n');
  try {
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: sleeper, timeoutMs: 40 }), error => error.code === 'SCRAPLING_TIMEOUT');
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: malformed }), error => error.code === 'SCRAPLING_PROTOCOL_ERROR');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('bridge validates hashes and shapes without exposing child stderr', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-protocol-'));
  const wrong = path.join(temp, 'wrong.py');
  const secret = path.join(temp, 'secret.py');
  fs.writeFileSync(wrong, `import json,sys\nr=json.load(sys.stdin)\nprint(json.dumps({'version':1,'profile':r['profile'],'sourceUrl':r['url'],'engine':'scrapling','engineVersion':'0.4.15','contentSha256':'0'*64,'links':'wrong'}))\n`);
  fs.writeFileSync(secret, `import sys\nsys.stdin.read()\nprint('OPENAI_API_KEY=secret-value',file=sys.stderr)\nraise SystemExit(2)\n`);
  try {
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: wrong }), error => error.code === 'SCRAPLING_PROTOCOL_ERROR');
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: secret }), error => error.code === 'SCRAPLING_PROCESS_FAILED' && !error.message.includes('secret-value'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('bridge rejects wrong protocol version from child', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-version-'));
  const script = path.join(temp, 'v2.py');
  fs.writeFileSync(script, `import json,sys\nr=json.load(sys.stdin)\nprint(json.dumps({'version':2,'profile':r['profile'],'sourceUrl':r['url'],'engine':'scrapling','engineVersion':'0.4.15','contentSha256':'0'*64,'links':[]}))\n`);
  try {
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: script }), error => error.code === 'SCRAPLING_PROTOCOL_ERROR');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('bridge rejects wrong engine name from child', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-engine-'));
  const script = path.join(temp, 'fake.py');
  fs.writeFileSync(script, `import json,sys,hashlib\nr=json.load(sys.stdin)\nh=hashlib.sha256(r['html'].encode()).hexdigest()\nprint(json.dumps({'version':1,'profile':r['profile'],'sourceUrl':r['url'],'engine':'cheerio','engineVersion':'0.4.15','contentSha256':h,'links':[]}))\n`);
  try {
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: script }), error => error.code === 'SCRAPLING_PROTOCOL_ERROR');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('bridge rejects wrong engineVersion from child', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-ver-'));
  const script = path.join(temp, 'old.py');
  fs.writeFileSync(script, `import json,sys,hashlib\nr=json.load(sys.stdin)\nh=hashlib.sha256(r['html'].encode()).hexdigest()\nprint(json.dumps({'version':1,'profile':r['profile'],'sourceUrl':r['url'],'engine':'scrapling','engineVersion':'0.4.0','contentSha256':h,'links':[]}))\n`);
  try {
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: script }), error => error.code === 'SCRAPLING_PROTOCOL_ERROR');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('bridge rejects output exceeding 2 MB', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapling-bigout-'));
  const script = path.join(temp, 'big.py');
  fs.writeFileSync(script, `import sys\nsys.stdin.read()\nprint('x' * ${3 * 1024 * 1024})\n`);
  try {
    await assert.rejects(() => extractWithScrapling('page-links', { html: '<a href="/x">x</a>', url: 'https://example.test', python, scriptPath: script }), error => error.code === 'SCRAPLING_OUTPUT_TOO_LARGE');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
