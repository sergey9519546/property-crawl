'use strict';

const { createHash } = require('node:crypto');
const { loadStore } = require('./store');
const { cleanText, nonnegative, PublicRecordError } = require('../public-records/http');
const { normalizeParcelId, parcelIdentity } = require('../public-records/identity');
const { lookupAlachuaParcel } = require('../public-records/alachua');
const { ScraperCircuitBreaker } = require('../scrapers/circuit-breaker');

const ALACHUA_SOURCE_ID = 'alachua-tax-deeds';
const AVAILABLE_STATUS = 'List of Lands – Available for Public';
const LIST_OF_LANDS_GUIDANCE_URL = 'https://www.alachuaclerk.org/civil/taxlands.cfm';
const FRESHNESS_MS = 24 * 3600_000;
const MAX_CASES = 100;
const DOCUMENT_TYPES = new Set(['notice', 'property_information_report', 'tax_deed_file', 'terms', 'parcel_map', 'other']);
const DOCUMENT_HOSTS = new Set([
  'alachua.realtdm.com', 'alachua.realtaxdeed.com',
  'alachuacounty.us', 'www.alachuacounty.us',
  'alachuaclerk.org', 'www.alachuaclerk.org',
  'acpafl.org', 'www.acpafl.org', 'qpublic.schneidercorp.com',
]);

function reject(code, message) { throw new PublicRecordError(code, message); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function validTime(value, now) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function caseUrl(value, recordId) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
    if (!['alachua.realtdm.com', 'alachua.realtaxdeed.com'].includes(url.hostname)) return null;
    if ([...url.searchParams.keys()].some(key => /token|key|password|authorization|secret|session/i.test(key))) return null;
    const identifiers = [...url.searchParams.values(), ...url.pathname.split('/').map(decodeURIComponent)];
    if (recordId && !identifiers.some(value => value.toLowerCase() === recordId.toLowerCase())) return null;
    if (url.pathname === '/' && !url.search) return null;
    return url.toString();
  } catch { return null; }
}
function statusCode(value) {
  return String(value).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase() === 'list of lands - available for public' ? 'available_for_public' : 'unresolved';
}

function documentUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !DOCUMENT_HOSTS.has(url.hostname.toLowerCase())) return null;
    if ([...url.searchParams.keys()].some(key => /token|key|password|authorization|secret|session/i.test(key))) return null;
    if (url.pathname === '/' && !url.search) return null;
    return url.toString();
  } catch { return null; }
}

function normalizeDocuments(value, observedAt) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) reject('ALACHUA_DOCUMENT_INVALID', 'Case documents must be a bounded list of official evidence references.');
  const seen = new Set();
  return value.map(item => {
    const type = typeof item?.type === 'string' && DOCUMENT_TYPES.has(item.type) ? item.type : null;
    const url = documentUrl(item?.url);
    const title = cleanText(item?.title, 160);
    const sha256 = item?.sha256 == null ? null : (typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(item.sha256) ? item.sha256.toLowerCase() : null);
    if (!type || !url || !title || (item?.sha256 != null && !sha256) || seen.has(url)) reject('ALACHUA_DOCUMENT_INVALID', 'Each case document needs a unique official URL, supported type, title, and valid optional digest.');
    seen.add(url);
    return { type, title, url, sha256, observedAt, reviewStatus: 'reference_reviewed_with_packet', factStatus: 'document_link_only' };
  });
}

function optionalMoney(value, field) {
  if (value == null) return null;
  const amount = nonnegative(value);
  if (amount == null) reject('ALACHUA_COST_INVALID', `${field} must be a non-negative published amount or null.`);
  return amount;
}

function optionalDate(value, field) {
  if (value == null) return null;
  if (!validDate(value)) reject('ALACHUA_DATE_INVALID', `${field} must be a real ISO calendar date or null.`);
  return value;
}

