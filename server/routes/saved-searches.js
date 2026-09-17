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
//   POST   /api/alerts/matches/read     mark a batch read
//
// Auth: same workspace-identity gate as the existing /api/alerts route.

const db = require('../db/client');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
const { runAlertsForUser } = require('../intelligence/alerts-runner');

function isStringArray(value, maxLen = 64) {
  return Array.isArray(value)
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
  return { ok: true };
}

function serializeSearch(record) {
  if (!record) return null;
  return {
    id: record.id,
    label: record.label,
    filters: record.filters,
    isActive: record.isActive,
    lastRunAt: record.lastRunAt,
    lastMatchCount: record.lastMatchCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function runSearchAgainstPool(database, search) {
  const inventory = await database.getListings({ limit: 1000 });
  const pool = Array.isArray(inventory?.listings) ? inventory.listings : [];
  // We piggy-back on runAlertsForUser so the persistence side stays
  // consistent. The userId/scope is the search owner — only the
  // recordAlertMatches path matters here.
  const { matchListingAgainstSearch } = require('../intelligence/saved-search-alerts');
  const matchingIds = [];
  for (const listing of pool) {
    const verdict = matchListingAgainstSearch(listing, search);
    if (verdict.match) matchingIds.push(listing.id);
  }
  if (matchingIds.length === 0) {
    return { newMatches: 0, scanned: pool.length };
  }
  const records = await database.recordAlertMatches(search.userId, search.id, matchingIds);
  return { newMatches: records.length, scanned: pool.length };
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
        return res.json({ userId, count: searches.length, searches: searches.map(serializeSearch) });
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
          scanned: result.scanned
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
      const limit = Number(url.searchParams.get('limit'));
      const matches = await database.listAlertMatches(userId, {
        onlyUnread,
        limit: Number.isFinite(limit) ? limit : 100
      });
      return res.json({ userId, onlyUnread, count: matches.length, matches });
    }
    if (method === 'POST') {
      const body = req.body || {};
      const action = typeof body.action === 'string' ? body.action : 'mark_read';
      if (action !== 'mark_read') return res.status(400).json({ error: 'unsupported_action' });
      const ids = Array.isArray(body.matchIds) ? body.matchIds.filter((v) => typeof v === 'string') : [];
      if (ids.length === 0) return res.status(400).json({ error: 'matchIds_required' });
      const marked = await database.markAlertMatchesRead(userId, ids);
      return res.json({ success: true, markedRead: marked });
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