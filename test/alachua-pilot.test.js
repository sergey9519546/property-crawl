'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { submitEvidence, reviewEvidence } = require('../server/sources/intake');
const { loadStore } = require('../server/sources/store');
const { buildAlachuaPilot, normalizeReviewedPacket, buildAlachuaSignals } = require('../server/sources/alachua');
const { lookupAlachuaParcel, buildAlachuaQuery, isAlachuaListing } = require('../server/public-records/alachua');
const { buildPublicRecordEvidence } = require('../server/public-records');
const { ScraperCircuitBreaker } = require('../server/scrapers/circuit-breaker');
const { getSource } = require('../server/sources/catalog');

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const CAPTURED = '2026-09-05T10:00:00.000Z';
// Entire fixture is synthetic. These portal paths/IDs are contract test inputs,
// not verified publisher routes, real cases, or live opportunities.
const row = changes => ({ publisherRecordId: 'TEST-ONLY-CASE', caseNumber: 'SYNTHETIC-CASE-2026', rawParcelIds: ['00000-000-001'], status: 'List of Lands – Available for Public', sourceUrl: 'https://alachua.realtdm.com/public/case?caseId=TEST-ONLY-CASE', advertisedPropertyType: 'Vacant Land', saleDate: '2026-01-01', ...changes });
const polygon = { type: 'Polygon', coordinates: [[[-82, 29], [-81, 29], [-81, 30], [-82, 29]]] };
const feature = changes => ({ type: 'Feature', properties: { objectid: 7, parcel: '00000-000-001', taxyear: 2025, buildingquantity: 1, heatedsquarefeet: 800, acres: 2, justvalue: 100000, jurisno: 0, zonecode: 'SYNTHETIC', epdwetland: 4, ...changes }, geometry: polygon });
const response = data => ({ ok: true, status: 200, json: async () => data });
const fetchFor = (features = [feature()], extra = {}) => async () => response({ type: 'FeatureCollection', features, ...extra });
const lookupOptions = changes => ({ now: NOW, circuitBreaker: new ScraperCircuitBreaker(), fetchImpl: fetchFor(), ...changes });

function setup(t, rows = [row()], capturedAt = CAPTURED) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alachua-pilot-test-'));
  t.after(() => { const resolved = path.resolve(dir); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('alachua-pilot-test-')); fs.rmSync(resolved, { recursive: true, force: true }); });
  const storePath = path.join(dir, 'intake.json');
  const result = submitEvidence({ sourceId: 'alachua-tax-deeds', sourceUrl: 'https://alachua.realtdm.com/public/cases?status=ListOfLands', capturedAt, kind: 'json', records: rows }, { storePath, now: NOW });
  return { storePath, id: result.record.id, approve: () => reviewEvidence(result.record.id, { decision: 'approve', reviewer: 'synthetic-test-reviewer' }, { storePath, now: NOW }) };
}

test('county pilot requires approved original evidence and performs no default network', async t => {
  const state = setup(t);
  let calls = 0;
  const options = { storePath: state.storePath, now: NOW, lookupAlachuaParcel: async () => { calls++; throw new Error('must not call'); } };
  await assert.rejects(buildAlachuaPilot(state.id, options), { code: 'ALACHUA_REVIEW_REQUIRED' });
  state.approve();
  const result = await buildAlachuaPilot(state.id, options);
  assert.equal(calls, 0);
  assert.equal(result.completeCountyInventory, false);
  assert.equal(result.records[0].source.evidenceClass, 'reviewed_import');
  assert.equal(result.records[0].signals[0].id, 'second_chance_review');
  assert.equal(result.records[0].currentPurchaseCost, null);
  assert.equal(result.records[0].currentAvailability, 'requires_publisher_confirmation');
});

