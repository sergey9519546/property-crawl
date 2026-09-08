const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { createSourceNetworkHandler } = require('../server/routes/source-network');
const { buildSourceNetwork, enrolledSources } = require('../server/sources/network');
const { IngestionScheduler } = require('../server/scrapers/scheduler');
const { ScraperResponseError } = require('../server/scrapers/circuit-breaker');
const { loadObservations, recordSourceRun } = require('../server/sources/observations');
const sourceIntake = require('../server/sources/intake');
const { loadStore: loadIntakeStore } = require('../server/sources/store');

const temporaryDirectories = [];
const NOW = Date.parse('2026-09-05T18:00:00.000Z');

function workflow(cadenceHours = 24) {
  return { primary: 'Use exact records.', fallback: 'Use manual evidence intake.', cadenceHours, steps: [] };
}

function catalogEntry(id, adapterKey, cadenceHours = 24) {
  return {
    id, label: id, category: 'test', role: 'opportunity', coverage: 'Test coverage',
    discoveryUrl: 'https://example.gov/', access: 'public', adapterKey,
    workflow: workflow(cadenceHours), requiredEvidence: [], notes: '',
  };
}

function liveHudListing(overrides = {}) {
  const observedAt = overrides.sourceObservedAt || '2026-09-05T17:30:00.000Z';
  return {
    id: 'HUD-OH-123', source: 'hud', state: 'OH', county: 'Cuyahoga', city: 'Cleveland', zip: '44101',
    address: '123 Current Record Street, Cleveland, OH 44101', openingBid: null,
    raw: 'Current observed HUD HomeStore publisher property record.',
    sourceUrl: 'https://www.hudhomestore.gov/property/propertydetails?caseNumber=123', sourceObservedAt: observedAt,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record',
      publisher: 'HUD HomeStore', recordId: '123', observedAt,
    },
    ...overrides,
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(handler, { url, method = 'GET', token, body } = {}) {
  const req = { url, method, body, headers: token ? { 'x-scraper-token': token } : {} };
  const res = response();
  await handler(req, res);
  return res;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const target = temporaryDirectories.pop();
    if (target.startsWith(os.tmpdir())) fs.rmSync(target, { recursive: true, force: true });
  }
});

test('source network maps catalog ids to adapter keys and reports successful, failed, empty, stale, and import states truthfully', () => {
  const catalog = [
    catalogEntry('hud-homestore', 'hud'),
    catalogEntry('irs-auctions', 'irs'),
    catalogEntry('gsa-real-estate-sales', 'gsa'),
    catalogEntry('usda-resales', 'usda', 12),
    catalogEntry('fdic-asset-sales', null),
  ];
  const observations = {
    records: { current: {} }, signals: [], runs: {
      hud: { lastRunAt: '2026-09-05T17:00:00.000Z', acceptedCount: 1, error: null },
      irs: { lastRunAt: '2026-09-05T17:00:00.000Z', acceptedCount: 0, error: 'CAPTCHA challenge' },
      gsa: { lastRunAt: '2026-09-05T17:00:00.000Z', acceptedCount: 0, error: null },
      usda: { lastRunAt: '2026-09-04T00:00:00.000Z', acceptedCount: 2, error: null },
    },
  };
  const adapters = ['hud', 'irs', 'gsa', 'usda'].map((sourceKey) => ({ sourceKey }));
  const fixture = liveHudListing({ id: 'HUD-FIXTURE', provenance: { origin: 'fixture', observed: false, fixture: true } });
  const network = buildSourceNetwork({ catalog, adapters, observations, listings: [liveHudListing(), fixture], now: NOW });
  const byId = Object.fromEntries(network.sources.map((source) => [source.id, source]));

  assert.equal(byId['hud-homestore'].status, 'collected');
  assert.equal(byId['hud-homestore'].observedRecords, 1);
  assert.deepEqual(byId['hud-homestore'].observedStates, ['OH']);
  assert.equal(byId['irs-auctions'].status, 'attention');
  assert.equal(byId['gsa-real-estate-sales'].status, 'empty');
  assert.equal(byId['usda-resales'].status, 'stale');
  assert.equal(byId['fdic-asset-sales'].status, 'import_available');
  assert.equal(network.summary.observedRecords, 1);
});

