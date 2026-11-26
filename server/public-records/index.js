'use strict';

const florida = require('./florida');
const census = require('./census');
const identity = require('./identity');
const equity = require('./equity');
const alachua = require('./alachua');
const { PublicRecordError } = require('./http');
const { queryArcgisParcel, resolveCountyEndpoint, resolveCountyKey } = require('../enrichment/arcgis-parcels');
const { isCompatibleNjSitusAddress } = require('../enrichment/nj-cadastral');
const { normalizeApn } = require('../scrapers/normalization');
const { resolveMunicipalPortal, lookupCodeViolations } = require('../enrichment/code-enforcement');

const CAPABILITIES = Object.freeze([
  { id: 'alachua-county-parcels', label: 'Alachua County parcel and planning evidence', access: 'public', configured: true, geography: 'Alachua County, Florida', limitation: 'Exact county parcel match required; planning records do not establish development rights.' },
  { id: 'florida-statewide-parcels', label: 'Florida parcel and assessment evidence', access: 'public', configured: true, geography: 'Florida', limitation: 'Annual assessment roll; source parcel match required.' },
  { id: 'enrolled-cadastral-parcels', label: 'Enrolled county and statewide ArcGIS parcel evidence', access: 'public', configured: true, geography: 'Enrolled US counties and states', limitation: 'Point-only hits remain candidates until parcel ID or situs corroborates.' },
  { id: 'census-acs', label: 'Census tract and county context', access: 'api_key', geography: 'United States', limitation: 'Five-year area estimates; never property occupancy or value.' },
  { id: 'hud-usps-vacancy', label: 'HUD/USPS administrative vacancy', access: 'restricted_license', configured: false, geography: 'Census tract', limitation: 'HUD restricts eligibility to registered government and nonprofit organizations and stated-purpose use. Use ACS housing-vacancy context when no entitlement exists.' },
  { id: 'equity-scenario', label: 'Equity scenario', access: 'documented_inputs', configured: true, limitation: 'Requires recorded basis, matching HPI anchors, and complete supplied debt inputs.' },
]);