test('case evidence preserves intact IDs, original timestamps, and explicit county scope', async t => {
  const state = setup(t, [row({ rawParcelIds: ['00Ab-000-001'], publishedOpeningBid: 1500 })]); state.approve();
  const result = await buildAlachuaPilot(state.id, { storePath: state.storePath, now: NOW });
  const record = result.records[0];
  assert.deepEqual(record.rawParcelIds, ['00Ab-000-001']);
  assert.equal(record.parcelIdentities[0].normalizedParcelId, '00AB-000-001');
  assert.equal(record.parcelIdentities[0].jurisdiction, 'us-fips:12001');
  assert.equal(record.observedAt, CAPTURED);
  assert.equal(record.publishedOpeningBid, 1500);
  assert.equal(record.equity, undefined);
  assert.equal(record.occupancy, undefined);
});

test('passed dates and stale recorded availability never become current second-chance signals', async t => {
  const state = setup(t, [row({ status: 'Scheduled' })]); state.approve();
  const result = await buildAlachuaPilot(state.id, { storePath: state.storePath, now: NOW });
  assert.equal(result.records[0].status, 'unresolved');
  assert.equal(result.records[0].signals.length, 0);
  const old = setup(t, [row()], '2026-08-01T10:00:00.000Z'); old.approve();
  const stale = await buildAlachuaPilot(old.id, { storePath: old.storePath, now: NOW });
  assert.equal(stale.records[0].signals.length, 0);
  assert.ok(stale.records[0].issues.some(item => item.code === 'COUNTY_CASE_STALE'));
});

test('rejected reviews, modified original content and future capture times fail closed', t => {
  const state = setup(t); state.approve();
  const packet = loadStore(state.storePath).records[0];
  assert.throws(() => normalizeReviewedPacket({ ...packet, review: { ...packet.review, decision: 'rejected' } }, { now: NOW }), { code: 'ALACHUA_REVIEW_REQUIRED' });
  const edited = structuredClone(packet); edited.original.records[0].status = 'Sold';
  assert.throws(() => normalizeReviewedPacket(edited, { now: NOW }), { code: 'ALACHUA_CONTENT_CHANGED' });
  assert.throws(() => normalizeReviewedPacket({ ...packet, capturedAt: '2030-01-01T00:00:00Z' }, { now: NOW }), { code: 'ALACHUA_INVALID_TIME' });
});

test('historic archives, unrelated URLs, and numeric APNs cannot become county case evidence', async t => {
  for (const changes of [
    { sourceUrl: 'https://www.alachuaclerk.org/civil/taxlands3.cfm' },
    { sourceUrl: 'https://alachua.realtdm.com/public/case?caseId=SOME-OTHER-CASE' },
    { sourceUrl: 'https://alachua.realtdm.com/public/case?caseId=TEST-ONLY-CASE&session=secret' },
    { rawParcelIds: [1] },
  ]) {
    const state = setup(t, [row(changes)]); state.approve();
    await assert.rejects(buildAlachuaPilot(state.id, { storePath: state.storePath, now: NOW }), /case|parcel/i);
  }
});

test('exact county query is bounded, escapes identifiers, retains source geometry and assessed basis', async () => {
  const url = buildAlachuaQuery({ rawParcelId: "00'1" });
  assert.equal(url.searchParams.get('where'), "parcel='00''1'");
  assert.equal(url.searchParams.get('resultRecordCount'), '10');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.throws(() => buildAlachuaQuery({ rawParcelId: 1 }), { code: 'ALACHUA_PARCEL_ID_REQUIRED' });
  const result = await lookupAlachuaParcel({ rawParcelId: '00000-000-001' }, lookupOptions());
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.geometry, polygon);
  assert.equal(result.properties.assessorJustValue, 100000);
  assert.equal(result.properties.marketValue, undefined);
  assert.equal(result.source.observedAt, new Date(NOW).toISOString());
});

