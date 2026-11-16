'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DocumentVault, sanitizeKey } = require('../../server/storage/document-vault');

test('Document Vault: sanitizes keys and blocks directory traversal', () => {
  assert.equal(sanitizeKey('dockets/2026/notice.pdf'), 'dockets/2026/notice.pdf');
  assert.equal(sanitizeKey('/dockets/file.txt'), 'dockets/file.txt');
  assert.throws(() => sanitizeKey('../secret.env'), /illegal path traversal/);
  assert.throws(() => sanitizeKey('foo/..'), /illegal path traversal/);
  assert.throws(() => sanitizeKey('..'), /illegal path traversal/);
  assert.throws(() => sanitizeKey('foo/../bar'), /illegal path traversal/);
  assert.throws(() => sanitizeKey('foo\x00bar'), /illegal path traversal/);
  assert.throws(() => sanitizeKey('foo\nbar'), /illegal path traversal/);
  assert.throws(() => sanitizeKey(''), /must be between 1 and/);
});

test('Document Vault: puts, gets, and heads documents locally with SHA-256 verification', async () => {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  const vault = new DocumentVault({ vaultDir: tmpVault });

  const testContent = Buffer.from('FORECLOSURE LEGAL NOTICE: CASE #CV-2026-9912');
  const receipt = await vault.putDocument('notices/OH/Cuyahoga/case-9912.txt', testContent, {
    contentType: 'text/plain',
    metadata: { county: 'Cuyahoga', state: 'OH' },
  });

  assert.equal(receipt.key, 'notices/OH/Cuyahoga/case-9912.txt');
  assert.equal(receipt.size, testContent.length);
  assert.equal(typeof receipt.sha256, 'string');
  assert.equal(receipt.sha256.length, 64);
  assert.equal(receipt.storageType, 'local');

  // Head check
  const head = await vault.headDocument('notices/OH/Cuyahoga/case-9912.txt');
  assert.equal(head.exists, true);
  assert.equal(head.size, testContent.length);
  assert.equal(head.sha256, receipt.sha256);
  assert.equal(head.contentType, 'text/plain');

  // Get check
  const doc = await vault.getDocument('notices/OH/Cuyahoga/case-9912.txt');
  assert.ok(doc);
  assert.equal(doc.data.toString('utf8'), 'FORECLOSURE LEGAL NOTICE: CASE #CV-2026-9912');
  assert.equal(doc.metadata.county, 'Cuyahoga');

  // List check
  const list = await vault.listDocuments({ prefix: 'notices/OH' });
  assert.equal(list.length, 1);
  assert.equal(list[0].key, 'notices/OH/Cuyahoga/case-9912.txt');

  // Delete check
  const del = await vault.deleteDocument('notices/OH/Cuyahoga/case-9912.txt');
  assert.equal(del.deleted, true);

  const headAfter = await vault.headDocument('notices/OH/Cuyahoga/case-9912.txt');
  assert.equal(headAfter.exists, false);

  fs.rmSync(tmpVault, { recursive: true, force: true });
});

