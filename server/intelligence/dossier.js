const crypto = require('node:crypto');
const { verifiedSnapshotReceipt } = require('../scrapers/discovery-snapshots');
const { computePublicBenchmarkConsensus } = require('../enrichment/public-benchmark-consensus');
const { loadObservedHpiSeries } = require('../enrichment/hpi-series');
const { validateListingForIngestion } = require('../scrapers/validation');
const { evaluateOpportunitySignals } = require('./signals');
const { buildDocumentEvidence } = require('./document-evidence');
const { getHudSafmrBenchmark } = require('../enrichment/hud-safmr');
const { buildPossessionDossier } = require('./post-sale-possession');
const { calculateSurplusEquityWaterfall } = require('./surplus-waterfall');
const { evaluateAuctionProceedProbability, calculateDocketClearingAnalytics } = require('./auction-microstructure');
const { getAuctionDepositRules, calculateRequiredDeposit } = require('./escrow-optimizer');
const { arbitrateTitleRisk } = require('./title-risk-engine');
const { summarizeDocketHits } = require('../routes/verify-docket');
const { triggerWeightManager } = require('../swarm/trigger-weights');
const {
  normalizeCoordinates: normalizeHazardCoords,
  evaluateFloodRisk,
  estimateNfipReserve,
  loadCache: loadFemaCache,
} = require('../enrichment/fema-flood');
const { evaluateEnvironmentalLiability, loadCache: loadEpaCache } = require('../enrichment/epa-hazard');
const { classifySlope, loadCache: loadTerrainCache } = require('../enrichment/usgs-terrain');
const { isCompatibleNjSitusAddress } = require('../enrichment/nj-cadastral');

function coordHash(coords, suffix = '') {
  const base = `${coords.lat},${coords.lng}${suffix ? `,${suffix}` : ''}`;
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
}

