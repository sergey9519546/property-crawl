'use strict';

const crypto = require('crypto');
const { matchListingAgainstSearch } = require('./saved-search-alerts');

/**
 * High-performance Hunt Evaluator & Multi-Channel Alert Engine
 *
 * Implements Task 15:
 * Evaluates streaming/batch ingested listings against active operator saved hunts,
 * tracks matched criteria reasons, and produces webhook and email digest payloads.
 */

/**
 * Evaluates an ingested listing against a single saved hunt.
 *
 * @param {Object} listing
 * @param {Object} hunt
 * @returns {Object} { isMatch: boolean, reasons: string[], matchedCriteria: string[] }
 */
function evaluateListingAgainstHunt(listing, hunt) {
  if (!listing || !hunt) {
    return { isMatch: false, reasons: ['invalid_inputs'], matchedCriteria: [] };
  }

  // Use base predicate
  const matchResult = matchListingAgainstSearch(listing, hunt);
  if (!matchResult.match) {
    return {
      isMatch: false,
      reasons: [matchResult.reason || 'did_not_satisfy_filters'],
      matchedCriteria: []
    };
  }

  const matchedCriteria = [];
  const filters = hunt.filters || hunt;

  if (filters.states && Array.isArray(filters.states)) {
    matchedCriteria.push(`state=${listing.state}`);
  }
  if (filters.counties && Array.isArray(filters.counties)) {
    matchedCriteria.push(`county=${listing.county}`);
  }
  if (filters.minScore != null) {
    matchedCriteria.push(`dealScore>=${filters.minScore} (actual: ${listing.dealScore})`);
  }
  if (filters.maxBid != null) {
    matchedCriteria.push(`openingBid<=${filters.maxBid} (actual: ${listing.openingBid})`);
  }
  if (filters.sources && Array.isArray(filters.sources)) {
    matchedCriteria.push(`source=${listing.source}`);
  }

  return {
    isMatch: true,
    reasons: ['all_criteria_satisfied'],
    matchedCriteria
  };
}

/**
 * Evaluates an incoming listing against a fleet of active hunts.
 *
 * @param {Object} listing
 * @param {Array<Object>} hunts
 * @returns {Array<Object>} Matched hunt alerts
 */
function evaluateListingAcrossHunts(listing, hunts = []) {
  if (!listing || !Array.isArray(hunts) || hunts.length === 0) return [];

  const matches = [];

  for (const hunt of hunts) {
    const evaluation = evaluateListingAgainstHunt(listing, hunt);
    if (evaluation.isMatch) {
      const matchId = `ALERT-${hunt.id || 'HUNT'}-${listing.id}-${Date.now()}`;
      matches.push({
        id: matchId,
        huntId: hunt.id,
        huntTitle: hunt.label || hunt.title || 'Untitled Hunt',
        listingId: listing.id,
        matchedAt: new Date().toISOString(),
        matchedCriteria: evaluation.matchedCriteria,
        isRead: false,
        listingSnapshot: {
          address: listing.address,
          state: listing.state,
          county: listing.county,
          openingBid: listing.openingBid,
          dealScore: listing.dealScore,
          source: listing.source,
          sourceUrl: listing.sourceUrl
        }
      });
    }
  }

  return matches;
}

/**
 * Generates an HTTP Webhook event payload for third-party operator integration.
 *
 * @param {Object} hunt
 * @param {Object} listing
 * @param {Array<string>} matchedCriteria
 * @returns {Object} JSON webhook payload
 */
function generateHuntWebhookPayload(hunt, listing, matchedCriteria = []) {
  const eventId = `EVT-${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();

  return {
    event: 'hunt.listing_matched',
    eventId,
    timestamp,
    hunt: {
      id: hunt.id,
      title: hunt.label || hunt.title || 'Untitled Hunt',
      subscriberEmail: hunt.subscriberEmail || null
    },
    listing: {
      id: listing.id,
      address: listing.address,
      city: listing.city,
      state: listing.state,
      county: listing.county,
      openingBid: listing.openingBid,
      dealScore: listing.dealScore,
      saleDate: listing.saleDate,
      source: listing.source,
      sourceUrl: listing.sourceUrl
    },
    matchedCriteria
  };
}

/**
 * Generates a transactional email digest payload (for Resend / SMTP).
 *
 * @param {Object} hunt
 * @param {Array<Object>} matchedListings
 * @returns {Object} Email notification descriptor
 */
function generateHuntEmailDigest(hunt, matchedListings = []) {
  const count = matchedListings.length;
  const huntTitle = hunt.label || hunt.title || 'Saved Hunt';
  const to = hunt.subscriberEmail || 'operator@propertycrawl.com';

  const subject = `🎯 [${huntTitle}] Found ${count} New Distressed Property ${count === 1 ? 'Opportunity' : 'Opportunities'}`;

  const summaryRows = matchedListings.map((l) => {
    const bid = l.openingBid ? `$${Number(l.openingBid).toLocaleString()}` : 'Unlisted';
    const score = l.dealScore != null ? `Score ${l.dealScore}` : '';
    return `- ${l.address || 'Address Unrecorded'} (${l.city || ''}, ${l.state || ''}) — Bid: ${bid} ${score ? `· ${score}` : ''}`;
  });

  const textBody = `New distressed opportunities matched your hunt "${huntTitle}":\n\n${summaryRows.join('\n')}\n\nView and underwrite in your workspace:\nhttps://propertycrawl.com/hunts`;

  return {
    to,
    subject,
    text: textBody,
    huntId: hunt.id,
    matchCount: count,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  evaluateListingAgainstHunt,
  evaluateListingAcrossHunts,
  generateHuntWebhookPayload,
  generateHuntEmailDigest
};
