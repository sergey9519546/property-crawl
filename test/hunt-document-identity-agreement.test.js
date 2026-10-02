'use strict';

// test/hunt-document-identity-agreement.test.js
//
// How hasDocuments is actually decided, so this test is not misdescribed later:
//
//   For a hunt whose criteria are discoveryFilters, evaluateInventory decides
//   the status in ONE place - it calls the discovery query engine's `matches`
//   (server/intelligence/hunts.js). The per-listing snapshot's `hasDocuments`
//   field is derived by that same engine, so the two cannot disagree: there is
//   one function to get right, in server/discovery/query.js.
//
// That function had two wrong behaviours, and two red tests in
// test/discovery-documents-hunt.test.js had been sitting there because no CI
// workflow invoked `npm run test:property-documents`:
//
//   1. It read only provenance.sourceFacts.documents, so a listing whose
//      documents arrived through provenance.media.documents - the media
//      pipeline - was judged to have no documents. A `hasDocuments=true` hunt
//      silently returned nothing for every such listing.
//
//   2. It treated a document container that is present but EMPTY as null
//      (unknown) rather than false. An empty container is a conclusion: we
//      looked and there are none. Reporting it as unknown meant
//      `hasDocuments=unknown` hunts matched records that had actually been
//      examined - the mirror of the fail-open the code's own comment warns
//      about.
//
// This file pins the whole case matrix, including the unexamined case that must
// stay unknown, so both halves of the trilemma (true / false / unknown) are
// held rather than only the two that were broken.

const test = require('node:test');
const assert = require('node:assert/strict');

const hunts = require('../server/intelligence/hunts');
const discovery = require('../server/discovery/query');

const NOW = '2026-09-12T10:01:00.000Z';
const OBSERVED = '2026-09-12T10:00:00.000Z';

function listing(provenance) {
  return {
    id: 'HUD-012-345678', source: 'hud', state: 'CA', address: '100 Main Street',
    status: 'active', propType: 'Single Family', raw: 'Official HUD source record.',
    hasDocuments: null,
    sourceUrl: 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query?where=CASE_NUM%20%3D%20%27012-345678%27&outFields=*&f=pjson',
    sourceObservedAt: OBSERVED,
    provenance: {
      origin: 'live', observed: true, recordKind: 'source_record',
      publisher: 'HUD', recordId: '012-345678', observedAt: OBSERVED, ...provenance,
    },
  };
}

const CRITERIA = hunts.validateHuntInput({
  name: 'Document parity',
  criteria: { discoveryFilters: { hasDocuments: 'true' } },
}).value.criteria;

// The status a hunt reaches for a listing.
function huntStatus(record) {
  const hunt = { id: 'hunt_bbbbbbbbbbbbbbbbbbbbbbbb', version: 1, enabled: true, criteria: CRITERIA };
  const result = hunts.evaluateInventory(hunt, [record], { now: NOW, suppressEvents: true });
  return result.response.results[0].status;
}

// The same decision, asked directly of the engine that makes it.
function matcherSays(record, filterValue) {
  const query = discovery.queryFromUrl(new URL(`http://localhost/api/listings?hasDocuments=${filterValue}`));
  return discovery.matches(record, query, { now: Date.parse(NOW) }) ? 'match' : 'no_match';
}

const CASES = [
  ['documents only in sourceFacts', { sourceFacts: { documents: [{ id: 'a' }] } }],
  ['documents only in media', { media: { documents: [{ id: 'b' }] } }],
  ['documents in both places', { sourceFacts: { documents: [{ id: 'a' }] }, media: { documents: [{ id: 'b' }] } }],
  ['no document containers at all', {}],
  ['malformed containers are not evidence', { sourceFacts: { documents: { id: 'bad' } }, media: { documents: 'bad' } }],
  ['an empty sourceFacts container is a conclusion', { sourceFacts: { documents: [] } }],
  ['an empty media container is a conclusion', { media: { documents: [] } }],
];

test('the hunt snapshot and the discovery matcher agree about documents', () => {
  const disagreeing = [];
  for (const [label, provenance] of CASES) {
    const record = listing(provenance);
    const viaHunt = huntStatus(record);
    const matcher = matcherSays(record, 'true');
    if ((viaHunt === 'match') !== (matcher === 'match')) {
      disagreeing.push(`${label}: snapshot=${snapshot} matcher=${matcher}`);
    }
  }
  assert.deepEqual(
    disagreeing, [],
    `the hunt and the engine it delegates to reached opposite conclusions:\n  ${disagreeing.join('\n  ')}`
  );
});

test('a listing whose documents come only from media is not invisible to a hunt', () => {
  // The concrete user-facing regression: media-pipeline documents used to be
  // invisible to `hasDocuments=true`, so the hunt silently returned nothing.
  const record = listing({ media: { documents: [{ id: 'media-only' }] } });
  assert.equal(matcherSays(record, 'true'), 'match');
  assert.equal(huntStatus(record), 'match');
});

test('an examined-and-empty document container is false, not unknown', () => {
  // Mirror fail-open: reporting "looked, found none" as unknown let
  // `hasDocuments=unknown` hunts match records that had actually been checked.
  const record = listing({ media: { documents: [] } });
  assert.equal(matcherSays(record, 'false'), 'match', 'an empty container satisfies hasDocuments=false');
  assert.equal(matcherSays(record, 'unknown'), 'no_match', 'an empty container is not unknown');
});

test('a record with no document containers at all stays unknown', () => {
  // The fail-open the original comment guards against, still intact.
  const record = listing({});
  assert.equal(matcherSays(record, 'unknown'), 'match');
  assert.equal(matcherSays(record, 'false'), 'no_match', 'an unexamined record must not satisfy hasDocuments=false');
  assert.equal(matcherSays(record, 'true'), 'no_match');
});
