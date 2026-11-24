'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID: cryptoRandomUUID } = require('crypto');
const { LISTING_SELECT } = require('./listing-sql-constants');
const {
  ALERT_MATCHES_DEFAULT_LIMIT,
  finiteOrNull,
  clampAlertMatchesLimit,
  isoOrNull,
  mapPgListingRow,
} = require('./listing-normalizers');

const WORKSPACE_STORE_VERSION = 1;

function loadWorkspaceStore(client) {
  if (!client.workspaceStorePath) return;
  if (!fs.existsSync(client.workspaceStorePath)) return;
  const raw = fs.readFileSync(client.workspaceStorePath, 'utf8');
  const data = JSON.parse(raw);
  if (data.version !== WORKSPACE_STORE_VERSION) {
    throw new Error(`Workspace store version mismatch (expected ${WORKSPACE_STORE_VERSION}, got ${data.version}); preserved existing data.`);
    // Version mismatch throws to trigger quarantine
  }
  if (data.savedSearches && typeof data.savedSearches === 'object') {
    for (const [id, record] of Object.entries(data.savedSearches)) {
      client.inMemoryData.savedSearches.set(id, record);
    }
  }
  if (data.alertMatches && typeof data.alertMatches === 'object') {
    for (const [id, record] of Object.entries(data.alertMatches)) {
      client.inMemoryData.alertMatches.set(id, record);
    }
  }
  client._workspaceStoreLoaded = true;
  console.log(`[DB] Loaded ${client.inMemoryData.savedSearches.size} saved searches, ${client.inMemoryData.alertMatches.size} alert matches from workspace store`);
}

function quarantineWorkspaceStore(client) {
  if (!client.workspaceStorePath) return null;
  try {
    if (!fs.existsSync(client.workspaceStorePath)) return null;
    const quarantined = `${client.workspaceStorePath}.corrupt-${Date.now()}`;
    fs.renameSync(client.workspaceStorePath, quarantined);
    client.workspaceStoreQuarantined = quarantined;
    console.warn(`[DB] Unreadable workspace store moved aside to ${quarantined}; nothing was overwritten.`);
    return quarantined;
  } catch (err) {
    client._workspaceStoreWriteBlocked = true;
    console.warn('[DB] Could not set the unreadable workspace store aside; writes are now blocked to avoid destroying it:', err.message);
    return null;
  }
}

