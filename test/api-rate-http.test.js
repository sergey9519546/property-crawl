'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

// An isolated server with a deliberately small budget verifies the real routing
// order. Invalid image/listing requests exercise admission without provider calls.
process.env.PROPERTY_API_RATE_LIMIT = '2';
process.env.SCRAPER_BACKGROUND_ENABLED = '0';
delete process.env.DATABASE_URL;
delete process.env.DISCOVERY_MODE;
const server = require('../server/server');

test('canonical HTTP routing keeps image traffic separate from discovery and health', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async path => {
    const response = await fetch(base + path);
    await response.arrayBuffer();
    return response;
  };
  try {
    assert.notEqual((await get('/api/property-image')).status, 429);
    assert.notEqual((await get('/api/property-image')).status, 429);
    const exhausted = await get('/api/property-image');
    assert.equal(exhausted.status, 429);
    assert.ok(Number(exhausted.headers.get('retry-after')) > 0);
    assert.notEqual((await get('/api/listings/__rate_test_missing__')).status, 429);
    assert.notEqual((await get('/api/listings/__rate_test_missing__')).status, 429);
    assert.equal((await get('/api/listings/__rate_test_missing__')).status, 429);
    assert.equal((await get('/api/health')).status, 200);
    assert.notEqual((await get('/api/health/ready')).status, 429);
    assert.equal((await get('/api/health')).status, 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
