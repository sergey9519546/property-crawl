'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const huntStore = require('../server/intelligence/hunt-store');
const hunts = require('../server/intelligence/hunts');
const { createHuntsHandler } = require('../server/routes/hunts');

const temporaryDirectories = [];
const NOW = '2026-09-05T18:00:00.000Z';

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-hunts-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'saved-hunts.json');
}

function listing(overrides = {}) {
  const observedAt = overrides.sourceObservedAt || '2026-09-05T17:00:00.000Z';
  const recordId = overrides.recordId || '2128964683';
  return {
    id: `CIV-NJ-${recordId}`, source: 'civilview', state: 'NJ', county: 'Bergen', city: 'Park Ridge',
    address: '19 West Park Avenue, Park Ridge, NJ 07656', propType: 'Single Family', status: 'scheduled',
    openingBid: 100000, saleDate: '2026-10-01', sqft: 1800, deposit: '$5,000 certified funds',
    raw: `Official CivilView source record for sheriff sale ${recordId}.`,
    sourceUrl: `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${recordId}`,
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView',
      recordId, observedAt,
    },
    ...overrides,
  };
}

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
  };
}

async function request(handler, method, url, { token, body } = {}) {
  const req = { method, url, body: body || {}, headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = response();
  await handler(req, res, new URL(url, 'http://localhost'));
  return res;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const target = temporaryDirectories.pop();
    if (target.startsWith(os.tmpdir())) fs.rmSync(target, { recursive: true, force: true });
  }
});

test('criteria validation is bounded, typed, normalized, and rejects unsupported expressions', () => {
  const valid = hunts.validateHuntInput({
    name: '  Bergen opportunities  ',
    criteria: { mode: 'all', rules: [
      { field: 'state', operator: 'in', value: ['nj', 'PA'] },
      { field: 'openingBid', operator: 'between', value: [50000, 250000] },
      { field: 'saleDate', operator: 'on_or_after', value: '2026-09-01' },
    ] },
  });
  assert.equal(valid.isValid, true);
  assert.equal(valid.value.name, 'Bergen opportunities');
  assert.deepEqual(valid.value.criteria.rules[0].value, ['NJ', 'PA']);
  assert.equal(valid.value.criteria.rules[2].value, '2026-09-01T00:00:00.000Z');

  for (const criteria of [
    { mode: 'all', rules: [{ field: 'raw', operator: 'eq', value: 'secret' }] },
    { mode: 'all', rules: [{ field: 'openingBid', operator: 'contains', value: 5 }] },
    { mode: 'any', rules: [{ field: 'openingBid', operator: 'between', value: [20, 10] }] },
    { mode: 'none', rules: [{ field: 'state', operator: 'eq', value: 'NJ' }] },
    { mode: 'all', rules: Array.from({ length: 21 }, () => ({ field: 'state', operator: 'eq', value: 'NJ' })) },
  ]) assert.equal(hunts.validateHuntInput({ name: 'bad', criteria }).isValid, false);
});

test('tri-state evaluation explains every clause and never treats missing evidence as zero', () => {
  const hunt = {
    criteria: { mode: 'all', rules: [
      { field: 'state', operator: 'eq', value: 'NJ' },
      { field: 'openingBid', operator: 'lte', value: 150000 },
      { field: 'sqft', operator: 'gte', value: 1000 },
    ] },
  };
  const result = hunts.evaluateListing(listing({ openingBid: null }), hunt, { now: NOW });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.clauseResults.map((clause) => clause.status), ['match', 'unknown', 'match']);
  assert.match(result.clauseResults[1].reason, /unavailable/);
  assert.equal(result.clauseResults[1].evidenceClass, 'publisher_reported');

  const any = hunts.evaluateListing(listing({ openingBid: null, state: 'PA' }), {
    criteria: { mode: 'any', rules: [
      { field: 'state', operator: 'eq', value: 'NJ' },
      { field: 'openingBid', operator: 'gte', value: 1 },
    ] },
  }, { now: NOW });
  assert.equal(any.status, 'unknown');
});

