const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateListingForIngestion } = require('../scrapers/validation');

// Live store must absorb multi-state HUD (~2k records) + CivilView/FL DOR
// batches without throwing after ingest. Bounded but large enough for $0 hosts.
//
// Raised from 64MB to the guard's own 128MB ceiling. The store is sized for
// observed records across every source, and a working ServiceLink sweep alone
// discovers 6,194; at ~7KB per record the old default filled at 9,175 records
// and the sweep could not record what it had just found. 128MB still fails
// closed - the guard is unchanged, only sized for the workload that exists now
// rather than the one that existed before pagination worked. Override per host
// with PROPERTY_LIVE_STORE_MAX_BYTES.
const MAX_BYTES = Math.max(
  8 * 1024 * 1024,
  Math.min(
    128 * 1024 * 1024,
    Number.parseInt(process.env.PROPERTY_LIVE_STORE_MAX_BYTES, 10) || 128 * 1024 * 1024,
  ),
);

// The one canonical answer to "which file is the live record store?", with the
// same precedence DatabaseClient uses: PROPERTY_LIVE_CACHE_PATH wins, else the
// repo-local default. It lives here rather than in db/client.js because
// requiring db/client.js has import-time side effects (it loads and refreshes
// the whole store), and read-only consumers must not pay for that.
const DEFAULT_LIVE_STORE_PATH = path.resolve(__dirname, '../../.cache/live-listings.json');

function resolveLiveStorePath(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const fromEnv = process.env.PROPERTY_LIVE_CACHE_PATH;
  return fromEnv ? path.resolve(fromEnv) : DEFAULT_LIVE_STORE_PATH;
}

function loadLiveRecords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  if (fs.statSync(filePath).size > MAX_BYTES) throw new Error('Live record store exceeds size limit');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.listings)) throw new Error('Invalid live record store');
  return data.listings.flatMap((record) => {
    const result = validateListingForIngestion(record);
    return result.isValid && result.listing.provenance?.origin === 'live'
      && result.listing.provenance?.recordKind === 'source_record' ? [result.listing] : [];
  });
}

function mergeLiveRecords(filePath, candidates, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = filePath + '.lock';
  let lock;
  try { lock = fs.openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Live record store is locked by another writer. Retry after it finishes; never remove an active lock.');
    throw error;
  }
  try { return mergeLocked(filePath, candidates, options); }
  finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

function mergeLocked(filePath, candidates, options = {}) {
  // Never replace a corrupted existing store with a silently empty fallback.
  const records = new Map(loadLiveRecords(filePath).map((record) => [record.id, record]));
  let accepted = 0, rejected = 0, mutated = false;
  const seenIds = new Set();
  for (const record of candidates) {
    const result = validateListingForIngestion(record);
    if (!result.isValid || result.listing.provenance?.origin !== 'live' || result.listing.provenance?.recordKind !== 'source_record') { rejected++; continue; }
    seenIds.add(result.listing.id);
    if (result.listing.provenance?.publisherAbsence) {
      const provenance = { ...result.listing.provenance };
      delete provenance.publisherAbsence;
      result.listing.provenance = provenance;
    }
    const previous = records.get(result.listing.id);
    const observedAt = (item) => Date.parse(item.sourceObservedAt || item.provenance?.observedAt || '');
    if (previous && observedAt(previous) > observedAt(result.listing)) continue;
    records.set(result.listing.id, result.listing);
    accepted++;
  }
  // A complete run may note that a same-source id was absent from that index.
  // The record stays. Status and transactionOutcome stay. Absence is not a sale,
  // and a failed, partial, truncated, or unscoped run must not annotate.
  const retireFromSource = (options.runCompleted === true && typeof options.sourceKey === 'string' && options.sourceKey)
    ? options.sourceKey
    : null;
  let retired = 0;
  if (retireFromSource) {
    const at = new Date().toISOString();
    for (const [id, record] of records) {
      if (record.source !== retireFromSource) continue;
      if (seenIds.has(id)) {
        if (record.provenance?.publisherAbsence) {
          const provenance = { ...record.provenance };
          delete provenance.publisherAbsence;
          records.set(id, { ...record, provenance });
          mutated = true;
        }
        continue;
      }
      const provenance = {
        ...(record.provenance || {}),
        publisherAbsence: { at, sourceKey: retireFromSource, outcome: 'absent_from_complete_index' },
      };
      records.set(id, { ...record, provenance });
      retired++;
      mutated = true;
    }
  }
  if (!accepted && !retired && !mutated) return { accepted, rejected, retained: records.size, retired };
  const body = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), listings: [...records.values()] });
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Live record store exceeds size limit');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { accepted, rejected, retained: records.size, retired };
}

module.exports = { loadLiveRecords, mergeLiveRecords, resolveLiveStorePath, DEFAULT_LIVE_STORE_PATH };
