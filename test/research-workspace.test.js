'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cases = require('../server/intelligence/research-cases');
const store = require('../server/intelligence/research-store');
const { createWorkspaceHandler } = require('../server/routes/workspace');

const NOW = '2026-09-05T18:00:00.000Z';

function listing(overrides = {}) {
  const observedAt = overrides.sourceObservedAt || '2026-09-05T17:00:00.000Z';
  return {
    id: 'CIV-NJ-7-2128964683', source: 'civilview', state: 'NJ', county: 'Bergen', city: 'Park Ridge', zip: '07656',
    address: '19 West Park Avenue, Park Ridge, NJ 07656', openingBid: 100000, saleDate: '2026-10-01', status: 'scheduled',
    propType: 'Single Family', sqft: 1200, assessed: 180000, deposit: null, occupancy: null,
    raw: 'Test-only publisher notice record.',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    ...overrides,
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView',
      recordId: '2128964683', observedAt,
      ...(overrides.provenance || {}),
    },
  };
}

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'property-research-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'workspace.json');
}

function approvedEvidence(overrides = {}) {
  return {
    id: 'intake_aaaaaaaaaaaaaaaaaaaaaaaa', sourceId: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    capturedAt: '2026-09-05T16:00:00.000Z',
    content: { sha256: 'b'.repeat(64), bytes: 123 },
    review: { decision: 'approved', reviewedAt: '2026-09-05T16:30:00.000Z' },
    ...overrides,
  };
}

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

async function invoke(handler, method, url, body = {}, token = 'operator-secret') {
  const res = response();
  await handler({ method, url, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, res, new URL(url, 'http://localhost'));
  return res;
}

test('cases use exact source-record identity, deduplicate, and survive reload', (t) => {
  const filePath = tempStore(t);
  const first = cases.createCase({ listing: listing() }, { filePath, now: NOW });
  assert.equal(first.created, true);
  assert.match(first.case.id, /^rcase_[a-f0-9]{24}$/);
  assert.deepEqual(first.case.sourceRef, { sourceId: 'civilview', recordId: '2128964683' });
  assert.equal(first.case.workspaceState, 'inbox');

  const duplicate = cases.createCase({ listing: listing() }, { filePath, now: NOW });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.case.id, first.case.id);
  assert.equal(duplicate.case.revision, 1);
  assert.equal(store.loadStore(filePath).cases.length, 1);

  const detail = cases.getCase(first.case.id, { filePath });
  assert.equal(detail.case.timeline.length, 1);
  assert.equal(detail.case.origins.length, 1);
  assert.equal(detail.dossier.claimGroups.publisher.some((fact) => fact.key === 'openingBid'), true);
  assert.deepEqual(detail.dossier.claimGroups.official, []);
});