test('only approved custom-source evidence enrolls one discovery workflow without claiming inventory', () => {
  const catalog = [catalogEntry('hud-homestore', 'hud')];
  const customSource = {
    name: 'Example County Sheriff Sales', organization: 'Example County Sheriff',
    description: 'Official county notices', homepageUrl: 'https://sheriff.example.gov/sales',
  };
  const packets = [
    { sourceId: 'example-county', sourceUrl: 'https://sheriff.example.gov/sales/1', customSource, review: { decision: 'approved' } },
    { sourceId: 'example-county', sourceUrl: 'https://sheriff.example.gov/sales/2', customSource, review: { decision: 'approved' } },
    { sourceId: 'pending-county', customSource: { ...customSource, name: 'Pending County' }, review: null },
    { sourceId: 'rejected-county', customSource: { ...customSource, name: 'Rejected County' }, review: { decision: 'rejected' } },
    { sourceId: 'hud-homestore', customSource, review: { decision: 'approved' } },
  ];

  const enrolled = enrolledSources(packets, catalog);
  assert.equal(enrolled.length, 1);
  assert.equal(enrolled[0].id, 'example-county');
  assert.equal(enrolled[0].role, 'discovery');
  assert.equal(enrolled[0].adapterKey, null);
  assert.match(enrolled[0].notes, /does not establish a live property feed/i);
});

test('evidence automation and packet counts stay separate from property collectors and inventory', () => {
  const catalog = [catalogEntry('hud-homestore', 'hud'), catalogEntry('federal-register', null)];
  const network = buildSourceNetwork({
    catalog, adapters: [{ sourceKey: 'hud' }], listings: [],
    evidenceCollectors: ['federal-register'], evidenceSummary: { 'federal-register': { count: 3 } },
    observations: {
      records: {}, signals: [], runs: {
        'federal-register': { lastRunAt: '2026-09-05T17:00:00.000Z', acceptedCount: 0, evidenceCount: 3, error: null },
      },
    },
    now: NOW,
  });
  const federal = network.sources.find((source) => source.id === 'federal-register');

  assert.equal(federal.automated, true);
  assert.equal(federal.automatedEvidence, true);
  assert.equal(federal.status, 'evidence_queued');
  assert.equal(federal.evidencePackets, 3);
  assert.equal(federal.observedRecords, 0);
  assert.equal(network.summary.propertyCollectors, 1);
  assert.equal(network.summary.evidenceCollectors, 1);
  assert.equal(network.summary.observedRecords, 0);
});

test('old or mock inventory alone never makes an unrun collector look recently collected', () => {
  const old = liveHudListing({ id: 'HUD-OLD', sourceObservedAt: '2024-01-01T00:00:00.000Z' });
  old.provenance = { ...old.provenance, recordId: 'old', observedAt: old.sourceObservedAt };
  const mock = liveHudListing({ id: 'HUD-MOCK', provenance: { origin: 'snapshot', observed: false, recordKind: 'demo' } });
  const network = buildSourceNetwork({
    catalog: [catalogEntry('hud-homestore', 'hud')],
    adapters: [{ sourceKey: 'hud' }], observations: { runs: {}, records: {}, signals: [] },
    listings: [old, mock], now: NOW,
  });

  assert.equal(network.sources[0].status, 'awaiting_run');
  assert.notEqual(network.sources[0].latestObservation, mock.sourceObservedAt);
  assert.equal(network.summary.collected, 0);
});

