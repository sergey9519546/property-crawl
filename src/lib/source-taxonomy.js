// src/lib/source-taxonomy.js
//
// Source trust taxonomy, counted from `trustStatus`.
//
// THE FIELD MATTERS, and getting it wrong is silent.
//
// A source carries two unrelated vocabularies:
//
//   status       operational collection state -- collected, attention, stale,
//                import_available, lookup_available, empty, evidence_queued
//   trustStatus  catalog trust taxonomy -- VERIFIED_OFFICIAL,
//                VERIFIED_FIRST_PARTY, SCOPE_LIMITED, LOCAL_ROUTE,
//                DISCOVERY_ONLY, INCONCLUSIVE_BLOCKED
//
// Counting the taxonomy off `status` matches nothing, because the two sets are
// disjoint. That is not a crash or a wrong colour: every bucket lands on 0 and
// the page prints four confident zeros above a list of real blocked sources.
// A reader sees "nothing is verified, nothing is blocked", which is the exact
// opposite of the truth.
//
// It is a module rather than a local function so the counting rule has one
// definition that a test can reach. Previously it was private to the component
// and the only thing that could check it was a regex over the source, which
// passes identically whether the field is right or wrong.

const VERIFIED = new Set(['VERIFIED_OFFICIAL', 'VERIFIED_FIRST_PARTY']);
const SCOPE_LIMITED = new Set(['SCOPE_LIMITED', 'LOCAL_ROUTE']);
const DISCOVERY_ONLY = new Set(['DISCOVERY_ONLY']);
const BLOCKED = new Set(['INCONCLUSIVE_BLOCKED']);

/**
 * Summarise how much of the catalog is trusted, not how much collection ran.
 *
 * @param {Array<{ trustStatus?: string }>} sources
 * @returns {string} e.g. "10 verified · 120 scope-limited · 31 discovery-only · 2 blocked"
 */
function taxonomySummary(sources) {
  let verified = 0;
  let scopeLimited = 0;
  let discoveryOnly = 0;
  let blocked = 0;

  for (const source of sources || []) {
    const trust = source?.trustStatus;
    if (!trust) continue; // no trust recorded contributes to nothing
    if (VERIFIED.has(trust)) verified += 1;
    else if (SCOPE_LIMITED.has(trust)) scopeLimited += 1;
    else if (DISCOVERY_ONLY.has(trust)) discoveryOnly += 1;
    else if (BLOCKED.has(trust)) blocked += 1;
  }

  return `${verified} verified · ${scopeLimited} scope-limited · ${discoveryOnly} discovery-only · ${blocked} blocked`;
}

module.exports = { taxonomySummary };