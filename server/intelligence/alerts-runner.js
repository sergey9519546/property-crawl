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
const { isEmail, sendOutboundMail } = require('../delivery/outbound-mail');
const { notifySavedSearchWebhook } = require('../delivery/webhook-notify');

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
async function runAlertsForUser({ userId, listings, database, mailOptions, webhookOptions } = {}) {
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
    const row = { searchId: search.id, label: search.label, newMatches: newCount };
    const newIds = new Set((Array.isArray(records) ? records : []).map((record) => record.listingId));
    const fresh = listings.filter((listing) => newIds.has(listing?.id));
    if (newCount > 0 && (search?.filters?.webhookUrl || search?.webhookUrl)) {
      try {
        row.webhook = await notifySavedSearchWebhook(search, fresh, webhookOptions || {});
      } catch (error) {
        row.webhook = { delivery: 'unavailable', sent: false, reason: 'network' };
        row.webhookError = String(error?.message || error || 'webhook-failed');
      }
    }
    const notify = isEmail(search?.filters?.notifyEmail) || isEmail(search?.filters?.email) || isEmail(search?.notifyEmail);
    if (newCount > 0 && notify) {
      try {
        const baseUrl = process.env.PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || 'https://property-crawl.onrender.com';
        const formattedItems = fresh.slice(0, 15).map((l) => {
          const addr = l.address || 'Address unlisted';
          const location = [l.city, l.state].filter(Boolean).join(', ');
          const bid = l.openingBid != null ? `$${Math.round(Number(l.openingBid)).toLocaleString('en-US')}` : 'Opening bid unlisted';
          const score = l.dealScore != null ? `Score ${Math.round(Number(l.dealScore))}/99` : 'Unscored';
          const date = l.saleDate || l.auctionDate ? `Sale: ${(l.saleDate || l.auctionDate).slice(0, 10)}` : 'Sale date TBD';
          const url = `${baseUrl}/listings/${encodeURIComponent(l.id)}`;
          return `• ${addr}${location ? ` (${location})` : ''}\n  ${bid} | ${score} | ${date}\n  Details: ${url}`;
        }).join('\n\n');

        const emailText = `${newCount} new foreclosure or auction notice(s) matching "${search.label || search.id}":\n\n${formattedItems}\n\nNotice: Listings convey "as-is, where-is". Verify all civil dockets and title encumbrances prior to bidding. Manage your alert subscriptions at ${baseUrl}/hunts.`;

        const mail = await sendOutboundMail({
          to: notify,
          subject: `${newCount} new notice(s): ${search.label || 'Saved Search Alert'}`,
          text: emailText,
          kind: 'saved-search',
        }, mailOptions || {});
        row.mailDelivery = mail.delivery;
      } catch (error) {
        row.mailDelivery = 'unavailable';
        row.mailError = String(error?.message || error || 'mail-failed');
      }
    }
    results.push(row);
  }
  return { userId, searches: searches.length, totalNewMatches: total, results, skipped: null };
}

module.exports = {
  runAlertsForUser
};