'use strict';

/**
 * test/discovery/snapshot-compactor.test.js
 *
 * Unit tests for Observation Deduplication & Snapshot Compactor
 * (server/discovery/snapshot-compactor.js)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeContentHash,
  resolveHash,
  dedupConsecutive,
  compactObservations,
} = require('../../server/discovery/snapshot-compactor');

test('Snapshot Compactor: computeContentHash', async (t) => {
  await t.test('computes deterministic SHA-256 for primitive and object payloads', () => {
    const hash1 = computeContentHash({ b: 2, a: 1 });
    const hash2 = computeContentHash({ a: 1, b: 2 });
    assert.equal(hash1, hash2);
    assert.equal(typeof hash1, 'string');
    assert.equal(hash1.length, 64);
  });

  await t.test('computes different hashes for distinct payloads', () => {
    const hashA = computeContentHash({ status: 'active', bid: 1000 });
    const hashB = computeContentHash({ status: 'sold', bid: 1000 });
    assert.notEqual(hashA, hashB);
  });
});

test('Snapshot Compactor: resolveHash', async (t) => {
  await t.test('uses existing contentHash if present', () => {
    assert.equal(resolveHash({ contentHash: 'abc123' }), 'abc123');
  });

  await t.test('computes hash from payload or data when contentHash is missing', () => {
    const hash = resolveHash({ payload: { bid: 50000, status: 'active' } });
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
  });

  await t.test('computes hash from raw object when contentHash and payload are missing', () => {
    const hash = resolveHash({ bid: 50000, status: 'active' });
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
  });
});

test('Snapshot Compactor: dedupConsecutive', async (t) => {
  await t.test('returns empty array on empty or non-array input', () => {
    assert.deepEqual(dedupConsecutive([]), []);
    assert.deepEqual(dedupConsecutive(null), []);
  });

  await t.test('drops consecutive duplicate content hashes', () => {
    const observations = [
      { id: 1, contentHash: 'hash-A' },
      { id: 2, contentHash: 'hash-A' },
      { id: 3, contentHash: 'hash-B' },
      { id: 4, contentHash: 'hash-B' },
      { id: 5, contentHash: 'hash-A' },
    ];
    const deduped = dedupConsecutive(observations);
    assert.equal(deduped.length, 3);
    assert.deepEqual(deduped.map((o) => o.id), [1, 3, 5]);
  });

  await t.test('computes hash for observations lacking contentHash and dedups accurately', () => {
    const observations = [
      { id: 1, payload: { amount: 100 } },
      { id: 2, payload: { amount: 100 } }, // duplicate of 1
      { id: 3, payload: { amount: 200 } }, // distinct
      { id: 4, payload: { amount: 200 } }, // duplicate of 3
    ];
    const deduped = dedupConsecutive(observations);
    assert.equal(deduped.length, 2);
    assert.deepEqual(deduped.map((o) => o.id), [1, 3]);
  });
});

test('Snapshot Compactor: compactObservations', async (t) => {
  await t.test('handles empty input gracefully', () => {
    const res = compactObservations([]);
    assert.equal(res.originalCount, 0);
    assert.equal(res.retainedCount, 0);
    assert.equal(res.removedCount, 0);
    assert.equal(res.compressionPct, 0);
    assert.deepEqual(res.compacted, []);
  });

  await t.test('handles single-element array', () => {
    const single = [{ id: 1, contentHash: 'hash-1', status: 'active' }];
    const res = compactObservations(single);
    assert.equal(res.originalCount, 1);
    assert.equal(res.retainedCount, 1);
    assert.equal(res.removedCount, 0);
    assert.equal(res.compressionPct, 0);
    assert.deepEqual(res.compacted, single);
  });

  await t.test('always preserves first and last observation regardless of duplicates', () => {
    const observations = [
      { id: 1, contentHash: 'hash-A', status: 'scheduled' },
      { id: 2, contentHash: 'hash-A', status: 'scheduled' },
      { id: 3, contentHash: 'hash-A', status: 'scheduled' },
      { id: 4, contentHash: 'hash-A', status: 'scheduled' },
    ];
    const res = compactObservations(observations);
    assert.equal(res.originalCount, 4);
    assert.equal(res.retainedCount, 2);
    assert.equal(res.removedCount, 2);
    assert.equal(res.compressionPct, 50);
    assert.equal(res.compacted[0].id, 1);
    assert.equal(res.compacted[1].id, 4);
  });

  await t.test('always retains status transition records even if hashes collide or vary', () => {
    const observations = [
      { id: 1, contentHash: 'hash-A', status: 'scheduled' },
      { id: 2, contentHash: 'hash-A', status: 'scheduled' },
      { id: 3, contentHash: 'hash-B', status: 'postponed' },
      { id: 4, contentHash: 'hash-B', status: 'postponed' },
      { id: 5, contentHash: 'hash-C', status: 'sold' },
    ];
    const res = compactObservations(observations);
    assert.equal(res.originalCount, 5);
    assert.equal(res.retainedCount, 3);
    assert.deepEqual(res.compacted.map((o) => o.id), [1, 3, 5]);
  });
});
