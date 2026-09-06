const crypto = require('node:crypto');
const net = require('node:net');
const { loadStore, putRecord, queryRecords, updateRecord } = require('./store');

const ALLOWED_KINDS = new Set(['text', 'csv', 'json']);
const MAX_BODY_BYTES = 512 * 1024;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_JSON_RECORDS = 500;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SENSITIVE_KEY = /^(authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i;
const SENSITIVE_TEXT = /(?:authorization\s*:\s*(?:bearer|basic)|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key)\s*[:=]\s*[^\s,;]+)/i;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isJsonCompatible(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || depth > 30 || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonCompatible(item, seen, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Object.entries(value).every(([, nested]) => isJsonCompatible(nested, seen, depth + 1));
}

function hasSensitiveKeys(value, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 30) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, nested]) => SENSITIVE_KEY.test(key) || hasSensitiveKeys(nested, seen, depth + 1));
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] >= 224;
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === '::' || normalized === '::1' || /^f[cd]/.test(normalized)
    || /^fe[89ab]/.test(normalized) || normalized.startsWith('::ffff:');
}

function safeHttpsUrl(value, field, errors) {
  if (typeof value !== 'string' || value.length > 2048) {
    errors.push(`${field} must be an HTTPS URL no longer than 2048 characters`);
    return null;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const ipVersion = net.isIP(hostname);
    const localName = hostname === 'localhost'
      || (ipVersion === 0 && !hostname.includes('.'))
      || /\.(localhost|local|internal|home|lan|example|invalid|test|onion)$/i.test(hostname)
      || hostname === 'metadata.google.internal';
    const unsafeIp = ipVersion === 4 ? isPrivateIpv4(hostname) : ipVersion === 6 && isPrivateIpv6(hostname);
    const credentialQuery = [...parsed.searchParams.keys()].some((key) => SENSITIVE_KEY.test(key));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || credentialQuery || localName || unsafeIp) {
      errors.push(`${field} must be a public HTTPS URL without embedded credentials`);
      return null;
    }
    return parsed.href;
  } catch {
    errors.push(`${field} must be a valid public HTTPS URL`);
    return null;
  }
}

function cleanOptionalString(value, field, maximum, errors) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maximum) {
    errors.push(`${field} must be a string no longer than ${maximum} characters`);
    return null;
  }
  return value.trim();
}

function defaultGetSource(sourceId) {
  try {
    const catalog = require('./catalog');
    return typeof catalog.getSource === 'function' ? catalog.getSource(sourceId) : null;
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && /[\\/]sources[\\/]catalog/.test(error.message)) return null;
    throw error;
  }
}

function validateCustomSource(value, sourceId, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('customSource metadata is required for a source not present in the catalog');
    return null;
  }
  const name = cleanOptionalString(value.name, 'customSource.name', 120, errors);
  const organization = cleanOptionalString(value.organization, 'customSource.organization', 160, errors);
  const description = cleanOptionalString(value.description, 'customSource.description', 500, errors);
  const homepageUrl = value.homepageUrl == null ? null : safeHttpsUrl(value.homepageUrl, 'customSource.homepageUrl', errors);
  if (!name || name.length < 2) errors.push('customSource.name is required');
  if (!organization || organization.length < 2) errors.push('customSource.organization is required');
  if (value.id != null && value.id !== sourceId) errors.push('customSource.id must match sourceId');
  return { id: sourceId, name, organization, description, homepageUrl, cataloged: false };
}

