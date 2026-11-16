'use strict';

// Zero-Node-dependency boundary coverage manifest shared by browser preflight
// (src/lib/listing-map-policy.js) and verified against server registries in tests.
const STATEWIDE_BOUNDARY_STATES = new Set([
  'AR',
  'CO',
  'CT',
  'FL',
  'NC',
  'NJ',
  'NY',
  'OH',
  'TX',
  'WI',
]);

const ENROLLED_BOUNDARY_COUNTY_KEYS = new Set([
  'AL-JEFFERSON',
  'AZ-MARICOPA',
  'AZ-MOHAVE',
  'AZ-PIMA',
  'AZ-YUMA',
  'CA-LOS ANGELES',
  'CA-SAN BERNARDINO',
  'GA-DEKALB',
  'ID-BANNOCK',
  'IL-COOK',
  'MI-MACOMB',
  'MI-WAYNE',
  'MN-ANOKA',
  'MN-CARVER',
  'MN-DAKOTA',
  'MN-HENNEPIN',
  'MN-RAMSEY',
  'MN-SCOTT',
  'MN-WASHINGTON',
  'NV-CLARK',
  'NV-WASHOE',
  'OH-CUYAHOGA',
  'OH-FRANKLIN',
  'OH-HAMILTON',
  'OH-LAKE',
  'OH-MONTGOMERY',
  'OH-STARK',
  'OH-SUMMIT',
  'PA-ALLEGHENY',
  'PA-BERKS',
  'PA-BUCKS',
  'PA-CHESTER',
  'PA-PHILADELPHIA',
  'TX-BEXAR',
  'TX-DALLAS',
  'TX-HARRIS',
  'TX-TARRANT',
  'TX-TRAVIS',
  'UT-DAVIS',
  'UT-SALT LAKE',
  'UT-UTAH',
  'UT-WEBER',
  'WA-PIERCE',
]);

function normalizeBoundaryCountyKey(state, county) {
  if (!state) return null;
  const st = String(state).trim().toUpperCase();
  const co = county
    ? String(county)
        .trim()
        .toUpperCase()
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s+(COUNTY|PARISH|BOROUGH|MUNICIPALITY|CITY AND COUNTY)$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  if (!co || co === 'COUNTY UNKNOWN' || co === 'UNKNOWN' || co === 'NA' || co === 'N/A') {
    return null;
  }
  const candidates = [
    `${st}-${co}`,
    `${st}-${co.replace(/\./g, '')}`,
    `${st}-${co.replace(/^SAINT\s+/, 'ST. ')}`,
    `${st}-${co.replace(/\s+/g, '-')}`,
  ];
  return candidates.find((key) => ENROLLED_BOUNDARY_COUNTY_KEYS.has(key)) || null;
}

/** Returns true when /api/parcel-boundary has a configured state or county GIS layer. */
function hasParcelBoundaryCoverage(state, county) {
  if (!state) return false;
  const st = String(state).trim().toUpperCase();
  if (!st) return false;
  if (STATEWIDE_BOUNDARY_STATES.has(st)) return true;
  return Boolean(normalizeBoundaryCountyKey(st, county));
}

module.exports = {
  STATEWIDE_BOUNDARY_STATES,
  ENROLLED_BOUNDARY_COUNTY_KEYS,
  normalizeBoundaryCountyKey,
  hasParcelBoundaryCoverage,
};
