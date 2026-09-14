'use strict';

const MAX_COUNT = 1_000_000_000;
const FILTER_KEYS = new Set(['assetClass', 'propertyType', 'states', 'state', 'countyId', 'program', 'status', 'caseStepNumber', 'listingType']);
const OUTCOMES = new Set(['success', 'empty', 'partial_failure', 'failed', 'running']);

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined;
}

function firstInteger(...values) {
  for (const value of values) {
    const bounded = nonnegativeInteger(value);
    if (bounded !== undefined) return bounded;
  }
  return undefined;
}

function stateCodes(value) {
  if (!Array.isArray(value)) return undefined;
  const result = [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim().toUpperCase()).filter(item => /^[A-Z]{2}$/.test(item)))].slice(0, 60);
  return result.length || value.length === 0 ? result : undefined;
}

function safeEndpoint(value) {
  if (typeof value !== 'string' || !value || value.length > 500) return undefined;
  if (value.startsWith('/') && !/[?#]/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return url.toString();
  } catch {}
  return undefined;
}

function safeFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!FILTER_KEYS.has(key)) continue;
    if (key === 'states') {
      const codes = stateCodes(raw);
      if (codes !== undefined) output[key] = codes;
    } else if (key === 'countyId') {
      if (typeof raw === 'string' && /^\d{1,20}$/.test(raw)) output[key] = raw;
    } else if (typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw)) || (typeof raw === 'string' && raw.length <= 200)) output[key] = raw;
  }
  return Object.keys(output).length || Object.keys(value).length === 0 ? output : undefined;
}

function acquisitionScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return undefined;
  const endpoint = safeEndpoint(scope.endpoint);
  const filters = safeFilters(scope.filters);
  const states = stateCodes(scope.states);
  const pageSize = nonnegativeInteger(scope.pageSize);
  const jurisdictionSelection = scope.jurisdictionSelection === 'publisher_inventory_options' ? scope.jurisdictionSelection : undefined;
  const result = {
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(filters !== undefined ? { filters } : {}),
    ...(states !== undefined ? { states } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(jurisdictionSelection !== undefined ? { jurisdictionSelection } : {})
  };
  return Object.keys(result).length ? result : undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function countOrArrayLength(value) {
  return Array.isArray(value) ? nonnegativeInteger(stateCodes(value)?.length) : nonnegativeInteger(value);
}

function sanitizeRunReport(report, additions = {}) {
  const source = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
  const counts = compactObject({
    publisherDiscovered: firstInteger(source.recordsDiscovered, source.sourceRows),
    parserEmitted: firstInteger(source.recordsEmitted, source.listingsEmitted),
    parserRejected: firstInteger(source.recordsRejected),
    recordsSkipped: firstInteger(source.recordsSkipped),
    sourceRows: firstInteger(source.sourceRows),
    malformedRows: firstInteger(source.malformedRows),
    listingsParsed: firstInteger(source.listingsParsed),
    accepted: firstInteger(additions.accepted),
    ingestionRejected: firstInteger(additions.ingestionRejected)
  });
  const pages = compactObject({
    requested: firstInteger(source.pagesRequested), attempted: firstInteger(source.pagesAttempted),
    fetched: firstInteger(source.pagesFetched), previouslyCommitted: firstInteger(source.pagesPreviouslyCommitted)
  });
  const completedStateCodes = Array.isArray(source.completedStates) ? source.completedStates : source.statesCompleted;
  const jurisdictions = compactObject({
    configured: countOrArrayLength(source.configuredStates), discovered: countOrArrayLength(source.statesDiscovered),
    attempted: countOrArrayLength(source.statesAttempted),
    completed: firstInteger(countOrArrayLength(source.completedStates), countOrArrayLength(source.statesCompleted)),
    remaining: countOrArrayLength(source.remainingStates),
    failed: firstInteger(source.statesFailed), withListings: firstInteger(source.statesWithListings),
    empty: firstInteger(source.statesEmpty), fallback: firstInteger(source.fallbackStates),
    codes: compactObject({
      configured: stateCodes(source.configuredStates), discovered: stateCodes(source.discoveredStates),
      attempted: stateCodes(source.attemptedStates), completed: stateCodes(completedStateCodes), remaining: stateCodes(source.remainingStates)
    })
  });
  if (!Object.keys(jurisdictions.codes).length) delete jurisdictions.codes;
  const budget = compactObject({ bounded: typeof source.bounded === 'boolean' ? source.bounded : undefined, maxPages: firstInteger(source.maxPages), pageSize: firstInteger(source.limit, source.scope?.pageSize), maxPagesPerState: firstInteger(source.scope?.maxPagesPerState) });
  const scope = acquisitionScope(source.scope);
  const started = typeof source.sweepStartedAt === 'string' && Number.isFinite(Date.parse(source.sweepStartedAt)) ? new Date(source.sweepStartedAt).toISOString() : undefined;
  return compactObject({
    version: 1,
    outcome: OUTCOMES.has(source.outcome) ? source.outcome : undefined,
    complete: typeof source.complete === 'boolean' ? source.complete : undefined,
    fullSweepComplete: typeof source.fullSweepComplete === 'boolean' ? source.fullSweepComplete : undefined,
    truncated: typeof source.truncated === 'boolean' ? source.truncated : undefined,
    acquisitionScope: scope,
    counts: Object.keys(counts).length ? counts : undefined,
    pages: Object.keys(pages).length ? pages : undefined,
    jurisdictions: Object.keys(jurisdictions).length ? jurisdictions : undefined,
    budget: Object.keys(budget).length ? budget : undefined,
    sweepStartedAt: started
  });
}

module.exports = { sanitizeRunReport, acquisitionScope, MAX_COUNT };