test('duplicate identities, transfer limits, wrong IDs and empty responses stay distinct', async () => {
  const input = { rawParcelId: '00000-000-001' };
  assert.equal((await lookupAlachuaParcel(input, lookupOptions({ fetchImpl: fetchFor([feature(), feature({ objectid: 8 })]) }))).status, 'ambiguous');
  const partial = await lookupAlachuaParcel(input, lookupOptions({ fetchImpl: fetchFor([feature()], { exceededTransferLimit: true }) }));
  assert.equal(partial.status, 'ambiguous'); assert.equal(partial.hasMore, true);
  assert.equal((await lookupAlachuaParcel(input, lookupOptions({ fetchImpl: fetchFor([feature({ parcel: 'OTHER-PARCEL' })]) }))).status, 'candidate');
  assert.equal((await lookupAlachuaParcel(input, lookupOptions({ fetchImpl: fetchFor([]) }))).status, 'not_found');
});

test('upstream errors fail visibly and 403 stops the shared county circuit', async () => {
  const input = { rawParcelId: '00000-000-001' };
  await assert.rejects(lookupAlachuaParcel(input, lookupOptions({ fetchImpl: async () => response({ error: { message: 'bad query' } }) })), { code: 'SOURCE_REJECTED_QUERY' });
  const breaker = new ScraperCircuitBreaker(); let calls = 0;
  const options = lookupOptions({ circuitBreaker: breaker, fetchImpl: async () => { calls++; return { ok: false, status: 403 }; } });
  await assert.rejects(lookupAlachuaParcel(input, options), { code: 'SOURCE_HTTP_ERROR' });
  await assert.rejects(lookupAlachuaParcel(input, options), { code: 'ALACHUA_CIRCUIT_OPEN' });
  assert.equal(calls, 1);
});

test('jurisdiction and wetland codes never imply development permission or a clean site', async () => {
  for (const code of [null, 0, 4, 99]) {
    const result = await lookupAlachuaParcel({ rawParcelId: '00000-000-001' }, lookupOptions({ fetchImpl: fetchFor([feature({ epdwetland: code, jurisno: 300 })]) }));
    assert.equal(result.planning.countyRulesApplicable, false);
    assert.equal(result.planning.developmentRights, 'unresolved');
    assert.equal(result.planning.wetlandReview.conclusion, 'requires_site_review');
    if (code === 4) assert.match(result.planning.wetlandReview.label, /unincorporated/);
  }
});

test('structure discrepancy requires the exact offering parcel and retains both evidence dates', async t => {
  const state = setup(t); state.approve();
  const result = await buildAlachuaPilot(state.id, { storePath: state.storePath, now: NOW, allowNetwork: true, fetchImpl: fetchFor() });
  const record = result.records[0];
  const signal = record.signals.find(item => item.id.startsWith('structure_description_discrepancy'));
  assert.ok(signal); assert.equal(signal.evidenceClass, 'research_lead');
  assert.equal(signal.evidence[0].observedAt, CAPTURED);
  assert.equal(signal.evidence[1].assessmentYear, 2025);
  assert.match(signal.explanation, /usable building is unconfirmed/);
  for (const changes of [{ status: 'candidate' }, { jurisdiction: 'us-fips:12003' }, { rawParcelId: 'OTHER-PARCEL' }]) {
    const findings = buildAlachuaSignals(record, [{ ...record.parcels[0], ...changes }]);
    assert.equal(findings.signals.length, 1);
  }
});

test('county lookup budget is explicit and one failure preserves every imported case', async t => {
  const state = setup(t, [row({ rawParcelIds: ['00000-000-001', '00000-000-002'] }), row({ publisherRecordId: 'TEST-SECOND', caseNumber: 'TEST-SECOND', sourceUrl: 'https://alachua.realtdm.com/public/case?caseId=TEST-SECOND' })]); state.approve();
  let calls = 0;
  const result = await buildAlachuaPilot(state.id, { storePath: state.storePath, now: NOW, allowNetwork: true, maxParcelLookups: 1, lookupAlachuaParcel: async () => { calls++; throw new Error('private upstream message'); } });
  assert.equal(calls, 1); assert.equal(result.records.length, 2);
  assert.ok(result.records[0].issues.some(item => item.code === 'COUNTY_LOOKUP_BUDGET'));
  assert.ok(!JSON.stringify(result).includes('private upstream'));
});

