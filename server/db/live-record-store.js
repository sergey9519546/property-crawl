const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateListingForIngestion } = require('../scrapers/validation');

const MAX_BYTES = 20 * 1024 * 1024;

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
  let accepted = 0, rejected = 0;
  const acceptedIds = new Set();
  for (const record of candidates) {
    const result = validateListingForIngestion(record);
    if (!result.isValid || result.listing.provenance?.origin !== 'live' || result.listing.provenance?.recordKind !== 'source_record') { rejected++; continue; }
    const previous = records.get(result.listing.id);
    const observedAt = (item) => Date.parse(item.sourceObservedAt || item.provenance?.observedAt || '');
    if (previous && observedAt(previous) > observedAt(result.listing)) continue;
    records.set(result.listing.id, result.listing);
    acceptedIds.add(result.listing.id);
    accepted++;
  }
  // Source-scoped reconciliation. A *complete* run for a given source is
  // permitted to retire records belonging to that source that were not
  // re-observed in this run. A failed, partial, or truncated run MUST NOT
  // retire records — absence of evidence is not evidence of absence, and
  // retiring on a partial read can permanently drop real inventory.
  const retireFromSource = (options.runCompleted === true && typeof options.sourceKey === 'string' && options.sourceKey)
    ? options.sourceKey
    : null;
  let retired = 0;
  if (retireFromSource) {
    for (const [id, record] of records) {
      if (record.source === retireFromSource && !acceptedIds.has(id)) {
        records.delete(id);
        retired++;
      }
    }
  }
  if (!accepted && !retired) return { accepted, rejected, retained: records.size, retired };
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

module.exports = { loadLiveRecords, mergeLiveRecords };