async function lookupEnrolledCadastralParcel(listing, endpoint, options = {}) {
  const observedAt = new Date(options.now || Date.now()).toISOString();
  const countyKey = resolveCountyKey(listing?.state, listing?.county) || endpoint?.key || null;
  const rawApnInput = listing?.apn || listing?.parcelId || listing?.provenance?.parcelNumber || null;
  const hasCoords = Number.isFinite(Number(listing?.lat)) && Number.isFinite(Number(listing?.lng)) && !(Number(listing?.lat) === 0 && Number(listing?.lng) === 0);
  const parcel = await queryArcgisParcel({
    lat: hasCoords ? Number(listing.lat) : NaN,
    lng: hasCoords ? Number(listing.lng) : NaN,
    apn: rawApnInput,
    state: listing?.state,
    county: listing?.county,
    countyFips: listing?.countyFips || listing?.provenance?.countyFips || null,
    allowNetwork: true,
    fetchFn: options.fetchImpl || options.fetchFn || globalThis.fetch,
    signal: options.signal,
    ...(options.db !== undefined ? { db: options.db } : {}),
  });

  if (!parcel) {
    return {
      status: 'not_found',
      jurisdiction: countyKey,
      properties: null,
      source: {
        id: 'enrolled-cadastral-parcels',
        name: endpoint?.name || 'County Cadastral GIS',
        url: endpoint?.endpoint || null,
        observedAt,
      },
    };
  }

  const normalizedInputApn = normalizeApn(rawApnInput);
  const normalizedParcelApn = normalizeApn(parcel.canonicalApn || parcel.rawApn);
  const apnMatched = Boolean(normalizedInputApn && normalizedParcelApn && normalizedInputApn === normalizedParcelApn);
  const njSitusMatched = Boolean(
    String(listing?.state || '').toUpperCase() === 'NJ'
    && listing?.address
    && parcel.situsAddress
    && isCompatibleNjSitusAddress(String(listing.address), String(parcel.situsAddress))
  );
  const status = (apnMatched || njSitusMatched) ? 'matched' : 'candidate';
  const matchBasis = apnMatched
    ? 'cadastral_apn_lookup'
    : njSitusMatched
      ? 'cadastral_situs_corroborated'
      : 'cadastral_point_in_polygon';

  return {
    status,
    jurisdiction: countyKey,
    rawParcelId: parcel.rawApn || null,
    rawApn: parcel.rawApn || null,
    canonicalApn: parcel.canonicalApn || null,
    countyFips: parcel.countyFips || null,
    countyKey,
    situsAddress: parcel.situsAddress || null,
    assessedValue: parcel.assessedValue || null,
    geometry: parcel.geometry || null,
    matchBasis,
    properties: {
      parcelId: parcel.rawApn || null,
      situsAddress: parcel.situsAddress || null,
      assessedTotal: parcel.assessedValue?.total ?? null,
      assessedLand: parcel.assessedValue?.land ?? null,
      assessedImprovement: parcel.assessedValue?.improvements ?? null,
      landUse: parcel.landUse || null,
      livingAreaSqft: parcel.livingAreaSqft ?? null,
      yearBuilt: parcel.yearBuilt ?? null,
      lotAcres: parcel.lotAcres ?? null,
    },
    source: {
      id: 'enrolled-cadastral-parcels',
      name: typeof parcel.source === 'string' ? parcel.source : (endpoint?.name || 'County Cadastral GIS'),
      url: endpoint?.endpoint || null,
      observedAt: parcel.observedAt || observedAt,
    },
  };
}

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
  if (provenance?.observed !== true || !['live', 'email_notice'].includes(provenance.origin) || provenance.recordKind === 'demo') {
    result.issues.push('Public-record enrichment requires a source-observed listing.'); result.issueCodes.push('SOURCE_OBSERVATION_REQUIRED');
    return result;
  }
  const jobs = [{ key: 'areaContext', isParcelJob: false, work: census.lookupCensusContext(listing, options) }];
  if (String(listing.state).toUpperCase() === 'FL') {
    jobs.push({ key: 'parcel', isParcelJob: true, work: florida.lookupFloridaParcel(listing, options) });
  } else {
    const endpoint = resolveCountyEndpoint(listing.state, listing.county);
    if (endpoint) {
      jobs.push({ key: 'parcel', isParcelJob: true, work: lookupEnrolledCadastralParcel(listing, endpoint, options) });
    } else {
      result.issues.push('An automated parcel-record adapter is not configured for this state.');
      result.issueCodes.push('PARCEL_STATE_NOT_CONFIGURED');
    }
  }
  const rawParcelId = listing.parcelId || listing.apn || provenance.parcelNumber;
  if (alachua.isAlachuaListing(listing) && rawParcelId && !provenance.derivedFields?.parcelId && !provenance.derivedFields?.parcelNumber) {
    jobs.push({ key: 'countyParcel', isParcelJob: true, work: alachua.lookupAlachuaParcel({ rawParcelId }, options) });
  }
  if (resolveMunicipalPortal({ state: listing.state, county: listing.county, city: listing.city })) {
    jobs.push({
      key: 'municipalRecords',
      isParcelJob: false,
      isOptionalAux: true,
      work: lookupCodeViolations({
        state: listing.state,
        county: listing.county,
        city: listing.city,
        parcelId: rawParcelId,
        address: listing.address,
        fetchFn: options.fetchImpl || options.fetchFn || globalThis.fetch,
        timeoutMs: Math.min(4000, Number(options.timeoutMs) || 4000),
      }),
    });
  }
  const outcomes = await Promise.allSettled(jobs.map(job => job.work));
  outcomes.forEach((outcome, index) => {
    const job = jobs[index];
    if (outcome.status === 'fulfilled') {
      result[job.key] = outcome.value;
      if (outcome.value?.source && typeof outcome.value.source === 'object') result.sources.push(outcome.value.source);
      if (outcome.value?.geographySource) result.sources.push(outcome.value.geographySource);
      if (job.isParcelJob && outcome.value?.status !== 'matched') {
        result.issues.push(outcome.value?.status === 'candidate' ? 'The point intersects a parcel record; confirm its parcel ID before treating it as this property.' : 'A unique parcel record could not be established.');
        result.issueCodes.push('PARCEL_MATCH_UNCONFIRMED');
      }
    } else if (!job.isOptionalAux) {
      const error = outcome.reason;
      result.issues.push(error instanceof PublicRecordError ? error.message : 'Official-record lookup is unavailable.');
      result.issueCodes.push(error instanceof PublicRecordError ? error.code : 'SOURCE_UNAVAILABLE');
    }
  });
  return result;
}

module.exports = { buildPublicRecordEvidence, lookupEnrolledCadastralParcel, CAPABILITIES, ...florida, ...census, ...identity, ...equity, ...alachua };