function purchaseTerms(row, observedAt, source) {
  const costs = row?.publishedCosts;
  if (costs != null && (!costs || typeof costs !== 'object' || Array.isArray(costs))) reject('ALACHUA_COST_INVALID', 'publishedCosts must be a structured object.');
  const costFields = new Set(['taxesSinceAuction', 'deedIssuanceAndRecording', 'documentaryStamps', 'otherPublishedCosts']);
  if (costs && Object.keys(costs).some(key => !costFields.has(key))) reject('ALACHUA_COST_INVALID', 'publishedCosts contains an unsupported or misclassified cost component.');
  if (row?.currentPurchaseQuote != null || row?.currentPurchaseCost != null) reject('ALACHUA_QUOTE_REVIEW_REQUIRED', 'A current clerk purchase quote requires its own dated evidence workflow.');
  const publishedOpeningBid = optionalMoney(row?.publishedOpeningBid, 'publishedOpeningBid');
  const publishedCosts = {
    openingBidAtAuction: publishedOpeningBid,
    taxesSinceAuction: optionalMoney(costs?.taxesSinceAuction, 'publishedCosts.taxesSinceAuction'),
    deedIssuanceAndRecording: optionalMoney(costs?.deedIssuanceAndRecording, 'publishedCosts.deedIssuanceAndRecording'),
    documentaryStamps: optionalMoney(costs?.documentaryStamps, 'publishedCosts.documentaryStamps'),
    otherPublishedCosts: optionalMoney(costs?.otherPublishedCosts, 'publishedCosts.otherPublishedCosts'),
  };
  return {
    scope: 'list_of_lands_public_purchase_program',
    applicability: statusCode(row?.status) === 'available_for_public' ? 'program_terms_only' : 'unresolved',
    components: publishedCosts,
    currentPurchaseQuote: null,
    quoteStatus: 'requires_current_clerk_quote',
    guidance: {
      costComponents: ['opening bid at auction', 'taxes incurred since auction', 'tax-deed issuance and recording costs', 'documentary stamps'],
      source: { id: 'alachua-list-of-lands-guidance', label: 'Alachua County List of Lands instructions', url: LIST_OF_LANDS_GUIDANCE_URL, observedAt: null, evidenceClass: 'program_terms' },
    },
    recordEvidence: { ...source, observedAt },
  };
}

function normalizeReviewedPacket(packet, options = {}) {
  const now = Number(options.now ?? Date.now());
  if (!packet || packet.sourceId !== ALACHUA_SOURCE_ID || packet.status !== 'reviewed' || packet.review?.decision !== 'approved') reject('ALACHUA_REVIEW_REQUIRED', 'An approved county evidence packet is required.');
  if (!validTime(packet.capturedAt, now) || !validTime(packet.review.reviewedAt, now) || Date.parse(packet.review.reviewedAt) < Date.parse(packet.capturedAt)) reject('ALACHUA_INVALID_TIME', 'County evidence capture and review times must be valid.');
  if (packet.kind !== 'json' || !Array.isArray(packet.original?.records) || !packet.original.records.length || packet.original.records.length > MAX_CASES) reject('ALACHUA_INVALID_PACKET', 'County evidence must contain between 1 and 100 structured case records.');
  const hash = createHash('sha256').update(canonical(packet.original)).digest('hex');
  if (hash !== packet.content?.sha256) reject('ALACHUA_CONTENT_CHANGED', 'The approved county evidence content has changed; review it again.');
  if (!caseUrl(packet.sourceUrl)) reject('ALACHUA_SOURCE_URL_REQUIRED', 'Use the current county case portal as the packet source.');
  const seen = new Set();
  const records = packet.original.records.map(row => {
    const publisherRecordId = typeof row?.publisherRecordId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:~ -]{0,119}$/.test(row.publisherRecordId) ? row.publisherRecordId : null;
    const caseNumber = typeof row?.caseNumber === 'string' ? cleanText(row.caseNumber, 120) : null;
    const rawStatus = typeof row?.status === 'string' ? cleanText(row.status, 200) : null;
    const sourceUrl = publisherRecordId && caseUrl(row.sourceUrl, publisherRecordId);
    if (!publisherRecordId || !caseNumber || !rawStatus || !sourceUrl || seen.has(publisherRecordId)) reject('ALACHUA_CASE_INVALID', 'Each county case needs a unique publisher ID, case number, explicit status, and matching exact record URL.');
    seen.add(publisherRecordId);
    if (!Array.isArray(row.rawParcelIds) || !row.rawParcelIds.length || row.rawParcelIds.length > 20 || row.rawParcelIds.some(value => !normalizeParcelId(value))) reject('ALACHUA_PARCEL_ID_REQUIRED', 'Each county case requires intact text parcel identifiers.');
    const rawParcelIds = row.rawParcelIds.filter((value, index, values) => values.findIndex(other => normalizeParcelId(other) === normalizeParcelId(value)) === index);
    const observedAt = row.observedAt || packet.capturedAt;
    if (!validTime(observedAt, now) || Date.parse(observedAt) > Date.parse(packet.capturedAt)) reject('ALACHUA_INVALID_TIME', 'Case observation time must not exceed its packet capture time.');
    const freshness = now - Date.parse(observedAt) > FRESHNESS_MS ? 'stale' : 'within_review_window';
    const sourceRef = { sourceId: ALACHUA_SOURCE_ID, recordId: publisherRecordId };
    const source = { id: ALACHUA_SOURCE_ID, label: 'Alachua County reviewed tax-deed evidence', url: sourceUrl, observedAt, evidenceClass: 'reviewed_import', packetId: packet.id, contentDigest: `sha256:${packet.content.sha256}` };
    const terms = purchaseTerms(row, observedAt, source);
    return { sourceRef, publisherRecordId, caseNumber, rawParcelIds, parcelIdentities: rawParcelIds.map(rawParcelId => parcelIdentity({ rawParcelId, stateFips: '12', countyFips: '001' })), rawStatus, status: statusCode(rawStatus), observedAt, freshness, source,
      advertisedPropertyType: cleanText(row.advertisedPropertyType, 100), publishedOpeningBid: terms.components.openingBidAtAuction,
      purchaseTerms: terms, documents: normalizeDocuments(row.documents, observedAt),
      currentPurchaseCost: null, currentAvailability: 'requires_publisher_confirmation',
      saleDate: optionalDate(row.saleDate, 'saleDate'),
      review: { reviewedAt: packet.review.reviewedAt },
    };
  });
  return { packetId: packet.id, records, coverage: 'reviewed_import_only', completeCountyInventory: false };
}

