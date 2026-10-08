// server/discovery/coverage-matrix.js
//
// Per-state coverage matrix for the source catalog.
//
// What this module computes:
//   - how many catalog entries reference each US state (parsed from the
//     free-text `coverage` and `notes` fields combined), broken out by status
//     (verified official, verified first party, scope limited, local route,
//     discovery only, inconclusive/blocked, retired)
//   - how many live listings each (state, source) pair has in the live record
//     store, so a caller can answer "for state X, which sources have actually
//     published data?"
//   - aggregate counts (total, byStatus, byRole, byCategory) carried over
//     from summarizeCatalog()
//
// What this module does NOT do:
//   - it does not parse county-level detail from free text (too brittle)
//   - it does not hit the network; the live listing count is read from the
//     local live record store on disk
//   - it does not invent coverage where the catalog says nothing
//
// Honesty contract for the live half: `buildLiveStateSourceCoverage` reports
// `storeStatus` and `readError` so a store that could not be read is never
// presented as zero coverage. Records whose state is not one of the 51 codes
// are counted in `excludedRecords` / `excludedByState`, not dropped silently.

const fs = require('node:fs');
const { SOURCE_CATALOG, SOURCE_STATUSES, summarizeCatalog } = require('../sources/catalog');
const { loadLiveRecords, resolveLiveStorePath } = require('../db/live-record-store');

// Re-parsing the store costs ~130ms for a 28MB file and the file only changes
// when a collector rewrites it, so cache on its mtime+size signature. The stat
// runs on every call; only the parse is skipped.
let liveStoreCache = null;

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

// Node's fs errors carry the full path in .message -- "EACCES: permission
// denied, stat 'C:\...'" -- and this string is served by /api/coverage. The
// failure is worth reporting; the OS username and deployment layout it drags
// along are not. .code and .syscall carry the entire diagnostic on their own.
function describeLiveStoreError(error) {
  const code = error && error.code;
  const syscall = error && error.syscall;
  if (code && syscall) return `${code} while running ${syscall} on the live record store`;
  if (code) return `${code} reading the live record store`;
  return 'Could not read the live record store';
}

function readLiveStore() {
  const storePath = resolveLiveStorePath();
  let signature;
  try {
    const stats = fs.statSync(storePath);
    if (!stats.isFile()) {
      return { records: [], storePath, storeStatus: 'unreadable', readError: 'Live record store path is not a regular file' };
    }
    signature = `${stats.mtimeMs}:${stats.size}`;
  } catch (error) {
    // An absent store is an honest zero. Anything else is a read failure and
    // must be reported as one, never folded into "no live coverage".
    if (error.code === 'ENOENT') return { records: [], storePath, storeStatus: 'absent', readError: null };
    return { records: [], storePath, storeStatus: 'unreadable', readError: `Could not inspect live record store: ${describeLiveStoreError(error)}` };
  }
  const key = `${storePath}|${signature}`;
  if (liveStoreCache && liveStoreCache.key === key) return liveStoreCache.result;
  let result;
  try {
    result = { records: loadLiveRecords(storePath), storePath, storeStatus: 'read', readError: null };
  } catch (error) {
    result = { records: [], storePath, storeStatus: 'unreadable', readError: describeLiveStoreError(error) };
  }
  liveStoreCache = { key, result };
  return result;
}

function buildLiveStateSourceCoverage() {
  // Read the live record store - the canonical record of what we have actually
  // published. Running this module never touches the network.
  const { records, storeStatus, readError } = readLiveStore();
  const byStateSource = {};
  const byStateTotal = {};
  // Records whose state is not one of the 51 codes are real published records.
  // Dropping them without accounting would understate the store, so they are
  // counted here and surfaced to the caller.
  const excludedByState = {};
  let missingSource = 0;
  for (const record of records) {
    const source = typeof record?.source === 'string' ? record.source : null;
    if (!source) { missingSource += 1; continue; }
    const state = typeof record.state === 'string' ? record.state.toUpperCase() : null;
    if (!state) { excludedByState['<no state>'] = (excludedByState['<no state>'] || 0) + 1; continue; }
    if (!US_STATE_SET.has(state)) { excludedByState[state] = (excludedByState[state] || 0) + 1; continue; }
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
  const excludedRecords = Object.values(excludedByState).reduce((a, n) => a + n, 0) + missingSource;
  return {
    byStateSource,
    byStateTotal,
    totalRecords: records.length,
    countedRecords: records.length - excludedRecords,
    // storePath is deliberately absent. It is useful while diagnosing the store on
// disk, but this object is served by /api/coverage and nothing in src/ reads
// the path -- it only hands over the OS username and the deployment layout.
storeStatus,
    // null when the store was read or is genuinely absent; a message when the
    // store exists but could not be read. Consumers must not present a
    // readError as zero coverage. The message names the failure code, never the
    // path, because Node's fs errors put the full path in error.message.
    readError,
    excludedRecords,
    excludedByState
  };
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
    // The full 51-code schema, i.e. every state the matrix can describe.
    // This is NOT the set of states the catalog actually mentions - that is
    // `catalogByState.states` (filtered) and `catalogByState.statesWithCoverage`.
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
  describeLiveStoreError,
  US_STATE_ABBRS
};