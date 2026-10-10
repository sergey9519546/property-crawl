'use strict';

// server/routes/saved-searches.js
//
// CRUD + alerts run for the saved-searches feature.
//
//   GET    /api/saved-searches          list the user's saved searches
//   POST   /api/saved-searches          create one
//   PATCH  /api/saved-searches/:id      update label/filters/isActive
//   DELETE /api/saved-searches/:id      remove
//
//   GET    /api/saved-searches/:id/run  run the search against the
//                                       live listing pool right now and
//                                       persist any new matches
//   GET    /api/alerts/matches          list alert_matches for the user
//   POST   /api/alerts/matches          mark a batch read
//
// Auth: same workspace-identity gate as the existing /api/alerts route.
// Cursor: "<matchedAtISO>|<matchId>" — pipe only; underscore is invalid.

const db = require('../db/client');
const { scanAllListings } = require('../db/listings-scan');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
const { runAlertsForUser } = require('../intelligence/alerts-runner');

// Pagination bounds for GET /api/alerts/matches.
const ALERT_MATCHES_DEFAULT_LIMIT = 50;
const ALERT_MATCHES_MAX_LIMIT = 200;

// Element length was always capped; the COUNT was not. A 2MB body can hold
// ~30k 64-character strings, and filters.keywords is persisted as jsonb, so a
// single saved search could be made arbitrarily large. Cap the count too.
const MAX_STRING_ARRAY_LENGTH = 100;
const MAX_MARK_READ_IDS = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isStringArray(value, maxLen = 64) {
  return Array.isArray(value)
    && value.length <= MAX_STRING_ARRAY_LENGTH
    && value.every((v) => typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen);
}

function isString(value, maxLen = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

function validateFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return { ok: false, reason: 'filters_must_be_object' };
  }
  if ('states' in filters && !isStringArray(filters.states, 8)) {
    return { ok: false, reason: 'states_must_be_array_of_state_codes' };
  }
  if ('sources' in filters && !isStringArray(filters.sources, 32)) {
    return { ok: false, reason: 'sources_must_be_array_of_strings' };
  }
  if ('propTypes' in filters && !isStringArray(filters.propTypes, 64)) {
    return { ok: false, reason: 'propTypes_must_be_array_of_strings' };
  }
  if ('keywords' in filters && !isStringArray(filters.keywords, 64)) {
    return { ok: false, reason: 'keywords_must_be_array_of_strings' };
  }
  for (const numericKey of ['minScore', 'maxBid', 'minEquity']) {
    if (numericKey in filters) {
      const n = Number(filters[numericKey]);
      if (!Number.isFinite(n)) return { ok: false, reason: `${numericKey}_must_be_finite_number` };
    }
  }
  for (const enumKey of ['occupancy', 'seniorLien', 'redemption']) {
    if (enumKey in filters && !isString(filters[enumKey], 32)) {
      return { ok: false, reason: `${enumKey}_must_be_string` };
    }
  }
  if ('webhookUrl' in filters) {
    if (filters.webhookUrl !== null && filters.webhookUrl !== undefined && filters.webhookUrl !== '') {
      if (typeof filters.webhookUrl !== 'string' || !/^https?:\/\/.+/i.test(filters.webhookUrl.trim()) || filters.webhookUrl.trim().length > 512) {
        return { ok: false, reason: 'webhookUrl_must_be_valid_http_url' };
      }
    }
  }
  return { ok: true };
}

