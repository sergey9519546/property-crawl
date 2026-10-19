'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ping, getTargetUrl } = require('../scripts/keep-alive-ping');

test('keep-alive ping reports health for responsive endpoint', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', dataMode: 'memory', documentReviewStore: 'memory' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const targetUrl = `http://127.0.0.1:${port}/api/health`;

  try {
    const res = await ping(targetUrl);
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.payload?.dataMode, 'memory');
    assert.equal(res.payload?.documentReviewStore, 'memory');
  } finally {
    server.close();
  }
});

test('keep-alive ping fails gracefully without crashing on unreachable host', async () => {
  const res = await ping('http://127.0.0.1:59999/api/health'); // unreachable port
  assert.equal(res.ok, false);
  assert.ok(typeof res.error === 'string');
});

test('getTargetUrl resolves environment and defaults properly', () => {
  const prev = process.env.DEPLOY_SMOKE_URL;
  try {
    delete process.env.DEPLOY_SMOKE_URL;
    assert.equal(getTargetUrl(), 'https://property-crawl.onrender.com/api/health');

    process.env.DEPLOY_SMOKE_URL = 'https://custom-app.onrender.com';
    assert.equal(getTargetUrl(), 'https://custom-app.onrender.com/api/health');

    process.env.DEPLOY_SMOKE_URL = 'https://custom-app.onrender.com/api/health';
    assert.equal(getTargetUrl(), 'https://custom-app.onrender.com/api/health');
  } finally {
    if (prev !== undefined) process.env.DEPLOY_SMOKE_URL = prev;
    else delete process.env.DEPLOY_SMOKE_URL;
  }
});
