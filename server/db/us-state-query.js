'use strict';

// Shared US state name <-> postal abbreviation lookup for discovery & DB search queries.
const US_STATE_NAMES = Object.freeze({
  AK: 'Alaska',
  AL: 'Alabama',
  AR: 'Arkansas',
  AZ: 'Arizona',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DC: 'District of Columbia',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  IA: 'Iowa',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  MA: 'Massachusetts',
  MD: 'Maryland',
  ME: 'Maine',
  MI: 'Michigan',
  MN: 'Minnesota',
  MO: 'Missouri',
  MS: 'Mississippi',
  MT: 'Montana',
  NC: 'North Carolina',
  ND: 'North Dakota',
  NE: 'Nebraska',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NV: 'Nevada',
  NY: 'New York',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  PR: 'Puerto Rico',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VA: 'Virginia',
  VT: 'Vermont',
  WA: 'Washington',
  WI: 'Wisconsin',
  WV: 'West Virginia',
  WY: 'Wyoming',
});

const NAME_TO_STATE_CODE = Object.freeze(
  Object.entries(US_STATE_NAMES).reduce((acc, [code, name]) => {
    acc[name.toUpperCase()] = code;
    return acc;
  }, {
    'WASHINGTON DC': 'DC',
    'WASHINGTON D.C.': 'DC',
  }),
);

/** Resolves a standalone state name or 2-letter postal abbreviation (never arbitrary non-US tokens like "ZZ"). */
function resolveStateQuery(rawQuery) {
  const cleaned = String(rawQuery ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!cleaned) return null;
  if (/^[A-Z]{2}$/.test(cleaned) && US_STATE_NAMES[cleaned]) {
    return {
      stateCode: cleaned,
      stateName: US_STATE_NAMES[cleaned],
      isStateAbbrev: true,
      isFullStateName: false,
    };
  }
  const matchedCode = NAME_TO_STATE_CODE[cleaned] || null;
  if (matchedCode) {
    return {
      stateCode: matchedCode,
      stateName: US_STATE_NAMES[matchedCode],
      isStateAbbrev: false,
      isFullStateName: true,
    };
  }
  return null;
}

module.exports = {
  US_STATE_NAMES,
  NAME_TO_STATE_CODE,
  resolveStateQuery,
};