test('decisions require the retained revision and validate reconsideration conditions', (t) => {
  const filePath = tempStore(t);
  const created = cases.createCase({ listing: listing() }, { filePath, now: NOW }).case;
  assert.throws(() => cases.updateCase(created.id, { expectedRevision: 1, state: 'pass' }, { filePath, now: NOW }), /requires at least one reason/);
  assert.throws(() => cases.updateCase(created.id, {
    expectedRevision: 1, state: 'pass', reasonCodes: ['bid_too_high'],
    reconsideration: { mode: 'any', conditions: [{ field: 'address', operator: 'changed' }] },
  }, { filePath, now: NOW }), /unsupported/);

  const passed = cases.updateCase(created.id, {
    expectedRevision: 1, state: 'pass', reasonCodes: ['bid_too_high'], note: 'Wait for a supported bid reduction.',
    reconsideration: { mode: 'any', conditions: [{ field: 'openingBid', operator: 'changed' }] },
  }, { filePath, now: '2026-09-05T18:01:00.000Z' });
  assert.equal(passed.workspaceState, 'pass');
  assert.deepEqual(passed.reconsideration.conditions, [{ field: 'openingBid', operator: 'changed' }]);
  assert.throws(() => cases.updateCase(created.id, { expectedRevision: 1, state: 'pursue' }, { filePath, now: NOW }), (error) => error.code === 'RESEARCH_REVISION_CONFLICT');

  const freshnessOnly = cases.createCase({
    listing: listing({ sourceObservedAt: '2026-09-05T17:30:00.000Z' }),
    origin: { type: 'material_change', changedFields: ['sourceObservedAt'] },
  }, { filePath, now: '2026-09-05T18:02:00.000Z' }).case;
  assert.equal(freshnessOnly.reconsiderationRequired, false);

  const changed = cases.createCase({
    listing: listing({ sourceObservedAt: '2026-09-05T17:45:00.000Z', openingBid: 90000 }),
    origin: { type: 'material_change', changedFields: ['openingBid'] },
  }, { filePath, now: '2026-09-05T18:03:00.000Z' }).case;
  assert.equal(changed.reconsiderationRequired, true);
  assert.equal(changed.latestTrigger.type, 'origin');
  assert.equal(changed.latestTrigger.matchedConditions[0].field, 'openingBid');
});

test('approved evidence links are metadata-only and packets have stable digests', (t) => {
  const filePath = tempStore(t);
  const created = cases.createCase({ listing: listing() }, { filePath, now: NOW }).case;
  const passed = cases.updateCase(created.id, {
    expectedRevision: 1, state: 'pass', reasonCodes: ['title_evidence_missing'],
    reconsideration: { mode: 'any', conditions: [{ field: 'requiredEvidence', operator: 'available', value: 'title_research' }] },
  }, { filePath, now: '2026-09-05T18:01:00.000Z' });
  assert.throws(() => cases.linkEvidence(created.id, approvedEvidence({ review: { decision: 'rejected' } }), {
    expectedRevision: passed.revision, relationship: 'title_research',
  }, { filePath, now: NOW }), (error) => error.code === 'RESEARCH_EVIDENCE_NOT_APPROVED');

  const linked = cases.linkEvidence(created.id, approvedEvidence(), {
    expectedRevision: passed.revision, relationship: 'title_research',
  }, { filePath, now: '2026-09-05T18:02:00.000Z' });
  assert.equal(linked.evidenceCount, 1);
  assert.equal(linked.reconsiderationRequired, true);
  assert.equal(linked.latestTrigger.type, 'evidence_link');

  const first = cases.buildPacket(created.id, { filePath });
  const second = cases.buildPacket(created.id, { filePath });
  assert.deepEqual(second, first);
  assert.equal(first.evidenceManifest[0].promotesFacts, false);
  assert.equal(JSON.stringify(first).includes('original'), false);
  assert.equal(first.digest.value, cases.sha(Object.fromEntries(Object.entries(first).filter(([key]) => key !== 'digest'))));
  const markdown = cases.packetToMarkdown(first);
  assert.match(markdown, /Property research packet/);
  assert.match(markdown, new RegExp(first.digest.value));

  const unlinked = cases.unlinkEvidence(created.id, approvedEvidence().id, { expectedRevision: linked.revision }, { filePath, now: '2026-09-05T18:03:00.000Z' });
  assert.equal(unlinked.evidenceCount, 0);
});

test('browser import previews validated live bookmarks and commits idempotent cases', async (t) => {
  const filePath = tempStore(t);
  const snapshot = listing({ id: 'snapshot-1', provenance: { origin: 'snapshot', observed: false } });
  const records = new Map([[listing().id, listing()], [snapshot.id, snapshot]]);
  const database = { async getListingById(id) { return records.get(id) || null; } };
  const ids = [listing().id, snapshot.id, 'missing-id'];
  const preview = await cases.previewBrowserImport(ids, { database, filePath, now: NOW });
  assert.equal(preview.total, 3);
  assert.equal(preview.creatable, 1);
  assert.equal(preview.rejected.length, 2);

  const committed = await cases.commitBrowserImport(ids, preview.previewHash, { database, filePath, now: NOW });
  assert.equal(committed.created.length, 1);
  assert.equal(committed.rejected.length, 2);
  assert.equal(cases.listCases({}, { filePath }).total, 1);
  await assert.rejects(
    cases.commitBrowserImport(ids, preview.previewHash, { database, filePath, now: NOW }),
    (error) => error.code === 'RESEARCH_IMPORT_CHANGED',
  );
});

