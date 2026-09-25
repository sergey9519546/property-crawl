'use strict';

// server/routes/property-comparison.js
//
// GET /api/listings/compare?ids=A,B,C[&ids=D]
//
// Side-by-side comparison of 2-4 saved listings. The first id in the
// list is treated as the "target" (the row the deltas are signed
// against). All others are comparisons.
//
// Auth: read-only public analytics — no auth required.

const db = require('../db/client');
const { buildPropertyComparison, MAX_LISTINGS } = require('../intelligence/property-comparison');

function parseIds(searchParams) {
  // Accept ?ids=A&ids=B&ids=C and ?ids=A,B,C (the route is registered
  // for both shapes depending on which client code uses it).
  const collected = [];
  for (const value of searchParams.getAll('ids')) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed) collected.push(trimmed);
    }
  }
  return collected;
}

async function loadListings(database, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const listing = await database.getListingById(id.trim());
    if (listing) out.push(listing);
  }
  return out;
}

function createPropertyComparisonHandler(dependencies = {}) {
  const database = dependencies.database || db;

  return async function handlePropertyComparison(req, res, urlInput) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }

    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/listings/compare') {
      return res.status(404).json({ error: 'not_found' });
    }

    const ids = parseIds(url.searchParams);
    if (ids.length < 2) {
      return res.status(400).json({ error: 'ids_required', minRequired: 2 });
    }
    if (ids.length > MAX_LISTINGS) {
      return res.status(400).json({ error: 'too_many_ids', maxAllowed: MAX_LISTINGS });
    }

    const listings = await loadListings(database, ids);
    if (listings.length === 0) {
      return res.status(404).json({ error: 'listings_not_found', requested: ids });
    }
    if (listings.length < ids.length) {
      // Some ids were missing. Surface what we found vs what was requested.
      const found = listings.map((l) => l.id);
      const missing = ids.filter((id) => !found.includes(id));
      return res.status(404).json({ error: 'listings_not_found', missing });
    }

    const result = buildPropertyComparison(listings);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(result);
  };
}

module.exports = {
  createPropertyComparisonHandler,
  parseIds
};