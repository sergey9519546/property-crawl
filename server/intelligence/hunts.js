'use strict';

const crypto = require('node:crypto');
const { validateListingForIngestion } = require('../scrapers/validation');
const {
  HUNT_ID, MAX_BASELINE_RECORDS, MAX_EVENTS, MAX_HUNTS, loadStore, mutateStore,
} = require('./hunt-store');

const MAX_NAME_LENGTH = 80;
const MAX_RULES = 20;
const MAX_CRITERIA_BYTES = 16 * 1024;
const MAX_RETURNED_RESULTS = 500;
const MAX_RETURNED_EVENTS = 200;
const MAX_VERSIONS = 20;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const STRING_OPERATORS = new Set(['eq', 'neq', 'in', 'not_in', 'known', 'unknown']);
const NUMBER_OPERATORS = new Set(['eq', 'neq', 'gte', 'lte', 'between', 'known', 'unknown']);
const DATE_OPERATORS = new Set(['before', 'on_or_before', 'after', 'on_or_after', 'between', 'known', 'unknown']);
const FIELD_DEFINITIONS = Object.freeze({
  state: { type: 'string', normalize: 'upper', evidenceClass: 'publisher_reported' },
  source: { type: 'string', normalize: 'lower', evidenceClass: 'observation_metadata' },
  county: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  city: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  propType: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  status: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  auctionProgram: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  lifecycleStatus: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  transactionOutcome: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  occupancy: { type: 'string', normalize: 'lower', evidenceClass: 'publisher_reported' },
  seniorLienRisk: { type: 'string', normalize: 'lower', evidenceClass: 'derived_unverified' },
  openingBid: { type: 'number', min: 0, max: 1_000_000_000, evidenceClass: 'publisher_reported' },
  estLow: { type: 'number', min: 0, max: 1_000_000_000, evidenceClass: 'derived_unverified' },
  estHigh: { type: 'number', min: 0, max: 1_000_000_000, evidenceClass: 'derived_unverified' },
  assessed: { type: 'number', min: 0, max: 1_000_000_000, evidenceClass: 'publisher_reported' },
  mid: { type: 'number', min: 0, max: 1_000_000_000, evidenceClass: 'derived_from_listing_values' },
  ratio: { type: 'number', min: 0, max: 10000, evidenceClass: 'derived_from_listing_values' },
  equity: { type: 'number', min: -1_000_000_000, max: 1_000_000_000, evidenceClass: 'derived_from_listing_values' },
  dealScore: { type: 'number', min: 0, max: 100, evidenceClass: 'derived_from_listing_values' },
  redemptionDays: { type: 'number', min: 0, max: 10000, evidenceClass: 'derived_unverified' },
  sqft: { type: 'number', min: 0, max: 100_000_000, evidenceClass: 'publisher_reported' },
  beds: { type: 'number', min: 0, max: 100, evidenceClass: 'publisher_reported' },
  baths: { type: 'number', min: 0, max: 100, evidenceClass: 'publisher_reported' },
  year: { type: 'number', min: 1600, max: 2200, evidenceClass: 'publisher_reported' },
  saleDate: { type: 'date', evidenceClass: 'publisher_reported' },
  sourceObservedAt: { type: 'date', evidenceClass: 'observation_metadata' },
});
const MATERIAL_FIELDS = Object.freeze(['openingBid', 'saleDate', 'status', 'deposit', 'address']);
const DERIVED_PROVENANCE = Object.freeze({
  mid: 'valuationMetrics', ratio: 'valuationMetrics', equity: 'equityScenario', dealScore: 'valuationMetrics',
  redemptionDays: 'redemption', seniorLienRisk: 'seniorLienRisk',
});

class HuntError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'HuntError';
    this.code = code;
    if (details) this.details = details;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function known(value) {
  return value !== null && value !== undefined && value !== '';
}

function cleanString(value, definition) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 160 || /[\u0000-\u001f\u007f]/.test(cleaned)) return null;
  if (definition.normalize === 'upper') return cleaned.toUpperCase();
  if (definition.normalize === 'lower') return cleaned.toLowerCase();
  return cleaned;
}

function cleanNumber(value, definition) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < definition.min || value > definition.max) return null;
  return value;
}

function cleanDate(value) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeOne(value, definition) {
  if (definition.type === 'string') return cleanString(value, definition);
  if (definition.type === 'number') return cleanNumber(value, definition);
  return cleanDate(value);
}

