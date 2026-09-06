'use strict';

const { PublicRecordError, fetchOfficialJson, nonnegative, cleanText } = require('./http');
const { fips } = require('./identity');

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
const DEFAULT_ACS_YEAR = 2024;
const ACS_METRICS = Object.freeze({
  medianHomeValue: 'B25077_001', medianHouseholdIncome: 'B19013_001',
  housingUnits: 'B25002_001', vacantHousingUnits: 'B25002_003',
  ownerOccupiedUnits: 'B25003_002', renterOccupiedUnits: 'B25003_003',
});

function datasetYear(value = DEFAULT_ACS_YEAR) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2010 || year >= new Date().getUTCFullYear()) throw new PublicRecordError('INVALID_ACS_YEAR', 'Select a published ACS five-year dataset year.');
  return year;
}

function censusGeography({ stateFips, countyFips, tract, geoid } = {}) {
  let state = fips(stateFips, 2), county = fips(countyFips, 3), tractCode = tract;
  if (geoid !== undefined && geoid !== null) {
    if (typeof geoid !== 'string' || !/^(?:\d{5}|\d{11})$/.test(geoid)) throw new PublicRecordError('INVALID_GEOGRAPHY', 'GEOID must retain all five county digits or all 11 tract digits.');
    state = fips(geoid.slice(0, 2), 2); county = fips(geoid.slice(2, 5), 3); tractCode = geoid.length === 11 ? geoid.slice(5) : null;
  }
  if (!state || !county || (tractCode != null && (typeof tractCode !== 'string' || !/^\d{6}$/.test(tractCode)))) {
    throw new PublicRecordError('INVALID_GEOGRAPHY', 'Census context requires exact state/county FIPS and, for tract context, a six-digit tract code.');
  }
  return { stateFips: state, countyFips: county, tract: tractCode || null, geoid: state + county + (tractCode || ''), geographyLevel: tractCode ? 'tract' : 'county' };
}

async function geocodeCensusAddress(listing, options = {}) {
  const address = cleanText(listing?.address, 240);
  const state = cleanText(listing?.state, 2)?.toUpperCase();
  const city = cleanText(listing?.city, 100);
  const zip = cleanText(listing?.zip, 10);
  if (!address || !/^[A-Z]{2}$/.test(state || '') || (!city && !/^\d{5}(?:-\d{4})?$/.test(zip || ''))) {
    throw new PublicRecordError('ADDRESS_REQUIRED', 'Census context needs a complete source address, state, and city or ZIP.');
  }
  const year = datasetYear(options.acsYear);
  const url = new URL(CENSUS_GEOCODER);
  url.search = new URLSearchParams({ address: [address, city, state, zip].filter(Boolean).join(', '), benchmark: 'Public_AR_Current', vintage: `ACS${year}_Current`, format: 'json' }).toString();
  const data = await fetchOfficialJson(url, options);
  const matches = data?.result?.addressMatches;
  if (!Array.isArray(matches)) throw new PublicRecordError('CENSUS_SCHEMA_CHANGED', 'Census geocoder returned an unexpected format.');
  if (matches.length !== 1) throw new PublicRecordError(matches.length ? 'ADDRESS_AMBIGUOUS' : 'ADDRESS_NOT_FOUND', matches.length ? 'Census returned several address matches; confirm the address first.' : 'Census did not match the source address.');
  const match = matches[0];
  if (String(match.addressComponents?.state || '').toUpperCase() !== state) throw new PublicRecordError('ADDRESS_STATE_MISMATCH', 'Census address match is in a different state.');
  const tracts = match.geographies?.['Census Tracts'];
  if (!Array.isArray(tracts) || tracts.length !== 1) throw new PublicRecordError('TRACT_NOT_FOUND', 'Census did not return a unique tract for this address.');
  const geography = censusGeography({ geoid: tracts[0].GEOID });
  if (tracts[0].STATE !== geography.stateFips || tracts[0].COUNTY !== geography.countyFips) throw new PublicRecordError('CENSUS_SCHEMA_CHANGED', 'Census tract identifiers are inconsistent.');
  return {
    ...geography, year, matchedAddress: cleanText(match.matchedAddress), benchmark: 'Public_AR_Current', vintage: `ACS${year}_Current`,
    matchMethod: 'census_address_range_geocode', propertyCoordinates: null,
    source: { id: 'census-geocoder', label: 'U.S. Census address geography match', url: url.toString(), observedAt: new Date(options.now || Date.now()).toISOString() },
  };
}

