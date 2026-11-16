'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../.cache/research-workspace.json');
const MAX_STORE_BYTES = 24 * 1024 * 1024;
const MAX_CASES = 2000;
const MAX_CASE_HISTORY = 200;
const CASE_ID = /^rcase_[a-f0-9]{24}$/;

function emptyStore() {
  return { version: 1, updatedAt: null, cases: [] };
}

function resolveStorePath(filePath) {
  return path.resolve(/*turbopackIgnore: true*/ filePath || process.env.PROPERTY_RESEARCH_WORKSPACE_PATH || DEFAULT_STORE_PATH);
}

function assertStoreShape(store) {
  if (!store || store.version !== 1 || !Array.isArray(store.cases)) {
    throw new Error('Invalid research-workspace store; existing data was preserved');
  }
  if (store.cases.length > MAX_CASES) {
    throw new Error('Research-workspace store exceeds its case limit; existing data was preserved');
  }
  const ids = new Set();
  const identities = new Set();
  for (const item of store.cases) {
    const sourceRef = item?.sourceRef;
    const valid = item && CASE_ID.test(item.id || '')
      && typeof item.identityKey === 'string' && /^[a-f0-9]{64}$/.test(item.identityKey)
      && sourceRef && typeof sourceRef.sourceId === 'string' && typeof sourceRef.recordId === 'string'
      && /^[a-z0-9][a-z0-9_-]{1,63}$/.test(sourceRef.sourceId)
      && sourceRef.recordId.length >= 1 && sourceRef.recordId.length <= 300
      && ['inbox', 'pursue', 'pass'].includes(item.state)
      && Number.isInteger(item.revision) && item.revision >= 1
      && Array.isArray(item.origins) && Array.isArray(item.evidenceLinks) && Array.isArray(item.history)
      && item.origins.length <= 100 && item.evidenceLinks.length <= 100 && item.history.length <= MAX_CASE_HISTORY
      && item.listingSnapshot && typeof item.listingSnapshot === 'object' && !Array.isArray(item.listingSnapshot)
      && !Object.hasOwn(item.listingSnapshot, 'raw')
      && item.dossierSnapshot && typeof item.dossierSnapshot === 'object' && !Array.isArray(item.dossierSnapshot)
      && typeof item.reconsiderationRequired === 'boolean'
      && (item.latestTrigger === null || typeof item.latestTrigger === 'object')
      && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.updatedAt));
    const expectedIdentity = valid
      ? crypto.createHash('sha256').update(`${sourceRef.sourceId}\n${sourceRef.recordId}`).digest('hex')
      : null;
    const safeLinks = valid && item.evidenceLinks.every((link) => link && typeof link === 'object'
      && /^intake_[a-f0-9]{24}$/.test(link.intakeId || '')
      && /^[a-f0-9]{64}$/.test(link.contentSha256 || '')
      && typeof link.sourceUrl === 'string' && /^https:\/\//i.test(link.sourceUrl)
      && !Object.hasOwn(link, 'original'));
    if (!valid || !safeLinks || expectedIdentity !== item.identityKey || item.id !== `rcase_${item.identityKey.slice(0, 24)}`
      || ids.has(item?.id) || identities.has(item?.identityKey)) {
      throw new Error('Invalid research case; existing data was preserved');
    }
    ids.add(item.id);
    identities.add(item.identityKey);
  }
  return store;
}

function loadStore(filePath) {
  const resolved = resolveStorePath(filePath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ resolved)) return emptyStore();
  const stats = fs.statSync(/*turbopackIgnore: true*/ resolved);
  if (!stats.isFile() || stats.size > MAX_STORE_BYTES) {
    throw new Error('Research-workspace store exceeds its safe size limit');
  }
  return assertStoreShape(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ resolved, 'utf8')));
}

function replaceFileWithRetry(temporary,resolved,options={}) {
  const attempts=Math.max(1,Math.min(10,Number(options.attempts)||9));
  const wait=typeof options.wait==='function'?options.wait:(milliseconds)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds);
  for(let attempt=0;attempt<attempts;attempt+=1){
    try{fs.renameSync(/*turbopackIgnore: true*/ temporary,resolved);return;}
    catch(error){const retryable=(options.platform||process.platform)==='win32'&&['EPERM','EACCES','EBUSY'].includes(error.code);if(!retryable||attempt===attempts-1)throw error;wait(Math.min(250,10*(2**attempt)));}
  }
}

