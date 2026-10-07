'use strict';

// test/hunts-whole-inventory.test.js
//
// The file-backed hunt path reads `getListings({ limit: 10000, offset: 0 })`
// and answers 409 when the store is larger than that. That ceiling is 169
// listings away on the live store: 9,831 listings, cap 10,000, and the store
// grows every collection cycle -- ServiceLink alone holds 7,498 and refreshes
// every six hours.
//
// So /hunts, which does have UI callers (saved-hunts.tsx posts to
// /api/hunts/:id/evaluate), would start returning 409 for every hunt the
// moment the store crosses 10,000. Nothing warns it is approaching.
//
// The durable path (DISCOVERY_MODE=advanced + Postgres) already pages
// correctly and is covered by a 10,050-listing acceptance test. This
// deployment is embedded PGlite with no DISCOVERY_MODE, so the file-backed
// path is the live one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createHuntsHandler } = require('../server/routes/hunts');

const TOKEN = 'secret-operator-token';

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
  };
}

function listing(index) {
  return {
    id: `CIV-CA-${9000000 + index}`,
    source: 'civilview',
    state: 'CA',
    county: 'Alameda',
    city: 'Oakland',
    address: `${index + 1} Test Avenue, Oakland, CA`,
    propType: 'Single Family',
    status: 'scheduled',
    openingBid: 100000,
    saleDate: '2026-10-01',
    sourceObservedAt: '2026-09-07T18:00:00.000Z',
  };
}

// A store comfortably past the ceiling, served in pages the way Postgres
// serves them: limit + offset + a total.
function pagedDb(total) {
  return {
    isPg: false,
    calls: [],
    async getListings({ limit = 1000, offset = 0 } = {}) {
      this.calls.push({ limit, offset });
      const end = Math.min(offset + limit, total);
      const listings = [];
      for (let i = offset; i < end; i += 1) listings.push(listing(i));
      return { total, listings };
    },
  };
}

function tempFile() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hunts-whole-')),
    'hunts.json',
  );
}

async function invoke(handler, method, urlPath, body = {}) {
  const req = { method, url: urlPath, headers: { authorization: `Bearer ${TOKEN}` }, body };
  const res = response();
  await handler(req, res, new URL(urlPath, 'http://localhost'));
  return res;
}

test('hunt evaluation covers a store larger than any former ceiling instead of refusing', async () => {
  // Deliberately far above any former ceiling (10,000): this used to be
  // MAX_INVENTORY + 2000, anchored on a constant that the fix removed.
  const beyond = 12000;
  const database = pagedDb(beyond);
  const handler = createHuntsHandler({
    database,
    env: { SCRAPER_ADMIN_TOKEN: TOKEN },
    filePath: tempFile(),
    now: () => '2026-09-07T20:00:00.000Z',
  });

  const created = await invoke(handler, 'POST', '/api/hunts', {
    name: 'California', enabled: true,
    criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'CA' }] },
  });
  assert.equal(created.statusCode, 201, 'hunt creation must work');
  const huntId = created.body.hunt.id;

  const evaluated = await invoke(handler, 'POST', `/api/hunts/${huntId}/evaluate`);

  assert.equal(
    evaluated.statusCode, 200,
    `a store of ${beyond} records must still evaluate. The removed ceiling was 10,000 `
      + 'and the live store was 9,831, so 169 listings from breaking a wired feature',
  );
  assert.equal(evaluated.body.evaluation.counts.inventory, beyond,
    'every listing must be evaluated, not the first page of them');
});

test('hunt evaluation still refuses when the store genuinely cannot be read whole', async () => {
  // The 409 is the right behaviour -- it is only wrong when triggered by an
  // arbitrary ceiling rather than by an incomplete read. This pins that a
  // backend which reports more than it will serve is still refused.
  const capped = 10000; // the old ceiling
  const database = {
    isPg: false,
    async getListings({ limit = 1000, offset = 0 } = {}) {
      if (offset >= capped) return { total: capped + 5000, listings: [] };
      const end = Math.min(offset + limit, capped);
      const listings = [];
      for (let i = offset; i < end; i += 1) listings.push(listing(i));
      return { total: capped + 5000, listings };
    },
  };
  const handler = createHuntsHandler({
    database,
    env: { SCRAPER_ADMIN_TOKEN: TOKEN },
    filePath: tempFile(),
    now: () => '2026-09-07T20:00:00.000Z',
  });

  const created = await invoke(handler, 'POST', '/api/hunts', {
    name: 'California', enabled: true,
    criteria: { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'CA' }] },
  });
  const evaluated = await invoke(handler, 'POST', `/api/hunts/${created.body.hunt.id}/evaluate`);

  assert.equal(evaluated.statusCode, 409,
    'an incomplete read must still be refused rather than evaluated as if whole');
  assert.match(evaluated.body.error || '', /complete inventory/i,
    'the refusal must say the inventory was incomplete, not blame a record cap');
});