test('Document Vault: integrates with R2/S3 upload when credentials present', async () => {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-r2-'));
  let uploaded = null;

  const mockFetch = async (url, options) => {
    uploaded = { url, options };
    return { ok: true, status: 200 };
  };

  const vault = new DocumentVault({
    vaultDir: tmpVault,
    fetchImpl: mockFetch,
    env: {
      R2_BUCKET: 'property-dockets',
      R2_ACCESS_KEY_ID: 'test_access_key',
      R2_SECRET_ACCESS_KEY: 'test_secret_key',
      R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
    },
  });

  assert.equal(vault.storageType, 'r2');

  const receipt = await vault.putDocument('packets/dossier-4401.md', '# Due Diligence Packet', {
    contentType: 'text/markdown',
  });

  assert.equal(receipt.storageType, 'r2');
  assert.ok(uploaded);
  assert.ok(uploaded.url.includes('https://test-account.r2.cloudflarestorage.com/property-dockets/packets/dossier-4401.md'));
  assert.equal(uploaded.options.headers['Content-Type'], 'text/markdown');
  assert.match(uploaded.options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test_access_key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*x-amz-content-sha256.*x-amz-date.*, Signature=[a-f0-9]{64}$/);
  assert.match(uploaded.options.headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
  assert.equal(uploaded.options.headers['x-amz-content-sha256'], receipt.sha256);

  fs.rmSync(tmpVault, { recursive: true, force: true });
});

test('Document Vault: signs R2 GET, HEAD, and DELETE when local cache is absent', async () => {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-r2-ops-'));
  const calls = [];
  const payload = Buffer.from('REMOTE-R2-DOCKET');
  const mockFetch = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers });
    if (options.method === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain', 'content-length': String(payload.length), 'last-modified': 'Wed, 14 Oct 2026 12:00:00 GMT' }),
      };
    }
    if (options.method === 'GET') {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain', 'last-modified': 'Wed, 14 Oct 2026 12:00:00 GMT' }),
        arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
      };
    }
    return { ok: true, status: 204 };
  };

  const vault = new DocumentVault({
    vaultDir: tmpVault,
    fetchImpl: mockFetch,
    env: {
      R2_BUCKET: 'property-dockets',
      R2_ACCESS_KEY_ID: 'test_access_key',
      R2_SECRET_ACCESS_KEY: 'test_secret_key',
      R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
    },
  });

  const head = await vault.headDocument('notices/remote only.txt');
  assert.equal(head.exists, true);
  assert.equal(head.storageType, 'r2');
  assert.equal(head.size, payload.length);

  const fetched = await vault.getDocument('notices/remote only.txt');
  assert.ok(fetched);
  assert.equal(fetched.storageType, 'r2');
  assert.equal(fetched.data.toString('utf8'), 'REMOTE-R2-DOCKET');

  const del = await vault.deleteDocument('notices/remote only.txt');
  assert.equal(del.deleted, true);

  assert.deepEqual(calls.map((c) => c.method), ['HEAD', 'GET', 'DELETE']);
  for (const call of calls) {
    assert.ok(call.url.endsWith('/property-dockets/notices/remote%20only.txt'));
    assert.match(call.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test_access_key\/\d{8}\/auto\/s3\/aws4_request/);
    assert.match(call.headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
    assert.equal(call.headers['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  }

  fs.rmSync(tmpVault, { recursive: true, force: true });
});

test('Document Vault: preserves x-amz-meta-* + sha256 on R2, lists via ListObjectsV2, and fails closed under REQUIRE_DURABLE_VAULT', async () => {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-r2-meta-'));
  const remoteObjects = new Map();
  const requests = [];

  const mockFetch = async (url, options) => {
    requests.push({ url, method: options.method, headers: options.headers });
    const parsed = new URL(url);
    if (options.method === 'PUT') {
      const key = parsed.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
      remoteObjects.set(key, {
        body: Buffer.from(options.body),
        headers: new Map(Object.entries(options.headers).map(([k, v]) => [k.toLowerCase(), v])),
      });
      return { ok: true, status: 200 };
    }
    if (options.method === 'GET' && parsed.searchParams.get('list-type') === '2') {
      const prefix = parsed.searchParams.get('prefix') || '';
      const xmlItems = [...remoteObjects.entries()]
        .filter(([k]) => !prefix || k.startsWith(prefix))
        .map(([k, obj]) => `<Contents><Key>${k}</Key><Size>${obj.body.length}</Size><LastModified>2026-11-14T12:00:00.000Z</LastModified></Contents>`)
        .join('');
      return {
        ok: true,
        status: 200,
        text: async () => `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${xmlItems}</ListBucketResult>`,
      };
    }
    const key = parsed.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const item = remoteObjects.get(key);
    if (!item) return { ok: false, status: 404, headers: new Headers() };
    const respHeaders = new Headers({
      'content-type': item.headers.get('content-type') || 'application/octet-stream',
      'content-length': String(item.body.length),
      'last-modified': 'Sat, 14 Nov 2026 12:00:00 GMT',
    });
    for (const [hk, hv] of item.headers.entries()) {
      if (hk.startsWith('x-amz-meta-')) respHeaders.set(hk, hv);
    }
    if (options.method === 'HEAD') return { ok: true, status: 200, headers: respHeaders };
    return {
      ok: true,
      status: 200,
      headers: respHeaders,
      arrayBuffer: async () => item.body.buffer.slice(item.body.byteOffset, item.body.byteOffset + item.body.byteLength),
    };
  };

  try {
    const env = {
      R2_BUCKET: 'property-dockets',
      R2_ACCESS_KEY_ID: 'test_access_key',
      R2_SECRET_ACCESS_KEY: 'test_secret_key',
      R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
      REQUIRE_DURABLE_VAULT: '1',
    };
    const writer = new DocumentVault({ vaultDir: tmpVault, fetchImpl: mockFetch, env });
    const receipt = await writer.putDocument('notices/FL/case-1.txt', 'LEGAL-NOTICE-BODY', {
      contentType: 'text/plain',
      metadata: { county: 'Miami-Dade', sourceKey: 'county' },
    });
    assert.equal(receipt.storageType, 'r2');

    // Cold reader with empty local vaultDir still resolves metadata, sha256, and ListObjectsV2 from R2.
    const emptyDir = path.join(tmpVault, 'cold-reader');
    const reader = new DocumentVault({ vaultDir: emptyDir, fetchImpl: mockFetch, env });
    const list = await reader.listDocuments({ prefix: 'notices/FL/' });
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'notices/FL/case-1.txt');
    assert.equal(list[0].storageType, 'r2');

    const head = await reader.headDocument('notices/FL/case-1.txt');
    assert.equal(head.exists, true);
    assert.equal(head.sha256, receipt.sha256);
    assert.equal(head.metadata.county, 'Miami-Dade');
    assert.equal(head.metadata.sourcekey, 'county');

    const doc = await reader.getDocument('notices/FL/case-1.txt');
    assert.equal(doc.sha256, receipt.sha256);
    assert.equal(doc.metadata.county, 'Miami-Dade');

    // Tampered R2 SHA-256 fails integrity check.
    remoteObjects.get('notices/FL/case-1.txt').headers.set('x-amz-meta-sha256', '0'.repeat(64));
    await assert.rejects(() => reader.getDocument('notices/FL/case-1.txt'), /SHA-256 mismatch/);

    // Strict durable mode rejects unconfigured or failing R2 uploads rather than silently returning 'local'.
    const unconfigured = new DocumentVault({ vaultDir: tmpVault, env: { REQUIRE_DURABLE_VAULT: '1' } });
    await assert.rejects(() => unconfigured.putDocument('a/b.txt', 'hi'), /REQUIRE_DURABLE_VAULT=1/);

    const failing = new DocumentVault({
      vaultDir: tmpVault,
      fetchImpl: async () => ({ ok: false, status: 503 }),
      env,
    });
    await assert.rejects(() => failing.putDocument('a/b.txt', 'hi'), /HTTP 503/);
    assert.match(failing.lastError, /HTTP 503/);
  } finally {
    fs.rmSync(tmpVault, { recursive: true, force: true });
  }
});
