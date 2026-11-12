'use strict';

/**
 * server/discovery/evidence-ledger.js
 *
 * Append-Only Cryptographic Evidence Ledger.
 * Provides an immutable, cryptographically verifiable audit trail for discovered properties,
 * docket snapshots, and extraction evidence.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GENESIS_HASH = '0'.repeat(64);
const DEFAULT_LEDGER_PATH = path.resolve(__dirname, '../../.cache/evidence-ledger.json');

/**
 * Recursively serializes any JavaScript object or primitive into a deterministic,
 * canonical JSON string with sorted keys and no extraneous whitespace.
 *
 * @param {*} value - Value to serialize.
 * @returns {string} Canonical JSON representation.
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

/**
 * Computes a SHA-256 hash over the canonical JSON string of ledger block data.
 *
 * @param {Object} blockData - Data payload for the block.
 * @returns {string} 64-character SHA-256 hex digest.
 */
function computeBlockEntryHash({
  index,
  prevHash,
  timestamp,
  source,
  recordId,
  payloadSha256,
  action,
  metadata
}) {
  const payloadToHash = {
    index: Number(index),
    prevHash: String(prevHash),
    timestamp: String(timestamp),
    source: String(source),
    recordId: String(recordId),
    payloadSha256: String(payloadSha256),
    action: String(action || 'SNAPSHOT_RECORDED'),
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  };

  const canonical = canonicalStringify(payloadToHash);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Creates an immutable ledger block with cryptographic chaining.
 *
 * @param {Object} params
 * @param {number} params.index - Block height / sequence index.
 * @param {string} params.prevHash - SHA-256 hex digest of previous block (or GENESIS_HASH for index 0).
 * @param {string} [params.timestamp] - ISO-8601 timestamp.
 * @param {string} params.source - Originating scraper source key.
 * @param {string} params.recordId - Publisher record ID or case number.
 * @param {string} params.payloadSha256 - SHA-256 hex digest of raw payload or snapshot.
 * @param {string} [params.action='SNAPSHOT_RECORDED'] - Ledger action.
 * @param {Object} [params.metadata={}] - Structured metadata.
 * @returns {Object} Ledger block entry with entryHash.
 */
function createLedgerBlock({
  index,
  prevHash,
  timestamp,
  source,
  recordId,
  payloadSha256,
  action = 'SNAPSHOT_RECORDED',
  metadata = {}
}) {
  const blockIndex = Number(index ?? 0);
  const blockPrevHash = String(prevHash || (blockIndex === 0 ? GENESIS_HASH : ''));
  const blockTimestamp = timestamp ? String(timestamp) : new Date().toISOString();
  const blockSource = String(source || 'unknown');
  const blockRecordId = String(recordId || 'unknown');
  const blockPayloadSha256 = String(payloadSha256 || crypto.createHash('sha256').update('').digest('hex'));
  const blockAction = String(action);
  const blockMetadata = metadata && typeof metadata === 'object' ? metadata : {};

  const entryHash = computeBlockEntryHash({
    index: blockIndex,
    prevHash: blockPrevHash,
    timestamp: blockTimestamp,
    source: blockSource,
    recordId: blockRecordId,
    payloadSha256: blockPayloadSha256,
    action: blockAction,
    metadata: blockMetadata
  });

  return {
    index: blockIndex,
    prevHash: blockPrevHash,
    timestamp: blockTimestamp,
    source: blockSource,
    recordId: blockRecordId,
    payloadSha256: blockPayloadSha256,
    action: blockAction,
    metadata: blockMetadata,
    entryHash
  };
}

/**
 * Verifies the cryptographic integrity, hash chain, and timestamp monotonicity of a ledger.
 *
 * @param {Array<Object>} chain - Array of ledger blocks.
 * @returns {{ valid: boolean, error?: string, verifiedCount: number }}
 */
function verifyLedgerChain(chain) {
  if (!Array.isArray(chain)) {
    return {
      valid: false,
      error: 'Ledger chain must be an array',
      verifiedCount: 0
    };
  }

  if (chain.length === 0) {
    return {
      valid: true,
      verifiedCount: 0
    };
  }

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];

    if (!entry || typeof entry !== 'object') {
      return {
        valid: false,
        error: `Block ${i} is not a valid block object`,
        verifiedCount: i
      };
    }

    // 1. Genesis check
    if (!Number.isFinite(Date.parse(entry.timestamp)) || !/^[a-f0-9]{64}$/i.test(entry.payloadSha256 || '')) {
      return {valid:false,error:`Invalid timestamp or payload digest at block ${i}`,verifiedCount:i};
    }
    if (i === 0) {
      if (entry.index !== 0 || entry.prevHash !== GENESIS_HASH) {
        return {
          valid: false,
          error: `Genesis block at index 0 must have index === 0 and prevHash === GENESIS_HASH (found index: ${entry.index}, prevHash: ${entry.prevHash})`,
          verifiedCount: 0
        };
      }
    } else {
      // 2. Subsequent block height and chaining check
      const prevBlock = chain[i - 1];
      if (entry.index !== i) {
        return {
          valid: false,
          error: `Block index mismatch at height ${i}: expected ${i}, found ${entry.index}`,
          verifiedCount: i
        };
      }
      if (entry.prevHash !== prevBlock.entryHash) {
        return {
          valid: false,
          error: `Chain broken at block ${i}: prevHash "${entry.prevHash}" does not match prior block hash "${prevBlock.entryHash}"`,
          verifiedCount: i
        };
      }

      // 4. Timestamp monotonicity check
      const prevTime = new Date(prevBlock.timestamp).getTime();
      const currTime = new Date(entry.timestamp).getTime();
      if (Number.isFinite(prevTime) && Number.isFinite(currTime) && currTime < prevTime) {
        return {
          valid: false,
          error: `Timestamp monotonicity violation at block ${i}: current "${entry.timestamp}" is earlier than previous "${prevBlock.timestamp}"`,
          verifiedCount: i
        };
      }
    }

    // 3. Recomputed entryHash check
    const recomputedHash = computeBlockEntryHash(entry);
    if (recomputedHash !== entry.entryHash) {
      return {
        valid: false,
        error: `Hash verification failed at block ${i}: computed "${recomputedHash}", recorded "${entry.entryHash}"`,
        verifiedCount: i
      };
    }
  }

  return {
    valid: true,
    verifiedCount: chain.length
  };
}

