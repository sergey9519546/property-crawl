'use strict';

/**
 * server/discovery/snapshot-compactor.js
 *
 * Observation Deduplication & Snapshot Compactor.
 *
 * Reduces a sequence of observation records by eliminating consecutive
 * identical snapshots while preserving:
 *   - The first and last observation of each run
 *   - Every record where a status transition occurred
 *   - Unhashed observations (never dropped by false null === null equality)
 *
 * Content identity is determined by SHA-256 hash of canonical JSON,
 * consistent with the evidence-ledger's canonicalStringify approach.
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Canonical JSON serialization (mirrors evidence-ledger.js)
// ---------------------------------------------------------------------------

/**
 * Recursively serializes any value into a deterministic canonical JSON string
 * with sorted object keys and no extraneous whitespace.
 *
 * @param {*} value - Value to serialize
 * @returns {string} Canonical JSON representation
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') +
    '}'
  );
}

// ---------------------------------------------------------------------------
// Public utilities
// ---------------------------------------------------------------------------

/**
 * Computes the SHA-256 hex digest of the canonical JSON of a payload.
 * Stable across runtimes (deterministic key ordering).
 *
 * @param {*} payload - Any serializable value
 * @returns {string} 64-character SHA-256 hex digest
 */
function computeContentHash(payload) {
  const canonical = canonicalStringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Resolves or computes contentHash for an observation record.
 * Ensures observations without an explicit contentHash field compute one
 * deterministically rather than returning null.
 *
 * @param {*} obs - Observation record
 * @returns {string|null} Hex digest or null if object unhashable
 */
function resolveHash(obs) {
  if (obs && typeof obs.contentHash === 'string' && obs.contentHash.length > 0) {
    return obs.contentHash;
  }
  if (obs && (obs.payload !== undefined || obs.data !== undefined)) {
    return computeContentHash(obs.payload !== undefined ? obs.payload : obs.data);
  }
  if (obs && typeof obs === 'object') {
    return computeContentHash(obs);
  }
  return null;
}

/**
 * Eliminates consecutive duplicate observations using their contentHash fields.
 * When two adjacent records share the same contentHash, the later one is dropped.
 * Does NOT apply any "always retain first/last" logic — that is handled by
 * compactObservations().
 *
 * Unhashed records (hash === null) are never dropped as duplicates of each other.
 *
 * @param {Array<Object>} observations - Ordered observation records.
 * @returns {Array<Object>} Deduplicated observations (subset of input)
 */
function dedupConsecutive(observations) {
  if (!Array.isArray(observations) || observations.length === 0) return [];

  const result = [];
  let lastHash = Symbol('initial');

  for (const obs of observations) {
    const hash = resolveHash(obs);
    if (hash === null || hash !== lastHash) {
      result.push(obs);
      lastHash = hash;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main compactor
// ---------------------------------------------------------------------------

/**
 * Compacts an array of observation records by:
 *   1. Deduplicating consecutive identical records (same contentHash).
 *   2. Always retaining the first and last records of the original array.
 *   3. Always retaining status-transition records (status changed vs. previous).
 *   4. Retaining unhashed distinct records without silent null === null truncation.
 *
 * @param {Array<Object>} observations - Ordered observation records. Each record
 *   should have:
 *     - `contentHash` {string} SHA-256 of the observation payload (or computed on the fly)
 *     - `observedAt`  {string} ISO-8601 timestamp
 *     - `status`      {string} [optional] Status label for transition detection
 * @param {Object} [options] - Options
 * @param {boolean} [options.retainStatusTransitions=true] - When true, always
 *   retain records where `status` changed from the previous record.
 * @returns {{
 *   compacted: Array<Object>,
 *   originalCount: number,
 *   retainedCount: number,
 *   removedCount: number,
 *   compressionPct: number
 * }}
 */
function compactObservations(observations, options = {}) {
  const retainStatusTransitions =
    options.retainStatusTransitions !== false; // default true

  if (!Array.isArray(observations) || observations.length === 0) {
    return {
      compacted: [],
      originalCount: 0,
      retainedCount: 0,
      removedCount: 0,
      compressionPct: 0,
    };
  }

  const originalCount = observations.length;

  if (originalCount === 1) {
    return {
      compacted: [observations[0]],
      originalCount: 1,
      retainedCount: 1,
      removedCount: 0,
      compressionPct: 0,
    };
  }

  // Build a set of indices that MUST be retained
  const retainedIndices = new Set();

  // Always retain first and last
  retainedIndices.add(0);
  retainedIndices.add(originalCount - 1);

  // Retain status-transition records
  if (retainStatusTransitions) {
    let lastStatus = observations[0].status;
    for (let i = 1; i < originalCount; i++) {
      const currentStatus = observations[i].status;
      if (currentStatus !== undefined && currentStatus !== lastStatus) {
        retainedIndices.add(i);
      }
      if (currentStatus !== undefined) {
        lastStatus = currentStatus;
      }
    }
  }

  // Dedup consecutive identical hashes; always keep forced indices
  const compacted = [];
  let lastHash = Symbol('initial');

  for (let i = 0; i < originalCount; i++) {
    const obs = observations[i];
    const hash = resolveHash(obs);
    const isForced = retainedIndices.has(i);

    if (isForced || hash === null || hash !== lastHash) {
      compacted.push(obs);
      lastHash = hash;
    }
  }

  const retainedCount = compacted.length;
  const removedCount = originalCount - retainedCount;
  const compressionPct =
    originalCount > 0
      ? Math.round((removedCount / originalCount) * 10000) / 100
      : 0;

  return {
    compacted,
    originalCount,
    retainedCount,
    removedCount,
    compressionPct,
  };
}

module.exports = {
  canonicalStringify,
  computeContentHash,
  resolveHash,
  dedupConsecutive,
  compactObservations,
};
