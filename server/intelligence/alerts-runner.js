// server/intelligence/alerts-runner.js
//
// Alerts runner: takes a batch of new listings, runs each listing
// against every active saved search for the workspace user, and
// persists matches via the DB. Heavy lifting lives in
// server/intelligence/saved-search-alerts.js (the predicate) and
// server/db/client.js (persistence). This module is the thin
// orchestration glue so the scheduler's post-ingest hook and tests
// share one entry point.
//
// Pure orchestration: no state of its own. The DB is injected.

'use strict';

const { matchListingAgainstSearch } = require('./saved-search-alerts');

// Run every active saved search for a user against a batch of
// listings. Returns:
//   {
//     userId,
//     searches: <count of active searches>,
//     totalNewMatches: <count of new alert_matches rows written>,
//     results: [{ searchId, label, newMatches }]
//   }
//
// `database` must implement:
//   - listSavedSearches(userId, { includeInactive })
//   - recordAlertMatches(userId, searchId, listingIds)
//
// The scheduler calls this once per ingestion cycle and logs the
// totalNewMatches count.
async function runAlertsForUser({ userId, listings, database }) {
  if (!userId || typeof userId !== 'string') {
    return { userId: userId || null, searches: 0, totalNewMatches: 0, results: [], skipped: 'userId_missing' };
  }
  if (!database) {
    return { userId, searches: 0, totalNewMatches: 0, results: [], skipped: 'database_missing' };
  }
  if (!Array.isArray(listings) || listings.length === 0) {
    return { userId, searches: 0, totalNewMatches: 0, results: [], skipped: 'listings_empty' };
  }

  const searches = await database.listSavedSearches(userId, { includeInactive: false });
  if (!searches.length) {
    return { userId, searches: 0, totalNewMatches: 0, results: [], skipped: null };
  }

  const results = [];
  let total = 0;
  for (const search of searches) {
    const matchingIds = [];
    for (const listing of listings) {
      const verdict = matchListingAgainstSearch(listing, search);
      if (verdict.match) matchingIds.push(listing.id);
    }
    if (matchingIds.length === 0) continue;
    const records = await database.recordAlertMatches(userId, search.id, matchingIds);
    const newCount = Array.isArray(records) ? records.length : 0;
    total += newCount;
    results.push({ searchId: search.id, label: search.label, newMatches: newCount });
  }
  return { userId, searches: searches.length, totalNewMatches: total, results, skipped: null };
}

module.exports = {
  runAlertsForUser
};