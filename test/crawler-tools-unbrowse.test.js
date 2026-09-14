'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tool = require('../scripts/crawler-tools-unbrowse.cjs');

function candidate() {
  return {
    schemaVersion: tool.CANDIDATE_SCHEMA, source: 'gsa',
    sourceUrl: 'https://realestatesales.gov/asset-details?property_id=123',
    method: 'GET', reviewStatus: 'pending', generatedAt: '2026-01-01T00:00:00.000Z',
    evidence: {
      provider: 'unbrowse', version: '11.4.1',
      endpointUrl: 'https://realestatesales.gov/asset-details?property_id=123',
      observedAt: '2026-01-01T00:00:00.000Z', notes: 'Reviewed public route.',
    },
  };
}

test('publisher URLs require configured exact root/www host and safe HTTPS shape', () => {
  assert.equal(tool.validatePublisherUrl('https://realestatesales.gov/', 'gsa').hostname, 'realestatesales.gov');
  assert.equal(tool.validatePublisherUrl('https://www.realestatesales.gov/', 'gsa').hostname, 'www.realestatesales.gov');
  assert.throws(() => tool.validatePublisherUrl('https://api.realestatesales.gov/', 'gsa'), /not configured/);
  assert.throws(() => tool.validatePublisherUrl('https://unknown.gov/', 'gsa'), /not configured/);
  assert.throws(() => tool.validatePublisherUrl('https://127.0.0.1/', 'gsa'), /IP address/);
  assert.throws(() => tool.validatePublisherUrl('https://[::1]/', 'gsa'), /IP address/);
  assert.throws(() => tool.validatePublisherUrl('http://realestatesales.gov/', 'gsa'), /HTTPS/);
  assert.throws(() => tool.validatePublisherUrl('https://realestatesales.gov:8443/', 'gsa'), /port/);
  assert.throws(() => tool.validatePublisherUrl('https://realestatesales.gov/#x', 'gsa'), /fragment/);
  assert.throws(() => tool.validatePublisherUrl('https://realestatesales.gov/?access_token=x', 'gsa'), /Secret-like/);
  assert.throws(() => tool.validatePublisherUrl('https://realestatesales.gov/?apiKey=x', 'gsa'), /Secret-like/);
  // User-info rejection
  assert.throws(() => tool.validatePublisherUrl('https://user:pass@realestatesales.gov/', 'gsa'), /user information/);
  // Empty / missing URL
  assert.throws(() => tool.validatePublisherUrl('', 'gsa'), /absolute/);
  assert.throws(() => tool.validatePublisherUrl(undefined, 'gsa'), /absolute/);
});