function validateCriteria(criteria, errors = []) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
    errors.push('criteria must be an object');
    return null;
  }
  if (!['all', 'any'].includes(criteria.mode)) errors.push('criteria.mode must be all or any');
  if (!Array.isArray(criteria.rules) || criteria.rules.length < 1 || criteria.rules.length > MAX_RULES) {
    errors.push(`criteria.rules must contain 1 to ${MAX_RULES} rules`);
    return null;
  }
  const normalized = [];
  criteria.rules.forEach((rule, index) => {
    const prefix = `criteria.rules[${index}]`;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    const definition = FIELD_DEFINITIONS[rule.field];
    if (!definition) {
      errors.push(`${prefix}.field is not supported`);
      return;
    }
    const operators = definition.type === 'string' ? STRING_OPERATORS : definition.type === 'number' ? NUMBER_OPERATORS : DATE_OPERATORS;
    if (!operators.has(rule.operator)) {
      errors.push(`${prefix}.operator is not supported for ${definition.type} fields`);
      return;
    }
    const noValue = rule.operator === 'known' || rule.operator === 'unknown';
    if (noValue) {
      if (Object.hasOwn(rule, 'value') && rule.value !== undefined) errors.push(`${prefix}.value must be omitted for ${rule.operator}`);
      normalized.push({ field: rule.field, operator: rule.operator });
      return;
    }
    const listValue = ['in', 'not_in', 'between'].includes(rule.operator);
    if (listValue) {
      const expectedLength = rule.operator === 'between' ? 2 : null;
      if (!Array.isArray(rule.value) || (expectedLength && rule.value.length !== expectedLength)
        || (!expectedLength && (rule.value.length < 1 || rule.value.length > 20))) {
        errors.push(`${prefix}.value has an invalid list shape`);
        return;
      }
      const values = rule.value.map((item) => normalizeOne(item, definition));
      if (values.some((item) => item === null)) {
        errors.push(`${prefix}.value contains an invalid ${definition.type}`);
        return;
      }
      if (rule.operator === 'between' && (definition.type === 'date' ? Date.parse(values[0]) > Date.parse(values[1]) : values[0] > values[1])) {
        errors.push(`${prefix}.value lower bound must not exceed its upper bound`);
        return;
      }
      normalized.push({ field: rule.field, operator: rule.operator, value: [...new Set(values)] });
      return;
    }
    const value = normalizeOne(rule.value, definition);
    if (value === null) {
      errors.push(`${prefix}.value must be a valid ${definition.type}`);
      return;
    }
    normalized.push({ field: rule.field, operator: rule.operator, value });
  });
  const value = { mode: criteria.mode, rules: normalized };
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > MAX_CRITERIA_BYTES) errors.push(`criteria exceed the ${MAX_CRITERIA_BYTES}-byte limit`);
  return errors.length ? null : value;
}

function validateHuntInput(input, options = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { isValid: false, errors: ['hunt must be an object'] };
  const partial = options.partial === true;
  const value = {};
  if (Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > MAX_NAME_LENGTH
      || /[\u0000-\u001f\u007f]/.test(input.name)) errors.push(`name must be 1 to ${MAX_NAME_LENGTH} printable characters`);
    else value.name = input.name.replace(/\s+/g, ' ').trim();
  } else if (!partial) errors.push('name is required');
  if (Object.hasOwn(input, 'enabled')) {
    if (typeof input.enabled !== 'boolean') errors.push('enabled must be a boolean');
    else value.enabled = input.enabled;
  } else if (!partial) value.enabled = true;
  if (Object.hasOwn(input, 'criteria')) {
    const criteria = validateCriteria(input.criteria, errors);
    if (criteria) value.criteria = criteria;
  } else if (!partial) errors.push('criteria are required');
  if (partial && !Object.keys(value).length && !errors.length) errors.push('provide name, enabled, or criteria to update');
  return { isValid: errors.length === 0, errors, value: errors.length ? undefined : value };
}

function currentIso(now) {
  const date = new Date(now === undefined ? Date.now() : now);
  if (!Number.isFinite(date.getTime())) throw new HuntError('HUNT_TIME_INVALID', 'A valid evaluation time is required');
  return date.toISOString();
}