test('fixtures and future observations return unknown and cannot enter a baseline', () => {
  const hunt = { id: 'hunt_aaaaaaaaaaaaaaaaaaaaaaaa', version: 1, enabled: true, criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NJ' }] } };
  const fixture = listing({ provenance: { origin: 'fixture', observed: false, fixture: true, publisher: 'Fixture', recordId: 'fixture' } });
  const future = listing({ sourceObservedAt: '2026-09-06T18:00:00.000Z' });
  future.provenance = { ...future.provenance, observedAt: future.sourceObservedAt };
  const evaluated = hunts.evaluateInventory(hunt, [fixture, future], { now: NOW });
  assert.equal(evaluated.response.counts.accepted, 0);
  assert.equal(evaluated.response.counts.rejected, 2);
  assert.equal(Object.keys(evaluated.baseline.records).length, 0);
  assert.ok(evaluated.response.results.every((result) => result.status === 'unknown'));
});

test('derived score fields require explicit derivation provenance and are never publisher facts', () => {
  const hunt = { criteria: { mode: 'all', rules: [{ field: 'dealScore', operator: 'gte', value: 60 }] } };
  const unsupported = hunts.evaluateListing(listing({ dealScore: 95 }), hunt, { now: NOW });
  assert.equal(unsupported.status, 'unknown');
  assert.equal(unsupported.clauseResults[0].actual, null);
  assert.equal(unsupported.clauseResults[0].evidenceClass, 'derived_from_listing_values');

  const declaredWithoutInputs = listing({ dealScore: 95 });
  declaredWithoutInputs.provenance = {
    ...declaredWithoutInputs.provenance,
    derivedFields: { valuationMetrics: { model: 'observed-valuation-range-v1', inputs: ['openingBid', 'estLow', 'estHigh'] } },
  };
  assert.equal(hunts.evaluateListing(declaredWithoutInputs, hunt, { now: NOW }).status, 'unknown');

  const supportedListing = listing({ estLow: 180000, estHigh: 220000, mid: 200000, ratio: 0.5, dealScore: 65 });
  supportedListing.provenance = {
    ...supportedListing.provenance,
    derivedFields: { valuationMetrics: { model: 'observed-valuation-range-v1', inputs: ['openingBid', 'estLow', 'estHigh'] } },
  };
  const supported = hunts.evaluateListing(supportedListing, hunt, { now: NOW });
  assert.equal(supported.status, 'match');
  assert.equal(supported.clauseResults[0].evidenceClass, 'derived_from_listing_values');

  const legacyEquity = { ...supportedListing, equity: 100000 };
  const equity = hunts.evaluateListing(legacyEquity, {
    criteria: { mode: 'all', rules: [{ field: 'equity', operator: 'gte', value: 1 }] },
  }, { now: NOW });
  assert.equal(equity.status, 'unknown');
  assert.equal(equity.clauseResults[0].actual, null);
});

test('a derived building-area marker cannot pass as publisher-reported square footage', () => {
  const derivedArea = listing();
  derivedArea.provenance = {
    ...derivedArea.provenance,
    derivedFields: { sqft: { model: 'exterior-proxy', inputs: ['image'] } },
  };
  const result = hunts.evaluateListing(derivedArea, {
    criteria: { mode: 'all', rules: [{ field: 'sqft', operator: 'gte', value: 1500 }] },
  }, { now: NOW });
  assert.equal(result.status, 'unknown');
  assert.equal(result.clauseResults[0].actual, null);
  assert.equal(result.clauseResults[0].evidenceClass, 'derived_unverified');
});

test('hunt CRUD is durable, criteria changes increment version, and reset comparison baseline', () => {
  const filePath = temporaryStore();
  const created = hunts.createHunt({ name: 'NJ under 150k', criteria: { mode: 'all', rules: [{ field: 'openingBid', operator: 'lte', value: 150000 }] } }, { filePath, now: NOW });
  assert.match(created.id, /^hunt_[a-f0-9]{24}$/);
  assert.equal(hunts.listHunts({ filePath })[0].version, 1);
  const initial = hunts.runHunt(created.id, [listing()], { filePath, now: NOW });
  assert.equal(initial.baselineCreated, true);
  assert.equal(hunts.getHunt(created.id, { filePath }).baseline.records, 1);
  assert.deepEqual(hunts.getHunt(created.id, { filePath }).hunt.versions.map((version) => version.version), [1]);

  const renamed = hunts.updateHunt(created.id, { name: 'Renamed' }, { filePath, now: '2026-09-05T18:01:00.000Z' });
  assert.equal(renamed.version, 1);
  assert.equal(hunts.getHunt(created.id, { filePath }).baseline.records, 1);

  const updated = hunts.updateHunt(created.id, { criteria: { mode: 'all', rules: [{ field: 'openingBid', operator: 'lte', value: 90000 }] } }, { filePath, now: '2026-09-05T18:02:00.000Z' });
  assert.equal(updated.version, 2);
  assert.equal(updated.versionCount, 2);
  const detail = hunts.getHunt(created.id, { filePath });
  assert.equal(detail.baseline, null);
  assert.deepEqual(detail.hunt.versions.map((version) => version.version), [1, 2]);
  assert.deepEqual(hunts.deleteHunt(created.id, { filePath, now: NOW }), { deleted: true, id: created.id });
  assert.deepEqual(hunts.listHunts({ filePath }), []);
});

test('lifecycle events use newer exact source records and disappearance never implies sold', () => {
  const filePath = temporaryStore();
  const hunt = hunts.createHunt({ name: 'NJ under 150k', criteria: { mode: 'all', rules: [{ field: 'openingBid', operator: 'lte', value: 150000 }] } }, { filePath, now: NOW });

  const baseline = hunts.runHunt(hunt.id, [listing()], { filePath, now: NOW });
  assert.equal(baseline.baselineCreated, true);
  assert.deepEqual(baseline.newEvents, []);

  const timestampOnly = listing({ sourceObservedAt: '2026-09-05T17:05:00.000Z' });
  timestampOnly.provenance = { ...timestampOnly.provenance, observedAt: timestampOnly.sourceObservedAt };
  assert.equal(hunts.runHunt(hunt.id, [timestampOnly], { filePath, now: NOW }).newEvents.length, 0);

  const reduced = listing({ sourceObservedAt: '2026-09-05T17:10:00.000Z', openingBid: 90000 });
  reduced.provenance = { ...reduced.provenance, observedAt: reduced.sourceObservedAt };
  const material = hunts.runHunt(hunt.id, [reduced], { filePath, now: NOW });
  assert.deepEqual(material.newEvents.map((event) => event.type), ['material_change']);
  assert.deepEqual(material.newEvents[0].changedFields, ['openingBid']);
  assert.equal(material.newEvents[0].address, reduced.address);

  const tooHigh = listing({ sourceObservedAt: '2026-09-05T17:20:00.000Z', openingBid: 200000 });
  tooHigh.provenance = { ...tooHigh.provenance, observedAt: tooHigh.sourceObservedAt };
  assert.deepEqual(hunts.runHunt(hunt.id, [tooHigh], { filePath, now: NOW }).newEvents.map((event) => event.type), ['no_longer_matches']);

  const unavailable = listing({ sourceObservedAt: '2026-09-05T17:30:00.000Z', openingBid: null });
  unavailable.provenance = { ...unavailable.provenance, observedAt: unavailable.sourceObservedAt };
  assert.deepEqual(hunts.runHunt(hunt.id, [unavailable], { filePath, now: NOW }).newEvents.map((event) => event.type), ['evaluation_unknown']);

  const second = listing({ id: 'CIV-NJ-9999999999', recordId: '9999999999', sourceObservedAt: '2026-09-05T17:40:00.000Z' });
  second.provenance = { ...second.provenance, recordId: '9999999999', observedAt: second.sourceObservedAt };
  const added = hunts.runHunt(hunt.id, [unavailable, second], { filePath, now: NOW });
  assert.deepEqual(added.newEvents.map((event) => event.type), ['new_match']);

  const disappeared = hunts.runHunt(hunt.id, [], { filePath, now: NOW });
  assert.equal(disappeared.counts.notObserved, 2);
  assert.equal(disappeared.newEvents.length, 0);
  assert.ok(hunts.listEvents(hunt.id, {}, { filePath }).every((event) => !/sold|resolved|disappeared/.test(event.type)));
});

test('older or duplicate observations cannot overwrite the current hunt baseline', () => {
  const filePath = temporaryStore();
  const hunt = hunts.createHunt({ name: 'Current bid', criteria: { mode: 'all', rules: [{ field: 'openingBid', operator: 'lte', value: 150000 }] } }, { filePath, now: NOW });
  const newest = listing({ sourceObservedAt: '2026-09-05T17:30:00.000Z', openingBid: 90000 });
  newest.provenance = { ...newest.provenance, observedAt: newest.sourceObservedAt };
  hunts.runHunt(hunt.id, [newest], { filePath, now: NOW });
  const older = listing({ sourceObservedAt: '2026-09-05T16:30:00.000Z', openingBid: 200000 });
  older.provenance = { ...older.provenance, observedAt: older.sourceObservedAt };
  const result = hunts.runHunt(hunt.id, [older], { filePath, now: NOW });
  assert.equal(result.counts.olderIgnored, 1);
  assert.equal(result.counts.match, 1);
  assert.equal(result.counts.noMatch, 0);
  assert.equal(result.results[0].status, 'match');
  assert.equal(result.results[0].observationDisposition, 'older_ignored');
  assert.equal(result.results[0].observedAt, newest.sourceObservedAt);
  assert.equal(result.results[0].ignoredObservedAt, older.sourceObservedAt);
  assert.equal(result.newEvents.length, 0);
  const baseline = huntStore.loadStore(filePath).baselines[hunt.id];
  assert.equal(Object.values(baseline.records)[0].snapshot.openingBid, 90000);
});

test('source observation freshness orders records but is not itself a material fact', () => {
  const filePath = temporaryStore();
  const hunt = hunts.createHunt({
    name: 'Fresh observed record',
    criteria: { mode: 'all', rules: [{ field: 'sourceObservedAt', operator: 'known' }] },
  }, { filePath, now: NOW });
  hunts.runHunt(hunt.id, [listing()], { filePath, now: NOW });
  const refreshed = listing({ sourceObservedAt: '2026-09-05T17:05:00.000Z' });
  refreshed.provenance = { ...refreshed.provenance, observedAt: refreshed.sourceObservedAt };
  const result = hunts.runHunt(hunt.id, [refreshed], { filePath, now: NOW });
  assert.equal(result.results[0].status, 'match');
  assert.deepEqual(result.newEvents, []);
});

test('atomic locking and corrupt stores fail without replacing existing bytes', () => {
  const filePath = temporaryStore();
  hunts.createHunt({ name: 'Locked', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NJ' }] } }, { filePath, now: NOW });
  const original = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(`${filePath}.lock`, 'busy');
  assert.throws(() => hunts.createHunt({ name: 'Second', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'PA' }] } }, { filePath, now: NOW }), /locked/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  fs.unlinkSync(`${filePath}.lock`);
  fs.writeFileSync(filePath, '{broken');
  const corrupt = fs.readFileSync(filePath, 'utf8');
  assert.throws(() => hunts.listHunts({ filePath }));
  assert.equal(fs.readFileSync(filePath, 'utf8'), corrupt);
});

test('route protects every read and mutation and exposes safe evaluation summaries', async () => {
  const filePath = temporaryStore();
  const database = { getListings: async () => ({ total: 1, listings: [listing()] }) };
  const disabled = createHuntsHandler({ database, filePath, env: {} });
  assert.equal((await request(disabled, 'GET', '/api/hunts')).statusCode, 503);

  const handler = createHuntsHandler({ database, filePath, env: { SCRAPER_ADMIN_TOKEN: 'operator-secret' }, now: () => NOW });
  assert.equal((await request(handler, 'GET', '/api/hunts')).statusCode, 401);
  assert.equal((await request(handler, 'GET', '/api/hunts', { token: 'wrong' })).statusCode, 401);
  assert.deepEqual((await request(handler, 'GET', '/api/hunts', { token: 'operator-secret' })).body, { items: [] });

  const created = await request(handler, 'POST', '/api/hunts', {
    token: 'operator-secret',
    body: { name: 'Route hunt', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NJ' }] } },
  });
  assert.equal(created.statusCode, 201);
  const id = created.body.hunt.id;
  const evaluated = await request(handler, 'POST', `/api/hunts/${id}/evaluate`, { token: 'operator-secret' });
  assert.equal(evaluated.statusCode, 200);
  assert.equal(evaluated.body.evaluation.counts.match, 1);
  assert.equal(evaluated.body.evaluation.results[0].address, listing().address);
  assert.equal(Object.hasOwn(evaluated.body.evaluation.results[0], 'raw'), false);
  assert.equal((await request(handler, 'GET', `/api/hunts/${id}`, { token: 'operator-secret' })).body.baseline.records, 1);
  assert.deepEqual((await request(handler, 'GET', `/api/hunts/${id}/events`, { token: 'operator-secret' })).body, { items: [] });
});

test('route refuses a truncated inventory instead of producing incomplete lifecycle comparisons', async () => {
  const filePath = temporaryStore();
  const hunt = hunts.createHunt({ name: 'Complete inventory', criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NJ' }] } }, { filePath, now: NOW });
  const handler = createHuntsHandler({
    database: { getListings: async () => ({ total: 2, listings: [listing()] }) },
    filePath, env: { SCRAPER_ADMIN_TOKEN: 'secret' }, now: NOW,
  });
  const res = await request(handler, 'POST', `/api/hunts/${hunt.id}/evaluate`, { token: 'secret' });
  assert.equal(res.statusCode, 409);
  assert.equal(hunts.getHunt(hunt.id, { filePath }).baseline, null);
});