test('Alachua scope rejects conflicting identifiers and derived parcel IDs do not trigger county lookup', async () => {
  assert.equal(isAlachuaListing({ state: 'FL', floridaDorCountyNo: 11 }), true);
  assert.equal(isAlachuaListing({ state: 'FL', county: 'Alachua', floridaDorCountyNo: 12 }), false);
  assert.equal(isAlachuaListing({ state: 'FL', county: 'Alachua', countyFips: '003' }), false);
  let countyCalls = 0;
  const result = await buildPublicRecordEvidence({ id: 'SYNTHETIC', state: 'FL', county: 'Alachua', floridaDorCountyNo: 11, parcelId: '00000-000-001', provenance: { observed: true, origin: 'live', derivedFields: { parcelId: true } } }, { apiKey: '', allowNetwork: true, fetchImpl: async url => { if (url.includes('maps.alachuacounty.us')) countyCalls++; return response({ type: 'FeatureCollection', features: [] }); } });
  assert.equal(countyCalls, 0); assert.equal(result.countyParcel, null);
});

test('catalog and CLI expose an import workflow without enabling an automated inventory collector', t => {
  const source = getSource('alachua-tax-deeds');
  assert.equal(source.adapterKey, null);
  assert.equal(getSource('alachua-county-parcels').propertyLookup, true);
  const state = setup(t); state.approve();
  const output = execFileSync(process.execPath, [path.join(__dirname, '../scripts/collect-public-records.js'), '--alachua-intake', state.id, '--store', state.storePath], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.coverage, 'reviewed_import_only');
  assert.equal(result.parcelLookups, 0);
});