function summary(hunt) {
  return {
    id: hunt.id, name: hunt.name, enabled: hunt.enabled, version: hunt.version,
    criteria: hunt.criteria, criteriaHash: hunt.criteriaHash, createdAt: hunt.createdAt,
    updatedAt: hunt.updatedAt, versionCount: hunt.versions.length,
  };
}

function createHunt(input, options = {}) {
  const validation = validateHuntInput(input);
  if (!validation.isValid) throw new HuntError('HUNT_INVALID', 'Hunt needs corrections', validation.errors);
  const now = currentIso(options.now);
  const criteriaHash = sha(validation.value.criteria);
  const hunt = {
    id: `hunt_${crypto.randomBytes(12).toString('hex')}`,
    name: validation.value.name,
    enabled: validation.value.enabled,
    version: 1,
    criteria: validation.value.criteria,
    criteriaHash,
    createdAt: now,
    updatedAt: now,
    versions: [{ version: 1, criteria: validation.value.criteria, criteriaHash, createdAt: now }],
  };
  return mutateStore(options.filePath, (store) => {
    if (store.hunts.length >= MAX_HUNTS) throw new HuntError('HUNT_LIMIT', `No more than ${MAX_HUNTS} hunts may be stored`);
    store.hunts.push(hunt);
    return { value: summary(hunt) };
  }, { now });
}

function findHunt(store, id) {
  if (!HUNT_ID.test(id || '')) throw new HuntError('HUNT_ID_INVALID', 'Hunt id is invalid');
  const hunt = store.hunts.find((item) => item.id === id);
  if (!hunt) throw new HuntError('HUNT_NOT_FOUND', 'Hunt was not found');
  return hunt;
}

function listHunts(options = {}) {
  return loadStore(options.filePath).hunts
    .slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary);
}

function getHunt(id, options = {}) {
  const store = loadStore(options.filePath);
  const hunt = findHunt(store, id);
  return {
    hunt: {
      ...summary(hunt),
      versions: hunt.versions.map((version) => ({
        version: version.version,
        criteria: version.criteria,
        criteriaHash: version.criteriaHash,
        createdAt: version.createdAt,
      })),
    },
    baseline: summarizeBaseline(store.baselines[id]),
    recentEvents: store.events.filter((event) => event.huntId === id).slice(0, 20),
  };
}

function updateHunt(id, input, options = {}) {
  const validation = validateHuntInput(input, { partial: true });
  if (!validation.isValid) throw new HuntError('HUNT_INVALID', 'Hunt needs corrections', validation.errors);
  const now = currentIso(options.now);
  return mutateStore(options.filePath, (store) => {
    const hunt = findHunt(store, id);
    if (validation.value.name !== undefined) hunt.name = validation.value.name;
    if (validation.value.enabled !== undefined) hunt.enabled = validation.value.enabled;
    if (validation.value.criteria) {
      const criteriaHash = sha(validation.value.criteria);
      if (criteriaHash !== hunt.criteriaHash) {
        hunt.version += 1;
        hunt.criteria = validation.value.criteria;
        hunt.criteriaHash = criteriaHash;
        hunt.versions.push({ version: hunt.version, criteria: hunt.criteria, criteriaHash, createdAt: now });
        hunt.versions = hunt.versions.slice(-MAX_VERSIONS);
        delete store.baselines[id];
      }
    }
    hunt.updatedAt = now;
    return { value: summary(hunt) };
  }, { now });
}

function deleteHunt(id, options = {}) {
  return mutateStore(options.filePath, (store) => {
    const hunt = findHunt(store, id);
    store.hunts = store.hunts.filter((item) => item.id !== hunt.id);
    delete store.baselines[id];
    store.events = store.events.filter((event) => event.huntId !== id);
    return { value: { deleted: true, id } };
  }, { now: options.now });
}

function hasDerivedMarker(listing, field) {
  const derivedFields = listing.provenance?.derivedFields;
  return Boolean(derivedFields && typeof derivedFields === 'object' && Object.hasOwn(derivedFields, field));
}

function finiteListingNumber(listing, field) {
  const value = listing[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nearlyEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-9);
}

