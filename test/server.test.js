const assert = require('assert');
const http = require('http');
const server = require('../server/server');
const db = require('../server/db/client');

console.log('=== RUNNING SERVER & API TEST SUITE ===');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    });
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:3999${path}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null, raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

async function run() {
  await new Promise((resolve) => server.listen(3999, resolve));

  await test('GET /api/health returns 200 and status ok', async () => {
    const res = await request('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  await test('GET /api/sources returns verified sources list', async () => {
    const res = await request('/api/sources');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 11);
  });

  await test('GET /api/listings returns filtered and paginated listings', async () => {
    const res = await request('/api/listings?limit=5');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.listings.length, 5);
    assert.ok(res.body.total >= 20);
  });

  await test('GET /api/listings with state filter filters correctly', async () => {
    const res = await request('/api/listings?state=OH');
    assert.strictEqual(res.status, 200);
    res.body.listings.forEach(l => assert.strictEqual(l.state, 'OH'));
  });

  await test('GET /api/listings/:id returns single listing', async () => {
    const res = await request('/api/listings/OH-CUY-10231');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 'OH-CUY-10231');
    assert.strictEqual(res.body.city, 'Cleveland');
  });

  await test('POST /api/parse extracts structured notice and caches result', async () => {
    const res = await request('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { noticeText: 'SHERIFF SALE: 3841 E 55th St, Cleveland, OH 44105. Judgment $71,340.' }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.parsed);
    assert.strictEqual(res.body.parsed.state, 'OH');
  });

  await test('POST /api/alerts and GET /api/alerts manages user watchlist', async () => {
    const userId = 'test_user_42';
    const postRes = await request('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: { listingId: 'OH-CUY-10231' }
    });
    assert.strictEqual(postRes.status, 201);

    const getRes = await request(`/api/alerts?userId=${userId}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.savedCount, 1);
    assert.strictEqual(getRes.body.deals[0].id, 'OH-CUY-10231');
  });

  await test('GET /api/export?format=csv returns valid CSV stream', async () => {
    const res = await request('/api/export?format=csv');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/csv'));
    assert.ok(res.raw.includes('Opening Bid,Est Low,Est High,Deal Score'));
  });

  await new Promise((resolve) => server.close(resolve));
  console.log(`--- SERVER TEST SUMMARY: ${passed} Passed, ${failed} Failed ---`);
  if (failed > 0) process.exit(1);
}

run();
