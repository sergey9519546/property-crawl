'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../.cache/research-workspace.json');
const MAX_STORE_BYTES = 24 * 1024 * 1024;
const MAX_CASES = 2000;
const MAX_CASE_HISTORY = 200;
const CASE_ID = /^rcase_[a-f0-9]{24}$/;
const OWNER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,128}$/;

const initializedPools = new WeakSet();

function normalizeOwnerId(ownerId) {
  if (ownerId == null || ownerId === '' || ownerId === 'operator') return 'operator';
  if (typeof ownerId !== 'string' || !OWNER_ID_PATTERN.test(ownerId)) {
    throw new Error('Invalid research case ownerId');
  }
  return ownerId;
}

function emptyStore() {
  return { version: 1, updatedAt: null, cases: [] };
}

function resolveStorePath(filePath, ownerId) {
  const basePath = path.resolve(/*turbopackIgnore: true*/ filePath || process.env.PROPERTY_RESEARCH_WORKSPACE_PATH || DEFAULT_STORE_PATH);
  const owner = normalizeOwnerId(ownerId);
  if (owner === 'operator') return basePath;
  const safeOwner = owner.replace(/[^a-zA-Z0-9_-]/g, '_');
  const parsed = path.parse(basePath);
  const ext = parsed.ext || '.json';
  return path.join(parsed.dir, `${parsed.name}.${safeOwner}${ext}`);
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

function loadStore(filePath, options = {}) {
  const resolved = resolveStorePath(filePath, options.ownerId);
  if (!fs.existsSync(/*turbopackIgnore: true*/ resolved)) return emptyStore();
  const stats = fs.statSync(/*turbopackIgnore: true*/ resolved);
  if (!stats.isFile() || stats.size > MAX_STORE_BYTES) {
    throw new Error('Research-workspace store exceeds its safe size limit');
  }
  return assertStoreShape(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ resolved, 'utf8')));
}

function replaceFileWithRetry(temporary, resolved, options = {}) {
  const attempts = Math.max(1, Math.min(10, Number(options.attempts) || 9));
  const wait = typeof options.wait === 'function'
    ? options.wait
    : (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(/*turbopackIgnore: true*/ temporary, resolved);
      return;
    } catch (error) {
      const retryable = (options.platform || process.platform) === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (!retryable || attempt === attempts - 1) throw error;
      wait(Math.min(250, 10 * (2 ** attempt)));
    }
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
  const resolved = resolveStorePath(filePath, options.ownerId);
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

// ---------------------------------------------------------------------------
// ACID PostgreSQL backend for multi-tenant research_cases
// ---------------------------------------------------------------------------

function resolveDatabase(database) {
  return database || require('../db/client');
}

function isPgDatabase(database) {
  const db = resolveDatabase(database);
  return Boolean(db && db.isPg && db.pool);
}

async function ensurePgTable(pool) {
  if (!pool || initializedPools.has(pool)) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS research_cases (
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('inbox', 'pursue', 'pass')),
    payload JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, id),
    UNIQUE (owner_id, identity_key)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_research_cases_owner_updated ON research_cases (owner_id, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_research_cases_owner_state ON research_cases (owner_id, state)');
  initializedPools.add(pool);
}

async function runInPgTransaction(pool, fn) {
  const hasConnect = typeof pool.connect === 'function';
  const client = hasConnect ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    if (hasConnect && typeof client.release === 'function') {
      client.release();
    }
  }
}

function parsePgPayload(row) {
  if (!row) return null;
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : structuredClone(row.payload);
  if (Number.isInteger(row.revision)) payload.revision = row.revision;
  if (row.state) payload.state = row.state;
  return payload;
}

function rc() {
  return require('./research-cases');
}

function resolveTimestampIso(now) {
  const value = typeof now === 'function' ? now() : (now === undefined ? Date.now() : now);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    const { ResearchCaseError } = rc();
    throw new ResearchCaseError('RESEARCH_TIME_INVALID', 'A valid workspace time is required');
  }
  return date.toISOString();
}