function persistWorkspaceStore(client) {
  if (!client.workspaceStorePath || client.isPg) return;
  if (client._workspaceStoreWriteBlocked) {
    console.warn('[DB] Persist refused: the workspace store is unreadable and was not set aside; writing would destroy it.');
    return;
  }
  try {
    fs.mkdirSync(path.dirname(client.workspaceStorePath), { recursive: true });
    const body = JSON.stringify({
      version: WORKSPACE_STORE_VERSION,
      updatedAt: new Date().toISOString(),
      savedSearches: Object.fromEntries(client.inMemoryData.savedSearches),
      alertMatches: Object.fromEntries(client.inMemoryData.alertMatches)
    });
    const tempPath = client.workspaceStorePath + '.' + cryptoRandomUUID() + '.tmp';
    try {
      fs.writeFileSync(tempPath, body, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tempPath, client.workspaceStorePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
    client._workspaceStoreDirty = false;
  } catch (err) {
    console.warn('[DB] Failed to persist workspace store:', err.message);
  }
}

function triggerWorkspacePersist(client) {
  if (typeof client._persistWorkspaceStore === 'function') {
    client._persistWorkspaceStore();
  } else {
    persistWorkspaceStore(client);
  }
}

function serializeSavedSearch(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    filters: row.filters,
    isActive: row.is_active,
    lastRunAt: row.last_run_at,
    lastMatchCount: row.last_match_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeAlertMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    searchId: row.search_id,
    userId: row.user_id,
    listingId: row.listing_id,
    matchedAt: row.matched_at,
    readAt: row.read_at
  };
}

async function getSavedDeals(client, userId) {
  if (client.isPg) {
    const res = await client.pool.query(
      `SELECT
         l.*,
         sd.notes,
         sd.created_at AS "savedAt"
       FROM saved_deals sd
       JOIN (SELECT ${LISTING_SELECT} FROM listings) l ON sd.listing_id = l.id
       WHERE sd.user_id = $1
       ORDER BY l."saleDate" ASC NULLS LAST`,
      [userId]
    );
    return res.rows.map(mapPgListingRow);
  }
  client.refreshLiveCache();
  const ids = client.inMemoryData.savedDeals.get(userId) || new Set();
  return client.inMemoryData.listings.filter(l => ids.has(l.id));
}

async function saveDeal(client, userId, listingId) {
  if (client.isPg) {
    await client.pool.query(
      `INSERT INTO saved_deals (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, listingId]
    );
    return true;
  }
  if (!client.inMemoryData.savedDeals.has(userId)) {
    client.inMemoryData.savedDeals.set(userId, new Set());
  }
  client.inMemoryData.savedDeals.get(userId).add(listingId);
  return true;
}

async function removeSavedDeal(client, userId, listingId) {
  if (client.isPg) {
    await client.pool.query(`DELETE FROM saved_deals WHERE user_id = $1 AND listing_id = $2`, [userId, listingId]);
    return true;
  }
  if (client.inMemoryData.savedDeals.has(userId)) {
    client.inMemoryData.savedDeals.get(userId).delete(listingId);
  }
  return true;
}

async function createSavedSearch(client, userId, { label, filters }) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');
  if (!filters || typeof filters !== 'object') throw new Error('filters required');
  const safeLabel = typeof label === 'string' ? label.trim().slice(0, 120) : null;
  const nowIso = new Date().toISOString();
  if (client.isPg) {
    const res = await client.pool.query(
      `INSERT INTO saved_searches (user_id, label, filters, is_active, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, TRUE, NOW(), NOW())
       RETURNING id, user_id, label, filters, is_active, last_run_at, last_match_count, created_at, updated_at`,
      [userId, safeLabel, JSON.stringify(filters)]
    );
    const row = res.rows[0];
    return serializeSavedSearch(row);
  }
  const id = cryptoRandomUUID();
  const record = {
    id,
    userId,
    label: safeLabel,
    filters,
    isActive: true,
    lastRunAt: null,
    lastMatchCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  client.inMemoryData.savedSearches.set(id, record);
  triggerWorkspacePersist(client);
  return record;
}

async function listSavedSearchUserIds(client) {
  if (client.isPg) {
    const res = await client.pool.query('SELECT DISTINCT user_id FROM saved_searches WHERE is_active = TRUE');
    return res.rows.map((row) => row.user_id);
  }
  const ids = new Set();
  for (const record of client.inMemoryData.savedSearches.values()) if (record.isActive) ids.add(record.userId);
  return [...ids];
}

async function listSavedSearches(client, userId, { includeInactive = false } = {}) {
  if (client.isPg) {
    const sql = includeInactive
      ? `SELECT * FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC`
      : `SELECT * FROM saved_searches WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC`;
    const res = await client.pool.query(sql, [userId]);
    return res.rows.map((row) => serializeSavedSearch(row));
  }
  const out = [];
  for (const record of client.inMemoryData.savedSearches.values()) {
    if (record.userId !== userId) continue;
    if (!includeInactive && !record.isActive) continue;
    out.push(record);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

async function getSavedSearchById(client, userId, id) {
  if (client.isPg) {
    const res = await client.pool.query(
      `SELECT * FROM saved_searches WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.rows[0] ? serializeSavedSearch(res.rows[0]) : null;
  }
  const record = client.inMemoryData.savedSearches.get(id);
  if (!record || record.userId !== userId) return null;
  return record;
}

async function updateSavedSearch(client, userId, id, updates) {
  const record = await getSavedSearchById(client, userId, id);
  if (!record) return null;
  const allowed = {};
  if (typeof updates.label === 'string') allowed.label = updates.label.trim().slice(0, 120);
  if (typeof updates.isActive === 'boolean') allowed.isActive = updates.isActive;
  if (updates.filters && typeof updates.filters === 'object') allowed.filters = updates.filters;
  if (client.isPg) {
    const fields = [];
    const params = [];
    let i = 1;
    if ('label' in allowed) { fields.push(`label = $${i++}`); params.push(allowed.label); }
    if ('isActive' in allowed) { fields.push(`is_active = $${i++}`); params.push(allowed.isActive); }
    if ('filters' in allowed) { fields.push(`filters = $${i++}::jsonb`); params.push(JSON.stringify(allowed.filters)); }
    if (!fields.length) return record;
    fields.push(`updated_at = NOW()`);
    params.push(id, userId);
    const res = await client.pool.query(
      `UPDATE saved_searches SET ${fields.join(', ')} WHERE id = $${i++} AND user_id = $${i++} RETURNING *`,
      params
    );
    return res.rows[0] ? serializeSavedSearch(res.rows[0]) : null;
  }
  const stored = client.inMemoryData.savedSearches.get(id);
  Object.assign(stored, allowed, { updatedAt: new Date().toISOString() });
  triggerWorkspacePersist(client);
  return stored;
}

async function deleteSavedSearch(client, userId, id) {
  if (client.isPg) {
    // ON DELETE CASCADE on alert_matches cleans up the join table.
    const res = await client.pool.query(
      `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.rowCount > 0;
  }
  const record = client.inMemoryData.savedSearches.get(id);
  if (!record || record.userId !== userId) return false;
  client.inMemoryData.savedSearches.delete(id);
  // Cascade: drop alert_matches for this search
  for (const [matchId, match] of client.inMemoryData.alertMatches) {
    if (match.searchId === id) client.inMemoryData.alertMatches.delete(matchId);
  }
  triggerWorkspacePersist(client);
  return true;
}

async function recordAlertMatches(client, userId, searchId, listingIds) {
  if (!Array.isArray(listingIds) || listingIds.length === 0) return [];
  if (client.isPg) {
    const ids = [];
    for (const listingId of listingIds) {
      const res = await client.pool.query(
        `INSERT INTO alert_matches (search_id, user_id, listing_id, matched_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (search_id, listing_id) DO NOTHING
         RETURNING id, search_id, user_id, listing_id, matched_at, read_at`,
        [searchId, userId, listingId]
      );
      if (res.rows[0]) ids.push(serializeAlertMatch(res.rows[0]));
    }
    await client.pool.query(
      `UPDATE saved_searches SET last_run_at = NOW(), last_match_count = $2 WHERE id = $1`,
      [searchId, ids.length]
    );
    return ids;
  }
  const nowIso = new Date().toISOString();
  const out = [];
  for (const listingId of listingIds) {
    // Idempotency key: (searchId, listingId)
    const existing = [...client.inMemoryData.alertMatches.values()].find(
      (m) => m.searchId === searchId && m.listingId === listingId
    );
    if (existing) continue;
    const match = {
      id: cryptoRandomUUID(),
      searchId,
      userId,
      listingId,
      matchedAt: nowIso,
      readAt: null
    };
    client.inMemoryData.alertMatches.set(match.id, match);
    out.push(match);
  }
  const stored = client.inMemoryData.savedSearches.get(searchId);
  if (stored) {
    stored.lastRunAt = nowIso;
    stored.lastMatchCount = out.length;
    stored.updatedAt = nowIso;
  }
  triggerWorkspacePersist(client);
  return out;
}

async function listAlertMatches(client, userId, { onlyUnread = false, limit = ALERT_MATCHES_DEFAULT_LIMIT, cursor } = {}) {
  if (client.isPg) {
    const conditions = ['user_id = $1'];
    const params = [userId];
    let paramIdx = 2;

    if (onlyUnread) {
      conditions.push('read_at IS NULL');
    }
    if (cursor) {
      // cursor format: "<matchedAtISO>|<id>"
      const sepIdx = cursor.indexOf('|');
      if (sepIdx > 0) {
        const cursorDate = cursor.slice(0, sepIdx);
        const cursorId = cursor.slice(sepIdx + 1);
        conditions.push(`(matched_at < $${paramIdx} OR (matched_at = $${paramIdx} AND id < $${paramIdx + 1}))`);
        params.push(cursorDate, cursorId);
        paramIdx += 2;
      }
    }

    const where = conditions.join(' AND ');
    const effectiveLimit = clampAlertMatchesLimit(limit);
    // Fetch one extra row to detect whether there is a next page
    const sql = `SELECT * FROM alert_matches WHERE ${where} ORDER BY matched_at DESC, id DESC LIMIT $${paramIdx}`;
    const res = await client.pool.query(sql, [...params, effectiveLimit + 1]);
    const rows = res.rows.map((row) => serializeAlertMatch(row));

    const hasMore = rows.length > effectiveLimit;
    const page = hasMore ? rows.slice(0, effectiveLimit) : rows;
    const nextCursor = hasMore && page.length > 0
      ? `${page[page.length - 1].matchedAt}|${page[page.length - 1].id}`
      : null;

    return { matches: page, nextCursor };
  }

  // In-memory path
  const out = [];
  for (const match of client.inMemoryData.alertMatches.values()) {
    if (match.userId !== userId) continue;
    if (onlyUnread && match.readAt) continue;
    out.push(match);
  }
  // Same order as the SQL above: matched_at DESC, id DESC.
  out.sort(
    (a, b) => b.matchedAt.localeCompare(a.matchedAt) || String(b.id).localeCompare(String(a.id)),
  );

  if (cursor) {
    const sepIdx = cursor.indexOf('|');
    if (sepIdx > 0) {
      const cursorDate = cursor.slice(0, sepIdx);
      const cursorId = cursor.slice(sepIdx + 1);
      const pivot = out.findIndex(
        (m) => m.matchedAt === cursorDate && m.id === cursorId
      );
      if (pivot >= 0) {
        out.splice(0, pivot + 1);
      }
    }
  }

  const effectiveLimit = clampAlertMatchesLimit(limit);
  const hasMore = out.length > effectiveLimit;
  const page = hasMore ? out.slice(0, effectiveLimit) : out;
  const nextCursor = hasMore && page.length > 0
    ? `${page[page.length - 1].matchedAt}|${page[page.length - 1].id}`
    : null;

  return { matches: page, nextCursor };
}

async function markAlertMatchesRead(client, userId, matchIds) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) return 0;
  const nowIso = new Date().toISOString();
  if (client.isPg) {
    const res = await client.pool.query(
      `UPDATE alert_matches SET read_at = NOW()
       WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
      [userId, matchIds]
    );
    return res.rowCount;
  }
  let count = 0;
  for (const id of matchIds) {
    const match = client.inMemoryData.alertMatches.get(id);
    if (match && match.userId === userId && !match.readAt) {
      match.readAt = nowIso;
      count += 1;
    }
  }
  if (count > 0) triggerWorkspacePersist(client);
  return count;
}

async function recordListingHistorySnapshots(client, listings, options = {}) {
  if (!Array.isArray(listings) || listings.length === 0) return 0;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  let recorded = 0;
  if (client.isPg) {
    const seen = new Set();
    const rows = [];
    for (const listing of listings) {
      if (!listing || typeof listing !== 'object' || !listing.id) continue;
      const sourceObservedAt = listing.sourceObservedAt || listing.provenance?.observedAt;
      if (!sourceObservedAt) continue;
      const id = String(listing.id);
      const obs = String(sourceObservedAt);
      const dedupKey = `${id}\0${obs}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      rows.push({
        id,
        sourceObservedAt: obs,
        openingBid: finiteOrNull(listing.openingBid),
        mid: finiteOrNull(listing.mid),
        dealScore: finiteOrNull(listing.dealScore),
        source: typeof listing.source === 'string' ? listing.source.slice(0, 64) : null,
      });
    }
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const res = await client.pool.query(
        `INSERT INTO listing_history (listing_id, source_observed_at, opening_bid, mid, deal_score, source)
         SELECT * FROM UNNEST($1::text[], $2::timestamptz[], $3::numeric[], $4::numeric[], $5::numeric[], $6::text[])
         ON CONFLICT (listing_id, source_observed_at) DO NOTHING
         RETURNING id`,
        [
          batch.map((r) => r.id),
          batch.map((r) => r.sourceObservedAt),
          batch.map((r) => r.openingBid),
          batch.map((r) => r.mid),
          batch.map((r) => r.dealScore),
          batch.map((r) => r.source),
        ]
      );
      recorded += res.rows.length;
    }
    return recorded;
  }
  // In-memory path
  for (const listing of listings) {
    if (!listing || typeof listing !== 'object' || !listing.id) continue;
    const sourceObservedAt = listing.sourceObservedAt || listing.provenance?.observedAt;
    if (!sourceObservedAt) continue;
    const arr = client.inMemoryData.listingHistory.get(listing.id) || [];
    // Idempotency: skip if (listingId, sourceObservedAt) already exists
    const exists = arr.some((s) => s.sourceObservedAt === sourceObservedAt);
    if (exists) continue;
    arr.push({
      listingId: listing.id,
      sourceObservedAt,
      openingBid: finiteOrNull(listing.openingBid),
      mid: finiteOrNull(listing.mid),
      dealScore: finiteOrNull(listing.dealScore),
      source: typeof listing.source === 'string' ? listing.source : null,
      recordedAt: new Date(nowMs).toISOString()
    });
    // Most-recent-first ordering
    arr.sort((a, b) => b.sourceObservedAt.localeCompare(a.sourceObservedAt));
    client.inMemoryData.listingHistory.set(listing.id, arr);
    recorded += 1;
  }
  return recorded;
}

async function getListingHistory(client, listingIds, options = {}) {
  const ids = Array.isArray(listingIds) ? listingIds.filter((id) => typeof id === 'string' && id.trim()) : [];
  if (ids.length === 0) return new Map();
  const result = new Map();
  const prior = Boolean(options && (options.prior === true || options.penultimate === true));
  if (client.isPg) {
    const historySql = prior
      ? `WITH ranked AS (
           SELECT
             listing_id,
             source_observed_at::text AS "sourceObservedAt",
             opening_bid::float8 AS "openingBid",
             mid::float8         AS "mid",
             deal_score::float8  AS "dealScore",
             source,
             recorded_at::text   AS "recordedAt",
             ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY source_observed_at DESC) as rn
           FROM listing_history
           WHERE listing_id = ANY($1::text[])
         )
         SELECT listing_id, "sourceObservedAt", "openingBid", "mid", "dealScore", source, "recordedAt"
         FROM ranked
         WHERE rn = 2
         ORDER BY listing_id`
      : `SELECT DISTINCT ON (listing_id)
           listing_id,
           source_observed_at::text AS "sourceObservedAt",
           opening_bid::float8 AS "openingBid",
           mid::float8         AS "mid",
           deal_score::float8  AS "dealScore",
           source,
           recorded_at::text   AS "recordedAt"
        FROM listing_history
        WHERE listing_id = ANY($1::text[])
        ORDER BY listing_id, source_observed_at DESC`;
    const res = await client.pool.query(historySql, [ids]);
    for (const row of res.rows) {
      result.set(row.listing_id, {
        listingId: row.listing_id,
        sourceObservedAt: isoOrNull(row.sourceObservedAt),
        openingBid: finiteOrNull(row.openingBid),
        mid: finiteOrNull(row.mid),
        dealScore: finiteOrNull(row.dealScore),
        source: typeof row.source === 'string' ? row.source : null,
        recordedAt: isoOrNull(row.recordedAt)
      });
    }
    return result;
  }
  for (const id of ids) {
    const arr = client.inMemoryData.listingHistory.get(id);
    if (!arr || arr.length === 0) continue;
    if (prior) { if (arr.length >= 2) result.set(id, arr[1]); } else { result.set(id, arr[0]); }
  }
  return result;
}

module.exports = {
  WORKSPACE_STORE_VERSION,
  loadWorkspaceStore,
  quarantineWorkspaceStore,
  persistWorkspaceStore,
  serializeSavedSearch,
  serializeAlertMatch,
  getSavedDeals,
  saveDeal,
  removeSavedDeal,
  createSavedSearch,
  listSavedSearchUserIds,
  listSavedSearches,
  getSavedSearchById,
  updateSavedSearch,
  deleteSavedSearch,
  recordAlertMatches,
  listAlertMatches,
  markAlertMatchesRead,
  recordListingHistorySnapshots,
  getListingHistory,
};
