const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db/client');
const handleListings = require('../server/routes/listings');

test('encoded publisher identifiers round-trip through detail links; invalid paths fail before querying', async () => {
  const original = db.getListingById;
  const calls = [];
  db.getListingById = async (id) => { calls.push(id); return { id, address: 'Synthetic identifier test only' }; };
  function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
  try {
    for (const id of ['auction:publisher-record-123', 'CIV-NJ-123']) {
      const res = response();
      await handleListings({ method: 'GET', url: `/api/listings/${encodeURIComponent(id)}` }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.id, id);
    }
    assert.deepEqual(calls, ['auction:publisher-record-123', 'CIV-NJ-123']);
    for (const id of ['%ZZ', 'a%2Fb', 'a%5Cb', 'a%00b', 'x'.repeat(257)]) {
      const res = response();
      await handleListings({ method: 'GET', url: `/api/listings/${id}` }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(calls.length, 2);
  } finally { db.getListingById = original; }
});
