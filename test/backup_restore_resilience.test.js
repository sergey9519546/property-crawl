'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');

const {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot,
  calculateSha256
} = require('../scripts/db-backup');

const {
  pruneBackups,
  pruneRawCollectorDumps
} = require('../scripts/db-prune');

const {
  parseDbTarget,
  sha256File,
  uploadBackupToR2
} = require('../scripts/export-hosted-backup');

test('DisasterRecovery: creates snapshot with integrity manifest and checksums', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-test-source-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-test-backups-'));

  try {
    // Create mock store files
    fs.writeFileSync(path.join(tmpDir, 'live-listings.json'), JSON.stringify([{ id: 'listing-1', score: 92 }]));
    fs.writeFileSync(path.join(tmpDir, 'document-reviews.json'), JSON.stringify({ pending: 4 }));
    fs.writeFileSync(path.join(tmpDir, 'geocoding-cache.json'), JSON.stringify({ '123-elm': { lat: 40.1, lng: -75.2 } }));

    const result = createSnapshot({
      sourceDir: tmpDir,
      outputDir: backupDir,
      targets: ['live-listings.json', 'document-reviews.json', 'geocoding-cache.json']
    });

    assert.ok(fs.existsSync(result.snapshotPath));
    assert.equal(result.manifest.fileCount, 3);
    assert.ok(result.manifest.totalBytes > 0);
    assert.ok(result.manifest.files['live-listings.json']);
    assert.equal(
      result.manifest.files['live-listings.json'].sha256,
      calculateSha256(fs.readFileSync(path.join(tmpDir, 'live-listings.json')))
    );

    // Verify snapshot
    const verification = verifySnapshot(result.snapshotPath);
    assert.equal(verification.valid, true);
    assert.equal(verification.errors.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('DisasterRecovery: verification detects tampered snapshot archive', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-tamper-src-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-tamper-bk-'));

  try {
    fs.writeFileSync(path.join(tmpDir, 'live-listings.json'), JSON.stringify({ state: 'clean' }));

    const result = createSnapshot({
      sourceDir: tmpDir,
      outputDir: backupDir,
      targets: ['live-listings.json']
    });

    // Unpack, tamper payload, repack
    const raw = fs.readFileSync(result.snapshotPath);
    const parsed = JSON.parse(zlib.gunzipSync(raw).toString('utf-8'));
    // Tamper the file payload without updating checksum in manifest
    parsed.files['live-listings.json'] = Buffer.from('TAMPERED_INJECTION').toString('base64');
    const tampered = zlib.gzipSync(Buffer.from(JSON.stringify(parsed), 'utf-8'));
    fs.writeFileSync(result.snapshotPath, tampered);

    const verification = verifySnapshot(result.snapshotPath);
    assert.equal(verification.valid, false);
    assert.ok(verification.errors.some(e => e.includes('Checksum mismatch')));

    // Ensure restore rejects tampered snapshot
    assert.throws(
      () => restoreSnapshot(result.snapshotPath, tmpDir),
      /Cannot restore corrupted snapshot/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('DisasterRecovery: restore drill recovers exact state from clean snapshot', () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-restore-src-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-restore-bk-'));
  const restoreTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-restore-dest-'));

  try {
    const originalData = { listings: [{ id: 'deal-999', bid: 45000, score: 88 }] };
    fs.writeFileSync(path.join(srcDir, 'live-listings.json'), JSON.stringify(originalData));

    const result = createSnapshot({
      sourceDir: srcDir,
      outputDir: backupDir,
      targets: ['live-listings.json']
    });

    const restoreResult = restoreSnapshot(result.snapshotPath, restoreTarget);
    assert.equal(restoreResult.restoredCount, 1);

    const restoredContent = fs.readFileSync(path.join(restoreTarget, 'live-listings.json'), 'utf-8');
    assert.deepEqual(JSON.parse(restoredContent), originalData);
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.rmSync(restoreTarget, { recursive: true, force: true });
  }
});

test('DisasterRecovery: rotation policy retains daily and weekly tiers while pruning expired backups', () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-rotation-'));
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  try {
    // 3 recent daily backups (days 1, 2, 4)
    const b1 = path.join(backupDir, 'snapshot-day1.tar.gz');
    fs.writeFileSync(b1, 'snap1');
    fs.utimesSync(b1, (now - 1 * dayMs) / 1000, (now - 1 * dayMs) / 1000);

    const b2 = path.join(backupDir, 'snapshot-day2.tar.gz');
    fs.writeFileSync(b2, 'snap2');
    fs.utimesSync(b2, (now - 2 * dayMs) / 1000, (now - 2 * dayMs) / 1000);

    const b4 = path.join(backupDir, 'snapshot-day4.tar.gz');
    fs.writeFileSync(b4, 'snap4');
    fs.utimesSync(b4, (now - 4 * dayMs) / 1000, (now - 4 * dayMs) / 1000);

    // 2 backups in week 2 (days 10 and 12) -> only 1 should be kept
    const b10 = path.join(backupDir, 'snapshot-day10.tar.gz');
    fs.writeFileSync(b10, 'snap10');
    fs.utimesSync(b10, (now - 10 * dayMs) / 1000, (now - 10 * dayMs) / 1000);

    const b12 = path.join(backupDir, 'snapshot-day12.tar.gz');
    fs.writeFileSync(b12, 'snap12');
    fs.utimesSync(b12, (now - 12 * dayMs) / 1000, (now - 12 * dayMs) / 1000);

    // 1 expired backup (day 35) -> should be deleted
    const b35 = path.join(backupDir, 'snapshot-day35.tar.gz');
    fs.writeFileSync(b35, 'snap35');
    fs.utimesSync(b35, (now - 35 * dayMs) / 1000, (now - 35 * dayMs) / 1000);

    // Dry-run pass
    const dryRun = pruneBackups({ backupDir, now, dryRun: true });
    assert.equal(dryRun.kept.length, 4); // days 1, 2, 4, and day 10 (newest in week 2)
    assert.equal(dryRun.deleted.length, 2); // day 12 and day 35
    assert.equal(fs.existsSync(b35), true); // file still exists in dry-run

    // Apply pass
    const applied = pruneBackups({ backupDir, now, dryRun: false });
    assert.equal(applied.deleted.length, 2);
    assert.equal(fs.existsSync(b35), false); // Expired purged
    assert.equal(fs.existsSync(b12), false); // Redundant weekly purged
    assert.equal(fs.existsSync(b1), true); // Kept intact
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('DisasterRecovery: raw dump pruner protects permanent audit ledgers', () => {
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-raw-dumps-'));
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  try {
    // Stale temporary HTML scrap (age: 40 days)
    const oldHtml = path.join(rawDir, 'docket-scrape-camden-2026.html');
    fs.writeFileSync(oldHtml, '<html>old docket</html>');
    fs.utimesSync(oldHtml, (now - 40 * dayMs) / 1000, (now - 40 * dayMs) / 1000);

    // Fresh temporary HTML scrap (age: 5 days)
    const freshHtml = path.join(rawDir, 'docket-scrape-bexar-2026.html');
    fs.writeFileSync(freshHtml, '<html>fresh docket</html>');
    fs.utimesSync(freshHtml, (now - 5 * dayMs) / 1000, (now - 5 * dayMs) / 1000);

    // Permanent audit ledger (even if old, must NEVER be pruned)
    const auditLedger = path.join(rawDir, 'observations.json');
    fs.writeFileSync(auditLedger, JSON.stringify([{ id: 'obs-permanent' }]));
    fs.utimesSync(auditLedger, (now - 90 * dayMs) / 1000, (now - 90 * dayMs) / 1000);

    const result = pruneRawCollectorDumps({ targetDir: rawDir, maxAgeDays: 30, now, dryRun: false });
    assert.equal(result.deleted.length, 1);
    assert.equal(result.deleted[0].name, 'docket-scrape-camden-2026.html');
    assert.equal(fs.existsSync(oldHtml), false);
    assert.equal(fs.existsSync(freshHtml), true);
    assert.equal(fs.existsSync(auditLedger), true); // Protected!
  } finally {
    fs.rmSync(rawDir, { recursive: true, force: true });
  }
});

test('HostedPgBackup: parseDbTarget extracts connection fields from DATABASE_DIRECT_URL', () => {
  const savedDirect = process.env.DATABASE_DIRECT_URL;
  const savedUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_DIRECT_URL = 'postgresql://postgres.projref:s3cr%23t%21pw@db.projref.supabase.co:5432/postgres';
    process.env.DATABASE_URL = 'postgresql://pooled:ignored@pooler.supabase.com:6543/other';

    const target = parseDbTarget();
    assert.deepEqual(target, {
      host: 'db.projref.supabase.co',
      port: '5432',
      user: 'postgres.projref',
      database: 'postgres',
      password: 's3cr#t!pw',
    });
  } finally {
    if (savedDirect === undefined) delete process.env.DATABASE_DIRECT_URL;
    else process.env.DATABASE_DIRECT_URL = savedDirect;
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  }
});

test('HostedPgBackup: parseDbTarget converts Supavisor pooler :6543 to session mode :5432 when DATABASE_DIRECT_URL is unset', () => {
  const targetSubdomain = parseDbTarget({
    DATABASE_URL: 'postgresql://postgres.projref:s3cr%23t%21pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  });
  assert.deepEqual(targetSubdomain, {
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: '5432',
    user: 'postgres.projref',
    database: 'postgres',
    password: 's3cr#t!pw',
  });

  const targetApexPooler = parseDbTarget({
    DATABASE_DIRECT_URL: '   ',
    DATABASE_URL: 'postgresql://postgres.projref:pw@pooler.supabase.com:6543/postgres',
  });
  assert.equal(targetApexPooler.host, 'pooler.supabase.com');
  assert.equal(targetApexPooler.port, '5432');

  // Non-Supabase hosts on :6543 must not be rewritten
  const nonSupabase = parseDbTarget({
    DATABASE_URL: 'postgresql://app:pw@pgbouncer.internal:6543/postgres',
  });
  assert.equal(nonSupabase.port, '6543');

  // Direct URL with explicit port is not rewritten
  const explicitDirect = parseDbTarget({
    DATABASE_DIRECT_URL: 'postgresql://postgres.projref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  });
  assert.equal(explicitDirect.port, '6543');
});

test('HostedPgBackup: db-backup.yml installs postgresql-client-17 from PGDG and supports DATABASE_URL fallback', () => {
  const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'db-backup.yml');
  const yml = fs.readFileSync(workflowPath, 'utf8');

  // PGDG apt repo + PostgreSQL 17 client
  assert.match(yml, /https:\/\/www\.postgresql\.org\/media\/keys\/ACCC4CF8\.asc/);
  assert.match(yml, /https:\/\/apt\.postgresql\.org\/pub\/repos\/apt/);
  assert.match(yml, /-pgdg\s+main/);
  assert.match(yml, /apt-get install -y postgresql-client-17\b/);
  assert.doesNotMatch(yml, /apt-get install -y postgresql-client(?:\s|$)/);

  // DATABASE_URL fallback alongside DATABASE_DIRECT_URL in both config check and export step
  assert.match(yml, /DATABASE_DIRECT_URL:\s*\$\{\{\s*secrets\.DATABASE_DIRECT_URL\s*\}\}/);
  assert.match(yml, /DATABASE_URL:\s*\$\{\{\s*secrets\.DATABASE_URL\s*\}\}/);
  assert.match(yml, /\[\s*-z\s*"\$DATABASE_DIRECT_URL"\s*\]\s*&&\s*\[\s*-z\s*"\$DATABASE_URL"\s*\]/);
});

test('HostedPgBackup: uploadBackupToR2 fails closed with R2_CREDENTIALS_UNSET when R2_* env vars are missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-r2-neg-'));
  try {
    const dumpFilePath = path.join(tmpDir, 'property-crawl-pg-2026-11-24.dump');
    const manifestPath = path.join(tmpDir, 'property-crawl-pg-2026-11-24.manifest.json');
    fs.writeFileSync(dumpFilePath, Buffer.from('PGDMP-TEST-PAYLOAD'));
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, createdAt: '2026-11-24T08:17:00.000Z' }));

    const baseEnv = {
      R2_BUCKET: 'property-crawl-vault',
      R2_ACCESS_KEY_ID: 'r2-access-key',
      R2_SECRET_ACCESS_KEY: 'r2-secret-key',
      R2_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com',
    };

    await assert.rejects(
      () => uploadBackupToR2({ dumpFilePath, manifestPath, env: {} }),
      (err) => err && err.code === 'R2_CREDENTIALS_UNSET'
    );

    for (const missingKey of Object.keys(baseEnv)) {
      const partialEnv = { ...baseEnv, [missingKey]: '' };
      await assert.rejects(
        () => uploadBackupToR2({ dumpFilePath, manifestPath, env: partialEnv }),
        (err) => err && err.code === 'R2_CREDENTIALS_UNSET',
        `expected R2_CREDENTIALS_UNSET when ${missingKey} is missing`
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HostedPgBackup: uploadBackupToR2 sends SigV4 PUTs with SHA-256 digests and rejects on HTTP 500', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-r2-pos-'));
  try {
    const dumpFilename = 'property-crawl-pg-2026-11-24.dump';
    const manifestFilename = 'property-crawl-pg-2026-11-24.manifest.json';
    const dumpFilePath = path.join(tmpDir, dumpFilename);
    const manifestPath = path.join(tmpDir, manifestFilename);

    const dumpPayload = Buffer.from('PGDMP\x01\x0e\x00custom-postgres-archive-bytes');
    fs.writeFileSync(dumpFilePath, dumpPayload);
    const expectedDumpSha256 = sha256File(dumpFilePath);

    const manifestObj = {
      version: 1,
      createdAt: '2026-11-24T08:17:00.000Z',
      archive: {
        filename: dumpFilename,
        bytes: dumpPayload.length,
        sha256: expectedDumpSha256,
        format: 'custom',
      },
      tables: ['TABLE DATA public listings'],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), 'utf8');
    const expectedManifestSha256 = sha256File(manifestPath);

    const r2Env = {
      R2_BUCKET: 'property-crawl-vault',
      R2_ACCESS_KEY_ID: 'r2-test-access-id',
      R2_SECRET_ACCESS_KEY: 'r2-test-secret-access-key',
      R2_ENDPOINT: 'https://acct999.r2.cloudflarestorage.com///',
    };

    const calls = [];
    const okFetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => '',
      };
    };

    const receipt = await uploadBackupToR2({
      dumpFilePath,
      manifestPath,
      manifest: manifestObj,
      env: r2Env,
      fetchImpl: okFetch,
    });

    assert.equal(calls.length, 2);

    assert.equal(
      calls[0].url,
      'https://acct999.r2.cloudflarestorage.com/property-crawl-vault/backups/postgres/2026-11-24/property-crawl-pg-2026-11-24.dump'
    );
    assert.equal(calls[0].init.method, 'PUT');
    assert.equal(calls[0].init.headers['content-type'], 'application/octet-stream');
    assert.equal(calls[0].init.headers['x-amz-content-sha256'], expectedDumpSha256);
    assert.match(calls[0].init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=r2-test-access-id\//);
    assert.match(calls[0].init.headers.Authorization, /SignedHeaders=.*x-amz-content-sha256.*Signature=[a-f0-9]{64}$/);
    assert.deepEqual(Buffer.from(calls[0].init.body), dumpPayload);

    assert.equal(
      calls[1].url,
      'https://acct999.r2.cloudflarestorage.com/property-crawl-vault/backups/postgres/2026-11-24/property-crawl-pg-2026-11-24.manifest.json'
    );
    assert.equal(calls[1].init.method, 'PUT');
    assert.equal(calls[1].init.headers['content-type'], 'application/json');
    assert.equal(calls[1].init.headers['x-amz-content-sha256'], expectedManifestSha256);
    assert.match(calls[1].init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=r2-test-access-id\//);

    assert.deepEqual(receipt, {
      uploaded: true,
      bucket: 'property-crawl-vault',
      dumpKey: 'backups/postgres/2026-11-24/property-crawl-pg-2026-11-24.dump',
      manifestKey: 'backups/postgres/2026-11-24/property-crawl-pg-2026-11-24.manifest.json',
      dumpBytes: dumpPayload.length,
      sha256: expectedDumpSha256,
    });

    // Fail-closed control: upstream R2 HTTP 500 rejects
    const failingFetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'InternalError: R2 upstream unavailable',
    });

    await assert.rejects(
      () => uploadBackupToR2({
        dumpFilePath,
        manifestPath,
        manifest: manifestObj,
        env: r2Env,
        fetchImpl: failingFetch,
      }),
      /HTTP 500/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