test('public coverage is readable while intake, review, and run operations fail closed without the operator token', async () => {
  const collector = { realScrapers: [{ sourceKey: 'hud' }], realScraperKeys: new Set(['hud']), isRunning: false, networkEnabled: true };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, collector, scheduler: collector,
    catalog: [catalogEntry('hud-homestore', 'hud')],
    loadObservations: () => ({ runs: {}, records: {}, signals: [] }), env: {},
    intake: { listEvidence: () => [] },
  });

  assert.equal((await invoke(handler, { url: '/api/source-network' })).statusCode, 200);
  for (const [url, method] of [
    ['/api/source-network/intake', 'GET'],
    ['/api/source-network/intake', 'POST'],
    ['/api/source-network/review', 'POST'],
    ['/api/source-network/run', 'POST'],
  ]) {
    const res = await invoke(handler, { url, method, body: {} });
    assert.equal(res.statusCode, 503, `${method} ${url}`);
  }
});

test('public coverage counts safe evidence packets and appends approved custom workflows once', async () => {
  const calls = [];
  const customSource = {
    name: 'Example County Notices', organization: 'Example County',
    description: 'Official local notices', homepageUrl: 'https://notices.example.gov/',
  };
  const packets = [
    { sourceId: 'federal-register', status: 'needs_review', review: null },
    { sourceId: 'example-county', sourceUrl: 'https://notices.example.gov/1', customSource, review: { decision: 'approved' } },
    { sourceId: 'example-county', sourceUrl: 'https://notices.example.gov/2', customSource, review: { decision: 'approved' } },
    { sourceId: 'pending-county', customSource, review: null },
  ];
  const collector = { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: true };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
    catalog: [catalogEntry('federal-register', null)],
    loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    evidenceCollectors: { 'federal-register': async () => ({ submitted: 0 }) }, env: {},
    intake: { listEvidence(filters) { calls.push(filters); return packets; } },
  });

  const res = await invoke(handler, { url: '/api/source-network' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [{ limit: 200 }]);
  assert.equal(res.body.sources.filter((source) => source.id === 'example-county').length, 1);
  assert.equal(res.body.sources.some((source) => source.id === 'pending-county'), false);
  assert.equal(res.body.sources.find((source) => source.id === 'federal-register').evidencePackets, 1);
  assert.equal(res.body.sources.find((source) => source.id === 'example-county').evidencePackets, 2);
  assert.equal(res.body.sources.find((source) => source.id === 'example-county').observedRecords, 0);
});