function serializeSearch(record) {
  if (!record) return null;
  return {
    id: record.id,
    label: record.label,
    filters: record.filters,
    webhookUrl: record.filters?.webhookUrl || null,
    isActive: record.isActive,
    lastRunAt: record.lastRunAt,
    lastMatchCount: record.lastMatchCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function parseAlertCursor(cursor) {
  if (cursor == null || cursor === '') return { ok: true, value: null };
  if (typeof cursor !== 'string') return { ok: false, error: 'invalid_cursor' };
  const sepIdx = cursor.indexOf('|');
  if (sepIdx <= 0 || sepIdx === cursor.length - 1) {
    return { ok: false, error: 'invalid_cursor' };
  }
  const matchedAt = cursor.slice(0, sepIdx);
  const id = cursor.slice(sepIdx + 1).trim();
  if (!id) return { ok: false, error: 'invalid_cursor' };
  if (!/^\d{4}-\d{2}-\d{2}T/.test(matchedAt)) {
    return { ok: false, error: 'invalid_cursor' };
  }
  const parsed = Date.parse(matchedAt);
  if (!Number.isFinite(parsed)) return { ok: false, error: 'invalid_cursor' };
  return { ok: true, value: cursor };
}

function unwrapAlertMatches(result) {
  if (Array.isArray(result)) {
    return { matches: result, nextCursor: null };
  }
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const nextCursor = result?.nextCursor == null ? null : String(result.nextCursor);
  return { matches, nextCursor };
}

// A saved search is a standing claim that the user wants to hear about every
// listing matching it. Running it against a 1,000-row slice means the alert
// silently covers ~10% of the inventory and reports `scanned: 1000`, which a
// reader takes for the size of the search.
async function runSearchAgainstPool(database, search) {
  const { pool, scanned, availableTotal, truncated } = await scanAllListings(database);
  const { matchListingAgainstSearch } = require('../intelligence/saved-search-alerts');
  const matchingIds = [];
  for (const listing of pool) {
    const verdict = matchListingAgainstSearch(listing, search);
    if (verdict.match) matchingIds.push(listing.id);
  }
  const scope = { scanned, availableTotal, truncated };
  if (matchingIds.length === 0) {
    return { newMatches: 0, ...scope };
  }
  const records = await database.recordAlertMatches(search.userId, search.id, matchingIds);
  return { newMatches: records.length, ...scope };
}

function createSavedSearchesHandler(dependencies = {}) {
  const database = dependencies.database || db;

  async function handleSavedSearches(req, res, urlInput) {
    const method = String(req?.method || '').toUpperCase();
    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);

    const userId = requireWorkspaceIdentity(req, res);
    if (!userId) return;
    res.setHeader('Cache-Control', 'no-store');

    // /api/saved-searches — list / create
    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'saved-searches') {
      if (method === 'GET') {
        const searches = await database.listSavedSearches(userId);
        // A workspace store that failed to load returns no searches, which is
        // indistinguishable from the user having none. Say so here - this is the
        // response the UI reads, so it is the only place the user will see it.
        return res.json({
          userId,
          count: searches.length,
          searches: searches.map(serializeSearch),
          ...(database.workspaceStoreError ? {
            storeError: database.workspaceStoreError,
            ...(database.workspaceStoreQuarantined
              ? { storeQuarantinedTo: database.workspaceStoreQuarantined }
              : {}),
            ...(database._workspaceStoreWriteBlocked ? { writesBlocked: true } : {}),
          } : {}),
        });
      }
      if (method === 'POST') {
        const body = req.body || {};
        const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : null;
        const verdict = validateFilters(body.filters);
        if (!verdict.ok) return res.status(400).json({ error: verdict.reason });
        const record = await database.createSavedSearch(userId, { label, filters: body.filters });
        return res.status(201).json(serializeSearch(record));
      }
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    // /api/saved-searches/:id  or  /api/saved-searches/:id/run
    if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'saved-searches') {
      const id = segments[2];
      const action = segments[3];
      if (action === 'run' && method === 'GET') {
        const search = await database.getSavedSearchById(userId, id);
        if (!search) return res.status(404).json({ error: 'saved_search_not_found' });
        const result = await runSearchAgainstPool(database, search);
        return res.json({
          searchId: id,
          label: search.label,
          newMatches: result.newMatches,
          scanned: result.scanned,
          // scanned alone reads as "this is how much there is". These say how
          // much of it the search actually looked at.
          availableTotal: result.availableTotal,
          truncated: result.truncated
        });
      }
      if (action === undefined && method === 'PATCH') {
        const body = req.body || {};
        const updates = {};
        if (typeof body.label === 'string') updates.label = body.label.trim().slice(0, 120);
        if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
        if (body.filters !== undefined) {
          const verdict = validateFilters(body.filters);
          if (!verdict.ok) return res.status(400).json({ error: verdict.reason });
          updates.filters = body.filters;
        }
        const updated = await database.updateSavedSearch(userId, id, updates);
        if (!updated) return res.status(404).json({ error: 'saved_search_not_found' });
        return res.json(serializeSearch(updated));
      }
      if (action === undefined && method === 'DELETE') {
        const ok = await database.deleteSavedSearch(userId, id);
        if (!ok) return res.status(404).json({ error: 'saved_search_not_found' });
        return res.json({ success: true, id });
      }
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    return res.status(404).json({ error: 'not_found' });
  }

  async function handleAlertMatches(req, res, urlInput) {
    const method = String(req?.method || '').toUpperCase();
    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);

    const userId = requireWorkspaceIdentity(req, res);
    if (!userId) return;
    res.setHeader('Cache-Control', 'no-store');

    if (segments.length !== 3 || segments[0] !== 'api' || segments[1] !== 'alerts' || segments[2] !== 'matches') {
      return res.status(404).json({ error: 'not_found' });
    }

    if (method === 'GET') {
      const onlyUnread = url.searchParams.get('onlyUnread') === 'true';
      const rawLimit = Number(url.searchParams.get('limit'));
      const requested = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : ALERT_MATCHES_DEFAULT_LIMIT;
      const limit = Math.min(ALERT_MATCHES_MAX_LIMIT, requested);
      const parsedCursor = parseAlertCursor(url.searchParams.get('cursor'));
      if (!parsedCursor.ok) {
        return res.status(400).json({ error: parsedCursor.error || 'invalid_cursor' });
      }

      const result = await database.listAlertMatches(userId, {
        onlyUnread,
        limit,
        cursor: parsedCursor.value
      });
      const { matches, nextCursor } = unwrapAlertMatches(result);

      return res.json({
        userId,
        onlyUnread,
        count: matches.length,
        matches,
        nextCursor
      });
    }

    if (method === 'POST') {
      const body = req.body || {};
      const action = typeof body.action === 'string' ? body.action : 'mark_read';
      if (action !== 'mark_read') return res.status(400).json({ error: 'unsupported_action' });
      // These reach `id = ANY($2::uuid[])`, so they are capped in count and
      // shape-checked. Without both, a device-scoped caller could drive a
      // multi-megabyte single statement, and a single non-UUID string would
      // abort the whole cast and return a 500 instead of a 400.
      const requestedIds = Array.isArray(body.matchIds)
        ? body.matchIds
        : (Array.isArray(body.ids) ? body.ids : []);
      if (requestedIds.length > MAX_MARK_READ_IDS) {
        return res.status(400).json({ error: 'too_many_match_ids', max: MAX_MARK_READ_IDS });
      }
      const ids = requestedIds.filter((v) => typeof v === 'string' && UUID_PATTERN.test(v));
      if (ids.length === 0) return res.status(400).json({ error: 'matchIds_required' });
      const marked = await database.markAlertMatchesRead(userId, ids);
      const markedRead = typeof marked === 'number' ? marked : (Array.isArray(marked) ? marked.length : 0);
      return res.json({ success: true, markedRead });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  }

  return {
    handleSavedSearches,
    handleAlertMatches
  };
}

module.exports = {
  createSavedSearchesHandler,
  validateFilters,
  serializeSearch
};
