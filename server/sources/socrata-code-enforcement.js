'use strict';

/**
 * server/sources/socrata-code-enforcement.js
 *
 * Open Municipal Code Enforcement & Violation Ingestion via Socrata Open Data APIs.
 * Pulls active municipal code violations, condemned building notices, and demolition
 * orders across key metropolitan jurisdictions (Orlando, New Orleans, Chicago, Austin).
 */

const SOCRATA_PORTALS = Object.freeze({
  orlando: {
    city: 'Orlando',
    state: 'FL',
    endpoint: 'https://data.cityoforlando.net/resource/yjeq-4d5r.json',
    addressField: 'case_address',
    typeField: 'violation_type',
    statusField: 'case_status',
    dateField: 'opened_date',
    fineField: 'total_fees',
  },
  neworleans: {
    city: 'New Orleans',
    state: 'LA',
    endpoint: 'https://data.nola.gov/resource/7hhn-6xz7.json',
    addressField: 'address',
    typeField: 'case_type',
    statusField: 'status',
    dateField: 'date_opened',
    fineField: 'fines',
  },
  chicago: {
    city: 'Chicago',
    state: 'IL',
    endpoint: 'https://data.cityofchicago.org/resource/22u3-xenr.json',
    addressField: 'address',
    typeField: 'violation_description',
    statusField: 'violation_status',
    dateField: 'violation_date',
    fineField: 'fine_amount',
  },
  austin: {
    city: 'Austin',
    state: 'TX',
    endpoint: 'https://data.austintexas.gov/resource/3syk-w9eu.json',
    addressField: 'property_address',
    typeField: 'case_type',
    statusField: 'case_status',
    dateField: 'case_open_date',
    fineField: 'fee_amount',
  },
});

const DEMOLITION_KEYWORDS = [
  'condemn',
  'demolition',
  'unsafe structure',
  'unfit for human habitation',
  'order to demolish',
  'emergency board up',
  'imminent danger',
  'substandard building',
  'vacant building registration',
];

function isDemolitionOrCondemnation(text = '') {
  const lower = String(text || '').toLowerCase();
  return DEMOLITION_KEYWORDS.some((kw) => lower.includes(kw));
}

function parseSocrataRecord(raw = {}, cityKey = 'orlando') {
  const portal = SOCRATA_PORTALS[cityKey] || SOCRATA_PORTALS.orlando;

  const address = String(raw[portal.addressField] || '').trim();
  const violationType = String(raw[portal.typeField] || '').trim();
  const status = String(raw[portal.statusField] || 'OPEN').trim();
  const recordedDate = String(raw[portal.dateField] || '').trim();
  const fineRaw = raw[portal.fineField];
  const fineAmount = typeof fineRaw === 'number' ? fineRaw : parseFloat(String(fineRaw || '0').replace(/[^0-9.]/g, '')) || 0;

  const isCondemned = isDemolitionOrCondemnation(violationType) || isDemolitionOrCondemnation(raw.description || '');

  return {
    source: 'socrata-code-enforcement',
    city: portal.city,
    state: portal.state,
    address,
    violationType,
    status,
    recordedDate,
    fineAmount,
    isCondemned,
    isDemolitionRisk: isCondemned,
  };
}

module.exports = {
  SOCRATA_PORTALS,
  DEMOLITION_KEYWORDS,
  isDemolitionOrCondemnation,
  parseSocrataRecord,
};