test('workspace handler protects every route and serves create, decision, evidence, detail and packet', async (t) => {
  const filePath = tempStore(t);
  const database = { async getListingById(id) { return id === listing().id ? listing() : null; } };
  const handler = createWorkspaceHandler({
    database, filePath, env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, now: NOW,
    loadObservations: () => ({ records: {}, signals: [] }),
    getEvidence: (id) => id === approvedEvidence().id ? approvedEvidence() : null,
  });
  assert.equal((await invoke(handler, 'GET', '/api/workspace/cases', {}, '')).statusCode, 401);
  assert.equal((await invoke(createWorkspaceHandler({ database, filePath, env: {} }), 'GET', '/api/workspace/cases')).statusCode, 503);

  const create = await invoke(handler, 'POST', '/api/workspace/cases', { listingId: listing().id });
  assert.equal(create.statusCode, 201);
  const id = create.body.case.id;
  const list = await invoke(handler, 'GET', '/api/workspace/cases?state=inbox');
  assert.equal(list.body.total, 1);

  const pass = await invoke(handler, 'PATCH', `/api/workspace/cases/${id}`, {
    expectedRevision: 1, state: 'pass', reasonCodes: ['title_evidence_missing'],
    reconsideration: { mode: 'any', conditions: [{ field: 'requiredEvidence', operator: 'available', value: 'title_research' }] },
  });
  assert.equal(pass.statusCode, 200);
  const stale = await invoke(handler, 'PATCH', `/api/workspace/cases/${id}`, { expectedRevision: 1, state: 'pursue' });
  assert.equal(stale.statusCode, 409);

  const linked = await invoke(handler, 'POST', `/api/workspace/cases/${id}/evidence`, {
    expectedRevision: pass.body.case.revision, intakeId: approvedEvidence().id, relationship: 'title_research',
  });
  assert.equal(linked.body.case.latestTrigger.type, 'evidence_link');
  const detail = await invoke(handler, 'GET', `/api/workspace/cases/${id}`);
  assert.equal(detail.body.case.timeline.length, 3);
  assert.equal(detail.body.case.origins.length, 1);
  assert.equal(detail.body.dossier.reviewedEvidence[0].promotesFacts, false);
  assert.ok(detail.body.dossier.claimGroups.publisher.length > 0);

  const json = await invoke(handler, 'GET', `/api/workspace/cases/${id}/packet?format=json`);
  const md = await invoke(handler, 'GET', `/api/workspace/cases/${id}/packet?format=md`);
  assert.equal(md.headers['x-content-sha256'], json.body.digest.value);
  assert.match(md.headers['content-type'], /text\/markdown/);
  assert.match(md.body, /Evidence boundary/);
});

test('corrupt and locked stores fail closed without replacing retained bytes', (t) => {
  const filePath = tempStore(t);
  fs.writeFileSync(filePath, '{not-json', 'utf8');
  const retained = fs.readFileSync(filePath, 'utf8');
  assert.throws(() => cases.createCase({ listing: listing() }, { filePath, now: NOW }));
  assert.equal(fs.readFileSync(filePath, 'utf8'), retained);
  fs.writeFileSync(filePath, JSON.stringify(store.emptyStore()), 'utf8');
  fs.writeFileSync(`${filePath}.lock`, 'occupied', 'utf8');
  assert.throws(() => cases.createCase({ listing: listing() }, { filePath, now: NOW }), /locked/);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).cases.length, 0);
});