test('reviewed records expose stable source refs, exact documents, and separated published cost components', async t => {
  const state = setup(t, [row({
    publishedOpeningBid: 1200,
    publishedCosts: { taxesSinceAuction: 315.25, deedIssuanceAndRecording: 94, documentaryStamps: 8.4 },
    documents: [{ type: 'notice', title: 'Synthetic reviewed notice', url: 'https://www.alachuaclerk.org/civil/notices/TEST-ONLY-CASE.pdf', sha256: 'a'.repeat(64) }],
  })]);
  state.approve();
  const record = (await buildAlachuaPilot(state.id, { storePath: state.storePath, now: NOW })).records[0];
  assert.deepEqual(record.sourceRef, { sourceId: 'alachua-tax-deeds', recordId: 'TEST-ONLY-CASE' });
  assert.match(record.source.contentDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(record.documents[0].factStatus, 'document_link_only');
  assert.equal(record.purchaseTerms.components.openingBidAtAuction, 1200);
  assert.equal(record.purchaseTerms.components.taxesSinceAuction, 315.25);
  assert.equal(record.purchaseTerms.currentPurchaseQuote, null);
  assert.equal(record.purchaseTerms.quoteStatus, 'requires_current_clerk_quote');
  assert.match(record.purchaseTerms.guidance.source.url, /taxlands\.cfm$/);
});

test('malformed dates, costs, and document references fail instead of becoming silent evidence', async t => {
  for (const changes of [
    { saleDate: '2026-02-31' },
    { publishedCosts: { taxesSinceAuction: -1 } },
    { publishedCosts: { currentPurchaseQuote: 1500 } },
    { currentPurchaseCost: 1500 },
    { documents: [{ type: 'notice', title: 'Wrong host', url: 'https://example.com/notice.pdf' }] },
    { documents: [{ type: 'notice', title: 'Bad digest', url: 'https://www.alachuaclerk.org/civil/notice.pdf', sha256: 'bad' }] },
  ]) {
    const state = setup(t, [row(changes)]); state.approve();
    await assert.rejects(buildAlachuaPilot(state.id, { storePath: state.storePath, now: NOW }), /date|cost|document|quote/i);
  }
});

test('approved observations form a reconstructable status history and identify a material transition', async t => {
  const state = setup(t, [row({ status: 'Scheduled' })], '2026-09-05T08:00:00.000Z');
  state.approve();
  const second = submitEvidence({
    sourceId: 'alachua-tax-deeds',
    sourceUrl: 'https://alachua.realtdm.com/public/cases?status=ListOfLands',
    capturedAt: CAPTURED,
    kind: 'json',
    records: [row()],
  }, { storePath: state.storePath, now: NOW });
  reviewEvidence(second.record.id, { decision: 'approve', reviewer: 'synthetic-test-reviewer' }, { storePath: state.storePath, now: NOW });
  const result = await buildAlachuaPilot(second.record.id, { storePath: state.storePath, now: NOW });
  const record = result.records[0];
  assert.deepEqual(record.statusHistory.map(item => item.status), ['unresolved', 'available_for_public']);
  assert.equal(record.signals[0].category, 'material_status_change');
  assert.equal(record.signals[0].materialChange, true);
  assert.equal(record.signals[0].evidence.length, 2);
  assert.equal(result.historyCoverage.includedPackets, 2);
});

test('same-time status disagreement is preserved as a conflict rather than ordered as a transition', async t => {
  const state = setup(t, [row({ status: 'Scheduled' })]);
  state.approve();
  const second = submitEvidence({ sourceId: 'alachua-tax-deeds', sourceUrl: 'https://alachua.realtdm.com/public/cases?status=ListOfLands', capturedAt: CAPTURED, kind: 'json', records: [row()] }, { storePath: state.storePath, now: NOW });
  reviewEvidence(second.record.id, { decision: 'approve', reviewer: 'synthetic-test-reviewer' }, { storePath: state.storePath, now: NOW });
  const record = (await buildAlachuaPilot(second.record.id, { storePath: state.storePath, now: NOW })).records[0];
  assert.equal(record.statusConflicts.length, 1);
  assert.equal(record.signals[0].materialChange, false);
  assert.ok(record.issues.some(item => item.code === 'COUNTY_STATUS_CONFLICT'));
});

test('equivalent scoped parcel IDs share the bounded lookup cache', async t => {
  const state = setup(t, [
    row({ rawParcelIds: ['00ab-000-001'] }),
    row({ publisherRecordId: 'TEST-SECOND', caseNumber: 'TEST-SECOND', rawParcelIds: ['00AB-000-001'], sourceUrl: 'https://alachua.realtdm.com/public/case?caseId=TEST-SECOND' }),
  ]);
  state.approve();
  let calls = 0;
  const result = await buildAlachuaPilot(state.id, {
    storePath: state.storePath,
    now: NOW,
    allowNetwork: true,
    delay: async () => {},
    lookupAlachuaParcel: async ({ rawParcelId }) => {
      calls++;
      return { status: 'matched', rawParcelId, jurisdiction: 'us-fips:12001', properties: {}, geometry: null, source: { id: 'test', url: 'https://maps.alachuacounty.us/test', observedAt: CAPTURED } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.parcelLookups, 1);
  assert.equal(result.records[1].parcels.length, 1);
});

test('Alachua CLI rejects mixed workflows and invalid parcel budgets', t => {
  const script = path.join(__dirname, '../scripts/collect-public-records.js');
  assert.throws(() => execFileSync(process.execPath, [script, '--alachua-intake', 'intake_aaaaaaaaaaaaaaaaaaaaaaaa', '--fl-county', '11'], { encoding: 'utf8', stdio: 'pipe' }), /status|Command failed/);
  assert.throws(() => execFileSync(process.execPath, [script, '--alachua-intake', 'intake_aaaaaaaaaaaaaaaaaaaaaaaa', '--limit', '1.5'], { encoding: 'utf8', stdio: 'pipe' }), /status|Command failed/);
});