function buildSafeListingSnapshot(listing) {
  const allowed = [
    'id', 'address', 'state', 'county', 'city', 'zip', 'source', 'sourceUrl', 'sourceObservedAt',
    'propType', 'status', 'openingBid', 'saleDate', 'deposit', 'occupancy', 'sqft', 'assessed', 'assessedValue',
    'estLow', 'estHigh', 'dealScore', 'redemptionDays', 'redemptionWarning', 'seniorLienRisk', 'seniorLienWarning', 'plaintiff', 'rawNotice', 'notes', 'hasIrsLien', 'hasFederalTaxLien', 'bankruptcy', 'hoaDues', 'monthlyHoa', 'titleRisk', 'judgment', 'judgmentAmount',
  ];
  const snapshot = {};
  for (const field of allowed) {
    const value = listing[field];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) snapshot[field] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) { try { snapshot[field] = JSON.parse(JSON.stringify(value)); } catch {} }
  }
  snapshot.provenance = {
    origin: listing.provenance?.origin === 'email_notice' ? 'email_notice' : 'live',
    observed: true,
    publisher: String(listing.provenance?.publisher || '').replace(/\s+/g, ' ').trim(),
    recordId: String(listing.provenance?.recordId || '').replace(/\s+/g, ' ').trim(),
    observedAt: new Date(listing.sourceObservedAt || listing.provenance?.observedAt).toISOString(),
  };
  return snapshot;
}

function buildPgHistoryEvent(type, item, timestamp, details = {}) {
  const { sha } = rc();
  return {
    id: `hevt_${sha({ type, caseId: item.id, revision: item.revision, timestamp, details }).slice(0, 24)}`,
    at: timestamp,
    type,
    revision: item.revision,
    state: item.state,
    ...details,
  };
}

function buildPgWorkspaceDossier(item) {
  const publisherClaims = (item.dossierSnapshot?.facts || []).filter((fact) => fact.evidenceClass === 'publisher_reported');
  const parcel = item.dossierSnapshot?.publicRecords?.parcel;
  const officialClaims = parcel?.status === 'matched'
    ? Object.entries(parcel.properties || {}).map(([key, value]) => ({
        key: `parcel.${key}`, value, evidenceClass: 'official_record', sourceUrl: parcel.source?.url || null,
      }))
    : [];
  return {
    ...structuredClone(item.dossierSnapshot),
    workspace: {
      caseId: item.id,
      caseRevision: item.revision,
      state: item.state,
      decision: item.decision,
      reconsideration: item.reconsideration,
      reconsiderationRequired: item.reconsiderationRequired,
      latestTrigger: item.latestTrigger || null,
      sourceRef: item.sourceRef,
      underwriteScenario: item.underwriteScenario || null,
    },
    claimGroups: { publisher: publisherClaims, official: officialClaims },
    reviewedEvidence: item.evidenceLinks.map((link) => ({ ...link, evidenceClass: 'reviewed_attachment', promotesFacts: false })),
  };
}

