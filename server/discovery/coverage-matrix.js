// server/discovery/coverage-matrix.js
//
// Per-state coverage matrix for the source catalog.
//
// What this module computes:
//   - how many catalog entries reference each US state (parsed from the
//     free-text `coverage` field), broken out by status (verified, scope
//     limited, discovery only, blocked, retired)
//   - how many live listings each (state, source) pair has on disk, so
//     the UI can answer "for state X, which sources have actually
//     published data?"
//   - aggregate counts (total, byStatus, byRole, byCategory) carried over
//     from summarizeCatalog()
//
// What this module does NOT do:
//   - it does not parse county-level detail from free text (too brittle)
//   - it does not hit the network; the live listing count is read from
//     the local cache file the in-memory DB uses
//   - it does not invent coverage where the catalog says nothing

const { SOURCE_CATALOG, SOURCE_STATUSES, summarizeCatalog } = require('../sources/catalog');
const { loadLiveRecords } = require('../db/live-record-store');

const US_STATE_ABBRS = Object.freeze([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY'
]);
const US_STATE_SET = new Set(US_STATE_ABBRS);

// Match a US state abbreviation as a UPPERCASE 2-letter token with
// non-letter boundaries. Without the `i` flag we deliberately reject
// lowercase words like "in" (Indiana) or "me" (Maine) that happen to
// coincide with a state code - they are prose, not state references.
const STATE_REGEX = new RegExp('(?:^|[^A-Za-z])(' + US_STATE_ABBRS.join('|') + ')(?:[^A-Za-z]|$)', 'g');

function extractStateAbbrs(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const seen = new Set();
  for (const match of text.matchAll(STATE_REGEX)) {
    const abbr = match[1].toUpperCase();
    if (seen.has(abbr)) continue;
    seen.add(abbr);
    out.push(abbr);
  }
  return out;
}

function statesFromEntry(entry) {
  const text = `${entry.coverage || ''} ${entry.notes || ''}`;
  return extractStateAbbrs(text);
}

function emptyStateBucket() {
  return {
    VERIFIED_OFFICIAL: 0,
    VERIFIED_FIRST_PARTY: 0,
    SCOPE_LIMITED: 0,
    LOCAL_ROUTE: 0,
    DISCOVERY_ONLY: 0,
    INCONCLUSIVE_BLOCKED: 0,
    RETIRED: 0,
    total: 0
  };
}

function buildCatalogStateCoverage() {
  const byState = {};
  const statesSeen = new Set();
  for (const entry of SOURCE_CATALOG) {
    const states = statesFromEntry(entry);
    const status = entry.status || 'DISCOVERY_ONLY';
    for (const state of states) {
      statesSeen.add(state);
      if (!byState[state]) byState[state] = emptyStateBucket();
      if (byState[state][status] === undefined) byState[state][status] = 0;
      byState[state][status] += 1;
      byState[state].total += 1;
    }
  }
  return {
    states: US_STATE_ABBRS.filter((s) => statesSeen.has(s)),
    statesWithCoverage: statesSeen.size,
    byState
  };
}

function buildLiveStateSourceCoverage() {
  // Pull live listings from the in-memory cache. The cache is the canonical
  // source-of-truth for what we have actually published; running this
  // module never touches the network.
  let records = [];
  try {
    const merged = loadLiveRecords();
    records = Array.isArray(merged) ? merged : (Array.isArray(merged?.records) ? merged.records : []);
  } catch (_) {
    records = [];
  }
  const byStateSource = {};
  const byStateTotal = {};
  for (const record of records) {
    const state = typeof record?.state === 'string' ? record.state.toUpperCase() : null;
    const source = typeof record?.source === 'string' ? record.source : null;
    if (!state || !source) continue;
    if (!US_STATE_SET.has(state)) continue;
    if (!byStateSource[state]) byStateSource[state] = {};
    if (!byStateSource[state][source]) byStateSource[state][source] = { live: 0, observed: null };
    byStateSource[state][source].live += 1;
    const observedAt = record.sourceObservedAt || record.provenance?.observedAt || null;
    if (observedAt) {
      const t = Date.parse(observedAt);
      if (Number.isFinite(t)) {
        const current = byStateSource[state][source].observed;
        if (current === null || t > Date.parse(current)) byStateSource[state][source].observed = new Date(t).toISOString();
      }
    }
    byStateTotal[state] = (byStateTotal[state] || 0) + 1;
  }
  return { byStateSource, byStateTotal, totalRecords: records.length };
}

function summarize() {
  const aggregate = summarizeCatalog();
  const catalogCoverage = buildCatalogStateCoverage();
  const liveCoverage = buildLiveStateSourceCoverage();
  return {
    catalog: {
      total: aggregate.total,
      byRole: aggregate.byRole,
      byCategory: aggregate.byCategory,
      byStatus: aggregate.byStatus
    },
    catalogByState: catalogCoverage,
    liveByState: liveCoverage,
    states: US_STATE_ABBRS,
    statusLabels: Object.fromEntries(
      Object.entries(SOURCE_STATUSES).map(([key, value]) => [key, value.label])
    )
  };
}

module.exports = {
  summarize,
  extractStateAbbrs,
  statesFromEntry,
  buildCatalogStateCoverage,
  buildLiveStateSourceCoverage,
  US_STATE_ABBRS
};