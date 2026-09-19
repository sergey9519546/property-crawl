'use strict';

/**
 * Listing intelligence layer (10x pipeline upgrade).
 *
 * Computes presentation-safe research quality and opportunity signals from
 * already-observed listing fields. Never invents bids, valuations, inventory,
 * or geocodes. All scores are triage aids — not appraisals or investment advice.
 */

const IDENTITY_FALLBACK_FIELDS = ['address', 'city', 'state', 'zip', 'county'];

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Stable cross-source identity when parcelKey is absent.
 * Returns null when address+state are insufficient — never fabricates keys.
 */
function buildIdentityFallback(listing = {}) {
  const address = String(listing.address || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const state = String(listing.state || '').trim().toUpperCase();
  const city = String(listing.city || '').trim().toLowerCase();
  const zip = String(listing.zip || '').trim().slice(0, 5);
  const county = String(listing.county || '').trim().toLowerCase();
  if (!address || !state || address.length < 6) return null;
  const parts = [state, city || 'x', zip || 'x', county || 'x', address];
  return `addr:${parts.join('|')}`;
}

function resolveIdentityKey(listing = {}) {
  return listing.parcelKey || listing.identityFallback || buildIdentityFallback(listing) || null;
}

/**
 * Research quality: how complete and trustworthy the record is for triage.
 * 0–100. High quality does not mean a good deal — it means reviewable evidence.
 */
function computeResearchQuality(listing = {}, now = Date.now()) {
  const origin = listing.provenance?.origin;
  const observed = listing.provenance?.observed === true || origin === 'live';
  const completeness = listing.evidenceCompleteness;
  const completenessRatio = completeness && completeness.total
    ? completeness.known / completeness.total
    : 0;

  let score = 0;
  const factors = [];

  if (observed) {
    score += 30;
    factors.push({ factor: 'source_observed', weight: 30 });
  } else if (origin === 'archive') {
    score += 10;
    factors.push({ factor: 'dated_archive', weight: 10 });
  } else {
    factors.push({ factor: 'unverified_origin', weight: 0 });
  }

  const completenessPoints = Math.round(completenessRatio * 35);
  score += completenessPoints;
  factors.push({ factor: 'evidence_completeness', weight: completenessPoints });

  const fresh = listing.sourceFreshness?.status;
  if (fresh === 'current') {
    score += 20;
    factors.push({ factor: 'freshness_current', weight: 20 });
  } else if (fresh === 'stale') {
    score += 5;
    factors.push({ factor: 'freshness_stale', weight: 5 });
  } else if (fresh === 'archive') {
    score += 2;
    factors.push({ factor: 'freshness_archive', weight: 2 });
  }

  if (hasValue(listing.sourceUrl)) {
    score += 5;
    factors.push({ factor: 'publisher_url', weight: 5 });
  }
  if (listing.hasDocuments === true) {
    score += 5;
    factors.push({ factor: 'documents_observed', weight: 5 });
  }
  if (listing.crossSourceMatches?.length) {
    score += 5;
    factors.push({ factor: 'cross_source_match', weight: 5 });
  }

  score = Math.max(0, Math.min(100, score));
  const band = score >= 75 ? 'strong' : score >= 50 ? 'usable' : score >= 25 ? 'thin' : 'weak';
  return {
    score,
    band,
    factors,
    note: 'Evidence quality for triage only; not a valuation or title opinion.',
  };
}

/**
 * Opportunity signal: deal-shape + urgency from published fields only.
 */
function computeOpportunity(listing = {}, now = Date.now()) {
  const openingBid = numberOrNull(listing.openingBid);
  const estLow = numberOrNull(listing.estLow);
  const estHigh = numberOrNull(listing.estHigh);
  const mid = numberOrNull(listing.mid) ?? (
    estLow !== null && estHigh !== null && estHigh >= estLow ? (estLow + estHigh) / 2 : null
  );
  const dealScore = numberOrNull(listing.dealScore);
  const saleMs = listing.saleDate ? Date.parse(`${listing.saleDate}T12:00:00Z`) : NaN;
  const daysToSale = Number.isFinite(saleMs) ? Math.ceil((saleMs - now) / 86_400_000) : null;

  let urgency = 'unknown';
  if (daysToSale !== null) {
    if (daysToSale < 0) urgency = 'past_sale';
    else if (daysToSale <= 7) urgency = 'imminent';
    else if (daysToSale <= 30) urgency = 'near_term';
    else urgency = 'scheduled';
  }

  const bidSpread = openingBid !== null && mid !== null ? Math.max(0, mid - openingBid) : null;
  const bidToMid = openingBid !== null && mid !== null && mid > 0 ? openingBid / mid : null;

  let shape = 'unknown';
  if (dealScore !== null && dealScore >= 70) shape = 'deep_discount_model';
  else if (dealScore !== null && dealScore >= 45) shape = 'moderate_discount_model';
  else if (bidToMid !== null && bidToMid >= 0.9) shape = 'near_value_model';
  else if (openingBid === null && listing.status) shape = 'listed_without_bid';
  else if (bidSpread !== null && bidSpread > 0) shape = 'positive_spread_model';

  // Rank 0–100 for sorting. Models stay labeled; no fabricated ARV.
  let rank = 0;
  if (dealScore !== null) rank += dealScore * 0.55;
  if (urgency === 'imminent') rank += 25;
  else if (urgency === 'near_term') rank += 15;
  else if (urgency === 'scheduled') rank += 5;
  if (listing.evidenceCompleteness) {
    rank += (listing.evidenceCompleteness.known / Math.max(1, listing.evidenceCompleteness.total)) * 20;
  }
  if (listing.hasDocuments === true) rank += 5;
  rank = Math.max(0, Math.min(100, Math.round(rank)));

  return {
    rank,
    shape,
    urgency,
    daysToSale,
    dealScore,
    bidSpread,
    bidToMidRatio: bidToMid !== null ? Number(bidToMid.toFixed(4)) : null,
    note: 'Opportunity rank combines modeled deal score, sale urgency, and evidence completeness. Triage only.',
  };
}

function annotateListing(listing, now = Date.now()) {
  if (!listing || typeof listing !== 'object') return listing;
  const presented = { ...listing };
  presented.identityFallback = presented.identityFallback || buildIdentityFallback(presented);
  presented.identityKey = resolveIdentityKey(presented);
  presented.researchQuality = computeResearchQuality(presented, now);
  presented.opportunity = computeOpportunity(presented, now);
  return presented;
}

/**
 * Inventory pipeline summary for /api/listings responses.
 */
function summarizeInventory(listings = [], now = Date.now()) {
  const annotated = listings.map((l) => annotateListing(l, now));
  const byQuality = { strong: 0, usable: 0, thin: 0, weak: 0 };
  const byUrgency = { imminent: 0, near_term: 0, scheduled: 0, past_sale: 0, unknown: 0 };
  const bySource = {};
  let observed = 0;
  let withBid = 0;
  let crossSource = 0;
  let qualitySum = 0;
  let opportunitySum = 0;

  for (const listing of annotated) {
    const q = listing.researchQuality;
    const o = listing.opportunity;
    if (q) {
      byQuality[q.band] = (byQuality[q.band] || 0) + 1;
      qualitySum += q.score;
    }
    if (o) {
      byUrgency[o.urgency] = (byUrgency[o.urgency] || 0) + 1;
      opportunitySum += o.rank;
    }
    const source = listing.source || 'unknown';
    bySource[source] = (bySource[source] || 0) + 1;
    if (listing.provenance?.origin === 'live' || listing.provenance?.observed === true) observed += 1;
    if (hasValue(listing.openingBid)) withBid += 1;
    if (listing.crossSourceMatches?.length) crossSource += 1;
  }

  const total = annotated.length;
  return {
    total,
    observed,
    withOpeningBid: withBid,
    crossSourceLinked: crossSource,
    avgResearchQuality: total ? Math.round((qualitySum / total) * 10) / 10 : 0,
    avgOpportunityRank: total ? Math.round((opportunitySum / total) * 10) / 10 : 0,
    byQualityBand: byQuality,
    bySaleUrgency: byUrgency,
    bySource,
    model: 'listing-intelligence-v1',
    note: 'Inventory quality summary. Scores support triage; they are not appraisals.',
  };
}

/**
 * Group inventory by identity key for cross-source merge diagnostics.
 */
function groupByIdentity(listings = []) {
  const groups = new Map();
  for (const raw of listings) {
    const key = resolveIdentityKey(raw);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(raw);
  }
  return groups;
}

module.exports = {
  buildIdentityFallback,
  resolveIdentityKey,
  computeResearchQuality,
  computeOpportunity,
  annotateListing,
  summarizeInventory,
  groupByIdentity,
  IDENTITY_FALLBACK_FIELDS,
};