test('complete public summaries retain an approved local enrollment behind more than 200 newer packets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-source-network-'));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, 'intake.json');
  const originalText = 'Private original test packet; this text is not public coverage metadata.';
  const privateNote = 'PRIVATE OPERATOR REVIEW NOTE';
  const first = sourceIntake.submitEvidence({
    sourceId: 'older-approved-county', sourceUrl: 'https://notices.example.gov/old-record',
    capturedAt: '2026-09-01T00:00:00.000Z', kind: 'text', body: originalText,
    customSource: { name: 'Older Approved County', organization: 'County Clerk', description: 'Official local notices', homepageUrl: 'https://notices.example.gov/' },
  }, { storePath, now: '2026-09-01T01:00:00.000Z', getSource: () => null });
  sourceIntake.reviewEvidence(first.record.id, { decision: 'approve', note: privateNote, reviewer: 'PRIVATE REVIEWER' }, { storePath, now: '2026-09-01T02:00:00.000Z' });
  const store = loadIntakeStore(storePath);
  const template = store.records[0];
  // Populate only this temporary test store with structurally valid newer packets.
  for (let index = 0; index < 205; index++) {
    store.records.push({ ...template,
      id: `intake_${(index + 1).toString(16).padStart(24, '0')}`,
      sourceId: 'federal-register', source: { id: 'federal-register', name: 'Federal Register', cataloged: true },
      sourceUrl: `https://www.federalregister.gov/documents/2026/09/02/test-${index}`,
      submittedAt: new Date(Date.parse('2026-09-02T00:00:00.000Z') + index * 1000).toISOString(),
      status: 'needs_review', review: null,
    });
  }
  fs.writeFileSync(storePath, JSON.stringify(store));
  const reviewPage = sourceIntake.listEvidence({ limit: 200 }, { storePath });
  assert.equal(reviewPage.length, 200);
  assert.equal(reviewPage.some(packet => packet.sourceId === 'older-approved-county'), false);
  const summaries = sourceIntake.listEvidenceSummaries({ storePath, includeContent: true });
  assert.equal(summaries.length, 206);
  const older = summaries.find(packet => packet.sourceId === 'older-approved-county');
  assert.equal(older.customSource.name, 'Older Approved County');
  assert.deepEqual(older.review, { decision: 'approved' });
  assert.deepEqual(Object.keys(older).sort(), ['customSource', 'review', 'sourceId', 'sourceUrl']);
  const summaryText = JSON.stringify(summaries);
  for (const privateValue of [originalText, privateNote, 'PRIVATE REVIEWER']) assert.equal(summaryText.includes(privateValue), false);

  let allSummaryCalls = 0;
  const collector = { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: false };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
    catalog: [catalogEntry('federal-register', null)],
    loadObservations: () => ({ runs: {}, records: {}, signals: [] }), evidenceCollectors: {}, env: {},
    intake: {
      listEvidenceSummaries() { allSummaryCalls++; return sourceIntake.listEvidenceSummaries({ storePath }); },
      listEvidence() { throw new Error('Public coverage must not use the bounded raw review queue.'); },
    },
  });
  const result = await invoke(handler, { url: '/api/source-network' });
  assert.equal(result.statusCode, 200);
  assert.equal(allSummaryCalls, 1);
  assert.equal(result.body.evidenceSummaryLimited, false);
  assert.equal(result.body.evidenceQueueError, false);
  const local = result.body.sources.find(source => source.id === 'older-approved-county');
  assert.equal(local.label, 'Older Approved County');
  assert.equal(local.evidencePackets, 1);
  assert.equal(result.body.sources.find(source => source.id === 'federal-register').evidencePackets, 205);
  const publicText = JSON.stringify(result.body);
  for (const privateValue of [originalText, privateNote, 'PRIVATE REVIEWER']) assert.equal(publicText.includes(privateValue), false);
});

test('older injected intake APIs retain their bounded-summary limitation flag', async () => {
  const collector = { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: false };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
    catalog: [catalogEntry('federal-register', null)], loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    evidenceCollectors: {}, env: {},
    intake: { listEvidence: () => Array.from({ length: 200 }, () => ({ sourceId: 'federal-register' })) },
  });
  const result = await invoke(handler, { url: '/api/source-network' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.evidenceSummaryLimited, true);
  assert.equal(result.body.sources[0].evidencePackets, 200);
});

test('corrupt evidence and history files preserve public coverage with explicit availability flags', async () => {
  for (const scenario of [{ evidence: true, history: false }, { evidence: false, history: true }, { evidence: true, history: true }]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-source-network-'));
    temporaryDirectories.push(directory);
    const storePath = path.join(directory, 'intake.json');
    const historyPath = path.join(directory, 'observations.json');
    const evidenceBytes = scenario.evidence ? '{ PRIVATE BROKEN EVIDENCE' : JSON.stringify({ version: 1, records: [] });
    const historyBytes = scenario.history ? '{ PRIVATE BROKEN HISTORY' : JSON.stringify({ version: 1, runs: {}, records: {}, signals: [] });
    fs.writeFileSync(storePath, evidenceBytes);
    fs.writeFileSync(historyPath, historyBytes);
    const collector = { realScrapers: [{ sourceKey: 'hud' }], realScraperKeys: new Set(['hud']), isRunning: false, networkEnabled: false };
    const handler = createSourceNetworkHandler({
      database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
      catalog: [catalogEntry('hud-homestore', 'hud')], env: {}, evidenceCollectors: {},
      intake: { listEvidenceSummaries: () => sourceIntake.listEvidenceSummaries({ storePath }) },
      loadObservations: () => loadObservations({ filePath: historyPath }),
    });
    const result = await invoke(handler, { url: '/api/source-network' });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.evidenceQueueError, scenario.evidence);
    assert.equal(result.body.historyUnavailable, scenario.history);
    assert.equal(result.body.sources[0].status, scenario.history ? 'history_unavailable' : 'awaiting_run');
    assert.deepEqual(result.body.signals, []);
    assert.equal(JSON.stringify(result.body).includes('PRIVATE BROKEN'), false);
    assert.equal(fs.readFileSync(storePath, 'utf8'), evidenceBytes);
    assert.equal(fs.readFileSync(historyPath, 'utf8'), historyBytes);
  }
});

