'use strict';

/**
 * Schema-first listing shape gate (research: Runo/Spidra / State of Scraping).
 * Extends validateListingForIngestion with explicit foolproof invariants.
 */

const { validateListingForIngestion } = require('./validation');

const REQUIRED_FIELDS = ['id', 'source', 'state', 'address'];

function validateListingShape(listing, options = {}) {
  const base = validateListingForIngestion(listing, options);
  const errors = [...(base.errors || [])];
  for (const field of REQUIRED_FIELDS) {
    const value = listing?.[field];
    if (value === null || value === undefined || value === '') {
      if (!errors.includes(`missing_${field}`)) errors.push(`missing_${field}`);
    }
  }
  if (listing?.provenance?.origin === 'fixture' && options.requireLive === true) {
    errors.push('fixture_not_allowed');
  }
  const valid = errors.length === 0;
  return { valid, errors, listing: base.listing || listing };
}

function assertListingShape(listing, options = {}) {
  const result = validateListingShape(listing, options);
  if (!result.valid) {
    const error = new Error(`LISTING_SCHEMA_INVALID: ${result.errors.join(',')}`);
    error.code = 'LISTING_SCHEMA_INVALID';
    error.errors = result.errors;
    throw error;
  }
  return result.listing;
}

module.exports = {
  REQUIRED_FIELDS,
  validateListingShape,
  assertListingShape,
};
