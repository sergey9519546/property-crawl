// server/state-codes.js
//
// Single source of truth for US state/territory codes. The previous code
// base had the list inlined in at least three places (the live-ingestion
// validator, the audit library, and the FHFA source-policy regex), each
// drifting independently. The format-only `/^[A-Z]{2}$/` regex lets
// placeholder codes like 'ZZ' or 'AQ' through, so any caller that wants
// to fail closed must consult the canonical set rather than the regex.
//
// Sources: USPS two-letter state and territory abbreviations (public).

'use strict';

// Closed set of US states + DC + the 5 US territories that some
// government sources surface (PR, VI, GU, MP, AS). Adding a code here
// is a deliberate signal: "this is a real USPS code that may appear
// in upstream data."
const US_STATE_OR_TERRITORY_CODES = new Set([
  // 50 states + DC
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
  'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  // US territories
  'PR', 'VI', 'GU', 'MP', 'AS',
]);

// `XX` is reserved by USPS for "unknown" / placeholder states in some
// government feeds. Reject it explicitly so a placeholder can't sneak
// past the closed-set check on a separate import boundary.
const RESERVED_PLACEHOLDER_CODES = new Set(['XX', 'US']);

const US_STATE_OR_TERRITORY_CODE = /^[A-Z]{2}$/;

function isUsStateOrTerritoryCode(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toUpperCase();
  return US_STATE_OR_TERRITORY_CODE.test(normalized)
    && !RESERVED_PLACEHOLDER_CODES.has(normalized)
    && US_STATE_OR_TERRITORY_CODES.has(normalized);
}

module.exports = {
  US_STATE_OR_TERRITORY_CODES,
  RESERVED_PLACEHOLDER_CODES,
  US_STATE_OR_TERRITORY_CODE,
  isUsStateOrTerritoryCode,
};