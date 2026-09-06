'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPropertyDossier } = require('../server/intelligence/dossier');
const { createPropertyIntelligenceHandler } = require('../server/routes/property-intelligence');
const { validateListingForIngestion } = require('../server/scrapers/validation');
const { updateObservations } = require('../server/sources/observations');
const { buildPublicRecordEvidence } = require('../server/public-records');

const NOW = Date.now();
const observedAt = new Date(NOW - 3600000).toISOString();
const emptyHistory = () => ({ version: 1, runs: {}, records: {}, signals: [] });

// Synthetic in-memory test records shaped like the real CivilView publisher
// contract. No fixture is written to inventory or claimed as a live discovery.
function publisherFixture(overrides = {}) {
  const timestamp = overrides.sourceObservedAt || observedAt;
  return {
    id: 'CIV-NJ-7-2128964683', source: 'civilview', state: 'NJ', county: 'Bergen',
    city: 'Park Ridge', zip: '07656', address: '19 West Park Avenue, Park Ridge, NJ 07656',
    openingBid: 100000, saleDate: '2027-10-01', status: 'scheduled', deposit: null,
    propType: 'Single Family', sqft: 1200, assessed: 180000,
    raw: 'Synthetic test-only notice shaped like an official CivilView sheriff-sale record.',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683',
    ...overrides, sourceObservedAt: timestamp,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record', publisher: 'CivilView',
      recordId: '2128964683', observedAt: timestamp, ...overrides.provenance,
    },
  };
}

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

async function invoke(handler, method, id = publisherFixture().id) {
  const res = response();
  await handler({ method, url: `/api/property-intelligence?listingId=${encodeURIComponent(id)}`, body: { listingId: id } }, res);
  return res;
}

