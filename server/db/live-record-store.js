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

function mergeLiveRecords(filePath, candidates) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = filePath + '.lock';
  let lock;
  try { lock = fs.openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Live record store is locked by another writer. Retry after it finishes; never remove an active lock.');
    throw error;
  }
  try { return mergeLocked(filePath, candidates); }
  finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

function mergeLocked(filePath, candidates) {
  // Never replace a corrupted existing store with a silently empty fallback.
  const records = new Map(loadLiveRecords(filePath).map((record) => [record.id, record]));
  let accepted = 0, rejected = 0;
  for (const record of candidates) {
    const result = validateListingForIngestion(record);
    if (!result.isValid || result.listing.provenance?.origin !== 'live' || result.listing.provenance?.recordKind !== 'source_record') { rejected++; continue; }
    const previous = records.get(result.listing.id);
    const observedAt = (item) => Date.parse(item.sourceObservedAt || item.provenance?.observedAt || '');
    if (previous && observedAt(previous) > observedAt(result.listing)) continue;
    records.set(result.listing.id, result.listing);
    accepted++;
  }
  if (!accepted) return { accepted, rejected, retained: records.size };
  const body = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), listings: [...records.values()] });
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Live record store exceeds size limit');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { accepted, rejected, retained: records.size };
}

module.exports = { loadLiveRecords, mergeLiveRecords };