function supportedDerivedValue(listing, field, evidence) {
  if (!evidence || typeof evidence !== 'object' || typeof evidence.model !== 'string' || !evidence.model.trim()
    || !Array.isArray(evidence.inputs) || evidence.inputs.some((input) => typeof input !== 'string')) return false;
  const inputs = new Set(evidence.inputs);
  if (field === 'mid' || field === 'ratio' || field === 'dealScore') {
    if (evidence.model !== 'observed-valuation-range-v1' || !inputs.has('estLow') || !inputs.has('estHigh')) return false;
    const estLow = finiteListingNumber(listing, 'estLow');
    const estHigh = finiteListingNumber(listing, 'estHigh');
    if (estLow === null || estHigh === null || estLow <= 0 || estHigh < estLow) return false;
    const expectedMid = (estLow + estHigh) / 2;
    if (field === 'mid') return nearlyEqual(finiteListingNumber(listing, field), expectedMid);
    const openingBid = finiteListingNumber(listing, 'openingBid');
    if (!inputs.has('openingBid') || openingBid === null || openingBid <= 0 || expectedMid <= 0) return false;
    const expectedRatio = openingBid / expectedMid;
    if (field === 'ratio') return nearlyEqual(finiteListingNumber(listing, field), expectedRatio);
    const expectedScore = Math.max(1, Math.min(99, Math.round((1 - expectedRatio) * 130)));
    return finiteListingNumber(listing, field) === expectedScore;
  }
  // Legacy normalization calls mid minus opening bid "equity". That is a bid spread,
  // not debt-adjusted owner equity, so no current equity model is authorized here.
  if (field === 'equity') return false;
  if (field === 'redemptionDays') {
    return evidence.model === 'state-statutory-rule-lookup-v1' && inputs.has('state') && known(listing.state);
  }
  if (field === 'seniorLienRisk') {
    return evidence.model === 'legal-text-pattern-v1'
      && evidence.inputs.some((input) => inputs.has(input) && known(listing[input]));
  }
  return false;
}

function actualEvidence(listing, field, definition) {
  if (definition.evidenceClass === 'publisher_reported' && hasDerivedMarker(listing, field)) {
    return { actual: null, evidenceClass: 'derived_unverified' };
  }
  const provenanceKey = DERIVED_PROVENANCE[field];
  if (provenanceKey) {
    const evidence = listing.provenance?.derivedFields?.[provenanceKey];
    if (!supportedDerivedValue(listing, field, evidence)) {
      return { actual: null, evidenceClass: definition.evidenceClass };
    }
  }
  const raw = field === 'sourceObservedAt' ? listing.sourceObservedAt || listing.provenance?.observedAt : listing[field];
  if (!known(raw)) return { actual: null, evidenceClass: definition.evidenceClass };
  return { actual: normalizeOne(raw, definition), evidenceClass: definition.evidenceClass };
}

function actualValue(listing, field, definition) {
  return actualEvidence(listing, field, definition).actual;
}

function compareRule(actual, rule, definition) {
  if (rule.operator === 'known') return actual === null ? 'no_match' : 'match';
  if (rule.operator === 'unknown') return actual === null ? 'match' : 'no_match';
  if (actual === null) return 'unknown';
  const expected = rule.value;
  if (rule.operator === 'eq') return actual === expected ? 'match' : 'no_match';
  if (rule.operator === 'neq') return actual !== expected ? 'match' : 'no_match';
  if (rule.operator === 'in') return expected.includes(actual) ? 'match' : 'no_match';
  if (rule.operator === 'not_in') return !expected.includes(actual) ? 'match' : 'no_match';
  const left = definition.type === 'date' ? Date.parse(actual) : actual;
  const right = (value) => definition.type === 'date' ? Date.parse(value) : value;
  if (rule.operator === 'gte' || rule.operator === 'on_or_after') return left >= right(expected) ? 'match' : 'no_match';
  if (rule.operator === 'lte' || rule.operator === 'on_or_before') return left <= right(expected) ? 'match' : 'no_match';
  if (rule.operator === 'before') return left < right(expected) ? 'match' : 'no_match';
  if (rule.operator === 'after') return left > right(expected) ? 'match' : 'no_match';
  if (rule.operator === 'between') return left >= right(expected[0]) && left <= right(expected[1]) ? 'match' : 'no_match';
  return 'unknown';
}

function ruleReason(rule, status, actual) {
  if (status === 'unknown') return `${rule.field} is unavailable, so ${rule.operator} cannot be established.`;
  if (rule.operator === 'known') return status === 'match' ? `${rule.field} is present.` : `${rule.field} is unavailable.`;
  if (rule.operator === 'unknown') return status === 'match' ? `${rule.field} is unavailable as required.` : `${rule.field} is present.`;
  return `${rule.field} ${status === 'match' ? 'satisfies' : 'does not satisfy'} ${rule.operator}.`;
}