function resolveSyncFederalHazards(listing = {}, publicRecords = null, hazardCachePaths = null, now = Date.now()) {
  if (listing.federalHazards) return listing.federalHazards;
  if (publicRecords?.federalHazards) return publicRecords.federalHazards;

  const rawLat = listing.lat ?? listing.latitude ?? publicRecords?.parcel?.lat ?? publicRecords?.geocode?.lat;
  const rawLng = listing.lng ?? listing.longitude ?? publicRecords?.parcel?.lng ?? publicRecords?.geocode?.lng;
  const coords = (rawLat !== null && rawLat !== undefined && rawLng !== null && rawLng !== undefined)
    ? normalizeHazardCoords(rawLat, rawLng)
    : null;
  const cacheOpts = hazardCachePaths && typeof hazardCachePaths === 'object' ? hazardCachePaths : {};

  let floodResult = null;
  const inlineFlood = listing.femaFlood || publicRecords?.femaFlood;
  if (inlineFlood && inlineFlood.status === 'success' && inlineFlood.floodRisk) {
    floodResult = inlineFlood;
  } else if (typeof listing.floodZone === 'string' && listing.floodZone.trim()) {
    const risk = evaluateFloodRisk(listing.floodZone, listing.floodZoneSubtype || '', listing.sfhaFlag || '');
    floodResult = {
      status: 'success',
      fromCache: false,
      observedAt: listing.sourceObservedAt || new Date(now).toISOString(),
      coords,
      floodRisk: risk,
      nfipReserve: estimateNfipReserve(risk),
      provenance: 'listing-reported-flood-zone',
    };
  } else if (coords) {
    const femaCache = cacheOpts.femaFlood ? loadFemaCache(cacheOpts.femaFlood) : loadFemaCache();
    const cached = femaCache[coordHash(coords)];
    if (cached && cached.schemaVersion === 2 && cached.floodRisk) {
      floodResult = {
        status: 'success',
        fromCache: true,
        observedAt: cached.observedAt,
        coords,
        floodRisk: cached.floodRisk,
        nfipReserve: cached.nfipReserve,
        rawAttributes: cached.rawAttributes,
        provenance: 'fema-nfhl-spatial-query',
      };
    }
  }
  if (!floodResult) {
    floodResult = {
      status: 'unavailable',
      reason: coords ? 'fema_cache_miss_offline' : 'invalid_or_missing_coordinates',
      floodRisk: null,
      provenance: 'fema-nfhl-spatial-query',
    };
  }

  let epaResult = null;
  const inlineEpa = listing.epaHazard || publicRecords?.epaHazard;
  if (inlineEpa && inlineEpa.status === 'success' && inlineEpa.environmentalLiability) {
    epaResult = inlineEpa;
  } else if (Array.isArray(listing.epaFacilities) || Array.isArray(publicRecords?.epaFacilities)) {
    const facilities = Array.isArray(listing.epaFacilities) ? listing.epaFacilities : publicRecords.epaFacilities;
    epaResult = {
      status: 'success',
      fromCache: false,
      observedAt: listing.sourceObservedAt || new Date(now).toISOString(),
      coords,
      environmentalLiability: evaluateEnvironmentalLiability(facilities),
      facilities,
      provenance: 'listing-reported-epa-facilities',
    };
  } else if (coords) {
    const epaCache = cacheOpts.epaHazard ? loadEpaCache(cacheOpts.epaHazard) : loadEpaCache();
    const cached = epaCache[coordHash(coords, '0.25')];
    if (cached && cached.schemaVersion === 2 && cached.environmentalLiability) {
      epaResult = {
        status: 'success',
        fromCache: true,
        observedAt: cached.observedAt,
        coords,
        environmentalLiability: cached.environmentalLiability,
        facilities: cached.facilities,
        provenance: 'epa-envirofacts-spatial-query',
      };
    }
  }
  if (!epaResult) {
    epaResult = {
      status: 'unavailable',
      reason: coords ? 'epa_cache_miss_offline' : 'invalid_or_missing_coordinates',
      environmentalLiability: null,
      provenance: 'epa-envirofacts-spatial-query',
    };
  }

  let terrainResult = null;
  const inlineTerrain = listing.usgsTerrain || publicRecords?.usgsTerrain;
  const rawSlopePct = listing.terrainSlopePct;
  const hasExplicitTerrainSlope =
    rawSlopePct !== null &&
    rawSlopePct !== undefined &&
    typeof rawSlopePct !== 'boolean' &&
    (typeof rawSlopePct !== 'string' || rawSlopePct.trim() !== '') &&
    Number.isFinite(Number(rawSlopePct));
  if (inlineTerrain && inlineTerrain.status === 'success' && inlineTerrain.slopeAnalysis) {
    terrainResult = inlineTerrain;
  } else if (hasExplicitTerrainSlope) {
    const pct = Number(rawSlopePct);
    const slopeAnalysis = classifySlope(pct, 100);
    terrainResult = {
      status: 'success',
      fromCache: false,
      observedAt: listing.sourceObservedAt || new Date(now).toISOString(),
      coords,
      slopeAnalysis,
      provenance: 'listing-reported-slope',
    };
  } else if (coords) {
    const terrainCache = cacheOpts.usgsTerrain ? loadTerrainCache(cacheOpts.usgsTerrain) : loadTerrainCache();
    const cached = terrainCache[coordHash(coords)];
    if (cached && cached.slopeAnalysis) {
      terrainResult = {
        status: 'success',
        fromCache: true,
        observedAt: cached.observedAt,
        coords,
        slopeAnalysis: cached.slopeAnalysis,
        elevationMeters: cached.elevationMeters,
        samples: cached.samples,
        provenance: 'usgs-3dep-elevation-query',
      };
    }
  }
  if (!terrainResult) {
    terrainResult = {
      status: 'unavailable',
      reason: coords ? 'usgs_cache_miss_offline' : 'invalid_or_missing_coordinates',
      slopeAnalysis: null,
      provenance: 'usgs-3dep-elevation-query',
    };
  }

  const flags = [];
  let compositeScore = 100;

  if (floodResult.status === 'success' && floodResult.floodRisk) {
    const fr = floodResult.floodRisk;
    if (fr.riskTier === 'critical') {
      compositeScore -= 40;
      flags.push({ layer: 'fema_flood', severity: 'critical', label: `Coastal High Hazard Flood Zone (${fr.zone})`, detail: fr.description });
    } else if (fr.riskTier === 'high') {
      compositeScore -= 25;
      flags.push({ layer: 'fema_flood', severity: 'high', label: `Special Flood Hazard Area 100-Year Floodplain (${fr.zone})`, detail: 'Mandatory flood insurance required by federally-regulated mortgagees.' });
    } else if (fr.riskTier === 'moderate') {
      compositeScore -= 10;
      flags.push({ layer: 'fema_flood', severity: 'moderate', label: `500-Year Floodplain (${fr.zone})`, detail: fr.description });
    }
  }

  if (epaResult.status === 'success' && epaResult.environmentalLiability) {
    const el = epaResult.environmentalLiability;
    if (el.liabilityTier === 'critical') {
      compositeScore -= 50;
      flags.push({ layer: 'epa_superfund', severity: 'critical', label: 'Active Superfund / SEMS Site within 0.25 Miles', detail: el.summary });
    } else if (el.liabilityTier === 'high') {
      compositeScore -= 30;
      flags.push({ layer: 'epa_hazardous', severity: 'high', label: 'Multiple RCRA / Brownfield Facilities within 0.25 Miles', detail: el.summary });
    } else if (el.liabilityTier === 'moderate') {
      compositeScore -= 15;
      flags.push({ layer: 'epa_hazardous', severity: 'moderate', label: 'EPA Regulated Facility in Proximity', detail: el.summary });
    }
  }

  if (terrainResult.status === 'success' && terrainResult.slopeAnalysis) {
    const sl = terrainResult.slopeAnalysis;
    if (sl.classification === 'severe_slope') {
      compositeScore -= 45;
      flags.push({ layer: 'usgs_terrain', severity: 'critical', label: `Severe Ravine/Cliff Slope (${sl.slopePct}%)`, detail: sl.summary });
    } else if (sl.classification === 'steep_slope') {
      compositeScore -= 25;
      flags.push({ layer: 'usgs_terrain', severity: 'high', label: `Steep Building Slope (${sl.slopePct}%)`, detail: sl.summary });
    } else if (sl.classification === 'moderate_slope') {
      compositeScore -= 10;
      flags.push({ layer: 'usgs_terrain', severity: 'moderate', label: `Moderate Grade Slope (${sl.slopePct}%)`, detail: sl.summary });
    }
  }

  compositeScore = Math.max(0, Math.min(100, compositeScore));
  let overallTier = 'minimal_hazard';
  if (compositeScore < 40) overallTier = 'critical_hazard';
  else if (compositeScore < 70) overallTier = 'high_hazard';
  else if (compositeScore < 85) overallTier = 'moderate_hazard';

  const availableLayers = [floodResult, epaResult, terrainResult].filter((layer) => layer.status === 'success').length;
  const complete = availableLayers === 3;
  const status = complete ? 'success' : availableLayers > 0 ? 'partial' : 'unavailable';

  return {
    status,
    ...(status === 'unavailable' ? { reason: coords ? 'hazard_cache_unpopulated_offline' : 'invalid_or_missing_coordinates' } : {}),
    evaluatedAt: new Date(now).toISOString(),
    compositeScore: complete ? compositeScore : null,
    overallTier: complete ? overallTier : 'unknown',
    flags,
    layers: {
      femaFlood: floodResult,
      epaHazard: epaResult,
      usgsTerrain: terrainResult,
    },
    underwritingImpact: {
      nfipAnnualReserve: floodResult.status === 'success' ? floodResult.nfipReserve?.estimatedAnnualPremiumReserve ?? null : null,
      phaseOneEsaRequired: epaResult.status === 'success' ? epaResult.environmentalLiability?.phaseOneRecommended ?? null : null,
      gradingContingencyRequired: terrainResult.status === 'success' && Number.isFinite(terrainResult.slopeAnalysis?.slopePct) ? terrainResult.slopeAnalysis.slopePct > 15 : null,
    },
    provenance: 'federal-environmental-physical-gis-v1',
  };
}