function collectStatusHistory(records, throughCapturedAt, throughReviewedAt, options = {}) {
  const histories = new Map();
  const ignoredPackets = [];
  let includedPackets = 0;
  for (const packet of records) {
    if (packet?.sourceId !== ALACHUA_SOURCE_ID || packet?.review?.decision !== 'approved'
      || Date.parse(packet.capturedAt) > Date.parse(throughCapturedAt)
      || Date.parse(packet.review?.reviewedAt) > Date.parse(throughReviewedAt)) continue;
    let normalized;
    try { normalized = normalizeReviewedPacket(packet, options); }
    catch (error) {
      ignoredPackets.push({ packetId: packet?.id || null, code: error instanceof PublicRecordError ? error.code : 'ALACHUA_HISTORY_INVALID' });
      continue;
    }
    includedPackets++;
    for (const record of normalized.records) {
      const key = record.publisherRecordId.toLowerCase();
      const history = histories.get(key) || [];
      history.push({
        sourceRef: record.sourceRef, caseNumber: record.caseNumber, rawStatus: record.rawStatus, status: record.status,
        observedAt: record.observedAt, packetId: normalized.packetId, source: record.source,
      });
      histories.set(key, history);
    }
  }
  for (const history of histories.values()) history.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.packetId.localeCompare(right.packetId));
  return { histories, ignoredPackets, includedPackets };
}

function buildAlachuaSignals(record, parcels = []) {
  const signals = [], issues = [];
  if (record.freshness === 'stale') issues.push({ code: 'COUNTY_CASE_STALE', message: 'Refresh the exact county case before treating the recorded availability as current.' });
  if (record.statusConflicts?.length) issues.push({ code: 'COUNTY_STATUS_CONFLICT', message: 'Approved evidence contains conflicting case statuses at the same observation time; review the original records.' });
  if (record.status === 'available_for_public' && record.freshness === 'within_review_window') {
    const prior = record.statusHistory?.filter(item => item.observedAt < record.observedAt).at(-1) || null;
    const changed = Boolean(prior && prior.status !== record.status);
    signals.push({
    id: 'second_chance_review', title: 'Recorded as available for public purchase', evidenceClass: 'research_lead',
    category: changed ? 'material_status_change' : 'new_match',
    materialChange: changed,
    explanation: changed
      ? `The reviewed county status changed from “${prior.rawStatus}” to explicit public-purchase availability. Obtain current confirmation and a current purchase quote.`
      : 'The reviewed county case explicitly records public-purchase availability. Obtain current confirmation and a current purchase quote.',
    evidence: [
      ...(changed ? [{ field: 'previousStatus', value: prior.rawStatus, ...prior.source }] : []),
      { field: 'status', value: record.rawStatus, ...record.source },
    ],
    nextAction: 'Confirm the exact case status and current purchase cost with the clerk.',
  });
  }
  for (const parcel of parcels) {
    if (parcel.status !== 'matched' || parcel.jurisdiction !== 'us-fips:12001' || !record.rawParcelIds.some(value => normalizeParcelId(value) === normalizeParcelId(parcel.rawParcelId))) continue;
    if (/^vacant (?:land|lot)$/i.test(record.advertisedPropertyType || '') && parcel.properties?.buildingCount > 0 && parcel.properties?.livingAreaSqft > 0) signals.push({
      id: `structure_description_discrepancy:${parcel.rawParcelId}`, title: 'Offering description and building record disagree', evidenceClass: 'research_lead',
      explanation: 'The imported description says vacant land or lot, while the matched county parcel records a building and heated area. Record age and measurement definitions may explain the difference; a usable building is unconfirmed.',
      evidence: [{ field: 'advertisedPropertyType', value: record.advertisedPropertyType, ...record.source }, { field: 'buildingCount', value: parcel.properties.buildingCount, assessmentYear: parcel.properties.assessmentYear, ...parcel.source }, { field: 'livingAreaSqft', value: parcel.properties.livingAreaSqft, assessmentYear: parcel.properties.assessmentYear, ...parcel.source }],
      nextAction: 'Compare the offering document, dated assessment record, and property-specific inspection or permit evidence.',
    });
  }
  return { signals, issues };
}

