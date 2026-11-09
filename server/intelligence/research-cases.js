'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const { buildPropertyDossier } = require('./dossier');
const { validateListingForIngestion } = require('../scrapers/validation');
const {
  CASE_ID, MAX_CASE_HISTORY, MAX_CASES, loadStore, mutateStore,
} = require('./research-store');

const SOURCE_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const INTAKE_ID = /^intake_[a-f0-9]{24}$/;
const STATES = new Set(['inbox', 'pursue', 'pass']);
const ORIGIN_TYPES = new Set(['manual', 'browser_import', 'hunt_match', 'new_match', 'material_change', 'evaluation_unknown']);
const RELATIONSHIPS = new Set(['supports_identity', 'sale_terms', 'title_research', 'occupancy_research', 'valuation_research', 'other']);
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SENSITIVE_TEXT = /(?:authorization\s*:\s*(?:bearer|basic)|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key)\s*[:=]\s*[^\s,;]+)/i;
const MAX_ORIGINS = 100;
const MAX_EVIDENCE_LINKS = 100;
const MAX_IMPORT_IDS = 200;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const RECONSIDERATION_FIELDS = Object.freeze({
  openingBid: new Set(['changed', 'lte', 'gte', 'dropped_by_pct', 'bid_to_assessed_lte']),
  saleDate: new Set(['changed', 'within_days']),
  status: new Set(['changed']),
  sqft: new Set(['changed', 'lte', 'gte']),
  requiredEvidence: new Set(['available']),
  titleRisk: new Set(['changed', 'junior_lien_surviving_mortgage', 'irs_redemption_active', 'hoa_super_priority']),
});

class ResearchCaseError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ResearchCaseError';
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

function nowIso(now) {
  const value = typeof now === 'function' ? now() : (now === undefined ? Date.now() : now);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ResearchCaseError('RESEARCH_TIME_INVALID', 'A valid workspace time is required');
  return date.toISOString();
}

