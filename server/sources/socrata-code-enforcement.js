'use strict';

/**
 * server/sources/socrata-code-enforcement.js
 *
 * Open Municipal Code Enforcement & Violation Ingestion via Socrata Open Data APIs.
 * Pulls active municipal code violations, condemned building notices, and demolition
 * orders across key metropolitan jurisdictions (Orlando, New Orleans, Chicago, Austin,
 * Dallas, Baltimore, Cincinnati, Kansas City, Los Angeles, Philadelphia).
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
  dallas: {
    city: 'Dallas',
    state: 'TX',
    endpoint: 'https://data.dallasopendata.com/resource/438x-65be.json',
    addressField: 'service_request_address',
    typeField: 'service_request_type',
    statusField: 'status',
    dateField: 'created_date',
    fineField: 'estimated_cost',
  },
  baltimore: {
    city: 'Baltimore',
    state: 'MD',
    endpoint: 'https://data.baltimorecity.gov/resource/n435-yubt.json',
    addressField: 'propertyaddress',
    typeField: 'violationdescription',
    statusField: 'violationstatus',
    dateField: 'noticedate',
    fineField: 'fine_amount',
  },
  cincinnati: {
    city: 'Cincinnati',
    state: 'OH',
    endpoint: 'https://data.cincinnati-oh.gov/resource/m54f-jw4h.json',
    addressField: 'address',
    typeField: 'violation_description',
    statusField: 'status',
    dateField: 'entered_date',
    fineField: 'fine_amount',
  },
  kansascity: {
    city: 'Kansas City',
    state: 'MO',
    endpoint: 'https://data.kcmo.org/resource/ax3m-jhxx.json',
    addressField: 'street_address',
    typeField: 'violation_description',
    statusField: 'case_status',
    dateField: 'violation_entry_date',
    fineField: 'fine_amount',
  },
  losangeles: {
    city: 'Los Angeles',
    state: 'CA',
    endpoint: 'https://data.lacity.org/resource/fd5a-kuh3.json',
    addressField: 'address',
    typeField: 'order_type',
    statusField: 'status',
    dateField: 'effective_date',
    fineField: 'fees_assessed',
  },
  philadelphia: {
    city: 'Philadelphia',
    state: 'PA',
    endpoint: 'https://data.phila.gov/resource/t4b7-g4bp.json',
    addressField: 'address',
    typeField: 'violationdescription',
    statusField: 'violationstatus',
    dateField: 'violationdate',
    fineField: 'fee',
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