function combine(mode, clauseResults) {
  const statuses = clauseResults.map((result) => result.status);
  if (mode === 'all') {
    if (statuses.includes('no_match')) return 'no_match';
    return statuses.includes('unknown') ? 'unknown' : 'match';
  }
  if (statuses.includes('match')) return 'match';
  return statuses.includes('unknown') ? 'unknown' : 'no_match';
}

function validateObservedListing(listing, now) {
  const validation = validateListingForIngestion(listing);
  const observedAt = validation.listing.sourceObservedAt || validation.listing.provenance?.observedAt;
  const errors = [...validation.errors];
  if (validation.listing.provenance?.origin !== 'live') errors.push('non_live_origin');
  if (Number.isFinite(Date.parse(observedAt)) && Date.parse(observedAt) > Date.parse(now) + FUTURE_TOLERANCE_MS) errors.push('future_observation');
  return { isValid: errors.length === 0, errors: [...new Set(errors)], listing: validation.listing, observedAt };
}

function evaluateListing(listing, hunt, options = {}) {
  const now = currentIso(options.now);
  const observed = validateObservedListing(listing, now);
  if (!observed.isValid) {
    return {
      listingId: typeof listing?.id === 'string' ? listing.id.slice(0, 160) : null,
      status: 'unknown', observedAt: null, sourceId: null, sourceUrl: null,
      clauseResults: [], reasons: ['Listing lacks validated live publisher evidence.'],
      validationErrors: observed.errors,
    };
  }
  const clauseResults = hunt.criteria.rules.map((rule) => {
    const definition = FIELD_DEFINITIONS[rule.field];
    const { actual, evidenceClass } = actualEvidence(observed.listing, rule.field, definition);
    const status = compareRule(actual, rule, definition);
    return {
      field: rule.field, operator: rule.operator,
      ...(Object.hasOwn(rule, 'value') ? { expected: rule.value } : {}),
      actual, status, evidenceClass,
      reason: ruleReason(rule, status, actual),
    };
  });
  const status = combine(hunt.criteria.mode, clauseResults);
  return {
    listingId: observed.listing.id, status, observedAt: new Date(observed.observedAt).toISOString(),
    address: observed.listing.address, sourceId: observed.listing.source, sourceUrl: observed.listing.sourceUrl,
    recordId: String(observed.listing.provenance.recordId), clauseResults,
    reasons: clauseResults.filter((result) => result.status !== 'match').map((result) => result.reason),
    validationErrors: [],
  };
}

function compactMaterialSnapshot(listing, hunt) {
  const fields = new Set([...MATERIAL_FIELDS, ...hunt.criteria.rules.map((rule) => rule.field)]);
  const snapshot = {};
  for (const field of fields) {
    if (field === 'sourceObservedAt') continue;
    if (FIELD_DEFINITIONS[field]) snapshot[field] = actualValue(listing, field, FIELD_DEFINITIONS[field]);
    else {
      const value = listing[field];
      snapshot[field] = known(value) ? String(value).replace(/\s+/g, ' ').trim().slice(0, field === 'address' ? 500 : 200) : null;
    }
  }
  return snapshot;
}

function identityKey(sourceId, recordId) {
  return sha(`${sourceId}\n${recordId}`);
}

function eventFor(type, hunt, previous, current, detectedAt, changedFields = []) {
  const id = `hevt_${sha(`${hunt.id}\n${hunt.version}\n${type}\n${current.identityKey}\n${current.observedAt}\n${current.evaluationHash}\n${current.valueHash}`).slice(0, 24)}`;
  const messages = {
    new_match: 'A validated source record now matches this hunt.',
    material_change: 'A validated source record still matches and supported fields changed.',
    no_longer_matches: 'The same validated source record no longer matches this hunt.',
    evaluation_unknown: 'The same validated source record now lacks evidence needed to evaluate this hunt.',
  };
  return {
    id, type, huntId: hunt.id, huntVersion: hunt.version, identityKey: current.identityKey,
    listingId: current.listingId, address: current.address, sourceId: current.sourceId, sourceUrl: current.sourceUrl,
    observedAt: current.observedAt, detectedAt, previousStatus: previous?.status || null,
    currentStatus: current.status, previousEvaluationHash: previous?.evaluationHash || null,
    currentEvaluationHash: current.evaluationHash, changedFields,
    changes: Object.fromEntries(changedFields.map((field) => [field, {
      previous: previous?.snapshot?.[field] ?? null,
      current: current.snapshot?.[field] ?? null,
    }])),
    clauseResults: current.clauseResults,
    message: messages[type],
  };
}