function cleanText(value, maximum, field, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new ResearchCaseError('RESEARCH_INVALID', `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ResearchCaseError('RESEARCH_INVALID', `${field} must be text`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new ResearchCaseError('RESEARCH_INVALID', `${field} must be 1 to ${maximum} printable characters`);
  }
  if (SENSITIVE_TEXT.test(text)) throw new ResearchCaseError('RESEARCH_SENSITIVE', `${field} appears to contain a credential and cannot be retained`);
  return text;
}

function normalizeSourceRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResearchCaseError('RESEARCH_SOURCE_REF_INVALID', 'sourceRef with sourceId and recordId is required');
  }
  const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim().toLowerCase() : '';
  if (!SOURCE_ID.test(sourceId)) throw new ResearchCaseError('RESEARCH_SOURCE_REF_INVALID', 'sourceRef.sourceId is invalid');
  const recordId = cleanText(value.recordId, 300, 'sourceRef.recordId', { required: true });
  return { sourceId, recordId };
}

function identityKey(sourceRef) {
  const normalized = normalizeSourceRef(sourceRef);
  return sha(`${normalized.sourceId}\n${normalized.recordId}`);
}

function sourceRefFromListing(listing, referenceNow = Date.now()) {
  const validation = validateListingForIngestion(listing);
  const normalized = validation.listing;
  const errors = [...validation.errors];
  if (normalized.provenance?.origin !== 'live') errors.push('non_live_origin');
  const observedAt = normalized.sourceObservedAt || normalized.provenance?.observedAt;
  if (Number.isFinite(Date.parse(observedAt)) && Date.parse(observedAt) > Date.parse(referenceNow) + FUTURE_TOLERANCE_MS) errors.push('future_observation');
  if (errors.length) throw new ResearchCaseError('RESEARCH_LISTING_UNVERIFIED', 'Research cases require validated live publisher evidence', [...new Set(errors)]);
  return normalizeSourceRef({ sourceId: normalized.source, recordId: String(normalized.provenance.recordId) });
}

function safeListingSnapshot(listing) {
  const allowed = [
    'id', 'address', 'state', 'county', 'city', 'zip', 'source', 'sourceUrl', 'sourceObservedAt',
    'propType', 'status', 'openingBid', 'saleDate', 'deposit', 'occupancy', 'sqft', 'assessed', 'assessedValue',
    'estLow', 'estHigh', 'dealScore', 'redemptionDays', 'redemptionWarning', 'seniorLienRisk', 'seniorLienWarning', 'plaintiff', 'rawNotice', 'notes', 'hasIrsLien', 'hasFederalTaxLien', 'bankruptcy', 'hoaDues', 'monthlyHoa', 'titleRisk', 'judgment', 'judgmentAmount',
  ];
  const snapshot = {};
  for (const field of allowed) {
    const value = listing[field];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) snapshot[field] = value; else if (value && typeof value === 'object' && !Array.isArray(value)) { try { snapshot[field] = JSON.parse(JSON.stringify(value)); } catch {} }
  }
  snapshot.provenance = {
    origin: 'live', observed: true,
    publisher: cleanText(listing.provenance?.publisher, 200, 'provenance.publisher', { required: true }),
    recordId: cleanText(String(listing.provenance?.recordId || ''), 300, 'provenance.recordId', { required: true }),
    observedAt: new Date(listing.sourceObservedAt || listing.provenance?.observedAt).toISOString(),
  };
  return snapshot;
}

function safeDossierSnapshot(dossier, maximumBytes = 768 * 1024) {
  let clone;
  try { clone = JSON.parse(JSON.stringify(dossier)); }
  catch { throw new ResearchCaseError('RESEARCH_DOSSIER_INVALID', 'Dossier must be finite JSON'); }
  const body = JSON.stringify(clone);
  if (Buffer.byteLength(body, 'utf8') > maximumBytes) throw new ResearchCaseError('RESEARCH_DOSSIER_INVALID', 'Dossier exceeds its retained size limit');
  return clone;
}

function normalizeOrigin(value, listing, timestamp) {
  const input = value == null ? { type: 'manual' } : value;
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ORIGIN_TYPES.has(input.type)) {
    throw new ResearchCaseError('RESEARCH_ORIGIN_INVALID', 'origin.type is not supported');
  }
  const origin = { type: input.type };
  for (const [field, pattern] of [['huntId', /^hunt_[a-f0-9]{24}$/], ['eventId', /^hevt_[a-f0-9]{24}$/]]) {
    if (input[field] != null) {
      if (typeof input[field] !== 'string' || !pattern.test(input[field])) throw new ResearchCaseError('RESEARCH_ORIGIN_INVALID', `origin.${field} is invalid`);
      origin[field] = input[field];
    }
  }
  if (input.huntVersion != null) {
    if (!Number.isInteger(input.huntVersion) || input.huntVersion < 1 || input.huntVersion > 100000) throw new ResearchCaseError('RESEARCH_ORIGIN_INVALID', 'origin.huntVersion is invalid');
    origin.huntVersion = input.huntVersion;
  }
  const observedAtValue = input.observedAt || listing.sourceObservedAt || listing.provenance?.observedAt;
  if (!Number.isFinite(Date.parse(observedAtValue)) || Date.parse(observedAtValue) > Date.parse(timestamp) + FUTURE_TOLERANCE_MS) {
    throw new ResearchCaseError('RESEARCH_ORIGIN_INVALID', 'origin.observedAt is invalid');
  }
  origin.observedAt = new Date(observedAtValue).toISOString();
  if (input.changedFields != null) {
    if (!Array.isArray(input.changedFields) || input.changedFields.length > 30
      || input.changedFields.some((field) => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field))) {
      throw new ResearchCaseError('RESEARCH_ORIGIN_INVALID', 'origin.changedFields is invalid');
    }
    origin.changedFields = [...new Set(input.changedFields)].filter((field) => field !== 'sourceObservedAt').sort();
  }
  if (input.changes != null) {
    if (!input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes)
      || Object.keys(input.changes).length > 30
      || Object.entries(input.changes).some(([field, change]) => !origin.changedFields?.includes(field)
        || !change || typeof change !== 'object' || Array.isArray(change)
        || Object.keys(change).some((key) => !['previous', 'current'].includes(key))
        || [change.previous, change.current].some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))) {
      throw new ResearchCaseError('RESEARCH_ORIGIN_INVALID', 'origin.changes must contain primitive before/current values for changed fields');
    }
    origin.changes = Object.fromEntries(Object.keys(input.changes).sort().map((field) => [field, {
      previous: input.changes[field].previous ?? null,
      current: input.changes[field].current ?? null,
    }]));
  }
  origin.id = `rorigin_${sha(origin).slice(0, 24)}`;
  return origin;
}

function historyEvent(type, item, timestamp, details = {}) {
  const event = { type, at: timestamp, revision: item.revision, ...details };
  event.id = `rhist_${sha(event).slice(0, 24)}`;
  return event;
}

const CASH_FIELDS = [
  'registrationFunds',
  'creditedDeposit',
  'buyersPremium',
  'sheriffPoundage',
  'transferTax',
  'delinquentTaxes',
  'settlementCosts',
];

function sanitizeUnderwriteScenario(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const result = {};
  let hasAny = false;

  if (raw.rehabBudget !== undefined && raw.rehabBudget !== null && raw.rehabBudget !== '') {
    const num = Number(raw.rehabBudget);
    if (Number.isFinite(num) && num >= 0 && num <= 10_000_000) {
      result.rehabBudget = num;
      hasAny = true;
    }
  }

  if (raw.targetMargin !== undefined && raw.targetMargin !== null && raw.targetMargin !== '') {
    const num = Number(raw.targetMargin);
    if (Number.isFinite(num) && num >= 0 && num <= 100) {
      result.targetMargin = num;
      hasAny = true;
    }
  }

  if (raw.maxAllowableOffer !== undefined) {
    if (raw.maxAllowableOffer === null) {
      result.maxAllowableOffer = null;
      hasAny = true;
    } else if (raw.maxAllowableOffer !== '') {
      const num = Number(raw.maxAllowableOffer);
      if (Number.isFinite(num) && num >= 0 && num <= 1_000_000_000) {
        result.maxAllowableOffer = num;
        hasAny = true;
      }
    }
  }

  if (raw.holdingMonths !== undefined && raw.holdingMonths !== null && raw.holdingMonths !== '') {
    const num = Number(raw.holdingMonths);
    if (Number.isFinite(num) && num >= 1 && num <= 120) {
      result.holdingMonths = Math.round(num);
      hasAny = true;
    }
  }

  if (typeof raw.customValuation === 'string' && raw.customValuation.trim()) {
    const clean = raw.customValuation.trim().slice(0, 32);
    if (/^\d*(?:\.\d{0,2})?$/.test(clean)) {
      result.customValuation = clean;
      hasAny = true;
    }
  } else if (typeof raw.customValuation === 'number' && Number.isFinite(raw.customValuation) && raw.customValuation >= 0) {
    result.customValuation = String(raw.customValuation);
    hasAny = true;
  }

  if (typeof raw.customOpeningBid === 'string' && raw.customOpeningBid.trim()) {
    const clean = raw.customOpeningBid.trim().slice(0, 32);
    if (/^\d*(?:\.\d{0,2})?$/.test(clean)) {
      result.customOpeningBid = clean;
      hasAny = true;
    }
  } else if (typeof raw.customOpeningBid === 'number' && Number.isFinite(raw.customOpeningBid) && raw.customOpeningBid >= 0) {
    result.customOpeningBid = String(raw.customOpeningBid);
    hasAny = true;
  }

  for (const field of CASH_FIELDS) {
    const val = raw[field];
    if (val !== undefined && val !== null && val !== '') {
      if (typeof val === 'number') {
        if (Number.isFinite(val) && val >= 0 && val <= 1_000_000_000) {
          result[field] = val;
          hasAny = true;
        }
      } else if (typeof val === 'string') {
        const clean = val.trim();
        if (/^\d*(?:\.\d{0,2})?$/.test(clean) && clean !== '') {
          result[field] = clean;
          hasAny = true;
        }
      }
    }
  }

  return hasAny ? result : null;
}

function caseSummary(item) {
  return {
    id: item.id, identityKey: item.identityKey, sourceRef: item.sourceRef,
    listingId: item.listingId, address: item.address, state: item.state,
    listingAliases: item.listingAliases || [item.listingId],
    workspaceState: item.state, revision: item.revision, decision: item.decision,
    reconsideration: item.reconsideration, reconsiderationRequired: item.reconsiderationRequired,
    latestTrigger: item.latestTrigger || null, originCount: item.origins.length,
    latestOrigin: item.origins[0] || null,
    saleDate: item.listingSnapshot?.saleDate || null,
    openingBid: typeof item.listingSnapshot?.openingBid === 'number' ? item.listingSnapshot.openingBid : null,
    publishedStatus: item.listingSnapshot?.status || null,
    underwriteScenario: item.underwriteScenario || null,
    evidenceCount: item.evidenceLinks.length, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}

function normalizeReconsideration(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['any', 'all'].includes(value.mode)
    || !Array.isArray(value.conditions) || value.conditions.length < 1 || value.conditions.length > 10) {
    throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', 'reconsideration needs mode any or all and 1 to 10 conditions');
  }
  const conditions = value.conditions.map((condition, index) => {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
      throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', `reconsideration.conditions[${index}] is invalid`);
    }
    const operators = RECONSIDERATION_FIELDS[condition.field];
    if (!operators || !operators.has(condition.operator)) {
      throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', `reconsideration.conditions[${index}] field/operator is unsupported`);
    }
    const normalized = { field: condition.field, operator: condition.operator };
    if (condition.operator === 'lte' || condition.operator === 'gte') {
      if (typeof condition.value !== 'number' || !Number.isFinite(condition.value) || condition.value < 0 || condition.value > 1_000_000_000) {
        throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', `reconsideration.conditions[${index}].value must be a nonnegative number`);
      }
      normalized.value = condition.value;
    } else if (condition.operator === 'dropped_by_pct' || condition.operator === 'bid_to_assessed_lte') {
      if (typeof condition.value !== 'number' || !Number.isFinite(condition.value) || condition.value <= 0 || condition.value > 100) {
        throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', `reconsideration.conditions[${index}].value must be a percentage between 0 and 100`);
      }
      normalized.value = condition.value <= 1 ? Math.round(condition.value * 10000) / 100 : condition.value;
    } else if (condition.operator === 'within_days') {
      if (typeof condition.value !== 'number' || !Number.isFinite(condition.value) || condition.value < 1 || condition.value > 365) {
        throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', `reconsideration.conditions[${index}].value must be between 1 and 365 days`);
      }
      normalized.value = Math.round(condition.value);
    } else if (condition.operator === 'available') {
      normalized.value = cleanText(condition.value, 64, `reconsideration.conditions[${index}].value`, { required: true }).toLowerCase();
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized.value)) {
        throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', `reconsideration.conditions[${index}].value must be an evidence relationship or requirement key`);
      }
    } else if (condition.operator === 'changed' && Object.hasOwn(condition, 'value') && condition.value !== undefined) {
      throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', `reconsideration.conditions[${index}].value must be omitted for changed`);
    } else if (['junior_lien_surviving_mortgage', 'irs_redemption_active', 'hoa_super_priority'].includes(condition.operator)) {
      if (condition.value !== undefined && condition.value !== null) normalized.value = cleanText(String(condition.value), 64, `reconsideration.conditions[${index}].value`);
    }
    return normalized;
  });
  return { mode: value.mode, conditions };
}

function matchedReconsiderationConditions(item, trigger = {}, timestamp = null) {
  const policy = item.reconsideration;
  if (!policy) return trigger.substantive ? [{ field: 'supportedEvidence', operator: 'changed' }] : [];
  if (trigger.type === 'origin' && !trigger.substantive) return [];
  const changed = new Set((trigger.origin?.changedFields || []).filter((field) => field !== 'sourceObservedAt'));
  const matches = policy.conditions.filter((condition) => {
    if (condition.operator === 'changed') return changed.has(condition.field);
    if (condition.operator === 'lte' || condition.operator === 'gte') {
      if (trigger.type !== 'origin') return false;
      const value = item.listingSnapshot?.[condition.field];
      return typeof value === 'number' && Number.isFinite(value)
        && (condition.operator === 'lte' ? value <= condition.value : value >= condition.value);
    }
    if (condition.operator === 'dropped_by_pct') {
      if (trigger.type !== 'origin') return false;
      const currentBid = item.listingSnapshot?.openingBid;
      const baselineBid = (typeof item.decision?.decidedOpeningBid === 'number' && item.decision.decidedOpeningBid > 0) ? item.decision.decidedOpeningBid : (typeof trigger.origin?.changes?.openingBid?.previous === 'number' ? trigger.origin.changes.openingBid.previous : trigger.previousSnapshot?.openingBid); const previousBid = baselineBid;


      if (typeof currentBid !== 'number' || typeof previousBid !== 'number' || previousBid <= 0 || currentBid >= previousBid) return false;
      const dropPct = ((previousBid - currentBid) / previousBid) * 100;
      return dropPct + 1e-9 >= condition.value;
    }
    if (condition.operator === 'bid_to_assessed_lte') {
      if (trigger.type !== 'origin') return false;
      const currentBid = item.listingSnapshot?.openingBid;
      const assessed = item.listingSnapshot?.assessedValue ?? item.listingSnapshot?.assessed ??
        Number(item.dossierSnapshot?.publicRecords?.parcel?.assessedValue?.total) ??
        Number(item.dossierSnapshot?.publicRecords?.parcel?.properties?.assessedValue);
      if (typeof currentBid !== 'number' || !Number.isFinite(assessed) || assessed <= 0) return false;
      const ratioPct = (currentBid / assessed) * 100;
      return ratioPct - 1e-9 <= condition.value;
    }
    if (condition.operator === 'within_days') {
      if (trigger.type !== 'origin') return false;
      const saleDateStr = item.listingSnapshot?.saleDate;
      if (!saleDateStr) return false;
      const saleMs = Date.parse(String(saleDateStr).slice(0, 10));
      const refMs = Date.parse(String(timestamp || item.updatedAt || new Date().toISOString()).slice(0, 10));
      if (!Number.isFinite(saleMs) || !Number.isFinite(refMs)) return false;
      const daysUntil = Math.round((saleMs - refMs) / 86_400_000);
      return daysUntil >= 0 && daysUntil <= condition.value;
    }
    if (condition.operator === 'available') {
      return item.evidenceLinks.some((link) => condition.value === 'any'
        || link.relationship === condition.value || link.relationship === `${condition.value}_research`);
    }
    if (condition.field === 'titleRisk') {

      const { arbitrateTitleRisk } = require('./title-risk-engine');
      const { HOA_SUPER_PRIORITY_STATES } = require('./hoa-super-lien');
      const risk = arbitrateTitleRisk(item.listingSnapshot || {});
      const plaintiff = String(item.listingSnapshot?.plaintiff || '');
      const state = String(item.listingSnapshot?.state || item.state || 'OH').toUpperCase();
      if (condition.operator === 'junior_lien_surviving_mortgage') {
        const isJunior = risk.firstMortgageSurvives && (
          risk.plaintiffType === 'SECOND_MORTGAGE_HELOC' ||
          risk.plaintiffType === 'MECHANICS_LIEN' ||
          risk.instrumentPriority?.explicitlySubjectToSeniorMortgage ||
          /(?:second[_\s]*mortgage|heloc|mechanic'?s?[_\s]*lien)/i.test(plaintiff)
        );
        return Boolean(isJunior);
      }
      if (condition.operator === 'irs_redemption_active') {
        return Boolean(risk.irsTaxLienRedemption?.hasIrsLien || risk.irsNoticeEvaluation?.hasFederalTaxLien || item.listingSnapshot?.hasIrsLien || item.listingSnapshot?.hasFederalTaxLien);
      }
      if (condition.operator === 'hoa_super_priority') {
        const isSuperState = risk.hoaSuperPriority?.isSuperPriorityState || ['NV', 'FL'].includes(state) || Boolean(HOA_SUPER_PRIORITY_STATES[state]);
        const isHoa = risk.plaintiffType === 'HOA_ASSESSMENT' || /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b)/i.test(plaintiff);
        return Boolean(isSuperState && (isHoa || risk.hoaSuperPriority?.isSuperPriorityState));
      }
      if (condition.operator === 'changed') {
        return changed.has('titleRisk') || changed.has('seniorLienRisk') || changed.has('plaintiff') || changed.has('hasIrsLien');
      }
    }
    return false;
  });
  const satisfied = policy.mode === 'all' ? matches.length === policy.conditions.length : matches.length > 0;
  return satisfied ? matches : [];
}

function applyReconsiderationTrigger(item, trigger, timestamp) {
  if (item.state !== 'pass') return false;
  const matchedConditions = matchedReconsiderationConditions(item, trigger, timestamp);
  if (!matchedConditions.length) return false;
  const { arbitrateTitleRisk } = require('./title-risk-engine');
  const { HOA_SUPER_PRIORITY_STATES } = require('./hoa-super-lien');
  const titleRisk = arbitrateTitleRisk(item.listingSnapshot || {});
  const plaintiff = String(item.listingSnapshot?.plaintiff || '');
  const state = String(item.listingSnapshot?.state || item.state || 'OH').toUpperCase();
  const alerts = [];
  const flags = [];
  const isJuniorLien = Boolean(titleRisk.firstMortgageSurvives && (
    titleRisk.plaintiffType === 'SECOND_MORTGAGE_HELOC' ||
    titleRisk.plaintiffType === 'MECHANICS_LIEN' ||
    titleRisk.instrumentPriority?.explicitlySubjectToSeniorMortgage ||
    /(?:second[_\s]*mortgage|heloc|mechanic'?s?[_\s]*lien)/i.test(plaintiff)
  ));
  const priceDropDetected = matchedConditions.some((c) =>
    (c.field === 'openingBid' && ['dropped_by_pct', 'bid_to_assessed_lte', 'lte', 'changed'].includes(c.operator)) ||
    (c.field === 'titleRisk' && c.operator === 'junior_lien_surviving_mortgage')
  ) || (trigger.type === 'origin' && Number(trigger.origin?.changes?.openingBid?.previous) > Number(trigger.origin?.changes?.openingBid?.current));
  if (isJuniorLien && (priceDropDetected || matchedConditions.some((c) => c.field === 'titleRisk'))) {
    alerts.push('JUNIOR_LIEN_SURVIVING_MORTGAGE');
  }
  const hasIrsLien = Boolean(
    titleRisk.irsTaxLienRedemption?.hasIrsLien ||
    titleRisk.irsNoticeEvaluation?.hasFederalTaxLien ||
    item.listingSnapshot?.hasIrsLien ||
    item.listingSnapshot?.hasFederalTaxLien ||
    titleRisk.plaintiffType === 'IRS_TAX_LIEN'
  );
  if (hasIrsLien) {
    flags.push('IRS_REDEMPTION_WINDOW_ACTIVE');
  }
  const isSuperState = Boolean(
    titleRisk.hoaSuperPriority?.isSuperPriorityState ||
    ['NV', 'FL'].includes(state) ||
    Boolean(HOA_SUPER_PRIORITY_STATES[state])
  );
  const isHoa = Boolean(
    titleRisk.plaintiffType === 'HOA_ASSESSMENT' ||
    /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b)/i.test(plaintiff)
  );
  if (isSuperState && (isHoa || titleRisk.hoaSuperPriority?.isSuperPriorityState)) {
    flags.push('HOA_SUPER_PRIORITY_RISK');
  }
  item.reconsiderationRequired = true;
  item.latestTrigger = {
    at: timestamp, type: trigger.type,
    ...(trigger.origin ? { originId: trigger.origin.id } : {}),
    ...(trigger.intakeId ? { intakeId: trigger.intakeId } : {}),
    matchedConditions, alerts, flags, titleRiskAlert: alerts.includes('JUNIOR_LIEN_SURVIVING_MORTGAGE') ? 'JUNIOR_LIEN_SURVIVING_MORTGAGE' : null, irsRedemptionActive: flags.includes('IRS_REDEMPTION_WINDOW_ACTIVE'), hoaSuperPriorityRisk: flags.includes('HOA_SUPER_PRIORITY_RISK'),
  };
  return true;
}

function findCase(store, id) {
  if (!CASE_ID.test(id || '')) throw new ResearchCaseError('RESEARCH_CASE_ID_INVALID', 'Research case id is invalid');
  const item = store.cases.find((entry) => entry.id === id);
  if (!item) throw new ResearchCaseError('RESEARCH_CASE_NOT_FOUND', 'Research case was not found');
  return item;
}

function createCase(input, options = {}) {
  if (!input || typeof input !== 'object' || !input.listing) throw new ResearchCaseError('RESEARCH_INVALID', 'A validated listing is required');
  const timestamp = nowIso(options.now);
  const sourceRef = sourceRefFromListing(input.listing, timestamp);
  if (input.sourceRef) {
    const supplied = normalizeSourceRef(input.sourceRef);
    if (canonicalJson(supplied) !== canonicalJson(sourceRef)) throw new ResearchCaseError('RESEARCH_SOURCE_REF_MISMATCH', 'sourceRef does not match the validated listing');
  }
  const key = identityKey(sourceRef);
  const id = `rcase_${key.slice(0, 24)}`;
  const origin = normalizeOrigin(input.origin, input.listing, timestamp);
  const listingSnapshot = safeListingSnapshot(input.listing);
  const dossier = safeDossierSnapshot(input.dossier || buildPropertyDossier(input.listing, { now: Date.parse(timestamp) }));
  return mutateStore(options.filePath, (store) => {
    const existing = store.cases.find((entry) => entry.identityKey === key);
    if (existing) {
      let changed = false;
      let listingAliasChange = null;
      const previousAliases = existing.listingAliases || [existing.listingId];
      const nextAliases = [...new Set([...previousAliases, listingSnapshot.id])].slice(-100);
      if (canonicalJson(previousAliases) !== canonicalJson(nextAliases)) {
        existing.listingAliases = nextAliases;
        listingAliasChange = {
          previousListingId: existing.listingId,
          currentListingId: listingSnapshot.id,
          canonicalListingId: existing.listingId,
        };
        changed = true;
      }
      const originAdded = !existing.origins.some((entry) => entry.id === origin.id);
      if (originAdded) {
        existing.origins.push(origin);
        existing.origins = existing.origins.slice(-MAX_ORIGINS);
        changed = true;
      }
      const incomingObserved = Date.parse(listingSnapshot.sourceObservedAt || listingSnapshot.provenance.observedAt);
      const retainedObserved = Date.parse(existing.listingSnapshot?.sourceObservedAt || existing.listingSnapshot?.provenance?.observedAt);
      const previousSnapshot = existing.listingSnapshot ? { ...existing.listingSnapshot } : null;
      const sourceCheck = { basis: 'retained_inventory', checkedAt: timestamp, previousObservedAt: existing.listingSnapshot?.sourceObservedAt || existing.listingSnapshot?.provenance?.observedAt || null, observedAt: listingSnapshot.sourceObservedAt || listingSnapshot.provenance.observedAt, updated: Number.isFinite(incomingObserved) && (!Number.isFinite(retainedObserved) || incomingObserved > retainedObserved) };
      if (Number.isFinite(incomingObserved) && (!Number.isFinite(retainedObserved) || incomingObserved > retainedObserved)) {
        const previousListingId = existing.listingId;
        existing.listingId = listingSnapshot.id;
        existing.address = listingSnapshot.address || existing.address;
        existing.listingSnapshot = listingSnapshot;
        existing.dossierSnapshot = dossier;
        if (previousListingId !== existing.listingId) listingAliasChange = {
          previousListingId,
          currentListingId: existing.listingId,
          canonicalListingId: existing.listingId,
        };
        changed = true;
      }
      let scenarioUpdated = false;
      if (input.underwriteScenario !== undefined) {
        const sanitized = sanitizeUnderwriteScenario(input.underwriteScenario);
        if (canonicalJson(existing.underwriteScenario || null) !== canonicalJson(sanitized)) {
          existing.underwriteScenario = sanitized;
          changed = true;
          scenarioUpdated = true;
        }
      }
      if (!changed) return { changed: false, value: { case: caseSummary(existing), created: false, sourceCheck } };
      existing.revision += 1;
      existing.updatedAt = timestamp;
      const substantive = origin.type === 'new_match' || origin.type === 'hunt_match' || origin.type === 'evaluation_unknown'
        || (origin.type === 'material_change' && (origin.changedFields || []).length > 0);
      applyReconsiderationTrigger(existing, { type: 'origin', origin, substantive, previousSnapshot }, timestamp);
      if (listingAliasChange) existing.history.unshift(historyEvent('listing_alias_updated', existing, timestamp, listingAliasChange));
      if (scenarioUpdated) existing.history.unshift(historyEvent('underwrite_scenario_updated', existing, timestamp, { underwriteScenario: existing.underwriteScenario }));
      if (originAdded) existing.history.unshift(historyEvent('origin_recorded', existing, timestamp, { originId: origin.id }));
      existing.history = existing.history.slice(0, MAX_CASE_HISTORY);
      return { value: { case: caseSummary(existing), created: false, sourceCheck } };
    }
    if (store.cases.length >= MAX_CASES) throw new ResearchCaseError('RESEARCH_CASE_LIMIT', `No more than ${MAX_CASES} research cases may be stored`);
    const item = {
      id, identityKey: key, sourceRef, listingId: listingSnapshot.id,
      listingAliases: [listingSnapshot.id],
      address: listingSnapshot.address || null, state: 'inbox', revision: 1,
      decision: null, reconsideration: null, reconsiderationRequired: false, latestTrigger: null,
      origins: [origin], evidenceLinks: [], listingSnapshot, dossierSnapshot: dossier,
      underwriteScenario: sanitizeUnderwriteScenario(input.underwriteScenario),
      createdAt: timestamp, updatedAt: timestamp, history: [],
    };
    item.history.push(historyEvent('case_created', item, timestamp, { originId: origin.id }));
    store.cases.push(item);
    return { value: { case: caseSummary(item), created: true } };
  }, { now: timestamp });
}

function listCases(filters = {}, options = {}) {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(filters.limit) || 50)));
  const offset = Math.max(0, Math.min(100000, Math.floor(Number(filters.offset) || 0)));
  if (filters.state && !STATES.has(filters.state)) throw new ResearchCaseError('RESEARCH_FILTER_INVALID', 'state filter is invalid');
  if (filters.sourceId && !SOURCE_ID.test(filters.sourceId)) throw new ResearchCaseError('RESEARCH_FILTER_INVALID', 'sourceId filter is invalid');
  const eventPriority = { material_change: 0, new_match: 1, hunt_match: 2, evaluation_unknown: 3, browser_import: 4, manual: 5 };
  const deadline = (item) => {
    const value = Date.parse(item.listingSnapshot?.saleDate);
    return Number.isFinite(value) && value >= Date.now() ? value : Number.MAX_SAFE_INTEGER;
  };
  const items = loadStore(options.filePath).cases
    .filter((item) => !filters.state || item.state === filters.state)
    .filter((item) => !filters.sourceId || item.sourceRef.sourceId === filters.sourceId)
    .filter((item) => !filters.listingId || item.listingId === filters.listingId || (item.listingAliases || []).includes(filters.listingId))
    .sort((left, right) => Number(right.reconsiderationRequired) - Number(left.reconsiderationRequired)
      || (eventPriority[left.origins[0]?.type] ?? 99) - (eventPriority[right.origins[0]?.type] ?? 99)
      || deadline(left) - deadline(right)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id));
  return { items: items.slice(offset, offset + limit).map(caseSummary), total: items.length, limit, offset };
}

function workspaceDossier(item) {
  const publisherClaims = (item.dossierSnapshot?.facts || []).filter((fact) => fact.evidenceClass === 'publisher_reported');
  const parcel = item.dossierSnapshot?.publicRecords?.parcel;
  const officialClaims = parcel?.status === 'matched'
    ? Object.entries(parcel.properties || {}).map(([key, value]) => ({
        key: `parcel.${key}`, value, evidenceClass: 'official_record', sourceUrl: parcel.source?.url || null,
      }))
    : [];
  return {
    ...structuredClone(item.dossierSnapshot),
    workspace: {
      caseId: item.id, caseRevision: item.revision, state: item.state,
      decision: item.decision, reconsideration: item.reconsideration,
      reconsiderationRequired: item.reconsiderationRequired, latestTrigger: item.latestTrigger || null,
      sourceRef: item.sourceRef,
      underwriteScenario: item.underwriteScenario || null,
    },
    claimGroups: { publisher: publisherClaims, official: officialClaims },
    reviewedEvidence: item.evidenceLinks.map((link) => ({ ...link, evidenceClass: 'reviewed_attachment', promotesFacts: false })),
  };
}

function getCase(id, options = {}) {
  const item = findCase(loadStore(options.filePath), id);
  const detail = structuredClone(item);
  detail.timeline = structuredClone(item.history);
  detail.latestTrigger = detail.latestTrigger || null;
  return { case: detail, dossier: workspaceDossier(item) };
}

function normalizeReasonCodes(value, state) {
  if (value == null) value = [];
  if (!Array.isArray(value) || value.length > 10 || value.some((code) => typeof code !== 'string' || !REASON_CODE.test(code))) {
    throw new ResearchCaseError('RESEARCH_DECISION_INVALID', 'reasonCodes must contain up to 10 lowercase reason identifiers');
  }
  const result = [...new Set(value)].sort();
  if (state === 'pass' && !result.length) throw new ResearchCaseError('RESEARCH_DECISION_INVALID', 'A pass decision requires at least one reason code');
  return result;
}

function requireExpectedRevision(value) {
  if (!Number.isInteger(value) || value < 1) throw new ResearchCaseError('RESEARCH_REVISION_REQUIRED', 'expectedRevision must be a positive integer');
  return value;
}

function updateCase(id, input, options = {}) {
  if (!input || typeof input !== 'object' || !STATES.has(input.state)) throw new ResearchCaseError('RESEARCH_DECISION_INVALID', 'state must be inbox, pursue, or pass');
  const expectedRevision = requireExpectedRevision(input.expectedRevision);
  const reasonCodes = normalizeReasonCodes(input.reasonCodes, input.state);
  const note = cleanText(input.note, 2000, 'note');
  if (input.state !== 'pass' && input.reconsideration != null) {
    throw new ResearchCaseError('RESEARCH_RECONSIDERATION_INVALID', 'reconsideration is only available for a pass decision');
  }
  const reconsideration = input.state === 'pass' ? normalizeReconsideration(input.reconsideration) : null;
  const timestamp = nowIso(options.now);
  return mutateStore(options.filePath, (store) => {
    const item = findCase(store, id);
    if (item.revision !== expectedRevision) throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before saving', { expectedRevision, currentRevision: item.revision });
    const decision = input.state === 'inbox' ? null : { state: input.state, reasonCodes, note, decidedAt: timestamp, actor: 'local_operator', decidedOpeningBid: item.listingSnapshot?.openingBid ?? null };
    const scenarioChanged = input.underwriteScenario !== undefined
      && canonicalJson(item.underwriteScenario || null) !== canonicalJson(sanitizeUnderwriteScenario(input.underwriteScenario));
    if (item.state === input.state && canonicalJson(item.decision) === canonicalJson(decision)
      && canonicalJson(item.reconsideration) === canonicalJson(reconsideration) && !item.reconsiderationRequired && !scenarioChanged) {
      return { changed: false, value: caseSummary(item) };
    }
    const previousState = item.state;
    item.state = input.state;
    item.decision = decision;
    item.reconsideration = reconsideration;
    if (scenarioChanged) {
      item.underwriteScenario = sanitizeUnderwriteScenario(input.underwriteScenario);
    }
    item.revision += 1;
    item.updatedAt = timestamp;
    item.reconsiderationRequired = false;
    item.latestTrigger = null;
    item.history.unshift(historyEvent('decision_changed', item, timestamp, { previousState, currentState: item.state, reasonCodes }));
    item.history = item.history.slice(0, MAX_CASE_HISTORY);
    return { value: caseSummary(item) };
  }, { now: timestamp });
}

function normalizeEvidence(evidence, relationship) {
  if (!RELATIONSHIPS.has(relationship)) throw new ResearchCaseError('RESEARCH_EVIDENCE_INVALID', 'Evidence relationship is invalid');
  if (!evidence || !INTAKE_ID.test(evidence.id || '') || evidence.review?.decision !== 'approved') {
    throw new ResearchCaseError('RESEARCH_EVIDENCE_NOT_APPROVED', 'Only an approved intake packet can be linked');
  }
  let parsedUrl = null;
  try { parsedUrl = new URL(evidence.sourceUrl); } catch {}
  const hostname = parsedUrl?.hostname.replace(/^\[|\]$/g, '').toLowerCase() || '';
  const ip = net.isIP(hostname);
  const privateIp = ip === 4 && (/^(?:10\.|127\.|0\.|169\.254\.|192\.168\.)/.test(hostname)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname))
    || ip === 6 && (hostname === '::1' || hostname === '::' || /^f[cd]/.test(hostname) || /^fe[89ab]/.test(hostname));
  const localHost = hostname === 'localhost' || !hostname.includes('.') || /\.(?:localhost|local|internal|home|lan|example|invalid|test|onion)$/i.test(hostname);
  const credentialQuery = parsedUrl && [...parsedUrl.searchParams.keys()].some((key) => /^(?:authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i.test(key));
  if (!SOURCE_ID.test(evidence.sourceId || '') || !parsedUrl || parsedUrl.protocol !== 'https:'
    || parsedUrl.username || parsedUrl.password || localHost || privateIp || credentialQuery
    || !/^[a-f0-9]{64}$/.test(evidence.content?.sha256 || '')
    || !Number.isFinite(evidence.content?.bytes) || evidence.content.bytes < 0
    || !Number.isFinite(Date.parse(evidence.capturedAt)) || (evidence.review.reviewedAt && !Number.isFinite(Date.parse(evidence.review.reviewedAt)))) {
    throw new ResearchCaseError('RESEARCH_EVIDENCE_INVALID', 'Approved evidence metadata is invalid');
  }
  return {
    intakeId: evidence.id, relationship, sourceId: evidence.sourceId, sourceUrl: evidence.sourceUrl,
    capturedAt: evidence.capturedAt, reviewedAt: evidence.review.reviewedAt || null,
    contentSha256: evidence.content.sha256, contentBytes: evidence.content.bytes,
  };
}

function linkEvidence(id, evidence, input, options = {}) {
  const expectedRevision = requireExpectedRevision(input?.expectedRevision);
  const link = normalizeEvidence(evidence, input.relationship);
  const timestamp = nowIso(options.now);
  return mutateStore(options.filePath, (store) => {
    const item = findCase(store, id);
    if (item.revision !== expectedRevision) throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before linking evidence', { expectedRevision, currentRevision: item.revision });
    const existing = item.evidenceLinks.find((entry) => entry.intakeId === link.intakeId);
    if (existing && canonicalJson(existing) === canonicalJson(link)) return { changed: false, value: caseSummary(item) };
    item.evidenceLinks = [link, ...item.evidenceLinks.filter((entry) => entry.intakeId !== link.intakeId)].slice(0, MAX_EVIDENCE_LINKS);
    item.revision += 1;
    item.updatedAt = timestamp;
    applyReconsiderationTrigger(item, { type: 'evidence_link', intakeId: link.intakeId, substantive: true }, timestamp);
    item.history.unshift(historyEvent('evidence_linked', item, timestamp, { intakeId: link.intakeId, relationship: link.relationship }));
    item.history = item.history.slice(0, MAX_CASE_HISTORY);
    return { value: caseSummary(item) };
  }, { now: timestamp });
}

function unlinkEvidence(id, intakeId, input, options = {}) {
  if (!INTAKE_ID.test(intakeId || '')) throw new ResearchCaseError('RESEARCH_EVIDENCE_INVALID', 'Evidence intake id is invalid');
  const expectedRevision = requireExpectedRevision(input?.expectedRevision);
  const timestamp = nowIso(options.now);
  return mutateStore(options.filePath, (store) => {
    const item = findCase(store, id);
    if (item.revision !== expectedRevision) throw new ResearchCaseError('RESEARCH_REVISION_CONFLICT', 'Research case changed; reload before unlinking evidence', { expectedRevision, currentRevision: item.revision });
    if (!item.evidenceLinks.some((entry) => entry.intakeId === intakeId)) throw new ResearchCaseError('RESEARCH_EVIDENCE_NOT_FOUND', 'Evidence link was not found');
    item.evidenceLinks = item.evidenceLinks.filter((entry) => entry.intakeId !== intakeId);
    item.revision += 1;
    item.updatedAt = timestamp;
    item.history.unshift(historyEvent('evidence_unlinked', item, timestamp, { intakeId }));
    item.history = item.history.slice(0, MAX_CASE_HISTORY);
    return { value: caseSummary(item) };
  }, { now: timestamp });
}

function buildPacket(idOrCase, options = {}) {
  const item = typeof idOrCase === 'string' ? findCase(loadStore(options.filePath), idOrCase) : idOrCase;
  if (!item || !CASE_ID.test(item.id || '')) throw new ResearchCaseError('RESEARCH_CASE_NOT_FOUND', 'Research case was not found');
  const content = {
    schemaVersion: 1,
    case: {
      id: item.id, revision: item.revision, state: item.state, sourceRef: item.sourceRef,
      listingId: item.listingId, listingAliases: item.listingAliases || [item.listingId], address: item.address, decision: item.decision,
      reconsideration: item.reconsideration, reconsiderationRequired: item.reconsiderationRequired,
      latestTrigger: item.latestTrigger || null, origins: item.origins, timeline: item.history,
      underwriteScenario: item.underwriteScenario || null,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
    },
    dossier: workspaceDossier(item),
    evidenceManifest: item.evidenceLinks.map((link) => ({ ...link, evidenceClass: 'reviewed_attachment', promotesFacts: false })),
    provenance: {
      subjectIdentityKey: item.identityKey,
      listingSnapshotSha256: sha(item.listingSnapshot),
      dossierSnapshotSha256: sha(item.dossierSnapshot),
      packetAsOf: item.updatedAt,
    },
    interpretation: 'This packet records source observations, reviewed attachments, explicit decisions, and unresolved research. Reviewed attachments are references and do not by themselves verify listing, title, occupancy, valuation, debt, or sale outcome facts.',
  };
  return { ...content, digest: { algorithm: 'sha256', value: sha(content) } };
}

function markdown(value) {
  const customerText = String(value ?? '')
    .replace(/https?:\/\/(?:www\.)?servicelinkauction\.com\/?\S*/gi, 'Official publisher reference retained in JSON packet')
    .replace(/servicelink(?:\s+auction)?/gi, 'Public Auction Network');
  return customerText.replace(/([\\`*_{}\[\]<>#+.!|~-])/g, '\\$1').replace(/[\r\n]+/g, ' ');
}

function packetToMarkdown(packet) {
  const facts = Array.isArray(packet.dossier?.facts) ? packet.dossier.facts : [];
  const gaps = Array.isArray(packet.dossier?.gaps) ? packet.dossier.gaps : [];
  const lines = [
    '# Property research packet', '',
    `- Case: ${markdown(packet.case.id)} (revision ${packet.case.revision})`,
    `- Decision: ${markdown(packet.case.state)}`,
    `- Property: ${markdown(packet.case.address || packet.case.listingId)}`,
    `- Source record: ${markdown(packet.case.sourceRef.sourceId)} / ${markdown(packet.case.sourceRef.recordId)}`,
    `- Packet as of: ${markdown(packet.provenance.packetAsOf)}`,
    `- SHA-256: ${packet.digest.value}`, '',
    '## Recorded facts', '',
  ];
  if (!facts.length) lines.push('- No recorded facts are available.');
  for (const fact of facts) lines.push(`- **${markdown(fact.title || fact.key)}:** ${markdown(fact.value == null ? 'Unknown' : fact.value)} _(${markdown(fact.evidenceClass || 'unknown')})_`);
  lines.push('', '## Reviewed evidence references', '');
  if (!packet.evidenceManifest.length) lines.push('- No reviewed evidence packets are linked.');
  for (const evidence of packet.evidenceManifest) lines.push(`- ${markdown(evidence.relationship)}: ${markdown(evidence.sourceUrl)} (SHA-256 ${evidence.contentSha256})`);
  lines.push('', '## Open research questions', '');
  if (!gaps.length) lines.push('- No open questions were recorded in this dossier snapshot.');
  for (const gap of gaps) lines.push(`- **${markdown(gap.title)}:** ${markdown(gap.reason)} Next: ${markdown(gap.nextAction)}`);
  if (packet.case.decision) {
    lines.push('', '## Decision details', '');
    lines.push(`- State: ${markdown(packet.case.decision.state)}`);
    if (packet.case.decision.decidedAt) lines.push(`- Decided at: ${markdown(packet.case.decision.decidedAt)}`);
    if (Array.isArray(packet.case.decision.reasonCodes) && packet.case.decision.reasonCodes.length) {
      lines.push(`- Reason codes: ${packet.case.decision.reasonCodes.map(markdown).join(', ')}`);
    }
    if (packet.case.decision.note) {
      lines.push(`- Note: ${markdown(packet.case.decision.note)}`);
    }
  }
  if (packet.case.latestTrigger?.titleRiskAlert || packet.case.latestTrigger?.irsRedemptionActive || packet.case.latestTrigger?.hoaSuperPriorityRisk) {
    lines.push('', '## Title risk second-look signals', '');
    if (packet.case.latestTrigger?.titleRiskAlert) {
      lines.push(`- **CRITICAL ALERT:** ${markdown(packet.case.latestTrigger.titleRiskAlert)}: Senior mortgage survives foreclosure sale.`);
    }
    if (packet.case.latestTrigger?.irsRedemptionActive) {
      lines.push('- **CASE FLAG:** IRS_REDEMPTION_WINDOW_ACTIVE: 120-day super-priority IRS redemption right under 26 U.S.C. § 7425(d).');
    }
    if (packet.case.latestTrigger?.hoaSuperPriorityRisk) {
      lines.push('- **CASE FLAG:** HOA_SUPER_PRIORITY_RISK: Property subject to statutory HOA super-priority assessment in UCIOA / NV / FL.');
    }
  }
  const scenario = packet.case.underwriteScenario;
  if (scenario && typeof scenario === 'object') {
    lines.push('', '## Saved underwriting assumptions', '');
    if (scenario.customValuation) lines.push(`- Custom valuation: $${markdown(scenario.customValuation)}`);
    if (scenario.customOpeningBid) lines.push(`- Assumed opening bid: $${markdown(scenario.customOpeningBid)}`);
    if (typeof scenario.maxAllowableOffer === 'number') lines.push(`- Max allowable offer: $${markdown(scenario.maxAllowableOffer)}`);
    if (typeof scenario.rehabBudget === 'number') lines.push(`- Rehab budget: $${markdown(scenario.rehabBudget)}`);
    if (typeof scenario.targetMargin === 'number') lines.push(`- Target margin: ${markdown(scenario.targetMargin)}%`);
    if (typeof scenario.holdingMonths === 'number') lines.push(`- Holding period: ${markdown(scenario.holdingMonths)} months`);
    const closingCosts = [];
    if (scenario.transferTax) closingCosts.push(`transfer tax: $${markdown(scenario.transferTax)}`);
    if (scenario.delinquentTaxes) closingCosts.push(`delinquent taxes: $${markdown(scenario.delinquentTaxes)}`);
    if (scenario.settlementCosts) closingCosts.push(`settlement costs: $${markdown(scenario.settlementCosts)}`);
    if (scenario.buyersPremium) closingCosts.push(`buyer's premium: $${markdown(scenario.buyersPremium)}`);
    if (scenario.sheriffPoundage) closingCosts.push(`sheriff poundage: $${markdown(scenario.sheriffPoundage)}`);
    if (closingCosts.length) {
      lines.push(`- Itemized costs: ${closingCosts.join(', ')}`);
    }
  }
  lines.push('', '## Evidence boundary', '', packet.interpretation, '');
  return lines.join('\n');
}

function normalizeListingIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IMPORT_IDS) throw new ResearchCaseError('RESEARCH_IMPORT_INVALID', `listingIds must contain 1 to ${MAX_IMPORT_IDS} identifiers`);
  const ids = value.map((id) => cleanText(id, 256, 'listingId', { required: true }));
  return [...new Set(ids)];
}

