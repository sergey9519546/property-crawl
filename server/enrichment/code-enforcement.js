'use strict';

/**
 * Municipal Code Violations & Vacancy Signals Ingestion Gateway
 * 
 * Queries public Socrata SODA REST APIs for municipal open data portals:
 * - City of Orlando (FL): data.cityoforlando.net dataset 5b39-smxs
 * - City of Chicago (IL): data.cityofchicago.org dataset 22u3-xenr
 * - City of New Orleans (LA): data.nola.gov dataset 8vs5-j6m5
 * - City of Philadelphia (PA): data.phila.gov / OpenDataPhilly licenses & inspections
 * - City of Austin (TX): data.austintexas.gov dataset b274-pqqb
 * - City of Dallas (TX): www.dallasopendata.com dataset 9qet-m2u9
 * - City of Baltimore (MD): data.baltimorecity.gov dataset n435-yubt
 * - City of Cincinnati (OH): data.cincinnati-oh.gov dataset cf5w-zngb
 * - City of Kansas City (MO): data.kcmo.org dataset ax3m-jhxx
 */

const MUNICIPAL_PORTALS = Object.freeze({
  orlando: {
    key: 'orlando',
    source: 'SOCRATA_ORLANDO',
    name: 'City of Orlando Code Enforcement Violations',
    host: 'data.cityoforlando.net',
    datasetId: '5b39-smxs',
    endpoint: 'https://data.cityoforlando.net/resource/5b39-smxs.json',
    states: ['FL'],
    cities: ['ORLANDO'],
    counties: ['ORANGE'],
    addressField: 'case_address',
    parcelField: 'parcel_id',
    codeField: 'violation_code',
    descField: 'violation_description',
    statusField: 'case_status',
    dateField: 'opened_date',
    inspectionDateField: 'last_inspection_date'
  },
  chicago: {
    key: 'chicago',
    source: 'SOCRATA_CHICAGO',
    name: 'City of Chicago Building Code Violations',
    host: 'data.cityofchicago.org',
    datasetId: '22u3-xenr',
    endpoint: 'https://data.cityofchicago.org/resource/22u3-xenr.json',
    states: ['IL'],
    cities: ['CHICAGO'],
    counties: ['COOK'],
    addressField: 'address',
    parcelField: 'property_group',
    codeField: 'violation_code',
    descField: 'violation_description',
    statusField: 'violation_status',
    dateField: 'violation_date',
    inspectionDateField: 'violation_status_date'
  },
  neworleans: {
    key: 'neworleans',
    source: 'SOCRATA_NEW_ORLEANS',
    name: 'City of New Orleans Code Enforcement Cases',
    host: 'data.nola.gov',
    datasetId: '8vs5-j6m5',
    endpoint: 'https://data.nola.gov/resource/8vs5-j6m5.json',
    states: ['LA'],
    cities: ['NEW ORLEANS'],
    counties: ['ORLEANS'],
    addressField: 'address',
    parcelField: 'geopin',
    codeField: 'case_type',
    descField: 'violation_description',
    statusField: 'case_status',
    dateField: 'date_opened',
    inspectionDateField: 'last_inspection_date'
  },
  philadelphia: {
    key: 'philadelphia',
    source: 'SOCRATA_PHILADELPHIA',
    name: 'City of Philadelphia Licenses & Inspections Violations',
    host: 'data.phila.gov',
    datasetId: '4zmm-btfc',
    endpoint: 'https://data.phila.gov/resource/4zmm-btfc.json',
    states: ['PA'],
    cities: ['PHILADELPHIA', 'PHILLY'],
    counties: ['PHILADELPHIA'],
    addressField: 'address',
    parcelField: 'parcel_id_num',
    codeField: 'violationcode',
    descField: 'violationdescription',
    statusField: 'casestatus',
    dateField: 'violationdate',
    inspectionDateField: 'inspectiondate'
  },
  austin: {
    key: 'austin',
    source: 'SOCRATA_AUSTIN',
    name: 'City of Austin Code Cases',
    host: 'data.austintexas.gov',
    datasetId: 'b274-pqqb',
    endpoint: 'https://data.austintexas.gov/resource/b274-pqqb.json',
    states: ['TX'],
    cities: ['AUSTIN'],
    counties: ['TRAVIS', 'WILLIAMSON'],
    addressField: 'property_address',
    parcelField: 'parcel_id',
    codeField: 'code_section',
    descField: 'case_description',
    statusField: 'case_status',
    dateField: 'opened_date',
    inspectionDateField: 'last_inspection_date'
  },
  dallas: {
    key: 'dallas',
    source: 'SOCRATA_DALLAS',
    name: 'City of Dallas Code Compliance Violations',
    host: 'www.dallasopendata.com',
    datasetId: '9qet-m2u9',
    endpoint: 'https://www.dallasopendata.com/resource/9qet-m2u9.json',
    states: ['TX'],
    cities: ['DALLAS'],
    counties: ['DALLAS', 'COLLIN', 'DENTON'],
    addressField: 'service_request_address',
    parcelField: 'property_id',
    codeField: 'violation_type',
    descField: 'violation_description',
    statusField: 'status',
    dateField: 'created_date',
    inspectionDateField: 'status_date'
  },
  baltimore: {
    key: 'baltimore',
    source: 'SOCRATA_BALTIMORE',
    name: 'City of Baltimore Housing Code Violations',
    host: 'data.baltimorecity.gov',
    datasetId: 'n435-yubt',
    endpoint: 'https://data.baltimorecity.gov/resource/n435-yubt.json',
    states: ['MD'],
    cities: ['BALTIMORE', 'BALTIMORE CITY'],
    counties: ['BALTIMORE', 'BALTIMORE CITY'],
    addressField: 'propertyaddress',
    parcelField: 'blocklot',
    codeField: 'violationcode',
    descField: 'violationdescription',
    statusField: 'violationstatus',
    dateField: 'noticedate',
    inspectionDateField: 'inspectiondate'
  },
  cincinnati: {
    key: 'cincinnati',
    source: 'SOCRATA_CINCINNATI',
    name: 'City of Cincinnati Code Enforcement Violations',
    host: 'data.cincinnati-oh.gov',
    datasetId: 'cf5w-zngb',
    endpoint: 'https://data.cincinnati-oh.gov/resource/cf5w-zngb.json',
    states: ['OH'],
    cities: ['CINCINNATI'],
    counties: ['HAMILTON'],
    addressField: 'address',
    parcelField: 'parcel_number',
    codeField: 'violation_code',
    descField: 'violation_description',
    statusField: 'status',
    dateField: 'entered_date',
    inspectionDateField: 'last_inspection_date'
  },
  kansascity: {
    key: 'kansascity',
    source: 'SOCRATA_KANSAS_CITY',
    name: 'City of Kansas City Property Violations',
    host: 'data.kcmo.org',
    datasetId: 'ax3m-jhxx',
    endpoint: 'https://data.kcmo.org/resource/ax3m-jhxx.json',
    states: ['MO'],
    cities: ['KANSAS CITY'],
    counties: ['JACKSON', 'CLAY', 'PLATTE'],
    addressField: 'street_address',
    parcelField: 'kiva_pin',
    codeField: 'ordinance_code',
    descField: 'violation_description',
    statusField: 'case_status',
    dateField: 'violation_entry_date',
    inspectionDateField: 'last_action_date'
  }
});

