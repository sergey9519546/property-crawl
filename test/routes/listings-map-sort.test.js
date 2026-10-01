'use strict';

// test/routes/listings-map-sort.test.js
//
// Regression guard: the map view 400'd whenever an intelligence sort was active.
//
// The workbench and the grid share one filter state, and the grid legitimately
// offers two sorts the discovery SQL layer does not understand -- 'quality'
// (evidence score) and 'opportunity' (opportunity rank). Those are applied after
// listing annotation, so server/routes/listings.js rewrites them to 'score'
// before handing the URL to the discovery layer (INTELLIGENCE_SORTS).
//
// The /api/listings/map branch sat *above* that rewrite and passed the caller's
// URL straight through. So: pick "Evidence quality" in the grid, click Map, and
// the map returned HTTP 400 "Invalid sort" instead of a map. The whole view was
// dead for those filters, and nothing caught it because the grid path works.
//
// This exercises the real route handler against the real in-memory discovery
// layer, and includes a negative control (an unknown sort must still 400) so
// the test cannot pass by the route having stopped validating at all.

const test = require('node:test');
const assert = require('node:assert/strict');

const handleListings = require('../../server/routes/listings');

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

async function hitMap(queryString) {
  const res = fakeRes();
  await handleListings({ url: `/api/listings/map${queryString}`, method: 'GET' }, res);
  return res;
}

test('map accepts the intelligence sorts the workbench offers', async () => {
  for (const sort of ['quality', 'opportunity']) {
    const res = await hitMap(`?sort=${sort}`);
    assert.notEqual(res.statusCode, 400,
      `map must accept sort=${sort}; got 400 ${JSON.stringify(res.body)}`);
    assert.equal(res.statusCode, 200);
  }
});

test('map still rejects a genuinely unknown sort', async () => {
  // Negative control. Without this, the test above would also pass if the map
  // branch had simply stopped validating `sort` at all -- which would be a new
  // defect, not a fix.
  const res = await hitMap('?sort=not-a-real-sort');
  assert.equal(res.statusCode, 400, 'an unknown sort must remain a 400');
  assert.match(String(res.body && res.body.error), /sort/i);
});

test('map leaves an ordinary discovery sort untouched', async () => {
  // The rewrite must be narrow: 'score', 'date', 'bid-asc' and 'equity' are
  // understood by the discovery layer and must pass through unchanged.
  for (const sort of ['score', 'date', 'bid-asc', 'equity']) {
    const res = await hitMap(`?sort=${sort}`);
    assert.equal(res.statusCode, 200, `map must accept sort=${sort}`);
  }
});

test('map still applies other filters alongside an intelligence sort', async () => {
  // The bug was not "map ignores sort"; it was "map 400s on sort". Combining a
  // real filter with an intelligence sort must behave like a normal query.
  const res = await hitMap('?sort=quality&state=CA&type=Land');
  assert.equal(res.statusCode, 200, `got 400 ${JSON.stringify(res.body)}`);
});