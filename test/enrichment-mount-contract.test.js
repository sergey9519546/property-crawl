'use strict';

// test/enrichment-mount-contract.test.js
//
// EnrichmentView was complete and fully tested, and mounted by nothing - the
// same "wired into a place nothing executes" shape this repo has hit three
// times. An earlier attempt at mounting it was written, appeared not to work,
// and was withdrawn: the only evidence available was a built bundle, and the
// check looked for `id="enrichment-view-heading"`.
//
// That check was wrong. EnrichmentView has two render paths:
//
//   populated  -> <h2 id="enrichment-view-heading">Cross-source enrichment</h2>
//   empty      -> "Enrichment view" + "No other source has reported a listing
//                 that shares the parcelKey <key>."
//
// All 114 parcel-bearing records render the EMPTY state, because none of them
// have cross-source matches. So the mount was working, the section was
// rendering, and the search was simply looking in the branch that never
// executes on this data.
//
// Verified against a freshly built stack (isolated distDir, turbopack cache
// off) serving real records:
//   TRSY-26-66-189       (parcelKey 208974)  -> empty state present
//   CIV-NJ-7-2129273608  (no parcelKey)      -> absent
//
// This file cannot replace that: the repo has no page-render harness, so it
// pins the mount and the data path, and the runtime check is documented here
// rather than claimed as automated coverage.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'src', 'app', 'listings', '[id]', 'page.tsx');
const VIEW = path.join(ROOT, 'src', 'components', 'listings', 'enrichment-view.tsx');

test('the listing page imports and mounts EnrichmentView', () => {
  const page = fs.readFileSync(PAGE, 'utf8');
  assert.match(page, /import \{ EnrichmentView \} from ["']@\/components\/listings\/enrichment-view["']/,
    'the page must import the component it is supposed to mount');
  assert.match(page, /<EnrichmentView\b/,
    'the page must actually render it, not merely import it');
});

test('the mount is conditional on a real parcelKey', () => {
  const page = fs.readFileSync(PAGE, 'utf8');
  // Unconditional would put "shares the parcelKey null" in front of the 98.3%
  // of records that have no parcel identifier at all.
  assert.match(page, /\{listing\.parcelKey\s*\?\s*<EnrichmentView/,
    'the mount must be guarded by listing.parcelKey');
  assert.match(page, /parcelKey=\{listing\.parcelKey\}/,
    'the component must receive the key it is guarded on');
});

test('the empty state names the parcelKey, so the conditional is observable', () => {
  // This is the branch every parcel-bearing record actually renders. A guard
  // that only looked for the populated heading proved nothing.
  const view = fs.readFileSync(VIEW, 'utf8');
  assert.match(view, /shares the parcelKey/,
    'the empty state must name the key, which is what makes the mount visible in HTML');
  assert.match(view, /id="enrichment-view-heading"/,
    'the populated branch must keep its heading id');
});

test('the listing type declares parcelKey', () => {
  const type = fs.readFileSync(path.join(ROOT, 'src', 'components', 'terminal', 'property-data.ts'), 'utf8');
  assert.match(type, /parcelKey\?:\s*string\s*\|\s*null/,
    'PropertyListing must declare parcelKey or the guard is unchecked');
});

test('the API delivers parcelKey when the record has one, and never invents one', () => {
  // presentListing is the function that builds the response the page reads, so
  // this checks the data path rather than a string in the page source.
  // buildParcelKey() reads apn / parcelNumber / parcelId - not a
  // sourceFacts.parcelKey - so the fixture uses the field the code actually
  // reads.
  const { presentListing } = require('../server/routes/listings');
  const record = (id, sourceFacts) => ({
    id, source: 'fl-dor-cadastral', state: 'FL',
    address: '1 Test Way, Tallahassee, FL 32301',
    provenance: {
      origin: 'live', recordKind: 'source_record', observed: true,
      publisher: 'FL DOR', recordId: id, sourceFacts,
    },
  });

  const withApn = presentListing(record('CIV-FL-1', { apn: '00-1234-5678-9' }));
  assert.ok(
    withApn.parcelKey != null && String(withApn.parcelKey).length > 0,
    `a record carrying a parcel identifier must yield a parcelKey, got ${JSON.stringify(withApn.parcelKey)}`
  );

  const withoutApn = presentListing(record('CIV-FL-2', {}));
  assert.equal(
    withoutApn.parcelKey == null || String(withoutApn.parcelKey).length === 0,
    true,
    'a record with no parcel identifier must not have one invented for it'
  );
});
