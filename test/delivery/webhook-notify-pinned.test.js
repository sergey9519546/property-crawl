'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const { isPrivateOrLocalHost } = require('../../server/scrapers/scrapling-bridge');
const { postWebhook } = require('../../server/delivery/webhook-notify');

// Self-signed test certificate (CN=alerts.example.com) with its private key,
// packaged as a PFX so Node's TLS stack can present it without OpenSSL on PATH.
// Validates the transport over a real socket to a public IPv6 address, which
// is the only address family isPrivateOrLocalHost treats as public here.
const PFX_BASE64 = fs.readFileSync(require('node:path').join(__dirname, 'test-webhook-pfx.base64'), 'utf8');

function publicIpv6Addresses() {
  const addrs = [];
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const iface of ifs || []) {
      if (iface.family === 'IPv6' && !iface.internal && !iface.address.startsWith('::1') && !isPrivateOrLocalHost(iface.address)) {
        addrs.push(iface.address);
      }
    }
  }
  return addrs;
}

let harness;
const prevTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
test.before(async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const publicIpv6 = publicIpv6Addresses();
  assert.ok(publicIpv6.length >= 2, 'need at least two public IPv6 addresses for the pinning harness');
  const pfx = Buffer.from(PFX_BASE64, 'base64');
  const server = https.createServer({ pfx, passphrase: 'test' });
  const connections = [];
  const requests = [];
  server.on('connection', (socket) => connections.push({ remoteAddress: socket.remoteAddress, remoteFamily: socket.remoteFamily }));
  server.on('request', (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, host: req.headers.host, body: Buffer.concat(chunks).toString('utf8') });
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'https://alerts.example.com/hook' });
        res.end();
        return;
      }
      if (req.url === '/slow') return; // never answer: caller must time out
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve, reject) => server.listen(443, publicIpv6[0], (err) => (err ? reject(err) : resolve())));
  harness = { server, connections, requests, publicIpv6 };
});

test.after(async () => {
  if (prevTlsReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTlsReject;
  await new Promise((resolve) => harness.server.close(resolve));
});

test('Case C: legitimate public fetch against the pinned address succeeds', async () => {
  const calls = [];
  const lookup = async () => {
    calls.push('lookup');
    return [{ address: harness.publicIpv6[0], family: 6 }];
  };
  const result = await postWebhook('https://alerts.example.com:443/hook', { event: 'x' }, { lookup, timeoutMs: 5000 });
  assert.equal(result.delivery, 'sent');
  assert.equal(result.sent, true);
  assert.equal(result.status, 204);
  assert.equal(calls.length, 1, 'DNS is resolved exactly once');
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/hook');
  assert.equal(request.host, 'alerts.example.com', 'original Host header is preserved');
  assert.equal(JSON.parse(request.body).event, 'x');
  assert.equal(harness.connections.length, 1);
  assert.equal(String(harness.connections[0].remoteFamily), 'IPv6', 'socket used the pinned IPv6 address family');
});

test('Case A: DNS rebinding (public first, private second) stays pinned to the public address', async () => {
  const calls = [];
  const connectionsBefore = harness.connections.length;
  const requestsBefore = harness.requests.length;
  const lookup = async () => {
    calls.push('lookup');
    return calls.length === 1
      ? [{ address: harness.publicIpv6[0], family: 6 }]
      : [{ address: '127.0.0.1', family: 4 }];
  };
  const result = await postWebhook('https://alerts.example.com:443/hook', { event: 'rebind' }, { lookup, timeoutMs: 5000 });
  assert.equal(result.delivery, 'sent');
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1, 'the rebinding answer is never consulted');
  assert.equal(harness.requests.length, requestsBefore + 1);
  assert.equal(harness.connections.length, connectionsBefore + 1);
  assert.equal(String(harness.connections[harness.connections.length - 1].remoteFamily), 'IPv6', 'never connects to the rebinded IPv4 loopback');
});

test('Case B: private resolution (169.254.169.254) refuses before the transport is used', async () => {
  const calls = [];
  const connectionsBefore = harness.connections.length;
  const lookup = async () => {
    calls.push('lookup');
    return [{ address: '169.254.169.254', family: 4 }];
  };
  const result = await postWebhook('https://alerts.example.com:443/hook', { event: 'x' }, { lookup });
  assert.equal(result.delivery, 'refused');
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'private_resolution');
  assert.equal(calls.length, 1);
  assert.equal(harness.connections.length, connectionsBefore, 'transport never connects');
});

test('refuses a loopback host literal before any lookup', async () => {
  const result = await postWebhook('https://127.0.0.1/hook', { event: 'x' });
  assert.equal(result.delivery, 'refused');
  assert.equal(result.reason, 'private_host');
});

test('requires https', async () => {
  const result = await postWebhook('http://alerts.example.com/hook', { event: 'x' });
  assert.equal(result.reason, 'https_required');
});

test('refuses dns resolution failures', async () => {
  const result = await postWebhook('https://alerts.example.com:443/hook', { event: 'x' }, {
    lookup: async () => { throw new Error('boom'); },
  });
  assert.equal(result.delivery, 'unavailable');
  assert.equal(result.reason, 'dns_failed');
});

test('refuses private loopback resolution', async () => {
  const result = await postWebhook('https://alerts.example.com:443/hook', { event: 'x' }, {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  });
  assert.equal(result.delivery, 'refused');
  assert.equal(result.reason, 'private_resolution');
});

test('refuses redirects', async () => {
  const result = await postWebhook('https://alerts.example.com:443/redirect', { event: 'x' }, {
    lookup: async () => [{ address: harness.publicIpv6[0], family: 6 }],
  });
  assert.equal(result.delivery, 'refused');
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'redirect_refused');
  assert.equal(result.status, 302);
});

test('reports connection failures as network errors', async () => {
  const result = await postWebhook('https://alerts.example.com:443/hook', { event: 'x' }, {
    lookup: async () => [{ address: harness.publicIpv6[1], family: 6 }],
    timeoutMs: 5000,
  });
  assert.equal(result.delivery, 'unavailable');
  assert.equal(result.reason, 'network');
});

test('reports timeouts as timeout', async () => {
  const result = await postWebhook('https://alerts.example.com:443/slow', { event: 'x' }, {
    lookup: async () => [{ address: harness.publicIpv6[0], family: 6 }],
    timeoutMs: 25,
  });
  assert.equal(result.delivery, 'unavailable');
  assert.equal(result.reason, 'timeout');
});
