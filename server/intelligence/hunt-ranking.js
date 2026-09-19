'use strict';

/**
 * Hunt match ranking — search-engine style presentation layer.
 *
 * Binary hunt match remains the gate (hunts.js). This module ranks *matched*
 * records so operators can triage evidence-backed hits. It never invents
 * publisher facts, bids, valuations, or legal status.
 *
 * Ranking inputs (all already-observed or already-derived):
 * 1. Criterion closeness (search-term coverage, numeric headroom vs thresholds)
 * 2. Research quality from listing-intelligence (evidence completeness/freshness)
 * 3. Sale urgency from published sale dates
 * 4. Modeled deal-score band (SCORE_BANDS) — price triage only
 */

const { bandForScore } = require('./score-bands');
const {
  computeOpportunity,
  computeResearchQuality,
} = require('../scrapers/listing-intelligence');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'at', 'by',
  'is', 'are', 'with', 'from', 'that', 'this', 'it', 'as', 'be',
]);

const RANK_NOTE = 'Triage rank for hunt matches only. Combines criterion closeness, evidence quality, sale urgency, and modeled deal-score band. Not an appraisal, title opinion, or legal verification.';
const MAX_CRITERION_POINTS = 40;
const MAX_EVIDENCE_POINTS = 25;
const MAX_URGENCY_POINTS = 20;
const MAX_DEAL_BAND_POINTS = 15;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function listingSearchDocument(listing = {}) {
  return [
    listing.address,
    listing.city,
    listing.county,
    listing.state,
    listing.zip,
    listing.propType,
    listing.source,
    listing.plaintiff,
    listing.defendant,
    listing.attorney,
    listing.auctionProgram,
    listing.lifecycleStatus,
    listing.status,
  ]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ');
}

