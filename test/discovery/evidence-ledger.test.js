'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  GENESIS_HASH,
  createLedgerBlock,
  verifyLedgerChain,
  appendLedgerEntry,
  saveLedgerToFile,
  loadLedgerFromFile,
  canonicalStringify,
  withLedgerLock,
  appendLedgerToFile,
  getLedgerHealth
} = require('../../server/discovery/evidence-ledger');
const { createMarkdownEvidenceSnapshot, evidenceStoreHealth } = require('../../server/scrapers/discovery-snapshots');

test('Append-Only Evidence Ledger: createLedgerBlock & canonicalStringify', async (t) => {
  await t.test('canonicalStringify produces deterministic JSON regardless of key order', () => {
    const objA = { z: 1, a: 2, m: { nestedB: 10, nestedA: 20 } };
    const objB = { a: 2, m: { nestedA: 20, nestedB: 10 }, z: 1 };

    assert.equal(canonicalStringify(objA), canonicalStringify(objB));
  });

  await t.test('generates valid genesis block with index 0 and GENESIS_HASH', () => {
    const block = createLedgerBlock({
      index: 0,
      prevHash: GENESIS_HASH,
      timestamp: '2026-10-31T12:00:00.000Z',
      source: 'civilview',
      recordId: 'CASE-2026-001',
      payloadSha256: 'a'.repeat(64),
      action: 'DOCKET_CAPTURED',
      metadata: { county: 'Camden', state: 'NJ' }
    });

    assert.equal(block.index, 0);
    assert.equal(block.prevHash, GENESIS_HASH);
    assert.equal(typeof block.entryHash, 'string');
    assert.equal(block.entryHash.length, 64);
  });
});

test('Ledger Chain Verification: verifyLedgerChain', async (t) => {
  await t.test('verifies a valid monotonically appended ledger chain', () => {
    const chain = [];
    const b0 = appendLedgerEntry(chain, {
      source: 'civilview',
      recordId: 'REC-100',
      payloadSha256: '1'.repeat(64),
      timestamp: '2026-10-31T10:00:00.000Z',
      action: 'DOCKET_SNAPSHOT',
      metadata: { title: 'First Sale' }
    });

    const b1 = appendLedgerEntry(chain, {
      source: 'hud',
      recordId: 'REC-200',
      payloadSha256: '2'.repeat(64),
      timestamp: '2026-10-31T10:05:00.000Z',
      action: 'OFFER_FILED',
      metadata: { title: 'Second Sale' }
    });

    const b2 = appendLedgerEntry(chain, {
      source: 'sheriff',
      recordId: 'REC-300',
      payloadSha256: '3'.repeat(64),
      timestamp: '2026-10-31T10:10:00.000Z',
      action: 'TITLE_VERIFIED',
      metadata: { title: 'Third Sale' }
    });

    assert.equal(chain.length, 3);
    assert.equal(b0.prevHash, GENESIS_HASH);
    assert.equal(b1.prevHash, b0.entryHash);
    assert.equal(b2.prevHash, b1.entryHash);

    const verification = verifyLedgerChain(chain);
    assert.equal(verification.valid, true);
    assert.equal(verification.verifiedCount, 3);
  });

  await t.test('detects tampered payloadSha256 within chain', () => {
    const chain = [];
    appendLedgerEntry(chain, {
      source: 'gsa',
      recordId: 'GSA-01',
      payloadSha256: 'a'.repeat(64),
      timestamp: '2026-10-31T10:00:00.000Z'
    });
    appendLedgerEntry(chain, {
      source: 'gsa',
      recordId: 'GSA-02',
      payloadSha256: 'b'.repeat(64),
      timestamp: '2026-10-31T10:01:00.000Z'
    });

    // Tamper with payloadSha256 in block 1 without updating entryHash
    chain[1].payloadSha256 = 'f'.repeat(64);

    const verification = verifyLedgerChain(chain);
    assert.equal(verification.valid, false);
    assert.ok(verification.error.includes('Hash verification failed at block 1'));
    assert.equal(verification.verifiedCount, 1);
  });

  await t.test('detects tampered prevHash breaking chain continuity', () => {
    const chain = [];
    appendLedgerEntry(chain, {
      source: 'treasury',
      recordId: 'TRS-01',
      payloadSha256: '1'.repeat(64),
      timestamp: '2026-10-31T11:00:00.000Z'
    });
    appendLedgerEntry(chain, {
      source: 'treasury',
      recordId: 'TRS-02',
      payloadSha256: '2'.repeat(64),
      timestamp: '2026-10-31T11:05:00.000Z'
    });

    // Alter prevHash of block 1
    chain[1].prevHash = 'e'.repeat(64);

    const verification = verifyLedgerChain(chain);
    assert.equal(verification.valid, false);
    assert.ok(verification.error.includes('Chain broken at block 1'));
    assert.equal(verification.verifiedCount, 1);
  });

  await t.test('detects timestamp monotonicity violation (backwards time jump)', () => {
    const chain = [];
    appendLedgerEntry(chain, {
      source: 'usda',
      recordId: 'USDA-01',
      payloadSha256: '1'.repeat(64),
      timestamp: '2026-10-31T14:00:00.000Z'
    });

    // Manually create block with earlier timestamp than prior block
    const block2 = createLedgerBlock({
      index: 1,
      prevHash: chain[0].entryHash,
      timestamp: '2026-10-31T13:30:00.000Z', // 30 minutes earlier!
      source: 'usda',
      recordId: 'USDA-02',
      payloadSha256: '2'.repeat(64)
    });
    chain.push(block2);

    const verification = verifyLedgerChain(chain);
    assert.equal(verification.valid, false);
    assert.ok(verification.error.includes('monotonicity violation at block 1'));
    assert.equal(verification.verifiedCount, 1);
  });

  await t.test('detects non-genesis root block (invalid prevHash or index)', () => {
    const tamperedRoot = [
      createLedgerBlock({
        index: 1, // Invalid index for root
        prevHash: GENESIS_HASH,
        timestamp: '2026-10-31T12:00:00.000Z',
        source: 'va',
        recordId: 'VA-01',
        payloadSha256: '0'.repeat(64)
      })
    ];

    const verification = verifyLedgerChain(tamperedRoot);
    assert.equal(verification.valid, false);
    assert.ok(verification.error.includes('Genesis block at index 0'));
  });
});

