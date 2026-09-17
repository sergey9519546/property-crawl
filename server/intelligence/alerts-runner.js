// server/intelligence/alerts-runner.js
//
// Alerts runner: takes a batch of new listings, runs each listing
// through the user's saved searches, and persists matches. The
// engine itself is thin — the heavy lifting lives in
// server/intelligence/saved-search-alerts.js (the predicate) and
// server/db/client.js (persistence). This module exists so the HTTP
// route, the cron-style ingest hook, and tests share one entry point.
//
// Pure orchestration: no state of its own. Each function is stateless
// and takes the database + clock as dependencies.

'use strict';

const { matchAllSearches } = require('./saved-search-alerts');

// Run a single listing through every active saved search for the
// listing's publisher's user community. Saves matches via the DB and
// returns the new match records.
//
// `database` must implement:
//   - listSavedSearches(userId)               → Search[]  (note: signature
//                                               takes a user; we pass the
//                                               per-listing pseudo-user
//                                               unless `userId` is given)
//   - recordAlertMatches(userId, searchId, ids)
//
// In practice, the alerts runner is per-user: callers iterate users.
// The simpler helper `runAlertsForListingAcrossUsers` covers the
// case where one user owns the saved searches.
async function runAlertsForListing({ listing, savedSearches, database, userId, nowMs }) {
  if (!listing || typeof listing !== 'object') {
    return { skipped: 'listing_missing', matches: [] };
  }
  if (!Array.isArray(savedSearches)) {
    return { skipped: 'searches_missing', matches: [] };
  }
  if (!database) return { skipped: 'database_missing', matches: [] };
  if (!userId || typeof userId !== 'string') {
    return { skipped: 'userId_missing', matches: [] };
  }

  const verdict = matchAllSearches(listing, savedSearches);
  if (verdict.matches.length === 0) {
    return { skipped: 'no_match', matches: [], skippedSearches: verdict.skipped };
  }

  const newMatches = [];
  for (const match of verdict.matches) {
    if (!match.searchId) continue;
    const records = await database.recordAlertMatches(userId, match.searchId, [listing.id]);
    if (Array.isArray(records) && records.length) {
      newMatches.push(...records.map((r) => ({ ...r, searchLabel: match.label })));
    }
  }
  return { skipped: null, matches: newMatches, skippedSearches: verdict.skipped };
}

// Run every saved search for a user against a batch of listings.
// Returns a map { searchId: numberOfNewMatches } so callers can report
// "3 searches surfaced new matches this run".
async function runAlertsForUser({ userId, listings, database, nowMs }) {
  if (!userId || !database) return { userId, searches: 0, totalNewMatches: 0, results: [] };
  const searches = await database.listSavedSearches(userId, { includeInactive: false });
  if (!searches.length) return { userId, searches: 0, totalNewMatches: 0, results: [] };

  const results = [];
  let total = 0;
  for (const search of searches) {
    const matchingIds = [];
    for (const listing of listings) {
      const { matchListingAgainstSearch } = require('./saved-search-alerts');
      const verdict = matchListingAgainstSearch(listing, search);
      if (verdict.match) matchingIds.push(listing.id);
    }
    if (matchingIds.length === 0) continue;
    const records = await database.recordAlertMatches(userId, search.id, matchingIds);
    const newCount = Array.isArray(records) ? records.length : 0;
    total += newCount;
    results.push({ searchId: search.id, label: search.label, newMatches: newCount });
  }
  return { userId, searches: searches.length, totalNewMatches: total, results };
}

module.exports = {
  runAlertsForListing,
  runAlertsForUser
};