function changedFields(previous, current) {
  const keys = new Set([...Object.keys(previous.snapshot || {}), ...Object.keys(current.snapshot || {})]);
  return [...keys].filter((key) => canonicalJson(previous.snapshot?.[key]) !== canonicalJson(current.snapshot?.[key]));
}

function evaluateInventory(hunt, listings, options = {}) {
  if (!hunt.enabled) throw new HuntError('HUNT_DISABLED', 'Enable the hunt before evaluating it');
  if (!Array.isArray(listings) || listings.length > MAX_BASELINE_RECORDS) {
    throw new HuntError('HUNT_INVENTORY_LIMIT', `A complete inventory of at most ${MAX_BASELINE_RECORDS} listings is required`);
  }
  const evaluatedAt = currentIso(options.now);
  const previousBaseline = options.previousBaseline && options.previousBaseline.huntVersion === hunt.version ? options.previousBaseline : null;
  const baselineCreated = !previousBaseline;
  const candidates = new Map();
  const invalidResults = [];
  for (const original of listings) {
    const evaluated = evaluateListing(original, hunt, { now: evaluatedAt });
    if (evaluated.validationErrors.length) {
      invalidResults.push(evaluated);
      continue;
    }
    const key = identityKey(evaluated.sourceId, evaluated.recordId);
    const normalized = validateListingForIngestion(original).listing;
    const snapshot = compactMaterialSnapshot(normalized, hunt);
    const record = {
      identityKey: key, listingId: evaluated.listingId, sourceId: evaluated.sourceId,
      address: evaluated.address,
      recordId: evaluated.recordId.slice(0, 300), sourceUrl: evaluated.sourceUrl,
      observedAt: evaluated.observedAt, status: evaluated.status,
      clauseResults: evaluated.clauseResults,
      evaluationHash: sha({ status: evaluated.status, clauseResults: evaluated.clauseResults }),
      valueHash: sha(snapshot), snapshot,
    };
    const priorCandidate = candidates.get(key);
    if (!priorCandidate || Date.parse(record.observedAt) > Date.parse(priorCandidate.observedAt)) candidates.set(key, record);
  }

  const previousRecords = previousBaseline?.records || {};
  const nextRecords = { ...previousRecords };
  const effectiveRecords = new Map(candidates);
  const events = [];
  let olderIgnored = 0;
  for (const current of candidates.values()) {
    const previous = previousRecords[current.identityKey];
    if (previous && Date.parse(current.observedAt) <= Date.parse(previous.observedAt)) {
      olderIgnored++;
      effectiveRecords.set(current.identityKey, {
        ...previous,
        observationDisposition: 'older_ignored',
        ignoredObservedAt: current.observedAt,
      });
      continue;
    }
    nextRecords[current.identityKey] = current;
    if (baselineCreated) continue;
    if (!previous && current.status === 'match') events.push(eventFor('new_match', hunt, null, current, evaluatedAt));
    else if (previous) {
      if (previous.status !== 'match' && current.status === 'match') events.push(eventFor('new_match', hunt, previous, current, evaluatedAt));
      else if (previous.status === 'match' && current.status === 'no_match') events.push(eventFor('no_longer_matches', hunt, previous, current, evaluatedAt));
      else if (previous.status !== 'unknown' && current.status === 'unknown') events.push(eventFor('evaluation_unknown', hunt, previous, current, evaluatedAt));
      else if (previous.status === 'match' && current.status === 'match' && previous.valueHash !== current.valueHash) {
        events.push(eventFor('material_change', hunt, previous, current, evaluatedAt, changedFields(previous, current)));
      }
    }
  }
  const baselineLimit = options.baselineLimit === Infinity ? Infinity : MAX_BASELINE_RECORDS;
  if (Object.keys(nextRecords).length > baselineLimit) throw new HuntError('HUNT_BASELINE_LIMIT', `Hunt baseline cannot exceed ${MAX_BASELINE_RECORDS} records`);
  const currentStatuses = [...effectiveRecords.values()].map((record) => record.status);
  const eventCounts = Object.fromEntries(['new_match', 'material_change', 'no_longer_matches', 'evaluation_unknown'].map((type) => [type, events.filter((event) => event.type === type).length]));
  const results = [...effectiveRecords.values()].map((record) => ({
    identityKey: record.identityKey, listingId: record.listingId, sourceId: record.sourceId,
    address: record.address,
    sourceUrl: record.sourceUrl, observedAt: record.observedAt, status: record.status,
    clauseResults: record.clauseResults,
    ...(record.observationDisposition ? {
      observationDisposition: record.observationDisposition,
      ignoredObservedAt: record.ignoredObservedAt,
    } : {}),
  })).concat(invalidResults).slice(0, MAX_RETURNED_RESULTS);
  return {
    baseline: { huntVersion: hunt.version, evaluatedAt, records: nextRecords },
    events: options.suppressEvents ? [] : events,
    response: {
      huntId: hunt.id, huntVersion: hunt.version, evaluatedAt, baselineCreated,
      counts: {
        inventory: listings.length, accepted: candidates.size, rejected: invalidResults.length,
        match: currentStatuses.filter((status) => status === 'match').length,
        noMatch: currentStatuses.filter((status) => status === 'no_match').length,
        unknown: currentStatuses.filter((status) => status === 'unknown').length,
        newMatch: eventCounts.new_match, materialChange: eventCounts.material_change,
        noLongerMatches: eventCounts.no_longer_matches, evidenceUnknown: eventCounts.evaluation_unknown,
        notObserved: Object.keys(previousRecords).filter((key) => !candidates.has(key)).length,
        olderIgnored,
      },
      results,
      resultsTruncated: candidates.size + invalidResults.length > MAX_RETURNED_RESULTS,
      newEvents: options.suppressEvents ? [] : events.slice(0, MAX_RETURNED_EVENTS),
      eventsTruncated: !options.suppressEvents && events.length > MAX_RETURNED_EVENTS,
      interpretation: baselineCreated
        ? 'Initial evaluation established a comparison baseline and emitted no lifecycle events.'
        : 'Events compare newer observations for the same exact publisher record. Missing inventory never implies a sale or resolution.',
    },
  };
}

