'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { Worker } = require('node:worker_threads');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-hunts-http-'));
const storePath = path.join(temporaryDirectory, 'saved-hunts.json');

// Keep the server on its deterministic test inventory and isolate every durable write.
process.env.NODE_ENV = 'test';
process.env.PROPERTY_HUNTS_PATH = storePath;
delete process.env.SCRAPER_ADMIN_TOKEN;

const server = require('../server/server');
const hunts = require('../server/intelligence/hunts');
const huntStore = require('../server/intelligence/hunt-store');

let baseUrl;

function request(method, pathname, { token, body } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(target, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = responseBody ? JSON.parse(responseBody) : null; } catch (_) { parsed = responseBody; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function listing(overrides = {}) {
  const observedAt = overrides.sourceObservedAt || '2026-09-05T17:00:00.000Z';
  const recordId = overrides.recordId || '2128964683';
  return {
    id: `CIV-NJ-${recordId}`,
    source: 'civilview',
    state: 'NJ',
    county: 'Bergen',
    city: 'Park Ridge',
    address: '19 West Park Avenue, Park Ridge, NJ 07656',
    propType: 'Single Family',
    status: 'scheduled',
    openingBid: 100000,
    saleDate: '2026-10-01',
    raw: `Source record ${recordId}`,
    sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${recordId}`,
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'CivilView',
      recordId,
      observedAt,
    },
    ...overrides,
  };
}

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  delete process.env.SCRAPER_ADMIN_TOKEN;
  await new Promise((resolve) => server.close(resolve));
  if (temporaryDirectory.startsWith(os.tmpdir())) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('real HTTP server protects and serves the full saved-hunt lifecycle without mutating inventory', async () => {
  const unavailable = await request('GET', '/api/hunts');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.requiredConfiguration, 'SCRAPER_ADMIN_TOKEN');

  const token = 'http-hunt-operator';
  process.env.SCRAPER_ADMIN_TOKEN = token;
  assert.equal((await request('GET', '/api/hunts')).status, 401);
  assert.deepEqual((await request('GET', '/api/hunts', { token })).body, { items: [] });

  const created = await request('POST', '/api/hunts', {
    token,
    body: {
      name: 'Observed source records',
      criteria: { mode: 'all', rules: [{ field: 'source', operator: 'known' }] },
    },
  });
  assert.equal(created.status, 201);
  const huntId = created.body.hunt.id;
  assert.equal(created.body.hunt.version, 1);

  const listed = await request('GET', '/api/hunts', { token });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.items.map((hunt) => hunt.id), [huntId]);

  const detail = await request('GET', `/api/hunts/${huntId}`, { token });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.baseline, null);

  const evaluated = await request('POST', `/api/hunts/${huntId}/evaluate`, { token });
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.body.evaluation.baselineCreated, true);
  assert.ok(evaluated.body.evaluation.counts.inventory <= 585, 'test-mode inventory must remain bounded to the repository seed');
  assert.equal(evaluated.body.evaluation.counts.inventory,
    evaluated.body.evaluation.counts.accepted + evaluated.body.evaluation.counts.rejected);
  assert.deepEqual(evaluated.body.evaluation.newEvents, []);
  assert.ok(evaluated.body.evaluation.results.every((result) => !Object.hasOwn(result, 'raw')));

  const paused = await request('PATCH', `/api/hunts/${huntId}`, { token, body: { enabled: false } });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.hunt.enabled, false);
  assert.equal(paused.body.hunt.version, 1);
  const pausedEvaluation = await request('POST', `/api/hunts/${huntId}/evaluate`, { token });
  assert.equal(pausedEvaluation.status, 409);
  assert.equal(pausedEvaluation.body.code, 'HUNT_DISABLED');

  const revised = await request('PATCH', `/api/hunts/${huntId}`, {
    token,
    body: {
      enabled: true,
      criteria: { mode: 'all', rules: [{ field: 'state', operator: 'known' }] },
    },
  });
  assert.equal(revised.status, 200);
  assert.equal(revised.body.hunt.version, 2);
  assert.equal((await request('GET', `/api/hunts/${huntId}`, { token })).body.baseline, null);

  const freshBaseline = await request('POST', `/api/hunts/${huntId}/evaluate`, { token });
  assert.equal(freshBaseline.status, 200);
  assert.equal(freshBaseline.body.evaluation.baselineCreated, true);
  assert.deepEqual((await request('GET', `/api/hunts/${huntId}/events?limit=10`, { token })).body, { items: [] });

  const removed = await request('DELETE', `/api/hunts/${huntId}`, { token });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { deleted: true, id: huntId });
  assert.equal((await request('GET', `/api/hunts/${huntId}`, { token })).status, 404);
  assert.deepEqual((await request('GET', '/api/hunts', { token })).body, { items: [] });
});

test('an overlapping writer locks out duplicate evaluation without corrupting the store', async () => {
  const filePath = path.join(temporaryDirectory, 'concurrent-hunts.json');
  const hunt = hunts.createHunt({
    name: 'Concurrent evaluation',
    criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NJ' }] },
  }, { filePath, now: '2026-09-05T18:00:00.000Z' });
  hunts.runHunt(hunt.id, [listing()], { filePath, now: '2026-09-05T18:00:00.000Z' });
  const original = fs.readFileSync(filePath, 'utf8');

  const signal = new SharedArrayBuffer(4);
  const signalView = new Int32Array(signal);
  const storeModule = path.resolve(__dirname, '../server/intelligence/hunt-store.js');
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { mutateStore } = require(workerData.storeModule);
    mutateStore(workerData.filePath, () => {
      parentPort.postMessage('locked');
      Atomics.wait(new Int32Array(workerData.signal), 0, 0, 5000);
      return { changed: false, value: null };
    });
    parentPort.postMessage('released');
  `, { eval: true, workerData: { filePath, signal, storeModule } });

  try {
    await new Promise((resolve, reject) => {
      worker.once('message', (message) => message === 'locked' && resolve());
      worker.once('error', reject);
    });
    assert.throws(() => hunts.runHunt(hunt.id, [listing({
      sourceObservedAt: '2026-09-05T17:05:00.000Z',
      openingBid: 90000,
      provenance: {
        origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView',
        recordId: '2128964683', observedAt: '2026-09-05T17:05:00.000Z',
      },
    })], { filePath, now: '2026-09-05T18:01:00.000Z' }), /locked by another writer/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  } finally {
    const released = new Promise((resolve, reject) => {
      worker.on('message', (message) => message === 'released' && resolve());
      worker.once('error', reject);
    });
    Atomics.store(signalView, 0, 1);
    Atomics.notify(signalView, 0);
    await released;
    await worker.terminate();
  }
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
  assert.doesNotThrow(() => huntStore.loadStore(filePath));
});

test('same-timestamp changed facts are ignored conservatively', () => {
  const filePath = path.join(temporaryDirectory, 'same-time-hunts.json');
  const hunt = hunts.createHunt({
    name: 'Same observation time',
    criteria: { mode: 'all', rules: [{ field: 'openingBid', operator: 'lte', value: 150000 }] },
  }, { filePath, now: '2026-09-05T18:00:00.000Z' });
  hunts.runHunt(hunt.id, [listing({ openingBid: 100000 })], { filePath, now: '2026-09-05T18:00:00.000Z' });

  const duplicateTime = listing({ openingBid: 200000 });
  const result = hunts.runHunt(hunt.id, [duplicateTime], { filePath, now: '2026-09-05T18:01:00.000Z' });
  assert.equal(result.counts.olderIgnored, 1);
  assert.deepEqual(result.newEvents, []);
  const record = Object.values(huntStore.loadStore(filePath).baselines[hunt.id].records)[0];
  assert.equal(record.snapshot.openingBid, 100000);
  assert.equal(record.status, 'match');
});