async function buildAlachuaPilot(packetId, options = {}) {
  if (!/^intake_[a-f0-9]{24}$/.test(packetId || '')) reject('ALACHUA_PACKET_REQUIRED', 'A stored county intake packet ID is required.');
  const store = loadStore(options.storePath);
  const packet = store.records.find(row => row.id === packetId);
  const result = normalizeReviewedPacket(packet, options);
  const history = collectStatusHistory(store.records, packet.capturedAt, packet.review.reviewedAt, options);
  for (const record of result.records) {
    record.statusHistory = (history.histories.get(record.publisherRecordId.toLowerCase()) || []).filter(item => item.observedAt <= record.observedAt);
    const byObservation = new Map();
    for (const item of record.statusHistory) {
      const statuses = byObservation.get(item.observedAt) || new Set();
      statuses.add(item.rawStatus);
      byObservation.set(item.observedAt, statuses);
    }
    record.statusConflicts = [...byObservation.entries()]
      .filter(([, statuses]) => statuses.size > 1)
      .map(([observedAt, statuses]) => ({ observedAt, rawStatuses: [...statuses].sort() }));
  }
  const lookup = options.lookupAlachuaParcel || lookupAlachuaParcel;
  const limit = Math.max(1, Math.min(20, Math.floor(Number(options.maxParcelLookups) || 5)));
  const cache = new Map();
  const breaker = options.circuitBreaker || new ScraperCircuitBreaker();
  const wait = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let lookups = 0;
  for (const record of result.records) {
    const parcels = [], issues = [];
    for (let index = 0; index < record.rawParcelIds.length; index++) {
      const rawParcelId = record.rawParcelIds[index];
      const cacheKey = record.parcelIdentities[index].key;
      if (cache.has(cacheKey)) { const cached = cache.get(cacheKey); if (cached.parcel) parcels.push(cached.parcel); else issues.push({ ...cached.issue, rawParcelId }); continue; }
      if (options.allowNetwork !== true || lookups >= limit) { issues.push({ code: options.allowNetwork === true ? 'COUNTY_LOOKUP_BUDGET' : 'COUNTY_LOOKUP_NOT_REQUESTED', message: 'County parcel evidence has not been acquired for this parcel.', rawParcelId }); continue; }
      if (lookups) await wait(250 + Math.floor(Math.random() * 501));
      lookups++;
      try { const parcel = await lookup({ rawParcelId }, { ...options, circuitBreaker: breaker }); cache.set(cacheKey, { parcel }); parcels.push(parcel); }
      catch (error) { const issue = { code: error instanceof PublicRecordError ? error.code : 'COUNTY_LOOKUP_UNAVAILABLE', message: error instanceof PublicRecordError ? error.message : 'County parcel lookup is unavailable.', rawParcelId }; cache.set(cacheKey, { issue }); issues.push(issue); }
    }
    const findings = buildAlachuaSignals(record, parcels);
    const parcelMaps = parcels.filter(parcel => parcel.status === 'matched').map(parcel => ({ rawParcelId: parcel.rawParcelId, propertyAppraiserUrl: parcel.propertyAppraiserUrl || null, geometry: parcel.geometry, source: parcel.source }));
    Object.assign(record, { parcels, parcelMaps, signals: findings.signals, issues: [...issues, ...findings.issues] });
  }
  return {
    ...result,
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    parcelLookups: lookups,
    historyCoverage: { scope: 'approved_reviewed_packets_through_selected_review', throughCapturedAt: packet.capturedAt, throughReviewedAt: packet.review.reviewedAt, includedPackets: history.includedPackets, ignoredPackets: history.ignoredPackets },
    limitation: 'Reviewed imports and public-record comparisons are research evidence. No automatic live inventory, clear-title, occupancy, valuation, or development-rights conclusion is made.',
  };
}

module.exports = { ALACHUA_SOURCE_ID, AVAILABLE_STATUS, LIST_OF_LANDS_GUIDANCE_URL, FRESHNESS_MS, normalizeReviewedPacket, collectStatusHistory, buildAlachuaSignals, buildAlachuaPilot };