function validateSubmission(input, options = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { isValid: false, errors: ['Submission must be an object'] };
  if (hasSensitiveKeys(input)) errors.push('Submission contains a credential-like field and cannot be retained');

  const sourceId = typeof input.sourceId === 'string' ? input.sourceId.trim().toLowerCase() : '';
  if (!SOURCE_ID_PATTERN.test(sourceId)) errors.push('sourceId must be a 2-64 character lowercase source key');
  const sourceUrl = safeHttpsUrl(input.sourceUrl, 'sourceUrl', errors);
  const isoTimestamp = typeof input.capturedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.capturedAt);
  const capturedAtMs = isoTimestamp ? Date.parse(input.capturedAt) : NaN;
  if (!Number.isFinite(capturedAtMs)) errors.push('capturedAt must be an ISO-8601 timestamp');
  const referenceNowValue = typeof options.now === 'function' ? options.now() : (options.now || Date.now());
  const referenceNow = new Date(referenceNowValue).getTime();
  if (Number.isFinite(capturedAtMs) && capturedAtMs > referenceNow + 10 * 60 * 1000) errors.push('capturedAt cannot be in the future');
  const capturedAt = Number.isFinite(capturedAtMs) ? new Date(capturedAtMs).toISOString() : null;

  const kind = typeof input.kind === 'string' ? input.kind.toLowerCase() : '';
  if (!ALLOWED_KINDS.has(kind)) errors.push('kind must be text, csv, or json');
  const body = input.body ?? input.text;
  let original = null;
  if (kind === 'text' || kind === 'csv') {
    if (typeof body !== 'string' || !body.trim()) errors.push(`${kind} evidence requires a non-empty body or text string`);
    else if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) errors.push(`${kind} evidence exceeds the ${MAX_BODY_BYTES}-byte body limit`);
    else if (SENSITIVE_TEXT.test(body)) errors.push(`${kind} evidence appears to contain a credential and cannot be retained`);
    else original = { body };
  } else if (kind === 'json') {
    let records = input.records;
    let originalBody = null;
    if (records == null && typeof body === 'string') {
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) errors.push(`json evidence exceeds the ${MAX_BODY_BYTES}-byte body limit`);
      else if (SENSITIVE_TEXT.test(body)) errors.push('json evidence appears to contain a credential and cannot be retained');
      else {
        try { records = JSON.parse(body); originalBody = body; }
        catch { errors.push('json evidence body must contain valid JSON'); }
      }
    }
    if (records == null) errors.push('json evidence requires records or a JSON body');
    else if (Array.isArray(records) && records.length > MAX_JSON_RECORDS) errors.push(`json evidence cannot contain more than ${MAX_JSON_RECORDS} records`);
    else if (!isJsonCompatible(records)) errors.push('json evidence records must contain only bounded, finite JSON values');
    else {
      try {
        const serialized = canonicalJson(records);
        if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) errors.push(`json evidence exceeds the ${MAX_PAYLOAD_BYTES}-byte payload limit`);
        else original = originalBody == null ? { records: structuredClone(records) } : { body: originalBody, records: structuredClone(records) };
      } catch {
        errors.push('json evidence records must be serializable JSON');
      }
    }
  }

  const getSource = options.getSource || defaultGetSource;
  let catalogSource = null;
  if (SOURCE_ID_PATTERN.test(sourceId)) {
    try { catalogSource = getSource(sourceId) || null; }
    catch { errors.push('Source catalog lookup failed'); }
  }
  const source = catalogSource
    ? {
        id: sourceId,
        name: catalogSource.name || catalogSource.label || sourceId,
        organization: catalogSource.organization || null,
        homepageUrl: catalogSource.homepageUrl || catalogSource.websiteUrl || catalogSource.discoveryUrl || null,
        cataloged: true,
      }
    : validateCustomSource(input.customSource, sourceId, errors);

  if (original) {
    try {
      const totalBytes = Buffer.byteLength(JSON.stringify(original), 'utf8');
      if (totalBytes > MAX_PAYLOAD_BYTES) errors.push(`Evidence exceeds the ${MAX_PAYLOAD_BYTES}-byte retained payload limit`);
    } catch {
      errors.push('Evidence must be serializable JSON');
    }
  }
  if (errors.length) return { isValid: false, errors };
  return { isValid: true, errors: [], value: { sourceId, source, sourceUrl, capturedAt, kind, original } };
}

function getSummary(record, options = {}) {
  const summary = {
    id: record.id,
    sourceId: record.sourceId,
    source: record.source,
    sourceUrl: record.sourceUrl,
    capturedAt: record.capturedAt,
    kind: record.kind,
    status: record.status,
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    content: record.content,
    provenance: record.provenance,
    review: record.review || null,
  };
  summary.customSource = record.source?.cataloged === false ? {
    name: record.source.name,
    organization: record.source.organization,
    homepageUrl: record.source.homepageUrl,
    description: record.source.description,
  } : null;
  if (options.includeContent === true) summary.original = structuredClone(record.original);
  return summary;
}