function runHunt(id, listings, options = {}) {
  const now = currentIso(options.now);
  return mutateStore(options.filePath, (store) => {
    const hunt = findHunt(store, id);
    const evaluated = evaluateInventory(hunt, listings, { now, previousBaseline: store.baselines[id] });
    store.baselines[id] = evaluated.baseline;
    const existing = new Set(store.events.map((event) => event.id));
    store.events = [...evaluated.events.filter((event) => !existing.has(event.id)), ...store.events]
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)).slice(0, MAX_EVENTS);
    return { value: evaluated.response };
  }, { now });
}

function summarizeBaseline(baseline) {
  if (!baseline) return null;
  const records = Object.values(baseline.records || {});
  return {
    huntVersion: baseline.huntVersion, evaluatedAt: baseline.evaluatedAt, records: records.length,
    match: records.filter((record) => record.status === 'match').length,
    noMatch: records.filter((record) => record.status === 'no_match').length,
    unknown: records.filter((record) => record.status === 'unknown').length,
  };
}

function listEvents(id, filters = {}, options = {}) {
  const store = loadStore(options.filePath);
  findHunt(store, id);
  const limit = Math.max(1, Math.min(200, Math.floor(Number(filters.limit) || 50)));
  return store.events.filter((event) => event.huntId === id).slice(0, limit);
}

module.exports = {
  DATE_OPERATORS,
  DERIVED_PROVENANCE,
  FIELD_DEFINITIONS,
  HuntError,
  MAX_CRITERIA_BYTES,
  MAX_RETURNED_EVENTS,
  MAX_RETURNED_RESULTS,
  MAX_RULES,
  NUMBER_OPERATORS,
  STRING_OPERATORS,
  canonicalJson,
  createHunt,
  deleteHunt,
  evaluateInventory,
  evaluateListing,
  getHunt,
  identityKey,
  listEvents,
  listHunts,
  runHunt,
  summarizeBaseline,
  updateHunt,
  validateCriteria,
  validateHuntInput,
};