async function listCasesPg(database, ownerId, filters = {}) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const { STATES, ResearchCaseError, caseSummary } = rc();
  const limit = Math.max(1, Math.min(200, Math.floor(Number(filters.limit) || 50)));
  const offset = Math.max(0, Math.min(100000, Math.floor(Number(filters.offset) || 0)));
  if (filters.state && !STATES.has(filters.state)) throw new ResearchCaseError('RESEARCH_FILTER_INVALID', 'state filter is invalid');
  if (filters.sourceId && !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(filters.sourceId)) throw new ResearchCaseError('RESEARCH_FILTER_INVALID', 'sourceId filter is invalid');

  await ensurePgTable(db.pool);
  const params = [owner];
  let sql = 'SELECT payload, revision, state FROM research_cases WHERE owner_id = $1';
  if (filters.state) {
    params.push(filters.state);
    sql += ` AND state = $${params.length}`;
  }
  const result = await db.pool.query(sql, params);
  const eventPriority = { material_change: 0, new_match: 1, hunt_match: 2, evaluation_unknown: 3, browser_import: 4, manual: 5 };
  const deadline = (item) => {
    const value = Date.parse(item.listingSnapshot?.saleDate);
    return Number.isFinite(value) && value >= Date.now() ? value : Number.MAX_SAFE_INTEGER;
  };
  const items = (result.rows || [])
    .map(parsePgPayload)
    .filter((item) => !filters.sourceId || item.sourceRef?.sourceId === filters.sourceId)
    .filter((item) => !filters.listingId || item.listingId === filters.listingId || (item.listingAliases || []).includes(filters.listingId))
    .sort((left, right) => Number(right.reconsiderationRequired) - Number(left.reconsiderationRequired)
      || (eventPriority[left.origins?.[0]?.type] ?? 99) - (eventPriority[right.origins?.[0]?.type] ?? 99)
      || deadline(left) - deadline(right)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id));
  return { items: items.slice(offset, offset + limit).map(caseSummary), total: items.length, limit, offset };
}

async function getCasePg(database, ownerId, id) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const { ResearchCaseError } = rc();
  if (!CASE_ID.test(id || '')) throw new ResearchCaseError('RESEARCH_CASE_ID_INVALID', 'Research case id is invalid');
  await ensurePgTable(db.pool);
  const res = await db.pool.query(
    'SELECT payload, revision, state FROM research_cases WHERE owner_id = $1 AND id = $2',
    [owner, id]
  );
  if (!res.rows || res.rows.length === 0) {
    throw new ResearchCaseError('RESEARCH_CASE_NOT_FOUND', 'Research case was not found');
  }
  const item = parsePgPayload(res.rows[0]);
  const detail = structuredClone(item);
  detail.timeline = structuredClone(item.history);
  detail.latestTrigger = detail.latestTrigger || null;
  return { case: detail, dossier: buildPgWorkspaceDossier(item) };
}

async function buildPacketPg(database, ownerId, id) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const { ResearchCaseError, buildPacket } = rc();
  if (!CASE_ID.test(id || '')) throw new ResearchCaseError('RESEARCH_CASE_ID_INVALID', 'Research case id is invalid');
  await ensurePgTable(db.pool);
  const res = await db.pool.query(
    'SELECT payload, revision, state FROM research_cases WHERE owner_id = $1 AND id = $2',
    [owner, id]
  );
  if (!res.rows || res.rows.length === 0) {
    throw new ResearchCaseError('RESEARCH_CASE_NOT_FOUND', 'Research case was not found');
  }
  return buildPacket(parsePgPayload(res.rows[0]));
}