function submitEvidence(input, options = {}) {
  const validation = validateSubmission(input, options);
  if (!validation.isValid) {
    const error = new Error(validation.errors.join('; '));
    error.code = 'SOURCE_INTAKE_INVALID';
    error.errors = validation.errors;
    throw error;
  }
  const value = validation.value;
  const canonicalContent = canonicalJson(value.original);
  const contentSha256 = crypto.createHash('sha256').update(canonicalContent).digest('hex');
  const identity = `${value.sourceId}\n${value.sourceUrl}\n${value.kind}\n${contentSha256}`;
  const id = `intake_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
  const now = typeof options.now === 'function' ? options.now() : (options.now || new Date());
  const submittedAt = new Date(now).toISOString();
  const record = {
    id,
    sourceId: value.sourceId,
    source: value.source,
    sourceUrl: value.sourceUrl,
    capturedAt: value.capturedAt,
    kind: value.kind,
    status: 'needs_review',
    submittedAt,
    updatedAt: submittedAt,
    content: {
      sha256: contentSha256,
      bytes: Buffer.byteLength(canonicalContent, 'utf8'),
      recordCount: Array.isArray(value.original.records) ? value.original.records.length : null,
    },
    provenance: { method: 'manual_evidence_import', exactSourceUrl: value.sourceUrl },
    original: value.original,
    review: null,
  };
  const stored = putRecord(record, { filePath: options.storePath });
  return { record: getSummary(stored.record), deduplicated: stored.deduplicated };
}

function listEvidence(filters = {}, options = {}) {
  return queryRecords(filters, { filePath: options.storePath })
    .map((record) => getSummary(record, { includeContent: filters.includeContent === true }));
}

// Coverage needs every enrolled source, including approvals older than the
// bounded review page. Load the bounded store, but return only public enrollment
// metadata: original evidence and operator review text never enter this API.
function listEvidenceSummaries(options = {}) {
  const publicText = (value, maximum) => {
    if (typeof value !== 'string' || SENSITIVE_TEXT.test(value)) return null;
    const text = value.trim();
    return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
  };
  const publicUrl = (value) => value ? safeHttpsUrl(value, 'sourceUrl', []) : null;
  return loadStore(options.storePath).records.slice()
    .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)))
    .map((record) => {
      const decision = ['approved', 'rejected'].includes(record.review?.decision) ? record.review.decision : null;
      const custom = decision === 'approved' && record.source?.cataloged === false ? record.source : null;
      return {
        sourceId: record.sourceId,
        sourceUrl: publicUrl(record.sourceUrl),
        review: decision ? { decision } : null,
        customSource: custom ? {
          name: publicText(custom.name, 120) || record.sourceId,
          organization: publicText(custom.organization, 160),
          homepageUrl: publicUrl(custom.homepageUrl),
          description: publicText(custom.description, 500),
        } : null,
      };
    });
}

function reviewEvidence(id, review, options = {}) {
  if (!/^intake_[a-f0-9]{24}$/.test(id || '')) throw new Error('A valid source intake id is required');
  if (!review || !['approve', 'reject'].includes(review.decision)) throw new Error('Review decision must be approve or reject');
  const errors = [];
  const note = cleanOptionalString(review.note, 'review.note', 1000, errors);
  const reviewer = cleanOptionalString(review.reviewer, 'review.reviewer', 120, errors) || 'admin';
  if (errors.length) {
    const error = new Error(errors.join('; '));
    error.code = 'SOURCE_INTAKE_INVALID_REVIEW';
    throw error;
  }
  const now = typeof options.now === 'function' ? options.now() : (options.now || new Date());
  const reviewedAt = new Date(now).toISOString();
  const updated = updateRecord(id, (record) => ({
    ...record,
    status: 'reviewed',
    updatedAt: reviewedAt,
    review: { decision: review.decision === 'approve' ? 'approved' : 'rejected', reviewer, note, reviewedAt },
  }), { filePath: options.storePath });
  return getSummary(updated);
}

module.exports = {
  ALLOWED_KINDS,
  MAX_BODY_BYTES,
  MAX_JSON_RECORDS,
  MAX_PAYLOAD_BYTES,
  getSummary,
  listEvidence,
  listEvidenceSummaries,
  reviewEvidence,
  submitEvidence,
  validateSubmission,
};
