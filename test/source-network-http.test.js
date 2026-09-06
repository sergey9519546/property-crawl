const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('real HTTP workflow imports, reviews, and enrolls a local publisher without publishing a property', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'property-source-http-'));
  const token = crypto.randomBytes(24).toString('hex');
  const environment = {
    NODE_ENV: 'test', SCRAPER_ADMIN_TOKEN: token,
    PROPERTY_SOURCE_INTAKE_PATH: path.join(directory, 'intake.json'),
    PROPERTY_OBSERVATIONS_PATH: path.join(directory, 'observations.json'),
    PROPERTY_LIVE_CACHE_PATH: path.join(directory, 'live.json'),
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const server = require('../server/server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const authorized = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  try {
    const before = await (await fetch(`${base}/api/source-network`)).json();
    assert.equal(before.summary.catalogSources, require('../server/sources/catalog').SOURCE_CATALOG.length);
    assert.equal(before.summary.propertyCollectors, 14);
    assert.equal(before.summary.evidenceCollectors, 1);
    assert.equal((await fetch(`${base}/api/source-network/intake`)).status, 401);
    const originalInventory = await (await fetch(`${base}/api/listings?limit=1`)).json();
    const payload = {
      sourceId: 'test-local-publisher', sourceUrl: 'https://example.org/records/test-123',
      capturedAt: new Date().toISOString(), kind: 'text', body: 'Test-only evidence packet. This is not a real property or sale.',
      customSource: { name: 'Test local publisher', organization: 'Test-only publisher', homepageUrl: 'https://example.org/' },
    };
    const submission = await fetch(`${base}/api/source-network/intake`, { method: 'POST', headers: authorized, body: JSON.stringify(payload) });
    assert.equal(submission.status, 201);
    const saved = await submission.json();
    assert.equal(saved.record.status, 'needs_review');
    assert.equal(saved.record.original, undefined);
    const duplicate = await fetch(`${base}/api/source-network/intake`, { method: 'POST', headers: authorized, body: JSON.stringify(payload) });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).deduplicated, true);
    const rawQueue = await (await fetch(`${base}/api/source-network/intake?includeContent=true`, { headers: authorized })).json();
    assert.equal(rawQueue.items[0].original.body, payload.body);
    const review = await fetch(`${base}/api/source-network/review`, { method: 'POST', headers: authorized, body: JSON.stringify({ id: saved.record.id, decision: 'approve', note: 'Test-only review' }) });
    assert.equal(review.status, 200);
    const after = await (await fetch(`${base}/api/source-network`)).json();
    assert.equal(after.summary.catalogSources, before.summary.catalogSources + 1);
    const enrolled = after.sources.find((source) => source.id === payload.sourceId);
    assert.equal(enrolled.role, 'discovery');
    assert.equal(enrolled.automated, false);
    assert.equal(enrolled.observedRecords, 0);
    const finalInventory = await (await fetch(`${base}/api/listings?limit=1`)).json();
    assert.equal(finalInventory.total, originalInventory.total);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('property-source-http-')) fs.rmSync(resolved, { recursive: true });
  }
});