function handlerFor(getListing, buildEvidence = async () => ({ parcel: null, areaContext: null, issues: [], sources: [] }), readHistory = emptyHistory) {
  return createPropertyIntelligenceHandler({ database: { getListingById: getListing }, buildPublicRecordEvidence: buildEvidence, loadObservations: readHistory });
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('synthetic publisher fixture passes the real ingestion validator', () => {
  const validated = validateListingForIngestion(publisherFixture());
  assert.equal(validated.isValid, true, validated.errors.join(', '));
});

test('GET reads publisher evidence without invoking enrichment or outbound fetch', async (t) => {
  let enrichCalls = 0;
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected outbound request'); });
  const handler = handlerFor(async () => publisherFixture(), async () => { enrichCalls++; throw new Error('GET must not enrich'); });
  const result = await invoke(handler, 'GET');
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(enrichCalls, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(result.body.source.status, 'source_observed');
  assert.equal(result.body.publicRecords, null);
  assert.equal(result.body.facts.find(fact => fact.key === 'openingBid').value, 100000);
});

test('POST rejects snapshot, missing observation, future, and wrong publisher URL records before enrichment', async () => {
  const rejected = [
    publisherFixture({ provenance: { origin: 'snapshot', observed: false } }),
    publisherFixture({ provenance: { observed: false } }),
    publisherFixture({ sourceObservedAt: new Date(NOW + 86400000).toISOString() }),
    publisherFixture({ sourceUrl: 'https://example.com/property/2128964683' }),
  ];
  for (const listing of rejected) {
    let calls = 0;
    const result = await invoke(handlerFor(async () => listing, async () => { calls++; return {}; }), 'POST');
    assert.equal(result.statusCode, 422);
    assert.equal(calls, 0);
  }
});

test('concurrent valid POSTs coalesce, then POST and GET use the same cached evidence', async () => {
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const evidence = { parcel: null, areaContext: null, issues: ['A source is unavailable'], sources: [] };
  const handler = handlerFor(async () => publisherFixture(), async () => { calls++; return pending; });
  const first = invoke(handler, 'POST');
  const second = invoke(handler, 'POST');
  await nextTurn();
  assert.equal(calls, 1);
  release(evidence);
  const results = await Promise.all([first, second]);
  assert.equal(results[0].statusCode, 200);
  assert.deepEqual(results[0].body.publicRecords, evidence);
  assert.deepEqual(results[1].body.publicRecords, evidence);
  const third = await invoke(handler, 'POST');
  const read = await invoke(handler, 'GET');
  assert.equal(calls, 1);
  assert.deepEqual(third.body.publicRecords, evidence);
  assert.deepEqual(read.body.publicRecords, evidence);
});

test('a newer source observation invalidates the public-record cache', async () => {
  let listing = publisherFixture(), calls = 0;
  const handler = handlerFor(async () => listing, async () => ({ attempt: ++calls }));
  assert.equal((await invoke(handler, 'POST')).body.publicRecords.attempt, 1);
  listing = publisherFixture({ sourceObservedAt: new Date(NOW - 1000).toISOString() });
  assert.equal((await invoke(handler, 'GET')).body.publicRecords, null);
  assert.equal((await invoke(handler, 'POST')).body.publicRecords.attempt, 2);
});

test('cached research cannot bypass POST source-validation when a record becomes unverified', async () => {
  let listing = publisherFixture(), calls = 0;
  const handler = handlerFor(async () => listing, async () => ({ attempt: ++calls }));
  assert.equal((await invoke(handler, 'POST')).statusCode, 200);
  listing = publisherFixture({ provenance: { origin: 'snapshot', observed: false } });
  const rejected = await invoke(handler, 'POST');
  assert.equal(rejected.statusCode, 422);
  assert.equal(calls, 1);
  assert.equal((await invoke(handler, 'GET')).body.publicRecords, null);
});

test('publisher record identity changes invalidate cached research even if listing ID and timestamp remain', async () => {
  let listing = publisherFixture(), calls = 0;
  const handler = handlerFor(async () => listing, async current => ({ attempt: ++calls, recordId: current.provenance.recordId }));
  assert.equal((await invoke(handler, 'POST')).body.publicRecords.recordId, '2128964683');
  listing = publisherFixture({
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964699',
    provenance: { recordId: '2128964699' },
  });
  assert.equal(validateListingForIngestion(listing).isValid, true);
  assert.equal((await invoke(handler, 'GET')).body.publicRecords, null);
  const refreshed = await invoke(handler, 'POST');
  assert.equal(refreshed.body.publicRecords.recordId, '2128964699');
  assert.equal(calls, 2);
});

test('missing debt and HPI leave equity unavailable despite known bid and assessment', async () => {
  const listing = publisherFixture({ openingBid: 50000, assessed: 900000 });
  const publicRecords = await buildPublicRecordEvidence(listing);
  const dossier = buildPropertyDossier(listing, { publicRecords, now: NOW });
  assert.equal(dossier.publicRecords.equityScenario.status, 'unavailable');
  assert.equal(dossier.publicRecords.equityScenario.estimatedEquity, null);
  assert.ok(dossier.gaps.some(gap => gap.id === 'value_and_debt'));
  assert.equal(dossier.facts.some(fact => /equity/i.test(fact.key)), false);
});

test('building-area discrepancies require a matched parcel, not a spatial candidate or area context', () => {
  const listing = publisherFixture({ sqft: 1200 });
  const parcel = { status: 'candidate', properties: { livingAreaSqft: 1800 }, source: { url: 'https://official.example/parcel/1' } };
  const candidate = buildPropertyDossier(listing, { publicRecords: { parcel }, now: NOW });
  assert.deepEqual(candidate.contradictions, []);
  const matched = buildPropertyDossier(listing, { publicRecords: { parcel: { ...parcel, status: 'matched' } }, now: NOW });
  assert.equal(matched.contradictions.length, 1);
  const finding = matched.contradictions[0];
  assert.equal(finding.id, 'building_area_discrepancy');
  assert.equal(finding.listingValue, 1200);
  assert.equal(finding.publicRecordValue, 1800);
  assert.equal(finding.unit, 'sq ft');
  assert.equal(finding.sourceUrl, parcel.source.url);
  assert.match(finding.explanation, /research lead/);
  const nearby = buildPropertyDossier(listing, { publicRecords: { parcel: { ...parcel, status: 'matched', properties: { livingAreaSqft: 1250 } } }, now: NOW });
  assert.deepEqual(nearby.contradictions, []);
  const area = buildPropertyDossier(listing, { publicRecords: { areaContext: { metrics: { medianHomeValue: 900000, vacancyRate: 0.8 } } }, now: NOW });
  assert.deepEqual(area.contradictions, []);
  assert.equal(area.facts.find(fact => fact.key === 'occupancy').evidenceClass, 'unknown');
});

test('a past sale date is an open research question and never implies sold status', () => {
  const yesterday = new Date(NOW - 86400000).toISOString().slice(0, 10);
  const dossier = buildPropertyDossier(publisherFixture({ saleDate: yesterday, status: 'scheduled', sourceObservedAt: new Date(NOW - 14 * 86400000).toISOString() }), { now: NOW });
  assert.equal(dossier.facts.find(fact => fact.key === 'status').value, 'scheduled');
  assert.ok(dossier.gaps.some(gap => gap.id === 'sale_date_passed'));
  assert.equal(dossier.source.freshness, 'stale');
  assert.ok(dossier.gaps.some(gap => gap.id === 'source_stale'));
  assert.deepEqual(dossier.signals, []);
  assert.deepEqual(dossier.contradictions, []);
});

test('observed changes preserve camelCase fields, before/after values, publisher URLs and both timestamps', () => {
  const observations = emptyHistory();
  const beforeTime = new Date(NOW - 7200000).toISOString();
  const afterTime = observedAt;
  const before = publisherFixture({ sourceObservedAt: beforeTime, deposit: 5000, status: 'withdrawn', saleDate: '2027-10-01' });
  const after = publisherFixture({ sourceObservedAt: afterTime, openingBid: 90000, deposit: 10000, status: 'scheduled', saleDate: '2027-11-01' });
  updateObservations(observations, 'civilview', { listings: [before], error: null }, { now: new Date(NOW).toISOString() });
  updateObservations(observations, 'civilview', { listings: [after], error: null }, { now: new Date(NOW).toISOString() });
  observations.signals.push({ ...observations.signals[0], id: 'unrelated', listingId: 'OTHER-LISTING' });
  const dossier = buildPropertyDossier(after, { observations, now: NOW });
  const expected = {
    openingBid: { before: 100000, after: 90000, kind: 'bid_reduced' },
    saleDate: { before: '2027-10-01', after: '2027-11-01', kind: 'sale_date_changed' },
    deposit: { before: 5000, after: 10000, kind: 'terms_changed' },
    status: { before: 'withdrawn', after: 'scheduled', kind: 'returned_to_market' },
  };
  assert.equal(dossier.signals.length, 4);
  assert.equal(dossier.summary.supportedChanges, 4);
  for (const signal of dossier.signals) {
    assert.ok(expected[signal.field], `Unexpected changed field ${signal.field}`);
    assert.equal(signal.before, expected[signal.field].before);
    assert.equal(signal.after, expected[signal.field].after);
    assert.equal(signal.kind, expected[signal.field].kind);
    assert.equal(signal.observedAt, afterTime);
    assert.deepEqual(signal.evidence, [
      { sourceUrl: before.sourceUrl, observedAt: beforeTime, value: signal.before },
      { sourceUrl: after.sourceUrl, observedAt: afterTime, value: signal.after },
    ]);
  }
  assert.equal(dossier.history.firstObservedAt, beforeTime);
  assert.equal(dossier.history.observations, 2);
  assert.deepEqual(dossier.history.snapshots.map(snapshot => snapshot.observedAt), [beforeTime, afterTime]);
});

test('unverified snapshots cannot inherit supported changes or tracked source history', () => {
  const observations = emptyHistory();
  updateObservations(observations, 'civilview', { listings: [publisherFixture()], error: null }, { now: new Date(NOW).toISOString() });
  const listing = publisherFixture({ provenance: { observed: false, origin: 'snapshot' } });
  const dossier = buildPropertyDossier(listing, { observations, now: NOW });
  assert.equal(dossier.source.status, 'unverified_snapshot');
  assert.equal(dossier.source.url, null);
  assert.equal(dossier.summary.publisherFacts, 0);
  assert.deepEqual(dossier.signals, []);
  assert.equal(dossier.history, null);
});

test('reused listing IDs cannot attach another publisher record\'s supported changes', () => {
  const observations = emptyHistory();
  updateObservations(observations, 'civilview', { listings: [publisherFixture({ sourceObservedAt: new Date(NOW - 7200000).toISOString() })], error: null }, { now: new Date(NOW).toISOString() });
  updateObservations(observations, 'civilview', { listings: [publisherFixture({ openingBid: 90000 })], error: null }, { now: new Date(NOW).toISOString() });
  const replacement = publisherFixture({ sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964699', provenance: { recordId: '2128964699' } });
  assert.equal(validateListingForIngestion(replacement).isValid, true);
  const dossier = buildPropertyDossier(replacement, { observations, now: NOW });
  assert.equal(dossier.history, null);
  assert.deepEqual(dossier.signals, []);
  assert.equal(dossier.summary.supportedChanges, 0);
});

test('explicitly derived listing fields are not publisher facts or evidence of an area discrepancy', () => {
  const listing = publisherFixture({ provenance: { derivedFields: { sqft: { method: 'estimated_from_exterior' }, assessed: { method: 'regional_proxy' } } } });
  const publicRecords = { parcel: { status: 'matched', properties: { livingAreaSqft: 2000 }, source: { url: 'https://official.example/parcel/1' } } };
  const dossier = buildPropertyDossier(listing, { publicRecords, now: NOW });
  assert.notEqual(dossier.facts.find(fact => fact.key === 'sqft').evidenceClass, 'publisher_reported');
  assert.notEqual(dossier.facts.find(fact => fact.key === 'assessed').evidenceClass, 'publisher_reported');
  assert.equal(dossier.facts.find(fact => fact.key === 'address').evidenceClass, 'publisher_reported');
  assert.deepEqual(dossier.contradictions, []);
});

test('history read failure leaves stored publisher facts available with an explicit flag', async () => {
  const handler = handlerFor(async () => publisherFixture(), undefined, () => { throw new Error('Local history unavailable'); });
  const result = await invoke(handler, 'GET');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.historyUnavailable, true);
  assert.equal(result.body.source.status, 'source_observed');
  assert.equal(result.body.history, null);
});

test('unsupported method, malformed ID and absent listing return bounded client errors without enrichment', async () => {
  let calls = 0;
  const handler = handlerFor(async () => null, async () => { calls++; return {}; });
  assert.equal((await invoke(handler, 'DELETE')).statusCode, 405);
  assert.equal((await invoke(handler, 'GET', '')).statusCode, 400);
  assert.equal((await invoke(handler, 'POST', 'x'.repeat(161))).statusCode, 400);
  assert.equal((await invoke(handler, 'GET')).statusCode, 404);
  assert.equal(calls, 0);
});
