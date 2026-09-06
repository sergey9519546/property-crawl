const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../.cache/source-intake.json');
const MAX_STORE_BYTES = 20 * 1024 * 1024;
const MAX_RECORDS = 2000;

function emptyStore() {
  return { version: 1, updatedAt: null, records: [] };
}

function resolveStorePath(filePath) {
  return path.resolve(filePath || process.env.PROPERTY_SOURCE_INTAKE_PATH || DEFAULT_STORE_PATH);
}

function loadStore(filePath) {
  const resolved = resolveStorePath(filePath);
  if (!fs.existsSync(resolved)) return emptyStore();
  const stats = fs.statSync(resolved);
  if (!stats.isFile() || stats.size > MAX_STORE_BYTES) throw new Error('Source intake store exceeds its safe size limit');
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (parsed?.version !== 1 || !Array.isArray(parsed.records)) throw new Error('Invalid source intake store');
  if (parsed.records.length > MAX_RECORDS) throw new Error('Source intake store exceeds its record limit');
  const ids = new Set();
  for (const record of parsed.records) {
    const valid = record && typeof record === 'object'
      && /^intake_[a-f0-9]{24}$/.test(record.id || '')
      && /^[a-z0-9][a-z0-9_-]{1,63}$/.test(record.sourceId || '')
      && ['needs_review', 'reviewed'].includes(record.status)
      && record.original && typeof record.original === 'object'
      && record.content && /^[a-f0-9]{64}$/.test(record.content.sha256 || '');
    if (!valid || ids.has(record?.id)) throw new Error('Invalid source intake record; existing evidence was preserved');
    ids.add(record.id);
  }
  return parsed;
}

function writeLocked(filePath, mutate) {
  const resolved = resolveStorePath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Source intake store is locked by another writer; retry after it finishes');
    throw error;
  }

  try {
    const store = loadStore(resolved);
    const result = mutate(store);
    if (result?.changed === false) return result.value;
    if (store.records.length > MAX_RECORDS) throw new Error('Source intake store has reached its record limit');
    store.updatedAt = new Date().toISOString();
    const body = JSON.stringify(store);
    if (Buffer.byteLength(body, 'utf8') > MAX_STORE_BYTES) throw new Error('Source intake store exceeds its safe size limit');
    const temporary = `${resolved}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, resolved);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return result?.value;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

function putRecord(record, options = {}) {
  if (!record || typeof record !== 'object' || !record.id) throw new TypeError('A source intake record with an id is required');
  return writeLocked(options.filePath, (store) => {
    const existing = store.records.find((item) => item.id === record.id);
    if (existing) return { changed: false, value: { record: existing, deduplicated: true } };
    store.records.push(record);
    return { changed: true, value: { record, deduplicated: false } };
  });
}

function queryRecords(filters = {}, options = {}) {
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
  return loadStore(options.filePath).records
    .filter((record) => !filters.status || record.status === filters.status)
    .filter((record) => !filters.sourceId || record.sourceId === filters.sourceId)
    .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)))
    .slice(0, limit);
}

function updateRecord(id, updater, options = {}) {
  if (typeof updater !== 'function') throw new TypeError('Source intake updater must be a function');
  return writeLocked(options.filePath, (store) => {
    const index = store.records.findIndex((record) => record.id === id);
    if (index < 0) {
      const error = new Error(`Source intake record not found: ${id}`);
      error.code = 'SOURCE_INTAKE_NOT_FOUND';
      throw error;
    }
    const updated = updater(structuredClone(store.records[index]));
    if (!updated || updated.id !== id) throw new Error('Source intake updater cannot remove or change a record id');
    store.records[index] = updated;
    return { changed: true, value: updated };
  });
}

module.exports = {
  DEFAULT_STORE_PATH,
  MAX_RECORDS,
  MAX_STORE_BYTES,
  loadStore,
  putRecord,
  queryRecords,
  resolveStorePath,
  updateRecord,
};
