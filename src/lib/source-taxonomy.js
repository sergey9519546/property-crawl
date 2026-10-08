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

/** Per-source trust badge. Mirrors the SOURCE_STATUSES taxonomy in
 * server/sources/catalog.js, and is keyed by the SAME vocabulary as
 * taxonomySummary -- so it takes `trustStatus`.
 *
 * This map used to live in the component and be rendered from `source.status`,
 * which meant SOURCE_STATUSES['collected'] was undefined for every source and
 * the badge rendered zero times. Same defect as the summary above, one function
 * over: trust was simply absent from the page.
 */
const SOURCE_STATUSES = {
  VERIFIED_OFFICIAL: {
    label: 'Verified official',
    description: 'Government first-party publisher with a confirmed working collector.',
    color: 'bg-emerald-100 text-emerald-800',
  },
  VERIFIED_FIRST_PARTY: {
    label: 'Verified first-party',
    description: 'Commercial first-party publisher with a confirmed working collector.',
    color: 'bg-blue-100 text-blue-800',
  },
  SCOPE_LIMITED: {
    label: 'Scope limited',
    description: 'Works, but only for specific jurisdictions or a bounded program.',
    color: 'bg-amber-100 text-amber-800',
  },
  LOCAL_ROUTE: {
    label: 'Local route',
    description: 'Requires per-jurisdiction enrollment and verification before use.',
    color: 'bg-amber-100 text-amber-800',
  },
  DISCOVERY_ONLY: {
    label: 'Discovery only',
    description: 'Catalog entry for investigation; no live collector yet.',
    color: 'bg-gray-100 text-gray-600',
  },
  INCONCLUSIVE_BLOCKED: {
    label: 'Blocked',
    description: 'Access denied by robots, CAPTCHA/Turnstile, or equivalent publisher control.',
    color: 'bg-red-100 text-red-800',
  },
  RETIRED: {
    label: 'Retired',
    description: 'No longer functional; kept for provenance and migration only.',
    color: 'bg-gray-100 text-gray-500',
  },
};

/**
 * Badge for one source's trust, or null when it has no recorded trust.
 *
 * An unknown or operational value yields null rather than a guess: showing no
 * badge is honest, showing a wrong one is not.
 *
 * @param {string | undefined} trustStatus
 */
function taxonomyBadge(trustStatus) {
  if (!trustStatus) return null;
  return SOURCE_STATUSES[trustStatus] ?? null;
}

module.exports = { taxonomySummary, taxonomyBadge };