function known(value) { return value !== null && value !== undefined && value !== ''; }

function buildPropertyDossier(listing, { observations = { records: {}, signals: [] }, publicRecords = null, operatorInput = null, now = Date.now(), historyUnavailable = false, countyStats = null, hazardCachePaths = null, triggerWeights = triggerWeightManager, docketVerification = null, docketSummary = null, trajectoryOverride = null } = {}) {
  const timestamp = listing.sourceObservedAt || listing.provenance?.observedAt;
  const publisherObserved = (listing.provenance?.origin === 'live' || listing.provenance?.origin === 'email_notice')
    && validateListingForIngestion(listing).isValid && Date.parse(timestamp) <= now + 300_000;
  const archived = listing.provenance?.origin === 'archive' && listing.provenance?.observed === true
    && /^[a-f0-9]{64}$/i.test(listing.provenance?.datasetSha256 || '')
    && listing.provenance?.recordId && Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) <= now + 300_000;
  const capturedEvidence = publisherObserved || archived;
  const source = {
    id: listing.source, publisher: listing.provenance?.publisher || listing.source,
    url: capturedEvidence ? listing.sourceUrl : null, observedAt: capturedEvidence ? timestamp : null,
    status: publisherObserved ? 'source_observed' : archived ? 'archived_publisher_snapshot' : 'unverified_snapshot',
  };
  const cadenceHours = require('../sources/catalog').SOURCE_CATALOG.find((entry) => entry.adapterKey === listing.source)?.workflow.cadenceHours || 24;
  source.refreshDueAt = publisherObserved ? new Date(Date.parse(timestamp) + cadenceHours * 3600_000).toISOString() : null;
  source.freshness = archived ? 'historical_snapshot' : !publisherObserved ? 'unverified' : Date.parse(source.refreshDueAt) < now ? 'stale' : 'within_refresh_window';
  const derived = (key) => Boolean(listing.provenance?.derivedFields?.[key]);
  const claim = (key, title) => ({
    key, title, value: known(listing[key]) ? listing[key] : null,
    evidenceClass: !known(listing[key]) ? 'unknown' : derived(key) ? 'model_derived' : archived ? 'archived_publisher_reported' : !publisherObserved ? 'unverified_snapshot' : 'publisher_reported',
    sourceUrl: source.url, observedAt: source.observedAt,
  });
  const facts = [
    claim('address', 'Property address'), claim('propType', 'Property type'), claim('openingBid', 'Published opening bid'),
    claim('saleDate', 'Published sale date'), claim('status', 'Published status'), claim('deposit', 'Deposit and payment terms'),
    claim('occupancy', 'Reported occupancy'), claim('sqft', 'Reported building area'), claim('assessed', 'Reported assessed value'),
    claim('auctionProgram', 'Published auction program'), claim('lifecycleStatus', 'Published lifecycle status'),
    claim('transactionOutcome', 'Verified transaction outcome'),
  ];
  const tracked = capturedEvidence ? Object.values(observations.records).find((record) => record.latest?.listingId === listing.id && record.latest.source === listing.source && record.latest.recordId === String(listing.provenance?.recordId)) : null;
  const recordUrls = new Set(tracked ? [...tracked.history, tracked.latest].map((record) => record.sourceUrl) : []);
  const signals = tracked ? observations.signals.filter((signal) => signal.listingId === listing.id && signal.sourceId === listing.source
    && (!signal.recordId || signal.recordId === String(listing.provenance?.recordId))
    && signal.evidence?.every((point) => recordUrls.has(point.sourceUrl))).slice(0, 10) : [];
  const resolvedViolations = Array.isArray(listing.municipalViolations)
    ? listing.municipalViolations
    : Array.isArray(listing.codeViolations)
      ? listing.codeViolations
      : Array.isArray(listing.codeEnforcement?.violations)
        ? listing.codeEnforcement.violations
        : Array.isArray(publicRecords?.municipalRecords?.violations)
          ? publicRecords.municipalRecords.violations
          : null;
  const rawDocketSummary = docketSummary
    || docketVerification?.docketSummary
    || publicRecords?.docketVerification?.docketSummary
    || publicRecords?.docketSummary
    || listing.docketSummary
    || listing.docketVerification?.docketSummary
    || null;
  const rawDocketHits = rawDocketSummary?.dockets
    || docketVerification?.matchedDockets
    || publicRecords?.docketVerification?.matchedDockets
    || publicRecords?.courtlistenerDockets
    || listing.courtlistenerDockets
    || listing.bankruptcyDockets
    || listing.provenance?.sourceFacts?.courtlistenerDockets
    || [];
  const resolvedDocketSummary = summarizeDocketHits(rawDocketHits, {
    checkedAt: rawDocketSummary?.checkedAt || new Date(now).toISOString(),
    lookupExecuted: Boolean(rawDocketSummary?.lookupExecuted),
  });
  const baseListingForTitle = (!Array.isArray(listing.municipalViolations) && resolvedViolations)
    ? { ...listing, municipalViolations: resolvedViolations }
    : listing;
  const listingForTitle = resolvedDocketSummary.hitCount > 0 || resolvedDocketSummary.lookupExecuted
    ? { ...baseListingForTitle, docketSummary: resolvedDocketSummary, courtlistenerDockets: resolvedDocketSummary.dockets }
    : baseListingForTitle;
  const titleRisk = listing.titleRisk || publicRecords?.titleRisk || arbitrateTitleRisk(listingForTitle, listing.raw || '');
  const gaps = [];
  const VOI_POINTS = { source_identity: 25, title_docket_joinder: 24, omitted_party_joinder: 24, title: 22, municipal_payoff: 21, municipal_liens: 21, value_and_debt: 20, opening_bid: 18, payment_terms: 15, sale_date_passed: 14, transaction_outcome: 12, source_stale: 10, occupancy: 10, archive_snapshot: 8 };
  const VOI_TIER = { source_identity: 'critical_risk', title_docket_joinder: 'critical_risk', omitted_party_joinder: 'critical_risk', municipal_payoff: 'critical_risk', municipal_liens: 'critical_risk', title: 'critical_risk', value_and_debt: 'high_leverage', opening_bid: 'high_leverage', payment_terms: 'high_leverage', sale_date_passed: 'high_leverage', transaction_outcome: 'standard', source_stale: 'standard', occupancy: 'standard', archive_snapshot: 'standard' };
  const TIER_ORDER = { critical_risk: 0, high_leverage: 1, standard: 2 };
  function gap(id, title, reason, nextAction) { gaps.push({ id, title, reason, nextAction, potentialPointsGain: VOI_POINTS[id] || 8, priorityTier: VOI_TIER[id] || 'standard' }); }
  if (!capturedEvidence) gap('source_identity', 'Source evidence is missing', 'This record has not passed the source-observation checks.', 'Locate and capture the exact publisher record before relying on its property facts.');
  if (archived) gap('archive_snapshot', 'Archive snapshot requires a current observation', 'The attachment preserves a dated publisher record. Import time does not verify current availability or terms.', 'Collect the exact publisher record to establish current evidence.');
  if (source.freshness === 'stale') gap('source_stale', 'The publisher observation needs refreshing', 'The saved observation is older than this source’s planned refresh interval. Its current availability and terms are unresolved.', 'Refresh this source in Source Radar or verify the exact publisher record. Public-record lookups are separate evidence with their own dates.');
  if (!known(listing.openingBid)) gap('opening_bid', 'Opening bid is not published here', 'A judgment, assessment, or deposit cannot substitute for the published bid.', 'Obtain the current offering terms from the publisher.');
  if (!known(listing.deposit)) gap('payment_terms', 'Cash requirements need confirmation', 'Deposit deadlines, premiums, fees, and payment forms have not been established.', 'Read the specific offering document and record its payment deadlines.');
  if (!known(listing.occupancy)) gap('occupancy', 'Occupancy is unresolved', 'Area vacancy rates and exterior photographs cannot establish whether this property is occupied.', 'Obtain property-specific occupancy and access evidence.');
  if (known(listing.saleDate) && Date.parse(String(listing.saleDate).slice(0, 10)) < Date.parse(new Date(now).toISOString().slice(0, 10))) {
    gap('sale_date_passed', 'The recorded sale date has passed', 'A past scheduled date does not establish whether a sale occurred, was canceled, or was postponed.', 'Refresh the exact sale record and check the current disposition.');
  }
  if (!known(listing.transactionOutcome)) gap('transaction_outcome', 'Transaction outcome is unresolved', 'A closed auction, reserve result, or passed date does not prove that title transferred.', 'Obtain a source record or public record that explicitly confirms the completed disposition.');
  const hasVerifiedTitleReview = Boolean(
    publicRecords?.titleVerified === true ||
    publicRecords?.docketVerified === true ||
    operatorInput?.titleVerified === true ||
    (publicRecords?.titleReview && publicRecords.titleReview.status === 'verified')
  );
  if (!hasVerifiedTitleReview) {
    gap('title', 'Title and surviving interests need research', 'A listing or a source match does not establish lien priority or a clear title.', 'Obtain the controlling sale documents and an appropriate recorder/title review.');
  }
  const hasOmittedPartyDefect = Boolean(
    titleRisk.instrumentPriority?.omittedPartyJoinderDefect ||
    listing.omittedPartyJoinderDefect ||
    listing.instrumentPriority?.omittedPartyJoinderDefect ||
    (Array.isArray(titleRisk.titleWarnings) && titleRisk.titleWarnings.some((w) => /omitted|unjoined|defective joinder/i.test(w)))
  );
  if (hasOmittedPartyDefect) {
    gap('title_docket_joinder', 'Property-specific docket review required for unjoined parties', 'Notice or docket evidence indicates an omitted junior lienholder or unjoined defendant. Under foreclosure law, unjoined parties retain their lien or statutory equity of redemption post-sale.', 'Examine the property-specific court docket and foreclosure complaint to confirm whether all subordinate interest holders were joined as named defendants.');
  }
  const municipalData = titleRisk.municipalLiens || null;
  const hasMunicipalLienWarnings = Boolean(
    municipalData?.hasMunicipalViolations ||
    municipalData?.isCondemnedOrDemolitionRisk ||
    titleRisk.instrumentPriority?.municipalSuperLienNotice ||
    (Array.isArray(listing.municipalViolations) && listing.municipalViolations.length > 0) ||
    (Array.isArray(listing.codeViolations) && listing.codeViolations.length > 0) ||
    (Array.isArray(titleRisk.titleWarnings) && titleRisk.titleWarnings.some((w) => /municipal|code violation|demolition/i.test(w)))
  );
  if (hasMunicipalLienWarnings) {
    const isDemolition = Boolean(municipalData?.isCondemnedOrDemolitionRisk);
    const count = municipalData?.activeViolationCount || (Array.isArray(listing.municipalViolations) ? listing.municipalViolations.length : (Array.isArray(listing.codeViolations) ? listing.codeViolations.length : 0));
    gap('municipal_payoff', 'Municipal payoff certificate required for surviving code/utility liens', isDemolition ? 'Active condemnation or demolition order on file with structural forfeiture risk. Municipal demolition assessments attach as surviving statutory super-liens.' : `Municipal violations or utility assessments detected (${count > 0 ? `${count} active citations` : 'super-lien signal'}). Municipal abatement and utility claims survive foreclosure sale by state statute.`, 'Obtain an official municipal payoff certificate and written code compliance clearance prior to bidding.');
  }
  gap('value_and_debt', 'Equity is not established', 'Opening bids and assessed values are not market valuations; a missing mortgage balance is not zero debt.', 'Supply current valuation evidence and supported outstanding debt before modeling equity.');
  const contradictions = [];
  const parcel = publicRecords?.parcel;
  const publisherIdentity = capturedEvidence ? {
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
  const opportunityEvaluation = evaluateOpportunitySignals(listing, { observations, publicRecords, now, historyUnavailable });
  const documentEvidence = buildDocumentEvidence(listing, { capturedEvidence, observedAt: timestamp, sourceUrl: source.url });
  gaps.sort((a, b) => (TIER_ORDER[a.priorityTier] ?? 2) - (TIER_ORDER[b.priorityTier] ?? 2) || (b.potentialPointsGain || 0) - (a.potentialPointsGain || 0));
  const possessionTimeline = buildPossessionDossier(listing);
  const auctionDepositTerms = {
    rules: getAuctionDepositRules(listing.source, { state: listing.state }),
    requiredDeposit: calculateRequiredDeposit(listing),
  };
  const rawDocketHistory = Array.isArray(countyStats?.historicalEvents)
    ? countyStats.historicalEvents
    : Array.isArray(countyStats?.events)
      ? countyStats.events
      : Array.isArray(listing.historicalEvents)
        ? listing.historicalEvents
        : null;
  const docketClearingAnalytics = rawDocketHistory
    ? calculateDocketClearingAnalytics(rawDocketHistory, { county: listing.county, state: listing.state })
    : (countyStats && typeof countyStats === 'object' && Number.isFinite(countyStats.totalDockets) ? countyStats : null);
  const effectiveCountyStats = countyStats || listing.countyStats || (docketClearingAnalytics && docketClearingAnalytics.sampleSufficient ? docketClearingAnalytics : null);
  const effectiveTrajectory = trajectoryOverride
    ? {
        ...opportunityEvaluation.trajectory,
        priorPostponements: trajectoryOverride.priorPostponements ?? opportunityEvaluation.trajectory?.priorPostponements ?? 0,
        statutoryStayExhausted: Boolean(trajectoryOverride.statutoryStayExhausted ?? opportunityEvaluation.trajectory?.statutoryStayExhausted),
      }
    : opportunityEvaluation.trajectory;
  const listingForMicrostructure = {
    ...listing,
    priorPostponements: effectiveTrajectory?.priorPostponements ?? listing.priorPostponements ?? 0,
    statutoryStayExhausted: Boolean(effectiveTrajectory?.statutoryStayExhausted || listing.statutoryStayExhausted),
    bankruptcyStayActive: Boolean(titleRisk?.bankruptcyStay?.stayEffective || listing.bankruptcyStayActive),
  };
  const auctionMicrostructure = evaluateAuctionProceedProbability(listingForMicrostructure, effectiveCountyStats);
  // Zero-Fabrication: a published opening bid is a minimum asking term, not a
  // realized gavel price, and the canonical judgment column is `judgment`
  // (LISTING_SELECT in server/db/client.js); `judgmentAmount` is only a legacy
  // alias. The statutory surplus waterfall allocates *actual* auction proceeds,
  // so it stays null until a verified transaction outcome supplies the realized
  // sale price. Otherwise every pre-sale listing would assert fabricated
  // former-owner equity (Tyler waterfall) from an asking price.
  const judgmentDebt = known(listing.judgment) ? listing.judgment : listing.judgmentAmount;
  const realizedWinningBid = known(listing.transactionOutcome)
    && Number.isFinite(Number(listing.winningBid)) && Number(listing.winningBid) > 0
    ? Number(listing.winningBid)
    : null;
  const surplusWaterfall = realizedWinningBid === null ? null : calculateSurplusEquityWaterfall({
    winningBid: realizedWinningBid,
    totalAdjudgedDebt: judgmentDebt,
    propertyAddress: listing.address,
    state: listing.state,
    liens: listing.liens || publicRecords?.liens || [],
  });
  const weightManager = triggerWeights || triggerWeightManager;
  const CALIBRATED_CAPABILITIES = ['geocode', 'cadastral_parcel', 'hpi_benchmark', 'hud_safmr', 'code_enforcement', 'title_risk'];
  const calibration = {
    neutralDefaultWeight: 1.0,
    weights: Object.fromEntries(CALIBRATED_CAPABILITIES.map((cap) => [cap, {
      weight: weightManager.getWeight(cap),
      calibratedConfidence: weightManager.applyCalibration(1.0, cap),
      observed: typeof weightManager.hasObservations === 'function' ? weightManager.hasObservations(cap) : false,
    }])),
  };
  const calibratedSignals = signals.map((sig) => {
    const baseConf = Number.isFinite(sig.confidence) ? sig.confidence : 1.0;
    const signalKey = sig.capability || sig.type || 'dossier_synthesis';
    return {
      ...sig,
      calibratedConfidence: weightManager.applyCalibration(baseConf, signalKey),
    };
  });
  const calibratedOpportunitySignals = Array.isArray(opportunityEvaluation.signals)
    ? opportunityEvaluation.signals.map((sig) => {
        const baseConf = sig.status === 'supported' ? 1.0 : 0.0;
        const sigKey = sig.key || sig.id || '';
        const capKey =
          sigKey === 'title_risk' || sigKey === 'title_equity_unresolved'
            ? 'title_risk'
            : sigKey === 'code_enforcement' || sigKey === 'municipal_code_enforcement'
              ? 'code_enforcement'
              : sigKey;
        return {
          ...sig,
          calibratedConfidence: weightManager.applyCalibration(baseConf, capKey),
        };
      })
    : opportunityEvaluation.signals;
  const roll = listing.provenance?.derivedFields?.assessorRoll || null;
  const persistedParcel = listing.assessorParcel || roll?.parcel || null;
  const persistedSitus = persistedParcel?.situsAddress || persistedParcel?.properties?.situsAddress || null;
  const persistedConflict = Boolean(
    persistedParcel && listing.address && persistedSitus
    && !isCompatibleNjSitusAddress(String(listing.address), String(persistedSitus)),
  );
  const rawBenchmarkParcel = publicRecords?.parcel != null
    ? publicRecords.parcel
    : (persistedParcel && !persistedConflict ? persistedParcel : null);
  let benchmarkParcel = rawBenchmarkParcel;
  if (benchmarkParcel && typeof benchmarkParcel === 'object') {
    const needsImprovementNorm = benchmarkParcel.assessedValue
      && typeof benchmarkParcel.assessedValue === 'object'
      && benchmarkParcel.assessedValue.improvement == null
      && benchmarkParcel.assessedValue.improvements != null;
    const inheritedCountyKey = publicRecords?.parcel == null && !benchmarkParcel.countyKey && roll?.countyKey
      ? roll.countyKey
      : null;
    if (needsImprovementNorm || inheritedCountyKey) {
      benchmarkParcel = {
        ...benchmarkParcel,
        ...(inheritedCountyKey ? { countyKey: inheritedCountyKey } : {}),
        ...(needsImprovementNorm ? {
          assessedValue: {
            ...benchmarkParcel.assessedValue,
            improvement: benchmarkParcel.assessedValue.improvements ?? null,
          },
        } : {}),
      };
    }
  }
  const rawListingAssessmentYear = listing.assessmentYear !== undefined && listing.assessmentYear !== null && listing.assessmentYear !== ''
    ? listing.assessmentYear
    : null;
  const benchmarkAssessmentYear = rawListingAssessmentYear
    ?? (publicRecords?.parcel == null && !persistedConflict ? (roll?.assessmentYear ?? roll?.taxYear ?? null) : null);
  return {
    evidenceReceipt: verifiedSnapshotReceipt(listing),
    publicBenchmarks: computePublicBenchmarkConsensus({ ...listing, parcel: benchmarkParcel, assessmentYear: benchmarkAssessmentYear }, { hpiSeries: loadObservedHpiSeries() }),
    version: 1, generatedAt: new Date(now).toISOString(), listingId: listing.id, address: listing.address,
    source, facts, signals: calibratedSignals, contradictions, gaps, documentEvidence,
    hudSafmr: listing.hudSafmr || (listing.zip ? getHudSafmrBenchmark({ zip: listing.zip, bedrooms: listing.beds ?? 2 }) : null),
    federalHazards: resolveSyncFederalHazards(listing, publicRecords, hazardCachePaths, now),
    calibration,
    titleRisk,
    docketStatus: resolvedDocketSummary,
    possessionTimeline,
    auctionDepositTerms,
    auctionMicrostructure,
    docketClearingAnalytics,
    surplusWaterfall,
    opportunitySignals: calibratedOpportunitySignals,
    trajectory: effectiveTrajectory,
    triagePriority: opportunityEvaluation.triagePriority,
    opportunityWeights: opportunityEvaluation.weights,
    componentScores: opportunityEvaluation.componentScores,
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
      documentCount: documentEvidence.count,
    },
    interpretation: 'A research dossier separates publisher observations, public-record context, model assumptions, and unresolved questions. It is not an appraisal, title determination, or bid recommendation.',
  };
}

module.exports = { buildPropertyDossier };