async function previewBrowserImport(listingIds, options = {}) {
  if (!options.database || typeof options.database.getListingById !== 'function') throw new TypeError('Browser import requires a listing database');
  const ids = normalizeListingIds(listingIds);
  const existing = new Set(loadStore(options.filePath).cases.map((item) => item.identityKey));
  const accepted = [], rejected = [];
  for (const listingId of ids) {
    try {
      const listing = await options.database.getListingById(listingId);
      if (!listing) { rejected.push({ listingId, reason: 'listing_not_found' }); continue; }
      const sourceRef = sourceRefFromListing(listing, nowIso(options.now));
      const key = identityKey(sourceRef);
      accepted.push({ listingId, sourceRef, address: listing.address || null, state: listing.state || null, existing: existing.has(key), observedAt: listing.sourceObservedAt || listing.provenance?.observedAt });
    } catch (error) {
      rejected.push({ listingId, reason: error instanceof ResearchCaseError ? error.code.toLowerCase() : 'listing_unavailable' });
    }
  }
  accepted.sort((left, right) => left.listingId.localeCompare(right.listingId));
  rejected.sort((left, right) => left.listingId.localeCompare(right.listingId));
  const basis = { listingIds: ids.slice().sort(), accepted, rejected };
  return {
    previewHash: sha(basis), total: ids.length,
    creatable: accepted.filter((item) => !item.existing).length,
    existing: accepted.filter((item) => item.existing).length,
    accepted, rejected,
  };
}