test('doctor recognizes only the installed runtime consent field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-doctor-'));
  const pkg = path.join(dir, 'pkg'); const cfg = path.join(dir, 'cfg');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true }); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"version":"11.4.1"}');
  fs.writeFileSync(path.join(pkg, 'bin', 'unbrowse-wrapper.mjs'), '');
  fs.writeFileSync(path.join(cfg, 'config.json'), '{"tosAccepted":true}');
  assert.equal(tool.inspectInstallation(pkg, cfg).setupReady, false);
  fs.writeFileSync(path.join(cfg, 'config.json'), '{"tos_accepted_version":"2026-01"}');
  assert.equal(tool.inspectInstallation(pkg, cfg).setupReady, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doctor reports missing installation cleanly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-missing-'));
  try {
    const state = tool.inspectInstallation(path.join(dir, 'nonexistent'), path.join(dir, 'cfg'));
    assert.equal(state.installed, false);
    assert.equal(state.version, null);
    assert.equal(state.setupReady, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('prepare reports absent consent and does not execute Unbrowse', () => {
  const plan = tool.prepareInspection({
    source: 'gsa', url: 'https://realestatesales.gov/',
    state: { version: '11.4.1', setupReady: false, configDir: 'isolated' },
  });
  assert.equal(plan.status, 'manual-review-required');
  assert.match(plan.reason, /tos_accepted_version/);
  assert.equal(plan.reviewPlan.some(step => /Run resolve manually/.test(step)), true);
});

test('prepare with consent still returns manual-review-required (wrapper never executes Unbrowse)', () => {
  const plan = tool.prepareInspection({
    source: 'gsa', url: 'https://realestatesales.gov/',
    state: { version: '11.4.1', setupReady: true, configDir: 'isolated' },
  });
  assert.equal(plan.status, 'manual-review-required');
  assert.match(plan.reason, /resolve-can-probe-or-capture/);
});

test('prepare rejects invalid source', () => {
  assert.throws(() => tool.prepareInspection({
    source: '', url: 'https://realestatesales.gov/',
    state: { version: '1.0', setupReady: false, configDir: 'x' },
  }), /bounded non-empty string/);
});

test('candidate accepts only a bounded whitelisted reviewed GET shape', () => {
  const value = tool.validateCandidate(candidate());
  assert.equal(value.method, 'GET');
  assert.deepEqual(Object.keys(value.evidence), ['provider', 'version', 'endpointUrl', 'observedAt', 'notes']);
});

test('candidate refuses POST, unknown fields, secrets, and arbitrary metadata', () => {
  const post = candidate(); post.method = 'POST';
  assert.throws(() => tool.validateCandidate(post), /method must be GET/);
  const header = candidate(); header.evidence.headers = { Authorization: 'secret' };
  assert.throws(() => tool.validateCandidate(header), /forbidden field: headers/);
  const token = candidate(); token.evidence.endpointUrl += '&api_key=secret';
  assert.throws(() => tool.validateCandidate(token), /Secret-like/);
  const nested = candidate(); nested.routeMetadata = { arbitrary: true };
  assert.throws(() => tool.validateCandidate(nested), /forbidden field: routeMetadata/);
  const note = candidate(); note.evidence.notes = 'Authorization: Bearer abc';
  assert.throws(() => tool.validateCandidate(note), /credential-like/);
});

test('candidate refuses wrong schema version, wrong review status, wrong provider', () => {
  const wrongSchema = candidate(); wrongSchema.schemaVersion = 'other/v1';
  assert.throws(() => tool.validateCandidate(wrongSchema), /schemaVersion is invalid/);
  const wrongReview = candidate(); wrongReview.reviewStatus = 'approved';
  assert.throws(() => tool.validateCandidate(wrongReview), /reviewStatus must be pending/);
  const wrongProvider = candidate(); wrongProvider.evidence.provider = 'other';
  assert.throws(() => tool.validateCandidate(wrongProvider), /provider must be unbrowse/);
});

test('candidate refuses missing or non-object evidence', () => {
  const noEvidence = candidate(); delete noEvidence.evidence;
  assert.throws(() => tool.validateCandidate(noEvidence), /must be an object/);
  const nullEvidence = candidate(); nullEvidence.evidence = null;
  assert.throws(() => tool.validateCandidate(nullEvidence), /must be an object/);
  const arrayEvidence = candidate(); arrayEvidence.evidence = [];
  assert.throws(() => tool.validateCandidate(arrayEvidence), /must be an object/);
});

test('candidate refuses invalid timestamps', () => {
  const badGen = candidate(); badGen.generatedAt = 'not-a-date';
  assert.throws(() => tool.validateCandidate(badGen), /generatedAt must be an ISO timestamp/);
  const badObs = candidate(); badObs.evidence.observedAt = 'not-a-date';
  assert.throws(() => tool.validateCandidate(badObs), /observedAt must be an ISO timestamp/);
});

test('candidate refuses ubr_ credential-like content in notes', () => {
  const c = candidate(); c.evidence.notes = 'Found ubr_abc123secret in page';
  assert.throws(() => tool.validateCandidate(c), /credential-like/);
});

test('candidate accepts optional evidence.notes is omitted', () => {
  const c = candidate(); delete c.evidence.notes;
  const value = tool.validateCandidate(c);
  assert.equal(value.evidence.notes, undefined);
});

test('candidate import refuses files larger than 1 MiB before parsing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-candidate-'));
  try {
    const file = path.join(dir, 'candidate.json');
    fs.writeFileSync(file, Buffer.alloc(tool.MAX_INPUT_BYTES + 1, 32));
    assert.throws(() => tool.importCandidate(file), /exceeds 1 MiB/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('candidate import refuses nonexistent file with clear error', () => {
  assert.throws(() => tool.importCandidate('/nonexistent/candidate.json'), /does not exist/);
});

test('candidate import refuses directory path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-dir-'));
  try {
    assert.throws(() => tool.importCandidate(dir), /must be a file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('candidate import refuses invalid JSON with clear error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-badjson-'));
  try {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, 'not json at all');
    assert.throws(() => tool.importCandidate(file), /not valid JSON/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('candidate import accepts a valid file and returns validated shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbrowse-valid-'));
  try {
    const file = path.join(dir, 'ok.json');
    fs.writeFileSync(file, JSON.stringify(candidate()));
    const result = tool.importCandidate(file);
    assert.equal(result.method, 'GET');
    assert.equal(result.source, 'gsa');
    assert.equal(result.evidence.provider, 'unbrowse');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('candidateToIntake bridges validated route metadata into reviewed source intake', () => {
  const calls = [];
  const result = tool.candidateToIntake(candidate(), {
    intake: { submitEvidence(input) { calls.push(input); return { record: { id: 'intake_test' }, deduplicated: false }; } },
  });
  assert.equal(result.provenance, 'unbrowse-route-candidate');
  assert.equal(calls[0].kind, 'json');
  assert.equal(calls[0].records[0].route, candidate().sourceUrl);
  assert.equal(calls[0].records[0].method, 'GET');
});

test('candidateToIntake validates before handing data to intake', () => {
  const invalid = candidate(); invalid.method = 'POST';
  assert.throws(() => tool.candidateToIntake(invalid, { intake: { submitEvidence() { throw new Error('must not call'); } } }), /method must be GET/);
});

test('main supports help flags without touching installation or hosted services', async () => {
  const long = await tool.main(['--help']);
  const short = await tool.main(['help']);
  const nested = await tool.main(['prepare', '--help']);
  for (const result of [long, short, nested]) {
    assert.match(result.help, /safe route candidate intake/);
    assert.match(result.help, /never runs Unbrowse/);
    assert.match(result.help, /configured HTTPS publisher hosts/);
  }
});

test('main rejects unknown command with usage error', async () => {
  await assert.rejects(tool.main(['frobnicate']), /Usage/);
});

test('main rejects prepare without required flags', async () => {
  await assert.rejects(tool.main(['prepare']), /bounded non-empty string/);
});

test('configuredHosts throws for unknown source', () => {
  assert.throws(() => tool.configuredHosts('nonexistent'), /Unknown source/);
});

test('configuredHosts returns both root and www variants', () => {
  const hosts = tool.configuredHosts('gsa');
  assert.equal(hosts.has('realestatesales.gov'), true);
  assert.equal(hosts.has('www.realestatesales.gov'), true);
  assert.equal(hosts.has('evil.example'), false);
});
