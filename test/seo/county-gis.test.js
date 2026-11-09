'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCountyCadastralGisLink,
  COUNTY_CADASTRAL_GIS_REGISTRY,
  STATEWIDE_CADASTRAL_FALLBACKS,
} = require('../../src/lib/county-seo.js');

const serverSeo = require('../../server/seo/index.js');

test('Cadastral GIS: Florida (FL) top counties & statewide fallback', () => {
  const flCounties = [
    { name: 'Miami-Dade', expectedSub: 'Miami-Dade' },
    { name: 'Broward', expectedSub: 'Broward' },
    { name: 'Palm Beach', expectedSub: 'Palm Beach' },
    { name: 'Orange', expectedSub: 'Orange' },
    { name: 'Hillsborough', expectedSub: 'Hillsborough' },
    { name: 'Duval', expectedSub: 'Duval' },
    { name: 'Pinellas', expectedSub: 'Pinellas' },
    { name: 'Lee', expectedSub: 'Lee' },
    { name: 'Polk', expectedSub: 'Polk' },
  ];

  for (const item of flCounties) {
    const link = getCountyCadastralGisLink('FL', item.name);
    assert.equal(link.state, 'FL');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(item.expectedSub), `portalName should contain ${item.expectedSub}: ${link.portalName}`);
    assert.ok(link.instructions.length > 10, 'instructions must be detailed');
  }

  // Unmapped FL county should fall back to statewide FDEP/NAL
  const unmapped = getCountyCadastralGisLink('FL', 'Monroe');
  assert.equal(unmapped.state, 'FL');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('Florida Department of Environmental Protection') || unmapped.portalName.includes('NAL'));
});

test('Cadastral GIS: New Jersey (NJ) top counties & statewide fallback', () => {
  const njCounties = ['Essex', 'Bergen', 'Hudson', 'Middlesex', 'Monmouth', 'Ocean', 'Camden'];

  for (const county of njCounties) {
    const link = getCountyCadastralGisLink('NJ', county);
    assert.equal(link.state, 'NJ');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(county), `portalName should contain ${county}: ${link.portalName}`);
  }

  // Unmapped NJ county should fall back to NJGIN
  const unmapped = getCountyCadastralGisLink('NJ', 'Sussex');
  assert.equal(unmapped.state, 'NJ');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('NJGIN'));
});

test('Cadastral GIS: Ohio (OH) top counties & statewide fallback', () => {
  const ohCounties = [
    { name: 'Cuyahoga', expectedSub: 'Cuyahoga' },
    { name: 'Franklin', expectedSub: 'Franklin' },
    { name: 'Hamilton', expectedSub: 'Hamilton' },
    { name: 'Montgomery', expectedSub: 'Montgomery' },
    { name: 'Summit', expectedSub: 'Summit' },
    { name: 'Lucas', expectedSub: 'Lucas' },
  ];

  for (const item of ohCounties) {
    const link = getCountyCadastralGisLink('OH', item.name);
    assert.equal(link.state, 'OH');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(item.expectedSub), `portalName should contain ${item.expectedSub}: ${link.portalName}`);
  }

  // Unmapped OH county should fall back to OGRIP
  const unmapped = getCountyCadastralGisLink('OH', 'Stark');
  assert.equal(unmapped.state, 'OH');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('OGRIP'));
});

test('Cadastral GIS: Pennsylvania (PA) top counties & statewide fallback', () => {
  const paCounties = ['Philadelphia', 'Allegheny', 'Montgomery', 'Bucks', 'Delaware'];

  for (const county of paCounties) {
    const link = getCountyCadastralGisLink('PA', county);
    assert.equal(link.state, 'PA');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(county), `portalName should contain ${county}: ${link.portalName}`);
  }

  // Unmapped PA county should fall back to PASDA
  const unmapped = getCountyCadastralGisLink('PA', 'Lancaster');
  assert.equal(unmapped.state, 'PA');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('PASDA'));
});

test('Cadastral GIS: California (CA) top counties & statewide fallback', () => {
  const caCounties = [
    { name: 'Los Angeles', expectedSub: 'Los Angeles' },
    { name: 'San Diego', expectedSub: 'San Diego' },
    { name: 'Orange', expectedSub: 'Orange' },
    { name: 'Riverside', expectedSub: 'Riverside' },
    { name: 'San Bernardino', expectedSub: 'San Bernardino' },
    { name: 'Santa Clara', expectedSub: 'Santa Clara' },
    { name: 'Alameda', expectedSub: 'Alameda' },
  ];

  for (const item of caCounties) {
    const link = getCountyCadastralGisLink('CA', item.name);
    assert.equal(link.state, 'CA');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(item.expectedSub), `portalName should contain ${item.expectedSub}: ${link.portalName}`);
  }

  // Unmapped CA county should fall back to California Geoportal
  const unmapped = getCountyCadastralGisLink('CA', 'Fresno');
  assert.equal(unmapped.state, 'CA');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('California State Geoportal'));
});