test('configured source operations reject a missing or incorrect token', async () => {
  const collector = { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: true };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
    catalog: [], loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    env: { SCRAPER_ADMIN_TOKEN: 'correct-token' }, intake: { listEvidence: () => [] },
  });

  assert.equal((await invoke(handler, { url: '/api/source-network/intake' })).statusCode, 401);
  assert.equal((await invoke(handler, { url: '/api/source-network/intake', token: 'wrong-token' })).statusCode, 401);
});

test('authorized intake GET is safe by default and exposes original evidence only when explicitly requested', async () => {
  const calls = [];
  const intake = {
    listEvidence(filters) {
      calls.push(filters);
      return filters.includeContent ? [{ id: 'intake_1', original: { body: 'raw evidence' } }] : [{ id: 'intake_1' }];
    },
  };
  const collector = { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: true };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
    catalog: [], loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, intake,
  });

  const safe = await invoke(handler, { url: '/api/source-network/intake?sourceId=civilview', token: 'operator-secret' });
  assert.equal(safe.statusCode, 200);
  assert.equal(safe.body.items[0].original, undefined);
  assert.deepEqual(calls[0], { sourceId: 'civilview', includeContent: false, limit: 50 });

  const raw = await invoke(handler, { url: '/api/source-network/intake?sourceId=civilview&includeContent=true', token: 'operator-secret' });
  assert.equal(raw.statusCode, 200);
  assert.equal(raw.body.items[0].original.body, 'raw evidence');
  assert.equal(calls[1].includeContent, true);
});

test('authorized intake and review validate input and retain evidence-only status messages', async () => {
  const calls = [];
  const summary = { id: 'intake_0123456789abcdef01234567', status: 'needs_review' };
  const intake = {
    validateSubmission(body) { calls.push(['validate', body]); return { isValid: Boolean(body.sourceId), errors: ['sourceId required'] }; },
    submitEvidence(body) { calls.push(['submit', body]); return { record: summary, deduplicated: false }; },
    reviewEvidence(id, review) { calls.push(['review', id, review]); return { ...summary, status: 'reviewed', review }; },
  };
  const collector = { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: true };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
    catalog: [], loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, intake,
  });

  const invalid = await invoke(handler, {
    url: '/api/source-network/intake', method: 'POST', token: 'operator-secret', body: {},
  });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.body.details, ['sourceId required']);

  const accepted = await invoke(handler, {
    url: '/api/source-network/intake', method: 'POST', token: 'operator-secret', body: { sourceId: 'civilview' },
  });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.body.record.status, 'needs_review');
  assert.match(accepted.body.message, /not been published as a property listing/i);

  const reviewed = await invoke(handler, {
    url: '/api/source-network/review', method: 'POST', token: 'operator-secret',
    body: { id: summary.id, decision: 'approve', note: 'Evidence only' },
  });
  assert.equal(reviewed.statusCode, 200);
  assert.equal(reviewed.body.record.status, 'reviewed');
  assert.deepEqual(calls.at(-1), ['review', summary.id, { decision: 'approve', note: 'Evidence only' }]);
});