function acquireOwnedLock(lockPath, options = {}) {
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const openWithToken = () => {
    const fd = fs.openSync(/*turbopackIgnore: true*/ lockPath, 'wx', 0o600);
    try {
      fs.writeSync(fd, token, 0, 'utf8');
    } catch (writeErr) {
      try { fs.closeSync(fd); } catch (_) {}
      try {
        const current = fs.readFileSync(/*turbopackIgnore: true*/ lockPath, 'utf8');
        if (current === '' || current === token) fs.unlinkSync(/*turbopackIgnore: true*/ lockPath);
      } catch (_) {}
      throw writeErr;
    }
    return fd;
  };
  let fd;
  try {
    fd = openWithToken();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const staleLockMs = typeof options.staleLockMs === 'number' ? options.staleLockMs : 30_000;
    let stale = false;
    let staleContent = null;
    try {
      staleContent = fs.readFileSync(/*turbopackIgnore: true*/ lockPath, 'utf8');
      stale = Date.now() - fs.statSync(/*turbopackIgnore: true*/ lockPath).mtimeMs > staleLockMs;
    } catch (_) {}
    if (stale) {
      try {
        if (staleContent !== null && fs.readFileSync(/*turbopackIgnore: true*/ lockPath, 'utf8') === staleContent) {
          fs.unlinkSync(/*turbopackIgnore: true*/ lockPath);
        }
      } catch (_) {}
      try { fd = openWithToken(); } catch (_) {}
    }
    if (fd === undefined) throw error;
  }
  return { lockPath, fd, token };
}

function releaseOwnedLock(handle) {
  if (!handle) return false;
  const { lockPath, fd, token } = handle;
  if (fd !== undefined) {
    try { fs.closeSync(fd); } catch (_) {}
  }
  try {
    if (fs.readFileSync(/*turbopackIgnore: true*/ lockPath, 'utf8') === token) {
      fs.unlinkSync(/*turbopackIgnore: true*/ lockPath);
      return true;
    }
  } catch (_) {}
  return false;
}

function mutateStore(filePath, mutate, options = {}) {
  if (typeof mutate !== 'function') throw new TypeError('Research-workspace mutation must be a function');
  const resolved = resolveStorePath(filePath);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  let lockHandle;
  try {
    lockHandle = acquireOwnedLock(lockPath, { staleLockMs: options.staleLockMs });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Research workspace is locked by another writer; retry after it finishes');
    }
    throw error;
  }
  const temporary = `${resolved}.${crypto.randomUUID()}.tmp`;
  try {
    const store = loadStore(resolved);
    const result = mutate(store) || {};
    if (result.changed === false) return result.value;
    if (store.cases.length > MAX_CASES) throw new Error(`Research workspace cannot contain more than ${MAX_CASES} cases`);
    store.updatedAt = new Date(options.now === undefined ? Date.now() : options.now).toISOString();
    assertStoreShape(store);
    const body = JSON.stringify(store);
    if (Buffer.byteLength(body, 'utf8') > MAX_STORE_BYTES) throw new Error('Research workspace exceeds its safe size limit');
    fs.writeFileSync(/*turbopackIgnore: true*/ temporary, body, { flag: 'wx', mode: 0o600 });
    replaceFileWithRetry(temporary, resolved, options.replaceOptions);
    return result.value;
  } finally {
    try { if (fs.existsSync(/*turbopackIgnore: true*/ temporary)) fs.unlinkSync(/*turbopackIgnore: true*/ temporary); } catch (_) {}
    releaseOwnedLock(lockHandle);
  }
}

module.exports = {
  CASE_ID,
  DEFAULT_STORE_PATH,
  MAX_CASES,
  MAX_CASE_HISTORY,
  MAX_STORE_BYTES,
  acquireOwnedLock,
  assertStoreShape,
  emptyStore,
  loadStore,
  mutateStore,
  releaseOwnedLock,
  resolveStorePath,
  replaceFileWithRetry,
};