function buildAcsUrl(geographyInput, options = {}) {
  const geography = censusGeography(geographyInput);
  const year = datasetYear(options.acsYear);
  const key = Object.hasOwn(options, 'apiKey') ? options.apiKey : process.env.CENSUS_API_KEY;
  if (!key || typeof key !== 'string') throw new PublicRecordError('CENSUS_API_KEY_REQUIRED', 'Census area estimates require a Census API key configured by the operator.');
  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set('get', ['NAME', ...Object.values(ACS_METRICS).flatMap(code => [code + 'E', code + 'M'])].join(','));
  url.searchParams.set('for', geography.tract ? `tract:${geography.tract}` : `county:${geography.countyFips}`);
  url.searchParams.set('in', geography.tract ? `state:${geography.stateFips} county:${geography.countyFips}` : `state:${geography.stateFips}`);
  url.searchParams.set('key', key);
  return url;
}

async function getAcsContext(geographyInput, options = {}) {
  const geography = censusGeography(geographyInput), year = datasetYear(options.acsYear);
  const url = buildAcsUrl(geography, options);
  const data = await fetchOfficialJson(url, options);
  if (!Array.isArray(data) || data.length !== 2 || !Array.isArray(data[0]) || !Array.isArray(data[1]) || data[0].length !== data[1].length) {
    throw new PublicRecordError('CENSUS_SCHEMA_CHANGED', 'Census returned an unexpected area-estimate response.');
  }
  const row = Object.fromEntries(data[0].map((key, i) => [key, data[1][i]]));
  if (row.state !== geography.stateFips || row.county !== geography.countyFips || (geography.tract && row.tract !== geography.tract)) {
    throw new PublicRecordError('CENSUS_GEOGRAPHY_MISMATCH', 'Census returned a different geography than requested.');
  }
  const metrics = {}, marginsOfError = {};
  for (const [name, code] of Object.entries(ACS_METRICS)) {
    if (!(code + 'E' in row) || !(code + 'M' in row)) throw new PublicRecordError('CENSUS_SCHEMA_CHANGED', 'Census estimate variables are missing.');
    metrics[name] = nonnegative(row[code + 'E']);
    marginsOfError[name] = nonnegative(row[code + 'M']);
  }
  metrics.vacancyRate = metrics.housingUnits > 0 && metrics.vacantHousingUnits !== null && metrics.vacantHousingUnits <= metrics.housingUnits
    ? Number((metrics.vacantHousingUnits / metrics.housingUnits).toFixed(6)) : null;
  // A derived ratio is not assigned an invented margin of error.
  marginsOfError.vacancyRate = null;
  url.searchParams.delete('key');
  return {
    status: 'available', ...geography, geographyLabel: cleanText(row.NAME), year, period: `${year - 4}–${year}`,
    dataset: 'ACS five-year estimates', metrics, marginsOfError, label: 'Area estimates; not property facts',
    source: { id: 'census-acs', label: 'U.S. Census ACS five-year area estimates', url: url.toString(), observedAt: new Date(options.now || Date.now()).toISOString() },
    limitations: ['Area housing vacancy is not evidence this property is vacant.', 'Median area home value is not a valuation of this property.', 'Survey estimates have sampling uncertainty; negative Census sentinel values remain unavailable.'],
  };
}

async function lookupCensusContext(listing, options = {}) {
  const key = Object.hasOwn(options, 'apiKey') ? options.apiKey : process.env.CENSUS_API_KEY;
  if (!key || typeof key !== 'string') throw new PublicRecordError('CENSUS_API_KEY_REQUIRED', 'Census area estimates require a Census API key configured by the operator.');
  const geography = await geocodeCensusAddress(listing, options);
  const context = await getAcsContext(geography, { ...options, apiKey: key });
  return { ...context, matchedAddress: geography.matchedAddress, geographySource: geography.source, geographyVintage: geography.vintage };
}

module.exports = { ACS_METRICS, CENSUS_GEOCODER, DEFAULT_ACS_YEAR, censusGeography, geocodeCensusAddress, buildAcsUrl, getAcsContext, lookupCensusContext };