test('authorized run validates catalog selection and sends the adapter key to the scheduler', async () => {
  const calls = [];
  const collector = {
    realScrapers: [{ sourceKey: 'hud' }], realScraperKeys: new Set(['hud']), isRunning: false, networkEnabled: true,
    runAll(options) { calls.push(options); return Promise.resolve({}); },
  };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector,
    catalog: [catalogEntry('hud-homestore', 'hud'), catalogEntry('fdic-asset-sales', null)],
    loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, intake: {},
  });

  const accepted = await invoke(handler, {
    url: '/api/source-network/run', method: 'POST', token: 'operator-secret', body: { sourceId: 'hud-homestore' },
  });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(calls, [{ sourceIds: ['hud'] }]);

  const manual = await invoke(handler, {
    url: '/api/source-network/run', method: 'POST', token: 'operator-secret', body: { sourceId: 'fdic-asset-sales' },
  });
  assert.equal(manual.statusCode, 400);
  assert.equal(calls.length, 1);
});

test('collection jobs expose a bounded activity list, exact job status, and source-run idempotency', async () => {
  const started = [];
  const job = { id: 'job_0123456789abcdef01234567', status: 'queued', revision: 1, stages: {}, errors: [] };
  const coordinator = {
    store: {
      list(limit) { assert.equal(limit, '50'); return { items: [job], total: 1 }; },
      get(id) { return id === job.id ? job : null; },
    },
    start(input) { started.push(input); return job; },
  };
  const collector = { realScrapers: [{ sourceKey: 'hud' }], realScraperKeys: new Set(['hud']), isRunning: false, networkEnabled: true };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) }, scheduler: collector, coordinator,
    catalog: [catalogEntry('hud-homestore', 'hud')], loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, intake: {},
  });
  const unauthorizedList = await invoke(handler, { url: '/api/source-network/jobs?limit=50' });
  assert.equal(unauthorizedList.statusCode, 401);
  const list = await invoke(handler, { url: '/api/source-network/jobs?limit=50', token: 'operator-secret' });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.available, true);
  assert.equal((await invoke(handler, { url: `/api/source-network/jobs/${job.id}` })).statusCode, 401);
  const detail = await invoke(handler, { url: `/api/source-network/jobs/${job.id}`, token: 'operator-secret' });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.job.id, job.id);
  const startedRun = await invoke(handler, {
    url: '/api/source-network/run', method: 'POST', token: 'operator-secret',
    body: { sourceId: 'hud-homestore', idempotencyKey: 'hud-run-20260905' },
  });
  assert.equal(startedRun.statusCode, 202);
  assert.equal(startedRun.body.job.id, job.id);
  assert.deepEqual(started, [{ sourceIds: ['hud'], trigger: 'source_network', idempotencyKey: 'hud-run-20260905' }]);
});

test('an authorized all-source run starts one unscoped coordinator job', async () => {
  const started = [];
  const job = { id: 'job_0123456789abcdef01234567', status: 'queued', revision: 1, stages: {}, errors: [] };
  const handler = createSourceNetworkHandler({
    database: { getListings: async () => ({ listings: [], total: 0 }) },
    scheduler: { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: true },
    coordinator: { store: { list: () => ({ items: [], total: 0 }), get: () => null }, start(input) { started.push(input); return job; } },
    catalog: [], loadObservations: () => ({ runs: {}, records: {}, signals: [] }), env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, intake: {},
  });
  const result = await invoke(handler, {
    url: '/api/source-network/run', method: 'POST', token: 'operator-secret',
    body: { scope: 'all', idempotencyKey: 'full-cycle-20260905' },
  });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.sourceId, null);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.job.id, job.id);
  assert.deepEqual(started, [{ trigger: 'source_network', idempotencyKey: 'full-cycle-20260905' }]);
});

