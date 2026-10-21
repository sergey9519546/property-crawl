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

  fs.rmSync(tmpVault, { recursive: true, force: true });
});