function termCoverage(query, documentText) {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length) {
    return { coverage: null, matchedTokens: [], queryTokens: [] };
  }
  const documentTokens = new Set(tokenize(documentText));
  const matchedTokens = queryTokens.filter((token) => documentTokens.has(token));
  return {
    coverage: matchedTokens.length / queryTokens.length,
    matchedTokens,
    queryTokens,
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampPoints(value, max) {
  return Math.max(0, Math.min(max, value));
}

function criterionFactors(listing, hunt, clauseResults = []) {
  const factors = [];
  let points = 0;

  const filters = hunt?.criteria?.discoveryFilters || null;
  if (filters?.q) {
    const { coverage, matchedTokens, queryTokens } = termCoverage(filters.q, listingSearchDocument(listing));
    if (coverage !== null) {
      const weight = clampPoints(coverage * 18, 18);
      points += weight;
      factors.push({
        factor: 'search_term_coverage',
        weight: Number(weight.toFixed(2)),
        detail: `Matched ${matchedTokens.length}/${queryTokens.length} query terms on observed listing text.`,
      });
    }
  }

  const minScore = finiteNumber(filters?.minScore);
  const dealScore = finiteNumber(listing.dealScore);
  if (minScore !== null && minScore > 0 && dealScore !== null && dealScore >= minScore) {
    const headroom = Math.min(1, (dealScore - minScore) / Math.max(20, minScore));
    const weight = clampPoints(8 + headroom * 8, 16);
    points += weight;
    factors.push({
      factor: 'deal_score_headroom',
      weight: Number(weight.toFixed(2)),
      detail: `Modeled deal score ${dealScore} meets minScore ${minScore} with modeled headroom.`,
    });
  }

  const maxBid = finiteNumber(filters?.maxBid);
  const openingBid = finiteNumber(listing.openingBid);
  if (maxBid !== null && maxBid > 0 && openingBid !== null && openingBid <= maxBid && maxBid > 0) {
    const margin = (maxBid - openingBid) / maxBid;
    const weight = clampPoints(6 + margin * 10, 16);
    points += weight;
    factors.push({
      factor: 'opening_bid_margin',
      weight: Number(weight.toFixed(2)),
      detail: `Published opening bid ${openingBid} is within maxBid ${maxBid}.`,
    });
  }

  const minEquity = finiteNumber(filters?.minEquity);
  const equity = finiteNumber(listing.equity);
  if (minEquity !== null && minEquity > 0 && equity !== null && equity >= minEquity) {
    const weight = clampPoints(6 + Math.min(1, (equity - minEquity) / Math.max(25000, minEquity)) * 6, 12);
    points += weight;
    factors.push({
      factor: 'bid_spread_headroom',
      weight: Number(weight.toFixed(2)),
      detail: `Derived bid spread ${equity} meets minEquity ${minEquity}.`,
    });
  }

  const matchedClauses = clauseResults.filter((clause) => clause?.status === 'match').length;
  if (matchedClauses > 0) {
    const weight = clampPoints(matchedClauses * 3, 12);
    points += weight;
    factors.push({
      factor: 'criterion_matches',
      weight: Number(weight.toFixed(2)),
      detail: `${matchedClauses} hunt clause(s) satisfied on validated publisher evidence.`,
    });
  }

  return { points: clampPoints(points, MAX_CRITERION_POINTS), factors };
}

function rankHuntMatch(listing = {}, hunt = {}, clauseResults = [], options = {}) {
  const now = options.now ?? Date.now();
  const factors = [];

  const criterion = criterionFactors(listing, hunt, clauseResults);
  factors.push(...criterion.factors);

  const quality = computeResearchQuality(listing, now);
  const evidencePoints = clampPoints((quality.score / 100) * MAX_EVIDENCE_POINTS, MAX_EVIDENCE_POINTS);
  factors.push({
    factor: 'research_quality',
    weight: Number(evidencePoints.toFixed(2)),
    detail: `Evidence quality ${quality.score}/100 (${quality.band}).`,
  });

  const opportunity = computeOpportunity(listing, now);
  let urgencyPoints = 0;
  if (opportunity.urgency === 'imminent') urgencyPoints = MAX_URGENCY_POINTS;
  else if (opportunity.urgency === 'near_term') urgencyPoints = MAX_URGENCY_POINTS * 0.75;
  else if (opportunity.urgency === 'scheduled') urgencyPoints = MAX_URGENCY_POINTS * 0.35;
  else if (opportunity.urgency === 'past_sale') urgencyPoints = 0;
  factors.push({
    factor: 'sale_urgency',
    weight: Number(urgencyPoints.toFixed(2)),
    detail: opportunity.daysToSale === null
      ? 'Published sale date unavailable; urgency not scored.'
      : `Urgency ${opportunity.urgency} (${opportunity.daysToSale} day(s) to published sale date).`,
  });

  const band = bandForScore(listing.dealScore);
  let dealBandPoints = 0;
  if (band?.key === 'elite') dealBandPoints = MAX_DEAL_BAND_POINTS;
  else if (band?.key === 'strong') dealBandPoints = MAX_DEAL_BAND_POINTS * 0.8;
  else if (band?.key === 'fair') dealBandPoints = MAX_DEAL_BAND_POINTS * 0.45;
  else if (band?.key === 'thin') dealBandPoints = MAX_DEAL_BAND_POINTS * 0.15;
  factors.push({
    factor: 'deal_score_band',
    weight: Number(dealBandPoints.toFixed(2)),
    detail: band
      ? `Modeled Deal Score band ${band.label} (${band.min}–${band.max}).`
      : 'Modeled Deal Score unavailable; band not scored.',
  });

  const rank = Math.max(0, Math.min(100, Math.round(
    criterion.points + evidencePoints + urgencyPoints + dealBandPoints,
  )));
  const rankBand = rank >= 70 ? 'high' : rank >= 40 ? 'medium' : 'low';

  return {
    rank,
    band: rankBand,
    dealScoreBand: band ? band.key : null,
    researchQualityScore: quality.score,
    urgency: opportunity.urgency,
    factors,
    note: RANK_NOTE,
  };
}

function statusSortRank(status) {
  if (status === 'match') return 0;
  if (status === 'unknown') return 1;
  if (status === 'no_match') return 2;
  return 3;
}

function sortHuntResults(results = []) {
  return [...results].sort((left, right) => {
    const statusDelta = statusSortRank(left?.status) - statusSortRank(right?.status);
    if (statusDelta !== 0) return statusDelta;
    const leftRank = Number.isFinite(left?.relevance?.rank) ? left.relevance.rank : -1;
    const rightRank = Number.isFinite(right?.relevance?.rank) ? right.relevance.rank : -1;
    if (leftRank !== rightRank) return rightRank - leftRank;
    return String(left?.listingId || '').localeCompare(String(right?.listingId || ''));
  });
}

module.exports = {
  MAX_CRITERION_POINTS,
  MAX_DEAL_BAND_POINTS,
  MAX_EVIDENCE_POINTS,
  MAX_URGENCY_POINTS,
  RANK_NOTE,
  listingSearchDocument,
  rankHuntMatch,
  sortHuntResults,
  termCoverage,
  tokenize,
};