test('Windows transient rename locks retry without deleting the retained workspace', (t) => {
  const filePath=tempStore(t),temporary=`${filePath}.replacement.tmp`;fs.writeFileSync(filePath,'old','utf8');fs.writeFileSync(temporary,'new','utf8');
  const original=fs.renameSync;let calls=0,waits=0;
  t.mock.method(fs,'renameSync',(from,to)=>{calls++;if(calls<3){const error=new Error('temporarily locked');error.code='EPERM';throw error;}return original(from,to);});
  store.replaceFileWithRetry(temporary,filePath,{platform:'win32',attempts:4,wait:()=>{waits++;assert.equal(fs.readFileSync(filePath,'utf8'),'old');}});
  assert.equal(calls,3);assert.equal(waits,2);assert.equal(fs.readFileSync(filePath,'utf8'),'new');
});

test('HTTP browser import requires an unchanged preview and never imports snapshots', async (t) => {
  const filePath = tempStore(t);
  const snapshot = listing({ id: 'snapshot-1', provenance: { origin: 'snapshot', observed: false } });
  const records = new Map([[listing().id, listing()], [snapshot.id, snapshot]]);
  const handler = createWorkspaceHandler({
    database: { async getListingById(id) { return records.get(id) || null; } },
    filePath, env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, now: NOW,
    loadObservations: () => ({ records: {}, signals: [] }),
  });
  const preview = await invoke(handler, 'POST', '/api/workspace/import/preview', { listingIds: [listing().id, snapshot.id] });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.preview.creatable, 1);
  assert.equal(preview.body.preview.rejected[0].listingId, snapshot.id);
  const commit = await invoke(handler, 'POST', '/api/workspace/import/commit', {
    listingIds: [listing().id, snapshot.id], previewHash: preview.body.preview.previewHash,
  });
  assert.equal(commit.statusCode, 200);
  assert.equal(commit.body.result.created.length, 1);
  assert.equal(commit.body.result.rejected.length, 1);
});

test('main Node server dispatches the protected workspace route against live inventory', async (t) => {
  const filePath = tempStore(t);
  const previous = {
    token: process.env.SCRAPER_ADMIN_TOKEN,
    store: process.env.PROPERTY_RESEARCH_WORKSPACE_PATH,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.SCRAPER_ADMIN_TOKEN = 'workspace-http-secret';
  process.env.PROPERTY_RESEARCH_WORKSPACE_PATH = filePath;
  process.env.NODE_ENV = 'test';
  const database = require('../server/db/client');
  const { validateListingForIngestion } = require('../server/scrapers/validation');
  const inventory = await database.getListings({ limit: 1000, offset: 0 });
  const observed = inventory.listings.find((item) => item.provenance?.origin === 'live' && validateListingForIngestion(item).isValid);
  assert.ok(observed, 'test inventory needs one validated source-observed record');
  const server = require('../server/server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (previous.token === undefined) delete process.env.SCRAPER_ADMIN_TOKEN; else process.env.SCRAPER_ADMIN_TOKEN = previous.token;
    if (previous.store === undefined) delete process.env.PROPERTY_RESEARCH_WORKSPACE_PATH; else process.env.PROPERTY_RESEARCH_WORKSPACE_PATH = previous.store;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const unauthorized = await fetch(`${base}/api/workspace/cases`);
  assert.equal(unauthorized.status, 401);
  const created = await fetch(`${base}/api/workspace/cases`, {
    method: 'POST',
    headers: { authorization: 'Bearer workspace-http-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ listingId: observed.id }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const detail = await fetch(`${base}/api/workspace/cases/${createdBody.case.id}`, {
    headers: { authorization: 'Bearer workspace-http-secret' },
  });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).case.sourceRef.recordId, String(observed.provenance.recordId));
});