test('Cadastral GIS: North Carolina (NC) top counties & statewide fallback', () => {
  const ncCounties = ['Wake', 'Mecklenburg', 'Guilford', 'Forsyth'];

  for (const county of ncCounties) {
    const link = getCountyCadastralGisLink('NC', county);
    assert.equal(link.state, 'NC');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(county), `portalName should contain ${county}: ${link.portalName}`);
  }

  // Unmapped NC county should fall back to NC OneMap
  const unmapped = getCountyCadastralGisLink('NC', 'Durham');
  assert.equal(unmapped.state, 'NC');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('NC OneMap'));
});

test('Cadastral GIS: Texas (TX) top counties & statewide fallback', () => {
  const txCounties = ['Harris', 'Dallas', 'Tarrant', 'Bexar', 'Travis'];

  for (const county of txCounties) {
    const link = getCountyCadastralGisLink('TX', county);
    assert.equal(link.state, 'TX');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(county), `portalName should contain ${county}: ${link.portalName}`);
  }

  // Unmapped TX county should fall back to TNRIS
  const unmapped = getCountyCadastralGisLink('TX', 'Collin');
  assert.equal(unmapped.state, 'TX');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('TNRIS'));
});

test('Cadastral GIS: Colorado (CO) top counties & statewide fallback', () => {
  const coCounties = ['Denver', 'El Paso', 'Arapahoe', 'Jefferson', 'Adams'];

  for (const county of coCounties) {
    const link = getCountyCadastralGisLink('CO', county);
    assert.equal(link.state, 'CO');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.equal(link.verified, true);
    assert.ok(link.url.startsWith('https://'), `URL must start with https: ${link.url}`);
    assert.ok(link.portalName.includes(county), `portalName should contain ${county}: ${link.portalName}`);
  }

  // Unmapped CO county should fall back to OIT
  const unmapped = getCountyCadastralGisLink('CO', 'Boulder');
  assert.equal(unmapped.state, 'CO');
  assert.equal(unmapped.authorityType, 'statewide_cadastral');
  assert.equal(unmapped.verified, true);
  assert.ok(unmapped.url.startsWith('https://'));
  assert.ok(unmapped.portalName.includes('OIT'));
});

test('Cadastral GIS: normalization handles slug, lowercase, and trailing county', () => {
  const variations = [
    { state: 'fl', county: 'orange-county' },
    { state: 'FL', county: 'Orange County' },
    { state: 'FL', county: 'orange' },
    { state: 'fl', county: 'ORANGE' },
  ];

  for (const v of variations) {
    const link = getCountyCadastralGisLink(v.state, v.county);
    assert.equal(link.state, 'FL');
    assert.equal(link.authorityType, 'county_assessor_gis');
    assert.ok(link.portalName.includes('Orange County Property Appraiser'));
  }

  // Hyphenated name handling
  const miami1 = getCountyCadastralGisLink('FL', 'miami-dade');
  const miami2 = getCountyCadastralGisLink('FL', 'Miami-Dade County');
  assert.equal(miami1.portalName, miami2.portalName);
  assert.equal(miami1.authorityType, 'county_assessor_gis');
});

test('Cadastral GIS: graceful fallback for unmapped state & empty values', () => {
  const unmappedState = getCountyCadastralGisLink('WY', 'Laramie');
  assert.equal(unmappedState.state, 'WY');
  assert.equal(unmappedState.authorityType, 'statewide_cadastral');
  assert.equal(unmappedState.verified, true);
  assert.ok(unmappedState.url.startsWith('https://'));

  const emptyLink = getCountyCadastralGisLink(null, null);
  assert.equal(emptyLink.verified, true);
  assert.ok(emptyLink.url.startsWith('https://'));
  assert.equal(emptyLink.authorityType, 'statewide_cadastral');
});

test('Cadastral GIS: server/seo/index.js re-exports getCountyCadastralGisLink', () => {
  assert.equal(typeof serverSeo.getCountyCadastralGisLink, 'function');
  const link = serverSeo.getCountyCadastralGisLink('FL', 'Miami-Dade');
  assert.equal(link.state, 'FL');
  assert.equal(link.authorityType, 'county_assessor_gis');
  assert.ok(link.url.startsWith('https://'));
  assert.equal(link.verified, true);
});