/**
 * Appends a new entry to an in-memory ledger chain with automatic indexing and prevHash linking.
 *
 * @param {Array<Object>} chain - Mutable ledger chain array.
 * @param {Object} entryData - New entry parameters.
 * @returns {Object} The appended block entry.
 */
function appendLedgerEntry(chain, entryData) {
  if (!Array.isArray(chain)) {
    throw new TypeError('Chain must be an array');
  }

  const index = chain.length;
  const prevHash = index === 0 ? GENESIS_HASH : chain[index - 1].entryHash;
  const timestamp = entryData.timestamp || new Date().toISOString();

  const block = createLedgerBlock({
    index,
    prevHash,
    timestamp,
    source: entryData.source,
    recordId: entryData.recordId,
    payloadSha256: entryData.payloadSha256,
    action: entryData.action || 'SNAPSHOT_RECORDED',
    metadata: entryData.metadata || {}
  });

  chain.push(block);
  return block;
}

/**
 * Saves a ledger chain to disk.
 *
 * @param {string} filePath - Absolute path to ledger JSON file.
 * @param {Array<Object>} chain - Array of ledger blocks.
 */
function ledgerError(message, code = 'EVIDENCE_LEDGER_CORRUPT') {
  return Object.assign(new Error(message), { code });
}

const verifiedLedgerCache = new Map();

