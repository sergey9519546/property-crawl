'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const hunts = require('../server/intelligence/hunts');

function listing(observedAt, provenance) {
  return {
    id: 'HUD-012-345678', source: 'hud', state: 'CA', address: '100 Main Street',
    status: 'active', propType: 'Single Family', raw: 'Official HUD source record.', hasDocuments: null,
    sourceUrl: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query?where=CASE_NUM%20%3D%20%27012-345678%27&outFields=*&f=pjson',
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record', publisher: 'HUD',
      recordId: '012-345678', observedAt, ...provenance,
    },
  };
}

test('hunt snapshots merge document identities from sourceFacts and media', () => {
  const criteria = hunts.validateHuntInput({
    name: 'Document parity',
    criteria: { discoveryFilters: { hasDocuments: 'true' } },
  }).value.criteria;
  const hunt = { id: 'hunt_bbbbbbbbbbbbbbbbbbbbbbbb', version: 1, enabled: true, criteria };
  const first = hunts.evaluateInventory(hunt, [listing('2026-09-12T10:00:00.000Z', {
    sourceFacts: { documents: [] },
    media: { documents: [{ id: 'media-a' }, { id: 'shared' }] },
  })], { now: '2026-09-12T10:01:00.000Z', suppressEvents: true });
  assert.deepEqual(first.response.results[0].validationErrors || [], []);
  assert.equal(first.response.results[0].status, 'match');
  const second = hunts.evaluateInventory(hunt, [listing('2026-09-12T11:00:00.000Z', {
    sourceFacts: { documents: [{ id: 'source-b' }, { id: 'shared' }] },
    media: { documents: [{ id: 'shared' }] },
  })], { now: '2026-09-12T11:01:00.000Z', previousBaseline: first.baseline });
  assert.equal(second.events[0].type, 'material_change');
  assert.ok(second.events[0].changedFields.includes('documentIds'));
  assert.deepEqual(second.baseline.records[Object.keys(second.baseline.records)[0]].snapshot.documentIds, ['shared', 'source-b']);
});

test('malformed document containers remain unknown for hunt filters', () => {
  const criteria = hunts.validateHuntInput({
    name: 'Unknown documents',
    criteria: { discoveryFilters: { hasDocuments: 'unknown' } },
  }).value.criteria;
  const hunt = { criteria };
  assert.equal(hunts.evaluateListing(listing('2026-09-12T10:00:00.000Z', {
    sourceFacts: { documents: { id: 'bad' } },
    media: { documents: 'bad' },
  }), hunt, { now: '2026-09-12T10:01:00.000Z' }).status, 'match');
  assert.equal(hunts.evaluateListing(listing('2026-09-12T10:00:00.000Z', {
    media: { documents: [] },
  }), hunt, { now: '2026-09-12T10:01:00.000Z' }).status, 'no_match');
});