test('authorized evidence runs enqueue review packets and record success or failure without listing writes', async () => {
  const runs = [];
  const evidenceCalls = [];
  const database = {
    getListings: async () => ({ listings: [], total: 0 }),
    createListing: async () => { throw new Error('evidence collector must not create listings'); },
  };
  const collector = { realScrapers: [], realScraperKeys: new Set(), isRunning: false, networkEnabled: true };
  const makeHandler = (evidenceCollector) => createSourceNetworkHandler({
    database, scheduler: collector, catalog: [catalogEntry('federal-register', null)],
    loadObservations: () => ({ runs: {}, records: {}, signals: [] }),
    evidenceCollectors: { 'federal-register': evidenceCollector },
    recordSourceRun: (sourceId, run) => runs.push({ sourceId, run }),
    env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, intake: { listEvidence: () => [] },
  });

  const success = await invoke(makeHandler(async (options) => {
    evidenceCalls.push(options);
    return { submitted: 4 };
  }), {
    url: '/api/source-network/run', method: 'POST', token: 'operator-secret', body: { sourceId: 'federal-register' },
  });
  assert.equal(success.statusCode, 202);
  assert.match(success.body.message, /evidence review queue/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(evidenceCalls, [{ perPage: 10, daysBack: 30 }]);
  assert.equal(runs[0].sourceId, 'federal-register');
  assert.equal(runs[0].run.evidenceCount, 4);
  assert.deepEqual(runs[0].run.listings, []);
  assert.equal(runs[0].run.error, null);

  const failure = await invoke(makeHandler(async () => { throw new Error('official API unavailable'); }), {
    url: '/api/source-network/run', method: 'POST', token: 'operator-secret', body: { sourceId: 'federal-register' },
  });
  assert.equal(failure.statusCode, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(runs.at(-1).run.error, /official API unavailable/);
  assert.deepEqual(runs.at(-1).run.listings, []);
});

test('scheduler source selection runs only requested collectors and calls the source history hook', async () => {
  const ran = [];
  const history = [];
  const scrapers = ['civilview', 'hud'].map((sourceKey) => ({
    name: `${sourceKey}-collector`, sourceKey,
    async scrapeFeed() { ran.push(sourceKey); return []; },
  }));
  const scheduler = new IngestionScheduler({
    realScrapers: scrapers, networkEnabled: true,
    database: { createListing: async () => {} }, telemetry: { recordRun() {} },
    onSourceRun: async (sourceId, run) => history.push({ sourceId, run }),
  });

  const result = await scheduler.runAll({ sourceIds: ['hud'] });
  assert.deepEqual(ran, ['hud']);
  assert.equal(history.length, 1);
  assert.equal(history[0].sourceId, 'hud');
  assert.deepEqual(history[0].run.listings, []);
  assert.equal(result.sourceResults[0].sourceId, 'hud');
  await assert.rejects(() => scheduler.runAll({ sourceIds: ['fixture'] }), /registered live source collectors/);
});

test('a scraper challenge is persisted as an error observation without inventory', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-source-network-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'observations.json');
  const scraper = {
    name: 'CivilViewChallenge', sourceKey: 'civilview',
    async scrapeFeed() {
      throw new ScraperResponseError('Cloudflare challenge prevented collection', {
        code: 'UPSTREAM_BOT_CHALLENGE', haltScraper: true,
      });
    },
  };
  const scheduler = new IngestionScheduler({
    realScrapers: [scraper], networkEnabled: true,
    database: { createListing: async () => {} }, telemetry: { recordRun() {} },
    onSourceRun: async (sourceId, run) => recordSourceRun(sourceId, run, { filePath, now: '2026-09-05T18:00:00.000Z' }),
  });

  const result = await scheduler.runAll({ sourceIds: ['civilview'] });
  const stored = loadObservations({ filePath });
  assert.equal(result.totalIngested, 0);
  assert.match(stored.runs.civilview.error, /challenge/i);
  assert.equal(stored.runs.civilview.acceptedCount, 0);
  assert.equal(Object.keys(stored.records).length, 0);
});