function statSignature(target) {
  try {
    const st = fs.statSync(target, { bigint: true });
    return {
      ino: st.ino,
      size: st.size,
      mtimeNs: st.mtimeNs,
      ctimeNs: st.ctimeNs,
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameStatSignature(a, b) {
  return Boolean(
    a && b
    && a.ino === b.ino
    && a.size === b.size
    && a.mtimeNs === b.mtimeNs
    && a.ctimeNs === b.ctimeNs
  );
}

function updateVerifiedLedgerCache(target, sig, chain, isJsonArray) {
  const resolved = path.resolve(target);
  if (!sig || isJsonArray) {
    verifiedLedgerCache.delete(resolved);
    return;
  }
  const last = chain.length ? chain[chain.length - 1] : null;
  verifiedLedgerCache.set(resolved, {
    ...sig,
    isJsonArray: false,
    length: chain.length,
    lastEntryHash: last ? last.entryHash : GENESIS_HASH,
    lastTimestamp: last ? last.timestamp : null,
  });
}

function loadLedgerFromFile(filePath) {
  const target = filePath || DEFAULT_LEDGER_PATH;
  const resolved = path.resolve(target);
  try {
    const sig = statSignature(target);
    if (!sig) {
      verifiedLedgerCache.delete(resolved);
      return [];
    }
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ target, 'utf8');
    if (!raw.trim()) throw ledgerError('Empty ledger file');
    const isJsonArray = raw.trimStart().startsWith('[');
    const parsed = isJsonArray
      ? JSON.parse(raw) : raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const result = verifyLedgerChain(parsed);
    if (!result.valid) throw ledgerError(result.error);
    updateVerifiedLedgerCache(target, sig, parsed, isJsonArray);
    return parsed;
  } catch (error) {
    verifiedLedgerCache.delete(resolved);
    if (error.code === 'ENOENT') return [];
    // Preserve the original bytes and refuse all writes. Corruption is never an empty ledger.
    throw ledgerError(`Evidence ledger is unreadable; original retained at ${target}: ${error.message}`);
  }
}

/**
 * Returns chain integrity and block count in O(1) when the underlying file
 * signature (inode, size, nanosecond timestamps) matches a previously
 * verified chain, falling back to full chain verification on any change.
 */
function getLedgerHealth(filePath) {
  const target = filePath || DEFAULT_LEDGER_PATH;
  const resolved = path.resolve(target);
  const sig = statSignature(target);
  if (!sig) {
    verifiedLedgerCache.delete(resolved);
    return { integrity: 'not_recorded', entries: 0 };
  }
  const cached = verifiedLedgerCache.get(resolved);
  if (cached && !cached.isJsonArray && sameStatSignature(sig, cached)) {
    return { integrity: 'chain_verified', entries: cached.length };
  }
  const chain = loadLedgerFromFile(target);
  return { integrity: 'chain_verified', entries: chain.length };
}

// The ledger lock is held only across a synchronous write (load → append →
// fsync, milliseconds). A lock file older than this threshold belongs to a
// crashed writer (host spin-down, deploy kill) and would block every future
// write forever.
const STALE_LEDGER_LOCK_MS = 30_000;

function withLedgerLock(target, fn) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lockPath = `${target}.lock`;
  const acquire = () => fs.openSync(lockPath, 'wx', 0o600);
  let lock;
  try { lock = acquire(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let stale = false;
    try { stale = Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LEDGER_LOCK_MS; }
    catch (_) { throw ledgerError('Evidence ledger has another writer', 'EVIDENCE_LEDGER_BUSY'); }
    if (!stale) throw ledgerError('Evidence ledger has another writer', 'EVIDENCE_LEDGER_BUSY');
    fs.unlinkSync(lockPath);
    try { lock = acquire(); }
    catch (_) { throw ledgerError('Evidence ledger has another writer', 'EVIDENCE_LEDGER_BUSY'); }
  }
  try { return fn(); }
  finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

function persistSuffix(target, chain, existing) {
  const result = verifyLedgerChain(chain);
  if (!result.valid) throw ledgerError(result.error);
  if (chain.length < existing.length || existing.some((entry, i) => canonicalStringify(entry) !== canonicalStringify(chain[i]))) {
    throw ledgerError('Evidence ledger history cannot be replaced or truncated');
  }
  const suffix = chain.slice(existing.length);
  if (!suffix.length) return;
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').trimStart().startsWith('[')) {
    throw ledgerError('Legacy ledger is read-only; migrate explicitly before appending');
  }
  const fd = fs.openSync(target, 'a', 0o600);
  try {
    fs.writeFileSync(fd, suffix.map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  } finally { fs.closeSync(fd); }
  verifiedLedgerCache.delete(path.resolve(target));
}

function saveLedgerToFile(filePath, chain) {
  const target = filePath || DEFAULT_LEDGER_PATH;
  return withLedgerLock(target, () => persistSuffix(target, chain, loadLedgerFromFile(target)));
}

async function appendLedgerToFile(filePath, entryData, { timeoutMs = 5000 } = {}) {
  const target = filePath || DEFAULT_LEDGER_PATH;
  const resolved = path.resolve(target);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return withLedgerLock(target, () => {
        const sig = statSignature(target);
        let state = verifiedLedgerCache.get(resolved);
        if (!sig) {
          state = { length: 0, lastEntryHash: GENESIS_HASH, lastTimestamp: null };
        } else if (!state || state.isJsonArray || !sameStatSignature(sig, state)) {
          // Verify existing chain once on cold start or external file change.
          const prefix = fs.readFileSync(/*turbopackIgnore: true*/ target, 'utf8');
          if (prefix.trimStart().startsWith('[')) {
            loadLedgerFromFile(target);
            throw ledgerError('Legacy ledger is read-only; migrate explicitly before appending');
          }
          const chain = loadLedgerFromFile(target);
          const last = chain.length ? chain[chain.length - 1] : null;
          state = {
            length: chain.length,
            lastEntryHash: last ? last.entryHash : GENESIS_HASH,
            lastTimestamp: last ? last.timestamp : null,
          };
        }

        const prevTimeMs = state.lastTimestamp ? Date.parse(state.lastTimestamp) : NaN;
        let blockTimestamp = entryData && entryData.timestamp ? String(entryData.timestamp) : null;
        if (blockTimestamp != null) {
          const currTimeMs = Date.parse(blockTimestamp);
          if (!Number.isFinite(currTimeMs)) {
            throw ledgerError(`Invalid timestamp at block ${state.length}`);
          }
          if (Number.isFinite(prevTimeMs) && currTimeMs < prevTimeMs) {
            throw ledgerError(
              `Timestamp monotonicity violation at block ${state.length}: current "${blockTimestamp}" is earlier than previous "${state.lastTimestamp}"`
            );
          }
        } else {
          const nowMs = Date.now();
          blockTimestamp = Number.isFinite(prevTimeMs) && nowMs < prevTimeMs
            ? new Date(prevTimeMs).toISOString()
            : new Date(nowMs).toISOString();
        }

        const block = createLedgerBlock({
          index: state.length,
          prevHash: state.length === 0 ? GENESIS_HASH : state.lastEntryHash,
          timestamp: blockTimestamp,
          source: entryData.source,
          recordId: entryData.recordId,
          payloadSha256: entryData.payloadSha256,
          action: entryData.action || 'SNAPSHOT_RECORDED',
          metadata: entryData.metadata || {}
        });

        const fd = fs.openSync(target, 'a', 0o600);
        try {
          fs.writeFileSync(fd, JSON.stringify(block) + '\n', 'utf8');
        } finally {
          fs.closeSync(fd);
        }

        const nextSig = statSignature(target);
        if (nextSig) {
          verifiedLedgerCache.set(resolved, {
            ...nextSig,
            isJsonArray: false,
            length: state.length + 1,
            lastEntryHash: block.entryHash,
            lastTimestamp: block.timestamp,
          });
        } else {
          verifiedLedgerCache.delete(resolved);
        }
        return block;
      });
    } catch (error) {
      if (error.code !== 'EVIDENCE_LEDGER_BUSY' || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

module.exports = {
  GENESIS_HASH,
  DEFAULT_LEDGER_PATH,
  canonicalStringify,
  computeBlockEntryHash,
  createLedgerBlock,
  verifyLedgerChain,
  appendLedgerEntry,
  saveLedgerToFile,
  loadLedgerFromFile,
  getLedgerHealth,
  withLedgerLock,
  appendLedgerToFile
};