async function commitBrowserImport(listingIds, previewHash, options = {}) {
  if (typeof previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(previewHash)) throw new ResearchCaseError('RESEARCH_IMPORT_INVALID', 'A valid previewHash is required');
  const preview = await previewBrowserImport(listingIds, options);
  if (preview.previewHash !== previewHash) throw new ResearchCaseError('RESEARCH_IMPORT_CHANGED', 'Browser import preview changed; review it again before committing', { preview });
  const created = [], existing = [];
  for (const candidate of preview.accepted) {
    const listing = await options.database.getListingById(candidate.listingId);
    const timestamp = nowIso(options.now);
    const dossier = typeof options.buildDossier === 'function'
      ? await options.buildDossier(listing, timestamp)
      : buildPropertyDossier(listing, { now: Date.parse(timestamp) });
    const result = createCase({ listing, dossier, origin: { type: 'browser_import', observedAt: candidate.observedAt } }, options);
    (result.created ? created : existing).push(result.case);
  }
  return { previewHash, created, existing, rejected: preview.rejected };
}

module.exports = {
  INTAKE_ID,
  MAX_IMPORT_IDS,
  ORIGIN_TYPES,
  RECONSIDERATION_FIELDS,
  RELATIONSHIPS,
  ResearchCaseError,
  STATES,
  buildPacket,
  canonicalJson,
  caseSummary,
  commitBrowserImport,
  createCase,
  getCase,
  identityKey,
  linkEvidence,
  listCases,
  normalizeSourceRef,
  normalizeReconsideration,
  packetToMarkdown,
  previewBrowserImport,
  sanitizeUnderwriteScenario,
  sha,
  sourceRefFromListing,
  unlinkEvidence,
  updateCase,
};
