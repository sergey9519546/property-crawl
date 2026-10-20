'use strict';

/**
 * Municipal Code Violations & Vacancy Signals Ingestion Gateway
 * 
 * Queries public Socrata SODA REST APIs for municipal open data portals:
 * - City of Orlando (FL): data.cityoforlando.net dataset 5b39-smxs
 * - City of Chicago (IL): data.cityofchicago.org dataset 22u3-xenr
 * - City of New Orleans (LA): data.nola.gov dataset 8vs5-j6m5
 * - City of Philadelphia (PA): data.phila.gov / OpenDataPhilly licenses & inspections
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
  'PASSED'
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

/**
 * Resolves municipal portal configuration for state/county/city.
 */
function resolveMunicipalPortal({ state, county, city } = {}) {
  if (!state) return null;
  const st = String(state).trim().toUpperCase();
  const ct = city ? String(city).trim().toUpperCase() : '';
  const co = county ? String(county).trim().toUpperCase().replace(/\s+(COUNTY|PARISH)$/i, '') : '';

  for (const portal of Object.values(MUNICIPAL_PORTALS)) {
    if (!portal.states.includes(st)) continue;
    if (ct && portal.cities.includes(ct)) return portal;
    if (co && portal.counties.includes(co)) return portal;
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
  const text = `${violation.code || ''} ${violation.description || ''} ${record.case_type || ''} ${record.violation_type || ''} ${record.violation_ordinance || ''}`.toLowerCase();
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
    records = data.features.map(f => f.attributes || f.properties || {});
  }

  const violations = [];
  let openViolationsCount = 0;
  let vacantBuildingNotice = false;
  let latestInspectionTime = 0;
  let latestInspectionDateStr = null;

  for (const record of records) {
    const code = String(
      record[portal.codeField] ||
      record.violation_code ||
      record.violationcode ||
      record.code ||
      record.ordinance ||
      record.violation_ordinance ||
      record.case_type ||
      ''
    ).trim();

    const description = String(
      record[portal.descField] ||
      record.violation_description ||
      record.violationdescription ||
      record.description ||
      record.violation_type ||
      record.violation ||
      record.comments ||
      ''
    ).trim();

    const status = String(
      record[portal.statusField] ||
      record.violation_status ||
      record.case_status ||
      record.casestatus ||
      record.status ||
      'OPEN'
    ).trim();

    const date = String(
      record[portal.dateField] ||
      record.violation_date ||
      record.violationdate ||
      record.opened_date ||
      record.date_opened ||
      record.inspection_date ||
      record.violation_status_date ||
      record.date ||
      ''
    ).trim();

    const violation = {
      code,
      description,
      status,
      date
    };

    violations.push(violation);

    if (isOpenStatus(status)) {
      openViolationsCount++;
    }

    if (!vacantBuildingNotice && isVacantNotice(record, violation)) {
      vacantBuildingNotice = true;
    }

    const candidateDates = [
      record[portal.inspectionDateField],
      record.last_inspection_date,
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
    source: portal.source,
    queriedAt: new Date().toISOString(),
    violationsCount: violations.length,
    openViolationsCount,
    vacantBuildingNotice,
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
      vacantBuildingNotice: false,
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
  resolveMunicipalPortal,
  sanitizeSoqlLiteral,
  buildMunicipalQueryUrl,
  isOpenStatus,
  isVacantNotice,
  parseCodeViolationsResponse,
  lookupCodeViolations
};
