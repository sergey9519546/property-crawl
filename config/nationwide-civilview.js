'use strict';

/**
 * Nationwide CivilView (Tyler Sales Web) county registry.
 * Ids observed from the public index https://salesweb.civilview.com/ (2026-09-19).
 * Coverage is participating jurisdictions only — not every U.S. county.
 */

const CIVILVIEW_NATIONWIDE = Object.freeze({
  discoveredAt: '2026-09-19',
  sourceUrl: 'https://salesweb.civilview.com/',
  note: 'Participating CivilView counties. CAPTCHA/challenged platforms are excluded by policy.',
  counties: Object.freeze([
    { id: '74', name: 'Pulaski County, AR', state: 'AR' },
    { id: '47', name: 'Maricopa County, AZ', state: 'AZ' },
    { id: '48', name: 'Larimer County, CO', state: 'CO' },
    { id: '4', name: 'Kent County, DE', state: 'DE' },
    { id: '24', name: 'New Castle County, DE', state: 'DE' },
    { id: '12', name: 'Sussex, DE', state: 'DE' },
    { id: '49', name: 'Palm Beach County, FL', state: 'FL' },
    { id: '75', name: 'Santa Rosa County, FL', state: 'FL' },
    { id: '92', name: 'Coweta County, GA', state: 'GA' },
    { id: '11', name: 'Pottawattamie County, IA', state: 'IA' },
    { id: '37', name: 'Scott County, IA', state: 'IA' },
    { id: '16', name: 'Story County, IA', state: 'IA' },
    { id: '68', name: 'Canyon County, ID', state: 'ID' },
    { id: '42', name: 'Champaign County, IL', state: 'IL' },
    { id: '58', name: 'Lake County, IL', state: 'IL' },
    { id: '56', name: 'Shawnee County, KS', state: 'KS' },
    { id: '55', name: 'Ascension Parish, LA', state: 'LA' },
    { id: '28', name: 'Orleans Parish, LA', state: 'LA' },
    { id: '91', name: 'St. Louis County, MN', state: 'MN' },
    { id: '62', name: 'Stearns County, MN', state: 'MN' },
    { id: '25', name: 'Atlantic County, NJ', state: 'NJ' },
    { id: '7', name: 'Bergen County, NJ', state: 'NJ' },
    { id: '3', name: 'Burlington County, NJ', state: 'NJ' },
    { id: '1', name: 'Camden County, NJ', state: 'NJ' },
    { id: '52', name: 'Cape May County, NJ', state: 'NJ' },
    { id: '6', name: 'Cumberland County, NJ', state: 'NJ' },
    { id: '2', name: 'Essex County, NJ', state: 'NJ' },
    { id: '19', name: 'Gloucester County, NJ', state: 'NJ' },
    { id: '10', name: 'Hudson County, NJ', state: 'NJ' },
    { id: '32', name: 'Hunterdon County, NJ', state: 'NJ' },
    { id: '73', name: 'Middlesex County, NJ', state: 'NJ' },
    { id: '8', name: 'Monmouth County, NJ', state: 'NJ' },
    { id: '9', name: 'Morris County, NJ', state: 'NJ' },
    { id: '85', name: 'Ocean County, NJ', state: 'NJ' },
    { id: '17', name: 'Passaic County, NJ', state: 'NJ' },
    { id: '20', name: 'Salem County, NJ', state: 'NJ' },
    { id: '15', name: 'Union County, NJ', state: 'NJ' },
    { id: '34', name: 'Allen County, OH', state: 'OH' },
    { id: '18', name: 'Lorain County, OH', state: 'OH' },
    { id: '81', name: 'Medina County, OH', state: 'OH' },
    { id: '61', name: 'Richland County, OH', state: 'OH' },
    { id: '30', name: 'Deschutes County, OR', state: 'OR' },
    { id: '54', name: 'Josephine County, OR', state: 'OR' },
    { id: '51', name: 'Lehigh County, PA', state: 'PA' },
    { id: '23', name: 'Montgomery County, PA', state: 'PA' },
    { id: '60', name: 'Philadelphia County, PA', state: 'PA' },
    { id: '93', name: 'Dallas County, TX, Constable Precinct 1', state: 'TX' },
    { id: '94', name: 'Dallas County, TX, Constable Precinct 2', state: 'TX' },
    { id: '95', name: 'Dallas County, TX, Constable Precinct 3', state: 'TX' },
    { id: '96', name: 'Dallas County, TX, Constable Precinct 4', state: 'TX' },
    { id: '97', name: 'Dallas County, TX, Constable Precinct 5', state: 'TX' },
    { id: '86', name: 'Guadalupe County, TX, Constable Precinct 1', state: 'TX' },
    { id: '87', name: 'Guadalupe County, TX, Constable Precinct 2', state: 'TX' },
    { id: '88', name: 'Guadalupe County, TX, Constable Precinct 3', state: 'TX' },
    { id: '89', name: 'Guadalupe County, TX, Constable Precinct 4', state: 'TX' },
    { id: '90', name: "Guadalupe County, TX, Sheriff's Office", state: 'TX' },
    { id: '76', name: 'McLennan County, TX, Constable Precinct 1', state: 'TX' },
    { id: '77', name: 'McLennan County, TX, Constable Precinct 2', state: 'TX' },
    { id: '78', name: 'McLennan County, TX, Constable Precinct 3', state: 'TX' },
    { id: '79', name: 'McLennan County, TX, Constable Precinct 4', state: 'TX' },
    { id: '80', name: 'McLennan County, TX, Constable Precinct 5', state: 'TX' },
    { id: '69', name: 'Rockwall County, TX, Constable Precinct 1', state: 'TX' },
    { id: '70', name: 'Rockwall County, TX, Constable Precinct 2', state: 'TX' },
    { id: '71', name: 'Rockwall County, TX, Constable Precinct 3', state: 'TX' },
    { id: '72', name: 'Rockwall County, TX, Constable Precinct 4', state: 'TX' },
    { id: '63', name: "Rockwall County, TX, Sheriff's Office", state: 'TX' },
    { id: '26', name: 'Snohomish County, WA', state: 'WA' },
  ]),
});

function countiesByState() {
  const map = new Map();
  for (const county of CIVILVIEW_NATIONWIDE.counties) {
    if (!map.has(county.state)) map.set(county.state, []);
    map.get(county.state).push(county);
  }
  return map;
}

function allStateCodes() {
  return [...countiesByState().keys()].sort();
}

function idsForState(state) {
  return countiesByState().get(String(state).toUpperCase()) || [];
}

function nationwideEnv(options = {}) {
  const maxPerState = Math.min(20, Math.max(1, Number(options.maxPerState) || 8));
  const byState = countiesByState();
  const blocks = [];
  for (const state of allStateCodes()) {
    const ids = byState.get(state).map((c) => c.id).slice(0, maxPerState);
    blocks.push({ state, ids, countyCount: byState.get(state).length });
  }
  return blocks;
}

module.exports = {
  CIVILVIEW_NATIONWIDE,
  countiesByState,
  allStateCodes,
  idsForState,
  nationwideEnv,
};
