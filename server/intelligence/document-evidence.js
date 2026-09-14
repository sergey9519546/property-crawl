'use strict';
const { validateListingForIngestion } = require('../scrapers/validation');

const ACCESS_STATES = new Set(['public', 'restricted', 'registration_required', 'unavailable', 'unknown']);

function clean(value, max = 300) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function iso(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function statedAccess(document) {
  const value = clean(document?.accessState || document?.access, 40)?.toLowerCase().replace(/[\s-]+/g, '_');
  return ACCESS_STATES.has(value) ? value : null;
}

function sameDocuments(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length > 100) return false;
  for (let index = 0; index < left.length; index++) if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) return false;
  return true;
}

function buildDocumentEvidence(listing, { capturedEvidence, observedAt = null, sourceUrl = null, now = Date.now() } = {}) {
  const timestamp = observedAt || listing?.sourceObservedAt || listing?.provenance?.observedAt;
  if (capturedEvidence === undefined) {
    const live = listing?.provenance?.origin === 'live' && validateListingForIngestion(listing).isValid;
    const archive = listing?.provenance?.origin === 'archive' && listing?.provenance?.observed === true
      && /^[a-f0-9]{64}$/i.test(listing?.provenance?.datasetSha256 || '') && listing?.provenance?.recordId;
    capturedEvidence = Boolean((live || archive) && Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) <= now + 300_000);
  }
  const factDocuments = listing?.provenance?.sourceFacts?.documents;
  const mediaDocuments = listing?.provenance?.media?.documents;
  const containers = [
    ...(Array.isArray(factDocuments) ? [{ path: 'provenance.sourceFacts.documents', documents: factDocuments }] : []),
    ...(Array.isArray(mediaDocuments) ? [{ path: 'provenance.media.documents', documents: mediaDocuments }] : [])
  ];
  const capturedAt = capturedEvidence ? iso(timestamp) : null;
  const recordUrl = capturedEvidence ? safeUrl(sourceUrl || listing?.sourceUrl) : null;
  if (!capturedEvidence || !containers.length) {
    return { status: 'unknown', count: null, items: [], observedAt: capturedAt, sourceUrl: recordUrl };
  }
  const identicalContainers = containers.length === 2 && sameDocuments(factDocuments, mediaDocuments);
  const declaredCount = identicalContainers ? containers[0].documents.length : containers.reduce((sum, container) => sum + container.documents.length, 0);
  const normalized = [];
  const traversed = identicalContainers ? containers.slice(0, 1) : containers;
  for (const container of traversed) {
    for (let index = 0; index < container.documents.length && normalized.length < 100; index++) {
      normalized.push({ document: container.documents[index], index, path: container.path });
    }
    if (normalized.length >= 100) break;
  }
  const items = normalized.map(({ document, index, path }) => {
    if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
    const label = clean(document.title || document.label || document.name || document.documentName || document.documentType);
    const url = safeUrl(document.fileUrl || document.mediaUrl || document.url || document.documentUrl || document.documentURL || document.sourceUrl);
    const declared = statedAccess(document);
    return {
      label,
      url,
      accessState: declared || (url ? 'link_available' : 'unknown'),
      observedAt: iso(document.observedAt || document.capturedAt) || capturedAt,
      provenance: {
        origin: listing.provenance.origin === 'archive' ? 'archived_publisher_snapshot' : 'publisher_record',
        sourceField: `${path}[${index}]`,
        ...(identicalContainers ? { sourceFields: containers.map(container => `${container.path}[${index}]`) } : {}),
        sourceRecordUrl: recordUrl
      }
    };
  }).filter(Boolean);
  return {
    status: declaredCount === 0 ? 'none_observed' : 'observed',
    count: declaredCount,
    items,
    observedAt: capturedAt,
    sourceUrl: recordUrl,
    truncated: declaredCount > items.length,
    containers: Object.fromEntries(containers.map(container => [container.path, { count: container.documents.length }])),
    disagreement: containers.length > 1 && !identicalContainers
  };
}

module.exports = { buildDocumentEvidence, ACCESS_STATES };