async function createCasePg(database, ownerId, input, options = {}) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const {
    ResearchCaseError,
    sourceRefFromListing,
    normalizeSourceRef,
    canonicalJson,
    identityKey,
    caseSummary,
    sanitizeUnderwriteScenario,
    sha,
  } = rc();
  if (!input || typeof input !== 'object' || !input.listing) {
    throw new ResearchCaseError('RESEARCH_INVALID', 'A validated listing is required');
  }
  const timestamp = resolveTimestampIso(options.now);
  const sourceRef = sourceRefFromListing(input.listing, timestamp);
  if (input.sourceRef) {
    const supplied = normalizeSourceRef(input.sourceRef);
    if (canonicalJson(supplied) !== canonicalJson(sourceRef)) {
      throw new ResearchCaseError('RESEARCH_SOURCE_REF_MISMATCH', 'sourceRef does not match the validated listing');
    }
  }
  const key = identityKey(sourceRef);
  const id = `rcase_${key.slice(0, 24)}`;
  const rawOrigin = input.origin == null ? { type: 'manual' } : input.origin;
  const originObservedAt = new Date(rawOrigin.observedAt || input.listing.sourceObservedAt || input.listing.provenance?.observedAt).toISOString();
  const origin = {
    type: rawOrigin.type,
    ...(rawOrigin.huntId ? { huntId: rawOrigin.huntId } : {}),
    ...(rawOrigin.eventId ? { eventId: rawOrigin.eventId } : {}),
    ...(rawOrigin.huntVersion != null ? { huntVersion: rawOrigin.huntVersion } : {}),
    observedAt: originObservedAt,
    ...(rawOrigin.changedFields ? { changedFields: rawOrigin.changedFields } : {}),
    ...(rawOrigin.changes ? { changes: rawOrigin.changes } : {}),
  };
  origin.id = `org_${sha(origin).slice(0, 20)}`;

  const listingSnapshot = buildSafeListingSnapshot(input.listing);
  const { buildPropertyDossier } = require('./dossier');
  const dossierSnapshot = JSON.parse(JSON.stringify(input.dossier || buildPropertyDossier(input.listing, { now: Date.parse(timestamp) })));

  await ensurePgTable(db.pool);
  return runInPgTransaction(db.pool, async (client) => {
    const existingRes = await client.query(
      'SELECT payload, revision, state FROM research_cases WHERE owner_id = $1 AND identity_key = $2 FOR UPDATE',
      [owner, key]
    );
    if (existingRes.rows && existingRes.rows.length > 0) {
      const existing = parsePgPayload(existingRes.rows[0]);
      const previousRevision = existing.revision;
      let changed = false;
      let listingAliasChange = null;
      const previousAliases = existing.listingAliases || [existing.listingId];
      const nextAliases = [...new Set([...previousAliases, listingSnapshot.id])].slice(-100);
      if (canonicalJson(previousAliases) !== canonicalJson(nextAliases)) {
        existing.listingAliases = nextAliases;
        listingAliasChange = {
          previousListingId: existing.listingId,
          currentListingId: listingSnapshot.id,
          canonicalListingId: existing.listingId,
        };
        changed = true;
      }
      const originAdded = !existing.origins.some((entry) => entry.id === origin.id);
      if (originAdded) {
        existing.origins.push(origin);
        existing.origins = existing.origins.slice(-100);
        changed = true;
      }
      const incomingObserved = Date.parse(listingSnapshot.sourceObservedAt || listingSnapshot.provenance.observedAt);
      const retainedObserved = Date.parse(existing.listingSnapshot?.sourceObservedAt || existing.listingSnapshot?.provenance?.observedAt);
      const sourceCheck = {
        basis: 'retained_inventory',
        checkedAt: timestamp,
        previousObservedAt: existing.listingSnapshot?.sourceObservedAt || existing.listingSnapshot?.provenance?.observedAt || null,
        observedAt: listingSnapshot.sourceObservedAt || listingSnapshot.provenance.observedAt,
        updated: Number.isFinite(incomingObserved) && (!Number.isFinite(retainedObserved) || incomingObserved > retainedObserved),
      };
      if (sourceCheck.updated) {
        const previousListingId = existing.listingId;
        existing.listingId = listingSnapshot.id;
        existing.address = listingSnapshot.address || existing.address;
        existing.listingSnapshot = listingSnapshot;
        existing.dossierSnapshot = dossierSnapshot;
        if (previousListingId !== existing.listingId) {
          listingAliasChange = { previousListingId, currentListingId: existing.listingId, canonicalListingId: existing.listingId };
        }
        changed = true;
      }
      let scenarioUpdated = false;
      if (input.underwriteScenario !== undefined) {
        const sanitized = sanitizeUnderwriteScenario(input.underwriteScenario);
        if (canonicalJson(existing.underwriteScenario || null) !== canonicalJson(sanitized)) {
          existing.underwriteScenario = sanitized;
          changed = true;
          scenarioUpdated = true;
        }
      }
      if (!changed) return { case: caseSummary(existing), created: false, sourceCheck };
      existing.revision += 1;
      existing.updatedAt = timestamp;
      if (listingAliasChange) existing.history.unshift(buildPgHistoryEvent('listing_alias_updated', existing, timestamp, listingAliasChange));
      if (scenarioUpdated) existing.history.unshift(buildPgHistoryEvent('underwrite_scenario_updated', existing, timestamp, { underwriteScenario: existing.underwriteScenario }));
      if (originAdded) existing.history.unshift(buildPgHistoryEvent('origin_recorded', existing, timestamp, { originId: origin.id }));
      existing.history = existing.history.slice(0, MAX_CASE_HISTORY);
      const upd = await client.query(
        `UPDATE research_cases
         SET listing_id = $3, state = $4, payload = $5::jsonb, revision = $6, updated_at = $7
         WHERE owner_id = $1 AND id = $2 AND revision = $8`,
        [owner, existing.id, existing.listingId, existing.state, JSON.stringify(existing), existing.revision, timestamp, previousRevision]
      );
      if (upd.rowCount === 0) {
        throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed concurrently; retry');
      }
      return { case: caseSummary(existing), created: false, sourceCheck };
    }

    const countRes = await client.query('SELECT COUNT(*)::int AS cnt FROM research_cases WHERE owner_id = $1', [owner]);
    if ((countRes.rows?.[0]?.cnt || 0) >= MAX_CASES) {
      throw new ResearchCaseError('RESEARCH_CASE_LIMIT', `No more than ${MAX_CASES} research cases may be stored`);
    }
    const item = {
      id,
      identityKey: key,
      sourceRef,
      listingId: listingSnapshot.id,
      listingAliases: [listingSnapshot.id],
      address: listingSnapshot.address || null,
      state: 'inbox',
      revision: 1,
      decision: null,
      reconsideration: null,
      reconsiderationRequired: false,
      latestTrigger: null,
      origins: [origin],
      evidenceLinks: [],
      listingSnapshot,
      dossierSnapshot,
      underwriteScenario: sanitizeUnderwriteScenario(input.underwriteScenario),
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [],
    };
    item.history.push(buildPgHistoryEvent('case_created', item, timestamp, { originId: origin.id }));
    await client.query(
      `INSERT INTO research_cases
        (id, owner_id, identity_key, listing_id, state, payload, revision, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [item.id, owner, item.identityKey, item.listingId, item.state, JSON.stringify(item), item.revision, timestamp, timestamp]
    );
    return { case: caseSummary(item), created: true };
  });
}

async function updateCasePg(database, ownerId, id, input, options = {}) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const {
    STATES,
    ResearchCaseError,
    normalizeReconsideration,
    sanitizeUnderwriteScenario,
    canonicalJson,
    caseSummary,
  } = rc();
  if (!CASE_ID.test(id || '')) throw new ResearchCaseError('RESEARCH_CASE_ID_INVALID', 'Research case id is invalid');
  if (!input || typeof input !== 'object' || !STATES.has(input.state)) {
    throw new ResearchCaseError('RESEARCH_DECISION_INVALID', 'state must be inbox, pursue, or pass');
  }
  const expectedRevision = input.expectedRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ResearchCaseError('RESEARCH_REVISION_REQUIRED', 'expectedRevision must be a positive integer');
  }
  const reasonInput = input.reasonCodes == null ? [] : input.reasonCodes;
  if (!Array.isArray(reasonInput) || reasonInput.length > 10 || reasonInput.some((c) => typeof c !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(c))) {
    throw new ResearchCaseError('RESEARCH_DECISION_INVALID', 'reasonCodes must contain up to 10 lowercase reason identifiers');
  }
  const reasonCodes = [...new Set(reasonInput)].sort();
  if (input.state === 'pass' && !reasonCodes.length) {
    throw new ResearchCaseError('RESEARCH_DECISION_INVALID', 'A pass decision requires at least one reason code');
  }
  const note = input.note == null || input.note === '' ? null : String(input.note).replace(/\s+/g, ' ').trim();
  if (input.state !== 'pass' && input.reconsideration != null) {
    throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', 'reconsideration is only available for a pass decision');
  }
  const reconsideration = input.state === 'pass' ? normalizeReconsideration(input.reconsideration) : null;
  const timestamp = resolveTimestampIso(options.now);

  await ensurePgTable(db.pool);
  return runInPgTransaction(db.pool, async (client) => {
    const res = await client.query(
      'SELECT payload, revision, state FROM research_cases WHERE owner_id = $1 AND id = $2 FOR UPDATE',
      [owner, id]
    );
    if (!res.rows || res.rows.length === 0) {
      throw new ResearchCaseError('RESEARCH_CASE_NOT_FOUND', 'Research case was not found');
    }
    const item = parsePgPayload(res.rows[0]);
    if (item.revision !== expectedRevision) {
      throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before saving', {
        expectedRevision,
        currentRevision: item.revision,
      });
    }
    const decision = input.state === 'inbox'
      ? null
      : { state: input.state, reasonCodes, note, decidedAt: timestamp, actor: owner, decidedOpeningBid: item.listingSnapshot?.openingBid ?? null };
    const scenarioChanged = input.underwriteScenario !== undefined
      && canonicalJson(item.underwriteScenario || null) !== canonicalJson(sanitizeUnderwriteScenario(input.underwriteScenario));
    if (item.state === input.state && canonicalJson(item.decision) === canonicalJson(decision)
      && canonicalJson(item.reconsideration) === canonicalJson(reconsideration) && !item.reconsiderationRequired && !scenarioChanged) {
      return caseSummary(item);
    }
    const previousState = item.state;
    item.state = input.state;
    item.decision = decision;
    item.reconsideration = reconsideration;
    if (scenarioChanged) item.underwriteScenario = sanitizeUnderwriteScenario(input.underwriteScenario);
    item.revision += 1;
    item.updatedAt = timestamp;
    item.reconsiderationRequired = false;
    item.latestTrigger = null;
    item.history.unshift(buildPgHistoryEvent('decision_changed', item, timestamp, { previousState, currentState: item.state, reasonCodes }));
    item.history = item.history.slice(0, MAX_CASE_HISTORY);

    const upd = await client.query(
      `UPDATE research_cases
       SET state = $3, payload = $4::jsonb, revision = $5, updated_at = $6
       WHERE owner_id = $1 AND id = $2 AND revision = $7`,
      [owner, id, item.state, JSON.stringify(item), item.revision, timestamp, expectedRevision]
    );
    if (upd.rowCount === 0) {
      throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before saving');
    }
    return caseSummary(item);
  });
}

async function linkEvidencePg(database, ownerId, id, evidence, input, options = {}) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const { ResearchCaseError, RELATIONSHIPS, INTAKE_ID, canonicalJson, caseSummary } = rc();
  if (!CASE_ID.test(id || '')) throw new ResearchCaseError('RESEARCH_CASE_ID_INVALID', 'Research case id is invalid');
  const expectedRevision = input?.expectedRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ResearchCaseError('RESEARCH_REVISION_REQUIRED', 'expectedRevision must be a positive integer');
  }
  if (!RELATIONSHIPS.has(input?.relationship)) throw new ResearchCaseError('RESEARCH_EVIDENCE_INVALID', 'Evidence relationship is invalid');
  if (!evidence || !INTAKE_ID.test(evidence.id || '') || evidence.review?.decision !== 'approved') {
    throw new ResearchCaseError('RESEARCH_EVIDENCE_NOT_APPROVED', 'Only an approved intake packet can be linked');
  }
  const link = {
    intakeId: evidence.id,
    relationship: input.relationship,
    sourceId: evidence.sourceId,
    sourceUrl: evidence.sourceUrl,
    capturedAt: evidence.capturedAt,
    reviewedAt: evidence.review.reviewedAt || null,
    contentSha256: evidence.content.sha256,
    contentBytes: evidence.content.bytes,
  };
  const timestamp = resolveTimestampIso(options.now);

  await ensurePgTable(db.pool);
  return runInPgTransaction(db.pool, async (client) => {
    const res = await client.query(
      'SELECT payload, revision, state FROM research_cases WHERE owner_id = $1 AND id = $2 FOR UPDATE',
      [owner, id]
    );
    if (!res.rows || res.rows.length === 0) {
      throw new ResearchCaseError('RESEARCH_CASE_NOT_FOUND', 'Research case was not found');
    }
    const item = parsePgPayload(res.rows[0]);
    if (item.revision !== expectedRevision) {
      throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before linking evidence', {
        expectedRevision,
        currentRevision: item.revision,
      });
    }
    const existing = item.evidenceLinks.find((entry) => entry.intakeId === link.intakeId);
    if (existing && canonicalJson(existing) === canonicalJson(link)) return caseSummary(item);
    item.evidenceLinks = [link, ...item.evidenceLinks.filter((entry) => entry.intakeId !== link.intakeId)].slice(0, 100);
    item.revision += 1;
    item.updatedAt = timestamp;
    item.history.unshift(buildPgHistoryEvent('evidence_linked', item, timestamp, { intakeId: link.intakeId, relationship: link.relationship }));
    item.history = item.history.slice(0, MAX_CASE_HISTORY);
    const upd = await client.query(
      `UPDATE research_cases
       SET payload = $3::jsonb, revision = $4, updated_at = $5
       WHERE owner_id = $1 AND id = $2 AND revision = $6`,
      [owner, id, JSON.stringify(item), item.revision, timestamp, expectedRevision]
    );
    if (upd.rowCount === 0) {
      throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before linking evidence');
    }
    return caseSummary(item);
  });
}

async function unlinkEvidencePg(database, ownerId, id, intakeId, input, options = {}) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const { ResearchCaseError, INTAKE_ID, caseSummary } = rc();
  if (!CASE_ID.test(id || '')) throw new ResearchCaseError('RESEARCH_CASE_ID_INVALID', 'Research case id is invalid');
  if (!INTAKE_ID.test(intakeId || '')) throw new ResearchCaseError('RESEARCH_EVIDENCE_INVALID', 'Evidence intake id is invalid');
  const expectedRevision = input?.expectedRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ResearchCaseError('RESEARCH_REVISION_REQUIRED', 'expectedRevision must be a positive integer');
  }
  const timestamp = resolveTimestampIso(options.now);

  await ensurePgTable(db.pool);
  return runInPgTransaction(db.pool, async (client) => {
    const res = await client.query(
      'SELECT payload, revision, state FROM research_cases WHERE owner_id = $1 AND id = $2 FOR UPDATE',
      [owner, id]
    );
    if (!res.rows || res.rows.length === 0) {
      throw new ResearchCaseError('RESEARCH_CASE_NOT_FOUND', 'Research case was not found');
    }
    const item = parsePgPayload(res.rows[0]);
    if (item.revision !== expectedRevision) {
      throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before unlinking evidence', {
        expectedRevision,
        currentRevision: item.revision,
      });
    }
    if (!item.evidenceLinks.some((entry) => entry.intakeId === intakeId)) {
      throw new ResearchCaseError('RESEARCH_EVIDENCE_NOT_FOUND', 'Evidence link was not found');
    }
    item.evidenceLinks = item.evidenceLinks.filter((entry) => entry.intakeId !== intakeId);
    item.revision += 1;
    item.updatedAt = timestamp;
    item.history.unshift(buildPgHistoryEvent('evidence_unlinked', item, timestamp, { intakeId }));
    item.history = item.history.slice(0, MAX_CASE_HISTORY);
    const upd = await client.query(
      `UPDATE research_cases
       SET payload = $3::jsonb, revision = $4, updated_at = $5
       WHERE owner_id = $1 AND id = $2 AND revision = $6`,
      [owner, id, JSON.stringify(item), item.revision, timestamp, expectedRevision]
    );
    if (upd.rowCount === 0) {
      throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before unlinking evidence');
    }
    return caseSummary(item);
  });
}

async function previewBrowserImportPg(database, ownerId, listingIds, options = {}) {
  const db = resolveDatabase(database);
  const owner = normalizeOwnerId(ownerId);
  const { ResearchCaseError, sourceRefFromListing, identityKey, sha } = rc();
  if (!db || typeof db.getListingById !== 'function') throw new TypeError('Browser import requires a listing database');
  if (!Array.isArray(listingIds) || listingIds.length < 1 || listingIds.length > 200) {
    throw new ResearchCaseError('RESEARCH_IMPORT_INVALID', 'listingIds must contain 1 to 200 identifiers');
  }
  const ids = [...new Set(listingIds.map((v) => String(v || '').trim()).filter(Boolean))];
  await ensurePgTable(db.pool);
  const existingRes = await db.pool.query('SELECT identity_key FROM research_cases WHERE owner_id = $1', [owner]);
  const existing = new Set((existingRes.rows || []).map((r) => r.identity_key));
  const accepted = [];
  const rejected = [];
  const ts = resolveTimestampIso(options.now);
  for (const listingId of ids) {
    try {
      const listing = await db.getListingById(listingId);
      if (!listing) { rejected.push({ listingId, reason: 'listing_not_found' }); continue; }
      const sourceRef = sourceRefFromListing(listing, ts);
      const key = identityKey(sourceRef);
      accepted.push({
        listingId,
        sourceRef,
        address: listing.address || null,
        state: listing.state || null,
        existing: existing.has(key),
        observedAt: listing.sourceObservedAt || listing.provenance?.observedAt,
      });
    } catch (error) {
      rejected.push({ listingId, reason: error instanceof ResearchCaseError ? error.code.toLowerCase() : 'listing_unavailable' });
    }
  }
  accepted.sort((a, b) => a.listingId.localeCompare(b.listingId));
  rejected.sort((a, b) => a.listingId.localeCompare(b.listingId));
  const basis = { listingIds: ids.slice().sort(), accepted, rejected };
  return {
    previewHash: sha(basis),
    total: ids.length,
    creatable: accepted.filter((item) => !item.existing).length,
    existing: accepted.filter((item) => item.existing).length,
    accepted,
    rejected,
  };
}

async function commitBrowserImportPg(database, ownerId, listingIds, previewHash, options = {}) {
  const db = resolveDatabase(database);
  const { ResearchCaseError } = rc();
  if (typeof previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(previewHash)) {
    throw new ResearchCaseError('RESEARCH_IMPORT_INVALID', 'A valid previewHash is required');
  }
  const preview = await previewBrowserImportPg(db, ownerId, listingIds, options);
  if (preview.previewHash !== previewHash) {
    throw new ResearchCaseError('RESEARCH_IMPORT_CHANGED', 'Browser import preview changed; review it again before committing', { preview });
  }
  const created = [];
  const existing = [];
  const { buildPropertyDossier } = require('./dossier');
  for (const candidate of preview.accepted) {
    const listing = await db.getListingById(candidate.listingId);
    const timestamp = resolveTimestampIso(options.now);
    const dossier = typeof options.buildDossier === 'function'
      ? await options.buildDossier(listing, timestamp)
      : buildPropertyDossier(listing, { now: Date.parse(timestamp) });
    const result = await createCasePg(db, ownerId, {
      listing,
      dossier,
      origin: { type: 'browser_import', observedAt: candidate.observedAt },
    }, options);
    (result.created ? created : existing).push(result.case);
  }
  return { previewHash, created, existing, rejected: preview.rejected };
}

module.exports = {
  CASE_ID,
  DEFAULT_STORE_PATH,
  MAX_CASES,
  MAX_CASE_HISTORY,
  MAX_STORE_BYTES,
  acquireOwnedLock,
  assertStoreShape,
  buildPacketPg,
  commitBrowserImportPg,
  createCasePg,
  emptyStore,
  ensurePgTable,
  getCasePg,
  isPgDatabase,
  linkEvidencePg,
  listCasesPg,
  loadStore,
  mutateStore,
  normalizeOwnerId,
  previewBrowserImportPg,
  releaseOwnedLock,
  resolveDatabase,
  resolveStorePath,
  replaceFileWithRetry,
  unlinkEvidencePg,
  updateCasePg,
};
