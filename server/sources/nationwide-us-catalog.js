'use strict';

/**
 * Nationwide U.S. source catalog expansions.
 * Every state gets LOCAL_ROUTE enrollment templates for tax sale and surplus
 * real property. Federal national sources already live in catalog.js
 * (HUD, IRS, Treasury, USDA, GSA, FEMA, EPA, Census, CourtListener, etc.).
 * CAPTCHA platforms are never added as auto-crawl adapters here.
 */

const US_STATES = Object.freeze([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

const STATE_NAMES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
});

/** Official state government portal used as discovery root for enrollment. */
function statePortal(state) {
  return 'https://www.usa.gov/state-governments';
}

function buildNationwideStateEntries() {
  const entries = [];
  for (const code of US_STATES) {
    const name = STATE_NAMES[code] || code;
    entries.push({
      id: `state-tax-sale-${code.toLowerCase()}`,
      label: `${name} (${code}) State/County Tax Sale Program`,
      category: 'tax_sale',
      role: 'opportunity',
      coverage: `${name} statewide tax lien/deed sale programs — per-county enrollment required; no universal statewide inventory feed.`,
      discoveryUrl: statePortal(code),
      access: 'jurisdiction',
      adapterKey: null,
      status: 'LOCAL_ROUTE',
      workflow: {
        primary: `Identify the ${name} county tax collector/treasurer that publishes tax sales and enroll that exact official notice publisher.`,
        fallback: 'Use state comptroller/revenue guidance and county treasurer contacts.',
        cadenceHours: 168,
        steps: [
          'Confirm whether the county runs tax lien, tax deed, or redemption sales.',
          'Locate the official county/state sale calendar and parcel lists.',
          'Capture notice URL, sale type, redemption rules, and bidder requirements.',
        ],
      },
      requiredEvidence: [
        'official county/state tax-sale notice',
        'parcel or legal description',
        'sale type and redemption terms',
        'source-observed timestamp',
      ],
      notes: `Nationwide enrollment template for ${name}. Tax lien ≠ ownership. CAPTCHA marketplaces remain excluded.`,
    });
    entries.push({
      id: `state-surplus-${code.toLowerCase()}`,
      label: `${name} (${code}) State Surplus Real Property`,
      category: 'government_surplus',
      role: 'opportunity',
      coverage: `${name} state agency excess real-estate disposal programs; office and portal vary by state.`,
      discoveryUrl: statePortal(code),
      access: 'jurisdiction',
      adapterKey: null,
      status: 'LOCAL_ROUTE',
      workflow: {
        primary: `Enroll the ${name} state surplus/procurement office that disposes real property.`,
        fallback: 'Use state public-notice register and agency facilities contacts.',
        cadenceHours: 168,
        steps: [
          'Identify the state real-property disposal authority.',
          'Find the exact solicitation or auction notice.',
          'Record sale method, deposit, and transfer conditions.',
        ],
      },
      requiredEvidence: ['state disposal notice', 'legal description', 'bid/offer terms'],
      notes: `Nationwide enrollment template for ${name} surplus real property only (not personal property).`,
    });
  }
  return entries;
}

const NATIONWIDE_US_ENTRIES = Object.freeze(buildNationwideStateEntries());

const CIVILVIEW_NATIONWIDE_ENTRY = Object.freeze({
  id: 'civilview-nationwide',
  label: 'CivilView Participating Jurisdictions (Nationwide set)',
  category: 'foreclosure_auction',
  role: 'opportunity',
  coverage: 'All currently published CivilView/Sales Web participating counties (multi-state sheriff and tax-sale programs). Not every U.S. county.',
  discoveryUrl: 'https://salesweb.civilview.com/',
  access: 'jurisdiction',
  adapterKey: 'civilview',
  status: 'SCOPE_LIMITED',
  workflow: {
    primary: 'Set CIVILVIEW_NATIONWIDE=1 or enroll per-state CIVILVIEW_EXTRA_COUNTIES from config/nationwide-civilview.js.',
    fallback: 'Use each county sheriff/treasurer original notice.',
    cadenceHours: 12,
    steps: [
      'Discover countyId via scripts/civilview-counties.js.',
      'Enroll bounded county sets per run (maxCounties/detailLimit).',
      'Capture SaleDetails and issuing-county notice terms.',
    ],
  },
  requiredEvidence: ['CivilView SaleDetails URL', 'issuing county notice', 'source-observed timestamp'],
  notes: 'Nationwide means all participating CivilView counties (~67 across 18 states as of 2026-09-19), not 3,000+ U.S. counties.',
});

const SHERIFF_REALEAUCTION_MULTI_STATE = Object.freeze({
  id: 'realeauction-sheriff-multi-state',
  label: 'Realauction Sheriff/Tax Sale Portals (Multi-state)',
  category: 'foreclosure_auction',
  role: 'opportunity',
  coverage: 'Participating Realauction county portals (Ohio default set + operator-enrolled counties in other states using the same platform).',
  discoveryUrl: 'https://www.realauction.com/',
  access: 'jurisdiction',
  adapterKey: 'sheriff',
  status: 'LOCAL_ROUTE',
  workflow: {
    primary: 'Enroll Name:domain:ST via SHERIFF_EXTRA_COUNTIES for each Realauction county portal.',
    fallback: 'County sheriff or tax collector original sale notice.',
    cadenceHours: 12,
    steps: [
      'Confirm the county publishes on Realauction / sheriffsaleauction.* domains.',
      'Enroll domain and state code.',
      'Capture case/sale record and court or tax authority terms.',
    ],
  },
  requiredEvidence: ['Realauction case/sale URL', 'county authority notice', 'sale date and bid terms'],
  notes: 'Ohio defaults ship in sheriff.js; other states require explicit enrollment. Not nationwide by default.',
});

module.exports = {
  US_STATES,
  STATE_NAMES,
  NATIONWIDE_US_ENTRIES,
  CIVILVIEW_NATIONWIDE_ENTRY,
  SHERIFF_REALEAUCTION_MULTI_STATE,
  buildNationwideStateEntries,
};
