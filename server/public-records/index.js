'use strict';

const florida = require('./florida');
const census = require('./census');
const identity = require('./identity');
const equity = require('./equity');
const alachua = require('./alachua');
const { PublicRecordError } = require('./http');

const CAPABILITIES = Object.freeze([
  { id: 'alachua-county-parcels', label: 'Alachua County parcel and planning evidence', access: 'public', configured: true, geography: 'Alachua County, Florida', limitation: 'Exact county parcel match required; planning records do not establish development rights.' },
  { id: 'florida-statewide-parcels', label: 'Florida parcel and assessment evidence', access: 'public', configured: true, geography: 'Florida', limitation: 'Annual assessment roll; source parcel match required.' },
  { id: 'census-acs', label: 'Census tract and county context', access: 'api_key', geography: 'United States', limitation: 'Five-year area estimates; never property occupancy or value.' },
  { id: 'hud-usps-vacancy', label: 'HUD/USPS administrative vacancy', access: 'restricted_license', configured: false, geography: 'Census tract', limitation: 'HUD restricts eligibility to registered government and nonprofit organizations and stated-purpose use. Use ACS housing-vacancy context when no entitlement exists.' },
  { id: 'equity-scenario', label: 'Equity scenario', access: 'documented_inputs', configured: true, limitation: 'Requires recorded basis, matching HPI anchors, and complete supplied debt inputs.' },
]);

async function buildPublicRecordEvidence(listing, options = {}) {
  const result = {
    version: 1, listingId: listing?.id || null, observedAt: new Date(options.now || Date.now()).toISOString(),
    parcel: null, countyParcel: null, areaContext: null, equityScenario: equity.estimateEquityScenario(), issues: [], issueCodes: [], sources: [],
    capabilities: CAPABILITIES.map(item => ({ ...item, ...(item.id === 'census-acs' ? { configured: Boolean(Object.hasOwn(options, 'apiKey') ? options.apiKey : process.env.CENSUS_API_KEY) } : {}) })),
  };
  if (options.allowNetwork !== true) {
    result.issues.push('Run an official-record lookup to attach current source evidence.'); result.issueCodes.push('LOOKUP_NOT_REQUESTED');
    return result;
  }
  const provenance = listing?.provenance;
  if (provenance?.observed !== true || provenance.origin !== 'live' || provenance.recordKind === 'demo') {
    result.issues.push('Public-record enrichment requires a source-observed listing.'); result.issueCodes.push('SOURCE_OBSERVATION_REQUIRED');
    return result;
  }
  const jobs = [{ key: 'areaContext', work: census.lookupCensusContext(listing, options) }];
  if (String(listing.state).toUpperCase() === 'FL') jobs.push({ key: 'parcel', work: florida.lookupFloridaParcel(listing, options) });
  else { result.issues.push('An automated parcel-record adapter is not configured for this state.'); result.issueCodes.push('PARCEL_STATE_NOT_CONFIGURED'); }
  const rawParcelId = listing.parcelId || provenance.parcelNumber;
  if (alachua.isAlachuaListing(listing) && rawParcelId && !provenance.derivedFields?.parcelId && !provenance.derivedFields?.parcelNumber) jobs.push({ key: 'countyParcel', work: alachua.lookupAlachuaParcel({ rawParcelId }, options) });
  const outcomes = await Promise.allSettled(jobs.map(job => job.work));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      result[jobs[index].key] = outcome.value;
      if (outcome.value.source) result.sources.push(outcome.value.source);
      if (outcome.value.geographySource) result.sources.push(outcome.value.geographySource);
      if (index > 0 && outcome.value.status !== 'matched') {
        result.issues.push(outcome.value.status === 'candidate' ? 'The point intersects a parcel record; confirm its parcel ID before treating it as this property.' : 'A unique parcel record could not be established.');
        result.issueCodes.push('PARCEL_MATCH_UNCONFIRMED');
      }
    } else {
      const error = outcome.reason;
      result.issues.push(error instanceof PublicRecordError ? error.message : 'Official-record lookup is unavailable.');
      result.issueCodes.push(error instanceof PublicRecordError ? error.code : 'SOURCE_UNAVAILABLE');
    }
  });
  return result;
}

module.exports = { buildPublicRecordEvidence, CAPABILITIES, ...florida, ...census, ...identity, ...equity, ...alachua };