test('Ledger Persistence & Discovery Snapshot Integration', async (t) => {
  await t.test('persists and reloads ledger from disk without loss of integrity', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-ledger-test-'));
    const ledgerFile = path.join(tmpDir, 'test-chain.json');

    const chain = [];
    appendLedgerEntry(chain, {
      source: 'bid4assets',
      recordId: 'B4A-777',
      payloadSha256: '3'.repeat(64),
      timestamp: '2026-10-31T15:00:00.000Z',
      action: 'AUCTION_BID_OPEN'
    });
    appendLedgerEntry(chain, {
      source: 'bid4assets',
      recordId: 'B4A-778',
      payloadSha256: '4'.repeat(64),
      timestamp: '2026-10-31T15:02:00.000Z',
      action: 'AUCTION_BID_CLOSE'
    });

    saveLedgerToFile(ledgerFile, chain);
    assert.equal(fs.existsSync(ledgerFile), true);

    const loaded = loadLedgerFromFile(ledgerFile);
    assert.equal(loaded.length, 2);

    const verify = verifyLedgerChain(loaded);
    assert.equal(verify.valid, true);
    assert.equal(verify.verifiedCount, 2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('createMarkdownEvidenceSnapshot generates and embeds an evidence ledger block', () => {
    const snapshot = createMarkdownEvidenceSnapshot({
      sourceKey: 'civilview',
      recordId: 'DOCKET-8899',
      html: '<div><table><tr><th>Tax Due</th><td>$3,400</td></tr></table></div>',
      title: 'Civilview Camden County Auction'
    });

    assert.ok(snapshot.ledgerBlock, 'Must attach ledgerBlock entry');
    assert.equal(snapshot.ledgerBlock.source, 'civilview');
    assert.equal(snapshot.ledgerBlock.recordId, 'DOCKET-8899');
    assert.equal(snapshot.ledgerBlock.prevHash, GENESIS_HASH);
    assert.equal(typeof snapshot.ledgerBlock.entryHash, 'string');
    assert.equal(snapshot.ledgerBlock.entryHash.length, 64);

    // Verify block in isolation as genesis block
    const singleChain = [snapshot.ledgerBlock];
    const verification = verifyLedgerChain(singleChain);
    assert.equal(verification.valid, true);
    assert.equal(verification.verifiedCount, 1);
  });

  await t.test('appendLedgerToFile and withLedgerLock atomically persist newline-delimited ledger entries', async () => {
    const tmpDir = path.resolve(__dirname, `../../.cache/tmp-ledger-lock-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const ledgerFile = path.join(tmpDir, 'concurrent-ledger.json');

    const block1 = await appendLedgerToFile(ledgerFile, {
      source: 'treasury',
      recordId: 'TREAS-001',
      payloadSha256: 'a'.repeat(64),
      action: 'SNAPSHOT_RECORDED'
    });
    assert.equal(block1.index, 0);
    assert.equal(block1.prevHash, GENESIS_HASH);

    const block2 = await appendLedgerToFile(ledgerFile, {
      source: 'treasury',
      recordId: 'TREAS-002',
      payloadSha256: 'b'.repeat(64),
      action: 'SNAPSHOT_RECORDED'
    });
    assert.equal(block2.index, 1);
    assert.equal(block2.prevHash, block1.entryHash);

    const loaded = loadLedgerFromFile(ledgerFile);
    assert.equal(loaded.length, 2);
    const verification = verifyLedgerChain(loaded);
    assert.equal(verification.valid, true);
    assert.equal(verification.verifiedCount, 2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

test('Evidence ledger lock: a fresh foreign lock is respected, a stale one self-heals', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-ledger-lock-'));
  const target = path.join(dir, 'ledger.jsonl');
  const lockPath = `${target}.lock`;

  try {
    // A fresh lock (mtime = now) from another writer is respected: the write
    // fails busy rather than clobbering a live writer.
    fs.writeFileSync(lockPath, '', { flag: 'wx' });
    assert.throws(
      () => withLedgerLock(target, () => { throw new Error('must not run under a fresh foreign lock'); }),
      (e) => e.code === 'EVIDENCE_LEDGER_BUSY',
      'a fresh foreign lock must be respected'
    );

    // A stale lock (mtime pushed past the break threshold) belongs to a
    // crashed writer: the write self-heals, succeeds, and removes the lock.
    const staleTime = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(lockPath, staleTime, staleTime);
    const wrote = withLedgerLock(target, () => {
      fs.writeFileSync(target, `${JSON.stringify({ seq: 1 })}\n`, 'utf8');
      return 'ok';
    });
    assert.equal(wrote, 'ok', 'a stale lock must be broken and the write must proceed');
    assert.equal(fs.existsSync(lockPath), false, 'the broken lock must be cleaned up');
    assert.equal(fs.readFileSync(target, 'utf8'), `${JSON.stringify({ seq: 1 })}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Evidence ledger append scales O(1) per block and health detects external tampering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-ledger-scale-'));
  const target = path.join(dir, 'evidence-ledger.jsonl');

  try {
    const startMs = Date.now();
    for (let i = 0; i < 600; i++) {
      await appendLedgerToFile(target, {
        source: 'hud',
        recordId: `HUD-${i}`,
        payloadSha256: String(i).padStart(64, '0'),
        action: 'SNAPSHOT_RECORDED'
      });
    }
    const elapsedMs = Date.now() - startMs;
    assert.ok(elapsedMs < 3000, `600 appends took too long (${elapsedMs}ms), expected O(1) per append`);

    const cachedHealth = getLedgerHealth(target);
    assert.equal(cachedHealth.integrity, 'chain_verified');
    assert.equal(cachedHealth.entries, 600);

    const storeHealth = evidenceStoreHealth(dir);
    assert.equal(storeHealth.integrity, 'chain_verified');
    assert.equal(storeHealth.entries, 600);

    const verified = verifyLedgerChain(loadLedgerFromFile(target));
    assert.equal(verified.valid, true);
    assert.equal(verified.verifiedCount, 600);

    // Reject explicit backward timestamp monotonicity violation even via fast append path
    await assert.rejects(
      () => appendLedgerToFile(target, {
        source: 'hud',
        recordId: 'HUD-BACKWARD',
        payloadSha256: 'f'.repeat(64),
        timestamp: '2020-01-01T00:00:00.000Z'
      }),
      (err) => err && /monotonicity violation/i.test(err.message)
    );

    // Tamper one block in-place and confirm both getLedgerHealth and evidenceStoreHealth fail closed
    const raw = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, raw.replace('HUD-10', 'HUD-XX'), 'utf8');
    assert.throws(
      () => getLedgerHealth(target),
      (err) => err && err.code === 'EVIDENCE_LEDGER_CORRUPT'
    );
    assert.equal(evidenceStoreHealth(dir).integrity, 'unreadable');

    // Legacy JSON array ledger remains read-only
    const legacyFile = path.join(dir, 'legacy-ledger.json');
    const singleChain = [createLedgerBlock({
      index: 0,
      prevHash: GENESIS_HASH,
      timestamp: '2026-10-31T12:00:00.000Z',
      source: 'hud',
      recordId: 'LEG-1',
      payloadSha256: 'a'.repeat(64)
    })];
    fs.writeFileSync(legacyFile, JSON.stringify(singleChain), 'utf8');
    await assert.rejects(
      () => appendLedgerToFile(legacyFile, {
        source: 'hud',
        recordId: 'LEG-2',
        payloadSha256: 'b'.repeat(64)
      }),
      (err) => err && /Legacy ledger is read-only/i.test(err.message)
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
