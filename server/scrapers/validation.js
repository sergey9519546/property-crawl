const { findBotChallengeSignature } = require('./circuit-breaker');
const { normalizeOcrText } = require('../ai/notice-parser');
const { inspectSourceRecordUrl } = require('./source-policy');
const { isUsStateOrTerritoryCode } = require('../state-codes');
const LISTING_SCHEMA = require('./listing.schema.json');

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isKnown(value) {
  return value !== null && value !== undefined && value !== '';
}

function sanitizeListingForIngestion(item = {}) {
  const rawText = normalizeOcrText(String(item.raw ?? ''));
  return {
    ...item,
    id: String(item.id ?? '').trim(),
    source: String(item.source ?? '').trim().toLowerCase(),
    state: String(item.state ?? '').trim().toUpperCase(),
    address: String(item.address ?? '').replace(/\s+/g, ' ').trim(),
    sourceUrl: item.sourceUrl == null ? null : String(item.sourceUrl).trim(),
    raw: rawText.trim()
  };
}

/**
 * Universal JSON Schema validator for property listings.
 * Zero external dependencies; recursively validates schema types, required properties,
 * ranges, and regex patterns against server/scrapers/listing.schema.json.
 *
 * @param {object} listing - The listing object to validate.
 * @param {object} [schema=LISTING_SCHEMA] - Schema definition.
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validateListingSchema(listing, schema = LISTING_SCHEMA) {
  const errors = [];
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) {
    return {
      isValid: false,
      errors: ['schema_type_mismatch_listing']
    };
  }

  function validateNode(nodeSchema, data, path) {
    if (data === undefined) return;

    // 1. Type validation
    if (nodeSchema.type) {
      const allowedTypes = Array.isArray(nodeSchema.type) ? nodeSchema.type : [nodeSchema.type];
      const matchesType = allowedTypes.some((type) => {
        if (type === 'null') return data === null;
        if (type === 'string') return typeof data === 'string';
        if (type === 'number') return typeof data === 'number' && Number.isFinite(data);
        if (type === 'integer') return typeof data === 'number' && Number.isInteger(data);
        if (type === 'boolean') return typeof data === 'boolean';
        if (type === 'object') return typeof data === 'object' && data !== null && !Array.isArray(data);
        if (type === 'array') return Array.isArray(data);
        return false;
      });

      if (!matchesType) {
        errors.push(`schema_type_mismatch_${path}`);
        return;
      }
    }

    if (data === null) return;

    // 2. Object validation (required fields and properties)
    if (typeof data === 'object' && !Array.isArray(data)) {
      if (Array.isArray(nodeSchema.required)) {
        for (const reqKey of nodeSchema.required) {
          const fieldPath = path ? `${path}_${reqKey}` : reqKey;
          const val = data[reqKey];
          if (val === undefined || val === null || val === '') {
            errors.push(`schema_missing_${fieldPath}`);
          }
        }
      }

      if (nodeSchema.properties && typeof nodeSchema.properties === 'object') {
        for (const [propKey, propSchema] of Object.entries(nodeSchema.properties)) {
          if (data[propKey] !== undefined) {
            const childPath = path ? `${path}_${propKey}` : propKey;
            validateNode(propSchema, data[propKey], childPath);
          }
        }
      }
    }

    // 3. String validation (length and pattern)
    if (typeof data === 'string') {
      if (Number.isFinite(nodeSchema.minLength) && data.length < nodeSchema.minLength) {
        errors.push(`schema_range_mismatch_${path}`);
      }
      if (Number.isFinite(nodeSchema.maxLength) && data.length > nodeSchema.maxLength) {
        errors.push(`schema_range_mismatch_${path}`);
      }
      if (nodeSchema.pattern) {
        const regex = new RegExp(nodeSchema.pattern);
        if (!regex.test(data)) {
          errors.push(`schema_pattern_mismatch_${path}`);
        }
      }
    }

    // 4. Number / Integer validation (minimum and maximum)
    if (typeof data === 'number' && Number.isFinite(data)) {
      if (Number.isFinite(nodeSchema.minimum) && data < nodeSchema.minimum) {
        errors.push(`schema_range_mismatch_${path}`);
      }
      if (Number.isFinite(nodeSchema.maximum) && data > nodeSchema.maximum) {
        errors.push(`schema_range_mismatch_${path}`);
      }
    }
  }

  validateNode(schema, listing, '');

  return {
    isValid: errors.length === 0,
    errors
  };
}

function validateListingForIngestion(item, options = {}) {
  const listing = sanitizeListingForIngestion(item);
  const expectedSource = String(options.expectedSource ?? '').trim().toLowerCase();
  const errors = [];

  // P0.1 Universal Listing JSON Schema Validation
  const schemaValidation = validateListingSchema(listing);
  if (!schemaValidation.isValid) {
    for (const err of schemaValidation.errors) {
      if (!errors.includes(err)) errors.push(err);
    }
  }

  if (!SAFE_ID.test(listing.id)) errors.push('invalid_id');
  if (!listing.source) errors.push('missing_source');
  if (expectedSource && listing.source !== expectedSource) errors.push('source_mismatch');
  if (!isUsStateOrTerritoryCode(listing.state)) {
    errors.push('invalid_state');
  }
  if (listing.address.length < 8 || listing.address.length > 500) errors.push('invalid_address');
  if (isKnown(listing.openingBid) && !finitePositive(listing.openingBid)) errors.push('invalid_opening_bid');
  if (isKnown(listing.estLow) && !finitePositive(listing.estLow)) errors.push('invalid_est_low');
  if (isKnown(listing.estHigh) && !finitePositive(listing.estHigh)) errors.push('invalid_est_high');
  if (isKnown(listing.estLow) && isKnown(listing.estHigh) && Number(listing.estHigh) < Number(listing.estLow)) {
    errors.push('invalid_estimate_range');
  }

  const hasLat = isKnown(listing.lat);
  const hasLng = isKnown(listing.lng);
  if (hasLat !== hasLng) errors.push('partial_geocode');
  if (hasLat) {
    const lat = Number(listing.lat);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('invalid_latitude');
  }
  if (hasLng) {
    const lng = Number(listing.lng);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push('invalid_longitude');
  }

  if (!listing.sourceUrl) errors.push('missing_source_url');
  else {
    const sourceUrlCheck = inspectSourceRecordUrl(listing.source, listing.sourceUrl);
    if (!sourceUrlCheck.isValid) errors.push(sourceUrlCheck.error);
  }

  if (listing.raw.length < 10 || listing.raw.length > 100_000) errors.push('invalid_raw_notice');
  if (findBotChallengeSignature(`${listing.address}\n${listing.raw}`)) errors.push('challenge_payload');
  const provenance = listing.provenance && typeof listing.provenance === 'object'
    ? listing.provenance
    : {};
  const origin = String(provenance.origin || '').trim().toLowerCase();
  if (provenance.fixture === true || provenance.observed === false || ['fixture', 'demo', 'snapshot'].includes(origin)) {
    errors.push('fixture_record_not_ingestible');
  }
  if (provenance.observed !== true) errors.push('missing_observed_provenance');
  if (!String(provenance.publisher || '').trim()) errors.push('missing_provenance_publisher');
  if (!String(provenance.recordId || '').trim()) errors.push('missing_provenance_record_id');
  const observedAt = listing.sourceObservedAt || provenance.observedAt;
  if (!observedAt || !Number.isFinite(Date.parse(String(observedAt)))) errors.push('missing_source_observation_time');

  return {
    isValid: errors.length === 0,
    errors,
    listing
  };
}

module.exports = {
  sanitizeListingForIngestion,
  validateListingForIngestion,
  validateListingSchema,
  LISTING_SCHEMA
};
