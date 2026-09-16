// server/intelligence/saved-search-alerts.js
//
// Saved-search alerts: a user saves a search filter (states, sources,
// types, minScore, maxBid, keywords, minEquity). When the system ingests
// new listings, this module decides whether each listing matches any
// saved search and surfaces the matches as alerts.
//
// Two halves:
//   - matchListingAgainstSearch(listing, search) — pure boolean predicate
//     that one consumer can use to test a single (listing, search) pair.
//   - matchAllSearches(listing, searches) — convenience: returns an
//     array of matching search IDs for a single listing.
//
// Search shape:
//   { id, label?, states?: string[], sources?: string[], propTypes?: string[],
//     minScore?: number, maxBid?: number, minEquity?: number,
//     keywords?: string[], occupancy?: string, seniorLien?: string,
//     redemption?: string }
//
// Empty / missing fields mean "don't filter on this dimension". A search
// with no filters at all matches every listing, which is a foot-gun, so
// the predicate rejects that with reason='search_empty_filters'.

'use strict';

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.trim().length > 0);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Returns the normalized state list for a search: ['TX', 'CA'] (uppercase,
// trimmed, deduplicated, no empties). Null if the search doesn't constrain
// state. An empty array is treated as null (don't filter).
function normalizedStates(search) {
  if (!isStringArray(search.states) || search.states.length === 0) return null;
  return [...new Set(search.states.map((s) => s.trim().toUpperCase()))];
}

function normalizedSources(search) {
  if (!isStringArray(search.sources) || search.sources.length === 0) return null;
  return [...new Set(search.sources.map((s) => s.trim().toLowerCase()))];
}

function normalizedPropTypes(search) {
  if (!isStringArray(search.propTypes) || search.propTypes.length === 0) return null;
  return [...new Set(search.propTypes.map((s) => s.trim()))];
}

function normalizedKeywords(search) {
  if (!isStringArray(search.keywords) || search.keywords.length === 0) return null;
  return search.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
}

// Detect "this search has no real filters at all". We intentionally allow
// any single non-empty filter; the only failure case is "everything is
// absent/empty", which would match every listing and spam every user.
function hasAnyFilter(search) {
  return Boolean(normalizedStates(search)
    || normalizedSources(search)
    || normalizedPropTypes(search)
    || normalizedKeywords(search)
    || Number.isFinite(search.minScore)
    || Number.isFinite(search.maxBid)
    || Number.isFinite(search.minEquity)
    || (typeof search.occupancy === 'string' && search.occupancy.trim())
    || (typeof search.seniorLien === 'string' && search.seniorLien.trim())
    || (typeof search.redemption === 'string' && search.redemption.trim()));
}

// Returns one of:
//   { match: true }
//   { match: false, reason: '<machine-readable reason>' }
//
// Reasons: 'search_empty_filters' | 'state_mismatch' | 'source_mismatch'
//   | 'propType_mismatch' | 'minScore_not_met' | 'maxBid_exceeded'
//   | 'minEquity_not_met' | 'occupancy_mismatch' | 'seniorLien_mismatch'
//   | 'redemption_mismatch' | 'keywords_no_match'
function matchListingAgainstSearch(listing, search) {
  if (!listing || typeof listing !== 'object') return { match: false, reason: 'listing_missing' };
  if (!search || typeof search !== 'object') return { match: false, reason: 'search_missing' };
  if (!hasAnyFilter(search)) return { match: false, reason: 'search_empty_filters' };

  const states = normalizedStates(search);
  if (states) {
    const listingState = typeof listing.state === 'string' ? listing.state.trim().toUpperCase() : '';
    if (!listingState || !states.includes(listingState)) {
      return { match: false, reason: 'state_mismatch' };
    }
  }

  const sources = normalizedSources(search);
  if (sources) {
    const listingSource = typeof listing.source === 'string' ? listing.source.trim().toLowerCase() : '';
    if (!listingSource || !sources.includes(listingSource)) {
      return { match: false, reason: 'source_mismatch' };
    }
  }

  const propTypes = normalizedPropTypes(search);
  if (propTypes) {
    const listingType = typeof listing.propType === 'string' ? listing.propType.trim() : '';
    if (!listingType || !propTypes.includes(listingType)) {
      return { match: false, reason: 'propType_mismatch' };
    }
  }

  if (Number.isFinite(search.minScore)) {
    const score = finiteOrNull(listing.dealScore);
    if (!Number.isFinite(score) || score < search.minScore) {
      return { match: false, reason: 'minScore_not_met' };
    }
  }

  if (Number.isFinite(search.maxBid)) {
    const bid = finiteOrNull(listing.openingBid);
    if (Number.isFinite(bid) && bid > search.maxBid) {
      return { match: false, reason: 'maxBid_exceeded' };
    }
  }

  if (Number.isFinite(search.minEquity)) {
    const equity = finiteOrNull(listing.equity);
    if (!Number.isFinite(equity) || equity < search.minEquity) {
      return { match: false, reason: 'minEquity_not_met' };
    }
  }

  if (typeof search.occupancy === 'string' && search.occupancy.trim()) {
    const wanted = search.occupancy.trim().toLowerCase();
    const got = typeof listing.occupancy === 'string' ? listing.occupancy.trim().toLowerCase() : '';
    if (!got || got !== wanted) {
      return { match: false, reason: 'occupancy_mismatch' };
    }
  }

  if (typeof search.seniorLien === 'string' && search.seniorLien.trim()) {
    const wanted = search.seniorLien.trim().toLowerCase();
    const got = typeof listing.seniorLienRisk === 'string' ? listing.seniorLienRisk.trim().toLowerCase() : '';
    if (!got || got !== wanted) {
      return { match: false, reason: 'seniorLien_mismatch' };
    }
  }

  if (typeof search.redemption === 'string' && search.redemption.trim()) {
    const wanted = search.redemption.trim().toLowerCase();
    const got = typeof listing.redemptionWarning === 'string' ? listing.redemptionWarning.trim().toLowerCase() : '';
    if (!got || got !== wanted) {
      return { match: false, reason: 'redemption_mismatch' };
    }
  }

  const keywords = normalizedKeywords(search);
  if (keywords) {
    const haystack = [
      listing.address,
      listing.city,
      listing.county,
      listing.raw,
      listing.plaintiff,
      listing.defendant,
      listing.attorney
    ]
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    if (!keywords.some((kw) => haystack.includes(kw))) {
      return { match: false, reason: 'keywords_no_match' };
    }
  }

  return { match: true };
}

// Run a single listing through every search. Returns the array of
// matching search IDs. Searches without filters are skipped (with a
// reason) so the consumer can decide whether to alert or warn.
function matchAllSearches(listing, searches, options = {}) {
  if (!Array.isArray(searches)) return { matches: [], skipped: [] };
  const matches = [];
  const skipped = [];
  for (const search of searches) {
    if (!search || typeof search !== 'object') continue;
    const verdict = matchListingAgainstSearch(listing, search);
    if (verdict.match) {
      matches.push({
        searchId: search.id || null,
        label: search.label || null,
        verdict: 'match'
      });
    } else if (verdict.reason === 'search_empty_filters') {
      skipped.push({
        searchId: search.id || null,
        reason: verdict.reason
      });
    }
  }
  return { matches, skipped };
}

module.exports = {
  matchListingAgainstSearch,
  matchAllSearches,
  hasAnyFilter,
  // Internal helpers exposed for tests
  _internals: { normalizedStates, normalizedSources, normalizedKeywords }
};