const CLOSED_STATUSES = Object.freeze(new Set([
  'CLOSED',
  'COMPLIED',
  'RESOLVED',
  'DISMISSED',
  'COMPLIANT',
  'IN COMPLIANCE',
  'CANCELLED',
  'VOID',
  'ABATED',
  'INACTIVE',
  'PASSED',
  'SATISFIED',
  'COMPLETED'
]));

const VACANCY_KEYWORDS = Object.freeze([
  'vacant',
  'unoccupied',
  'abandoned',
  'board up',
  'boarded',
  'emergency board',
  'vacant building registration',
  'unfit for human habitation',
  'demolition',
  'condemn',
  'open to entry',
  'unsafe structure',
  'vbr'
]);

const DEMOLITION_KEYWORDS = Object.freeze([
  'condemn',
  'demolition',
  'unsafe structure',
  'unfit for human habitation',
  'order to demolish',
  'emergency board up',
  'emergency board',
  'imminent danger',
  'substandard building',
  'vacant building registration',
  'dangerous building',
  'structure unfit',
  'collapse hazard'
]);

function isDemolitionOrCondemnationText(text = '') {
  const lower = String(text || '').toLowerCase();
  return DEMOLITION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Resolves municipal portal configuration for state/county/city.
 */
function resolveMunicipalPortal({ state, county, city } = {}) {
  if (!state) return null;
  const st = String(state).trim().toUpperCase();
  const ct = city ? String(city).trim().toUpperCase() : '';
  const co = county ? String(county).trim().toUpperCase().replace(/\s+(COUNTY|PARISH)$/i, '') : '';
  const coRaw = county ? String(county).trim().toUpperCase() : '';

  const portals = Object.values(MUNICIPAL_PORTALS).filter((p) => p.states.includes(st));
  if (!portals.length) return null;

  // 1. Exact city match
  if (ct) {
    const matchedCity = portals.find((p) => p.cities.includes(ct));
    if (matchedCity) return matchedCity;
  }

  // 2. County / Parish match
  if (co || coRaw) {
    const matchedCounty = portals.find((p) =>
      p.counties.includes(co) ||
      p.counties.includes(coRaw) ||
      (co.endsWith(' CITY') && p.counties.includes(co))
    );
    if (matchedCounty) return matchedCounty;
  }

  // 3. Substring city match (e.g. 'KANSAS CITY, MO' or 'PHILLY')
  if (ct) {
    const matchedCitySub = portals.find((p) =>
      p.cities.some((c) => ct.includes(c) || c.includes(ct))
    );
    if (matchedCitySub) return matchedCitySub;
  }

  return null;
}

/**
 * Sanitizes input text for SoQL query literals.
 */
function sanitizeSoqlLiteral(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/'/g, "''");
}

/**
 * Builds the SODA REST API URL with SoQL query parameters for the specified municipality.
 */
function buildMunicipalQueryUrl({ state, county, city, parcelId, address } = {}) {
  const portal = resolveMunicipalPortal({ state, county, city });
  if (!portal) return null;

  const cleanAddr = sanitizeSoqlLiteral(address);
  const cleanParcel = sanitizeSoqlLiteral(parcelId);

  if (!cleanAddr && !cleanParcel) return null;

  const url = new URL(portal.endpoint);
  const whereClauses = [];

  if (cleanAddr) {
    whereClauses.push(`upper(${portal.addressField}) like '%${cleanAddr}%'`);
  }
  if (cleanParcel) {
    whereClauses.push(`upper(${portal.parcelField}) = '${cleanParcel}'`);
  }

  const where = whereClauses.length > 1 ? `(${whereClauses.join(' OR ')})` : whereClauses[0];
  url.searchParams.set('$where', where);
  url.searchParams.set('$limit', '50');
  if (portal.dateField) {
    url.searchParams.set('$order', `${portal.dateField} DESC`);
  }

  const queryString = url.searchParams.toString().replace(/%24/g, '$');
  return `${portal.endpoint}?${queryString}`;
}

/**
 * Determines whether a violation status represents an open violation.
 */
function isOpenStatus(status) {
  if (!status) return true;
  const normalized = String(status).trim().toUpperCase();
  return !CLOSED_STATUSES.has(normalized);
}

/**
 * Detects whether a record represents a vacancy notice, abandonment, or board-up.
 */
function isVacantNotice(record = {}, violation = {}) {
  if (record.vacant === 'Y' || record.vacant === true || record.is_vacant === true || record.is_vacant === 'Y') {
    return true;
  }
  const text = `${violation.code || ''} ${violation.description || ''} ${record.case_type || ''} ${record.violation_type || ''} ${record.violation_ordinance || ''} ${record.case_description || ''}`.toLowerCase();
  return VACANCY_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Extracts and parses violation items from SODA API responses.
 */
function parseCodeViolationsResponse(data, portal) {
  let records = [];
  if (Array.isArray(data)) {
    records = data;
  } else if (data && Array.isArray(data.rows)) {
    records = data.rows;
  } else if (data && Array.isArray(data.features)) {
    records = data.features.map((f) => f.attributes || f.properties || {});
  }

  const violations = [];
  let openViolationsCount = 0;
  let totalFines = 0;
  let vacantBuildingNotice = false;
  let hasDemolitionRisk = false;
  let isCondemnedFlag = false;
  let latestInspectionTime = 0;
  let latestInspectionDateStr = null;

  for (const record of records) {
    const code = String(
      (portal && portal.codeField && record[portal.codeField]) ||
      record.violation_code ||
      record.violationcode ||
      record.code_section ||
      record.ordinance_code ||
      record.code ||
      record.ordinance ||
      record.violation_ordinance ||
      record.case_type ||
      ''
    ).trim();

    const description = String(
      (portal && portal.descField && record[portal.descField]) ||
      record.violation_description ||
      record.violationdescription ||
      record.case_description ||
      record.description ||
      record.violation_type ||
      record.service_request_type ||
      record.violation ||
      record.comments ||
      ''
    ).trim();

    const status = String(
      (portal && portal.statusField && record[portal.statusField]) ||
      record.violation_status ||
      record.violationstatus ||
      record.case_status ||
      record.casestatus ||
      record.status ||
      'OPEN'
    ).trim();

    const date = String(
      (portal && portal.dateField && record[portal.dateField]) ||
      record.violation_date ||
      record.violationdate ||
      record.opened_date ||
      record.created_date ||
      record.entered_date ||
      record.violation_entry_date ||
      record.noticedate ||
      record.date_opened ||
      record.inspection_date ||
      record.violation_status_date ||
      record.date ||
      ''
    ).trim();

    // Fine extraction
    const rawFine = (portal && portal.fineField && record[portal.fineField] !== undefined)
      ? record[portal.fineField]
      : (record.fine_amount !== undefined
        ? record.fine_amount
        : record.fineAmount !== undefined
        ? record.fineAmount
        : record.fine !== undefined
        ? record.fine
        : record.fee_amount !== undefined
        ? record.fee_amount
        : record.total_fees !== undefined
        ? record.total_fees
        : record.fees_assessed !== undefined
        ? record.fees_assessed
        : record.estimated_cost !== undefined
        ? record.estimated_cost
        : record.fines !== undefined
        ? record.fines
        : record.fee !== undefined
        ? record.fee
        : record.penalty_amount !== undefined
        ? record.penalty_amount
        : record.balance_due !== undefined
        ? record.balance_due
        : record.amount !== undefined
        ? record.amount
        : 0);

    const parsedFine = typeof rawFine === 'number'
      ? rawFine
      : parseFloat(String(rawFine || '0').replace(/[^0-9.-]/g, '')) || 0;
    const fineAmount = Math.max(0, parsedFine);

    // Demolition / condemnation detection
    const fullText = `${code} ${description} ${record.case_type || ''} ${record.violation_type || ''} ${record.violation_description || ''} ${record.case_description || ''} ${record.ordinance_code || ''} ${record.code_section || ''}`;
    const recordCondemned = Boolean(
      record.is_condemned === true ||
      record.is_condemned === 'Y' ||
      record.condemned === true ||
      record.condemned === 'Y' ||
      record.isCondemned === true
    );
    const textCondemned = isDemolitionOrCondemnationText(fullText);
    const isCondemned = recordCondemned || textCondemned;
    const isDemolitionRisk = isCondemned || textCondemned;

    // Vacancy detection
    const isVacant = isVacantNotice(record, { code, description });

    const violation = {
      code,
      description,
      status,
      date,
      fineAmount,
      isCondemned,
      isDemolitionRisk,
      isVacant,
      violationType: description || code || 'Municipal Code Violation'
    };

    violations.push(violation);

    if (isOpenStatus(status)) {
      openViolationsCount++;
      totalFines += fineAmount;
    }

    if (!vacantBuildingNotice && (isVacant || isVacantNotice(record, violation))) {
      vacantBuildingNotice = true;
    }

    if (isCondemned) {
      isCondemnedFlag = true;
      hasDemolitionRisk = true;
    }
    if (isDemolitionRisk) {
      hasDemolitionRisk = true;
    }

    const inspectionField = portal ? portal.inspectionDateField : null;
    const candidateDates = [
      inspectionField ? record[inspectionField] : null,
      record.last_inspection_date,
      record.status_date,
      record.inspectiondate,
      record.last_action_date,
      record.inspection_date,
      record.violation_status_date,
      date
    ].filter(Boolean);

    for (const d of candidateDates) {
      const parsedTime = Date.parse(d);
      if (!Number.isNaN(parsedTime) && parsedTime > latestInspectionTime) {
        latestInspectionTime = parsedTime;
        latestInspectionDateStr = typeof d === 'string' && d.length <= 10 ? d : new Date(parsedTime).toISOString().slice(0, 10);
      }
    }
  }

  return {
    source: portal ? portal.source : 'SOCRATA_MUNICIPAL',
    queriedAt: new Date().toISOString(),
    violationsCount: violations.length,
    openViolationsCount,
    totalFines,
    vacantBuildingNotice,
    isCondemned: isCondemnedFlag,
    hasDemolitionRisk,
    lastInspectionDate: latestInspectionDateStr,
    violations
  };
}

/**
 * Looks up municipal code violations and vacancy signals for a property.
 *
 * @param {Object} params
 * @param {string} params.state - Two-letter state code (e.g. 'FL')
 * @param {string} [params.county] - County or parish name (e.g. 'Orange')
 * @param {string} [params.city] - City name (e.g. 'Orlando')
 * @param {string} [params.parcelId] - Parcel PIN / APN
 * @param {string} [params.address] - Street address
 * @param {number} [params.timeoutMs=4000] - Request timeout in milliseconds
 * @param {Function} [params.fetchFn] - Custom fetch implementation for testing
 * @returns {Promise<Object>}
 */
async function lookupCodeViolations({
  state,
  county,
  city,
  parcelId,
  address,
  timeoutMs = 4000,
  fetchFn = globalThis.fetch
} = {}) {
  const portal = resolveMunicipalPortal({ state, county, city });

  if (!portal) {
    return {
      source: 'UNSUPPORTED_MUNICIPALITY',
      violationsCount: 0,
      openViolationsCount: 0,
      vacantBuildingNotice: false,
      lastInspectionDate: null,
      violations: []
    };
  }

  const url = buildMunicipalQueryUrl({ state, county, city, parcelId, address });

  if (!url) {
    return {
      source: portal.source,
      queriedAt: new Date().toISOString(),
      violationsCount: 0,
      openViolationsCount: 0,
      totalFines: 0,
      vacantBuildingNotice: false,
      isCondemned: false,
      hasDemolitionRisk: false,
      lastInspectionDate: null,
      violations: []
    };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;

  if (controller) {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
    }, timeoutMs);
  }

  try {
    const fetchOptions = {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PropertyCrawl/2.0 (Municipal Code Intelligence)'
      }
    };
    if (controller) {
      fetchOptions.signal = controller.signal;
    }

    const res = await fetchFn(url, fetchOptions);

    if (!res || !res.ok) {
      return {
        source: portal.source,
        queriedAt: new Date().toISOString(),
        violationsCount: 0,
        openViolationsCount: 0,
        vacantBuildingNotice: false,
        lastInspectionDate: null,
        violations: []
      };
    }

    const json = await res.json();
    return parseCodeViolationsResponse(json, portal);
  } catch (err) {
    return {
      source: portal.source,
      queriedAt: new Date().toISOString(),
      violationsCount: 0,
      openViolationsCount: 0,
      vacantBuildingNotice: false,
      lastInspectionDate: null,
      violations: []
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  MUNICIPAL_PORTALS,
  CLOSED_STATUSES,
  VACANCY_KEYWORDS,
  DEMOLITION_KEYWORDS,
  isDemolitionOrCondemnation: isDemolitionOrCondemnationText,
  resolveMunicipalPortal,
  sanitizeSoqlLiteral,
  buildMunicipalQueryUrl,
  isOpenStatus,
  isVacantNotice,
  parseCodeViolationsResponse,
  lookupCodeViolations
};
