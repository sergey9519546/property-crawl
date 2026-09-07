const { validateListingForIngestion } = require('../scrapers/validation');
const { evaluateOpportunitySignals } = require('./signals');

function known(value) { return value !== null && value !== undefined && value !== ''; }

function buildPropertyDossier(listing, { observations = { records: {}, signals: [] }, publicRecords = null, now = Date.now() } = {}) {
  const timestamp = listing.sourceObservedAt || listing.provenance?.observedAt;
  const publisherObserved = listing.provenance?.origin === 'live'
    && validateListingForIngestion(listing).isValid && Date.parse(timestamp) <= now + 300_000;
  const source = {
    id: listing.source, publisher: listing.provenance?.publisher || listing.source,
    url: publisherObserved ? listing.sourceUrl : null, observedAt: publisherObserved ? timestamp : null,
    status: publisherObserved ? 'source_observed' : 'unverified_snapshot',
  };
  const cadenceHours = require('../sources/catalog').SOURCE_CATALOG.find((entry) => entry.adapterKey === listing.source)?.workflow.cadenceHours || 24;
  source.refreshDueAt = publisherObserved ? new Date(Date.parse(timestamp) + cadenceHours * 3600_000).toISOString() : null;
  source.freshness = !publisherObserved ? 'unverified' : Date.parse(source.refreshDueAt) < now ? 'stale' : 'within_refresh_window';
  const derived = (key) => Boolean(listing.provenance?.derivedFields?.[key]);
  const claim = (key, title) => ({
    key, title, value: known(listing[key]) ? listing[key] : null,
    evidenceClass: !known(listing[key]) ? 'unknown' : !publisherObserved ? 'unverified_snapshot' : derived(key) ? 'model_derived' : 'publisher_reported',
    sourceUrl: source.url, observedAt: source.observedAt,
  });
  const facts = [
    claim('address', 'Property address'), claim('propType', 'Property type'), claim('openingBid', 'Published opening bid'),
    claim('saleDate', 'Published sale date'), claim('status', 'Published status'), claim('deposit', 'Deposit and payment terms'),
    claim('occupancy', 'Reported occupancy'), claim('sqft', 'Reported building area'), claim('assessed', 'Reported assessed value'),
    claim('auctionProgram', 'Published auction program'), claim('lifecycleStatus', 'Published lifecycle status'),
    claim('transactionOutcome', 'Verified transaction outcome'),
  ];
  const tracked = publisherObserved ? Object.values(observations.records).find((record) => record.latest?.listingId === listing.id && record.latest.source === listing.source && record.latest.recordId === String(listing.provenance?.recordId)) : null;
  const recordUrls = new Set(tracked ? [...tracked.history, tracked.latest].map((record) => record.sourceUrl) : []);
  const signals = tracked ? observations.signals.filter((signal) => signal.listingId === listing.id && signal.sourceId === listing.source
    && (!signal.recordId || signal.recordId === String(listing.provenance?.recordId))
    && signal.evidence?.every((point) => recordUrls.has(point.sourceUrl))).slice(0, 10) : [];
  const gaps = [];
  function gap(id, title, reason, nextAction) { gaps.push({ id, title, reason, nextAction }); }
  if (!publisherObserved) gap('source_identity', 'Source evidence is missing', 'This record has not passed the source-observation checks.', 'Locate and capture the exact publisher record before relying on its property facts.');
  if (source.freshness === 'stale') gap('source_stale', 'The publisher observation needs refreshing', 'The saved observation is older than this source’s planned refresh interval. Its current availability and terms are unresolved.', 'Refresh this source in Source Radar or verify the exact publisher record. Public-record lookups are separate evidence with their own dates.');
  if (!known(listing.openingBid)) gap('opening_bid', 'Opening bid is not published here', 'A judgment, assessment, or deposit cannot substitute for the published bid.', 'Obtain the current offering terms from the publisher.');
  if (!known(listing.deposit)) gap('payment_terms', 'Cash requirements need confirmation', 'Deposit deadlines, premiums, fees, and payment forms have not been established.', 'Read the specific offering document and record its payment deadlines.');
  if (!known(listing.occupancy)) gap('occupancy', 'Occupancy is unresolved', 'Area vacancy rates and exterior photographs cannot establish whether this property is occupied.', 'Obtain property-specific occupancy and access evidence.');
  if (known(listing.saleDate) && Date.parse(String(listing.saleDate).slice(0, 10)) < Date.parse(new Date(now).toISOString().slice(0, 10))) {
    gap('sale_date_passed', 'The recorded sale date has passed', 'A past scheduled date does not establish whether a sale occurred, was canceled, or was postponed.', 'Refresh the exact sale record and check the current disposition.');
  }
  if (!known(listing.transactionOutcome)) gap('transaction_outcome', 'Transaction outcome is unresolved', 'A closed auction, reserve result, or passed date does not prove that title transferred.', 'Obtain a source record or public record that explicitly confirms the completed disposition.');
  gap('title', 'Title and surviving interests need research', 'A listing or a source match does not establish lien priority or a clear title.', 'Obtain the controlling sale documents and an appropriate recorder/title review.');
  gap('value_and_debt', 'Equity is not established', 'Opening bids and assessed values are not market valuations; a missing mortgage balance is not zero debt.', 'Supply current valuation evidence and supported outstanding debt before modeling equity.');
  const contradictions = [];
  const parcel = publicRecords?.parcel;
  const publisherIdentity = publisherObserved ? {
    sourceId: listing.source, recordId: String(listing.provenance?.recordId), listingId: listing.id,
    exactUrl: listing.sourceUrl, observedAt: timestamp,
  } : null;
  const parcelIdentity = parcel?.status === 'matched' ? {
    jurisdiction: parcel.jurisdiction || parcel.source?.jurisdiction || null,
    parcelId: parcel.rawParcelId || parcel.properties?.parcelId || listing.provenance?.parcelNumber || null,
    exactUrl: parcel.source?.url || null, observedAt: parcel.source?.observedAt || null,
  } : null;
  if (publisherObserved && !derived('sqft') && parcel?.status === 'matched') {
    const area = Number(parcel.properties?.livingAreaSqft);
    const advertised = Number(listing.sqft);
    if (area > 0 && advertised > 0 && Math.abs(area - advertised) / Math.max(area, advertised) > 0.1) {
      contradictions.push({
        id: 'building_area_discrepancy', title: 'Building-area records disagree',
        listingValue: advertised, publicRecordValue: area, unit: 'sq ft',
        sourceUrl: parcel.source?.url || null,
        explanation: 'Publisher and parcel evidence differ by more than 10%. Different measurement definitions or dates may explain this; it is a research lead, not extra verified space.',
        nextAction: 'Compare assessment year, building definitions, permits, and the offering document.',
      });
    }
  }
  const opportunityEvaluation = evaluateOpportunitySignals(listing, { observations, publicRecords, now });
  return {
    version: 1, generatedAt: new Date(now).toISOString(), listingId: listing.id, address: listing.address,
    source, facts, signals, contradictions, gaps,
    opportunitySignals: opportunityEvaluation.signals,
    triagePriority: opportunityEvaluation.triagePriority,
    opportunityWeights: opportunityEvaluation.weights,
    opportunitySummary: opportunityEvaluation.summary,
    opportunityDisclaimer: opportunityEvaluation.disclaimer,
    identityGroups: {
      publisher: publisherIdentity,
      parcel: parcelIdentity,
      links: publisherIdentity && parcelIdentity ? [{ type: 'publisher_to_parcel', status: 'matched_evidence', basis: parcel.matchBasis || 'public_record_match' }] : [],
    },
    history: tracked ? { firstObservedAt: tracked.firstObservedAt, observations: tracked.observations, snapshots: [...tracked.history, tracked.latest].slice(-10) } : null,
    publicRecords,
    summary: {
      publisherFacts: facts.filter((fact) => fact.evidenceClass === 'publisher_reported').length,
      unknownFacts: facts.filter((fact) => fact.evidenceClass === 'unknown').length,
      supportedChanges: signals.length, researchQuestions: gaps.length,
      opportunitySignals: opportunityEvaluation.signals.filter((s) => s.status === 'supported').length,
    },
    interpretation: 'A research dossier separates publisher observations, public-record context, model assumptions, and unresolved questions. It is not an appraisal, title determination, or bid recommendation.',
  };
}

module.exports = { buildPropertyDossier };
