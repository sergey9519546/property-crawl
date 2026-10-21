'use strict';
/**
 * signals.js — Transparent Opportunity-Signal Evaluator
 *
 * Implements Priority Upgrade 3 from docs/reference-audit/propertyradar.md:
 * Deterministic signal evaluation outputting actionable reasons, exact evidence
 * classifications, observed timestamps, and next research actions.
 * Calculates an explainable triage priority with published component weights.
 */

const crypto = require('node:crypto');
const { resolveCountyKey } = require('../enrichment/arcgis-parcels');
const { interpretAssessorParcel } = require('../enrichment/assessor-reading');
const { calculateMacroValuation, explicitDollarBasis } = require('../enrichment/macro-valuation');
const { getCountyMarketTrends } = require('../enrichment/macro-valuation-data');
const { analyzeMunicipalViolations } = require('./municipal-liens');
const { buildDocumentEvidence } = require('./document-evidence');
const { classifyStatusActivity } = require('../sources/observations');

const SIGNAL_WEIGHTS = Object.freeze({
  bidToValueRatio: 0.30,
  saleDateKnown: 0.20,
  bidReduction: 0.20,
  areaDiscrepancy: 0.10,
  returnedToMarket: 0.10,
  dataCompleteness: 0.10,
});

// Completeness is measured over the three distinct research artifacts (title
// facts, area corroboration, valuation band) with a fixed denominator. Event
// components (sale date, bid reduction, relist) are excluded so the aggregate
// does not re-count them; area and ratio intentionally contribute both depth
// (their own components) and research completeness here.
const CANONICAL_COMPLETENESS_SIGNALS = Object.freeze([
  'title_equity_unresolved',
  'building_area_discrepancy',
  'bid_to_value_ratio',
]);
const CANONICAL_COMPLETENESS_DENOMINATOR = CANONICAL_COMPLETENESS_SIGNALS.length;

function isKnown(value) {
  return value !== null && value !== undefined && value !== '' && !Number.isNaN(value);
}

function hasPublisherEvidence(listing, observedAt) {
  const provenance = listing.provenance || {};
  return provenance.origin === 'live'
    && provenance.observed === true
    && Boolean(String(listing.sourceUrl || '').trim())
    && Boolean(String(provenance.publisher || '').trim())
    && Boolean(String(provenance.recordId || '').trim())
    && Number.isFinite(Date.parse(String(observedAt || '')));
}

function evaluateOpportunitySignals(listing = {}, options = {}) {
  const {
    observations = { records: {}, signals: [] },
    publicRecords = null,
    now = Date.now(),
    historyUnavailable = false,
  } = options;

  const observedAt = listing.sourceObservedAt || listing.provenance?.observedAt || listing.fetchedAt || new Date(now).toISOString();
  const sourceUrl = listing.sourceUrl || null;
  const publisherObserved = hasPublisherEvidence(listing, observedAt);
  const signals = [];

  // 1. Sale Date Known
  const rawSaleDate = listing.saleDate;
  if (isKnown(rawSaleDate)) {
    const parsedSale = Date.parse(String(rawSaleDate).slice(0, 10));
    const today = Date.parse(new Date(now).toISOString().slice(0, 10));
    if (publisherObserved && Number.isFinite(parsedSale) && parsedSale >= today) {
      signals.push({
        key: 'sale_date_known',
        label: 'Published sale date is confirmed',
        status: 'supported',
        evidenceClass: 'publisher_reported',
        sourceUrl,
        observedAt,
        reason: `Active auction scheduled for ${String(rawSaleDate).slice(0, 10)}.`,
        nextAction: 'Monitor publisher calendar and docket for postponement or stay notices.',
      });
    } else if (publisherObserved && Number.isFinite(parsedSale)) {
      signals.push({
        key: 'sale_date_known',
        label: 'Recorded sale date has passed',
        status: 'unknown',
        evidenceClass: 'publisher_reported',
        sourceUrl,
        observedAt,
        reason: `Recorded date ${String(rawSaleDate).slice(0, 10)} has passed; post-sale disposition is unconfirmed.`,
        nextAction: 'Check whether auction occurred, postponed, or adjourned.',
      });
    } else {
      signals.push({
        key: 'sale_date_known',
        label: 'Sale date unresolved',
        status: 'unknown',
        evidenceClass: 'unresolved',
        sourceUrl: null,
        observedAt: null,
        reason: 'The recorded sale date is not backed by validated live publisher evidence.',
        nextAction: 'Capture and validate the exact current publisher record.',
      });
    }
  } else {
    signals.push({
      key: 'sale_date_known',
      label: 'Sale date unresolved',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Auction sale date is not published in current record.',
      nextAction: 'Check official county court docket or publisher listing.',
    });
  }

  // 2. Bid Reduction
  const hasObservationReduction = Array.isArray(observations.signals) && observations.signals.some((sig) =>
    (sig.listingId === listing.id || sig.recordId === String(listing.provenance?.recordId))
    && (sig.type === 'bid_reduced' || sig.kind === 'bid_reduced' || /bid.*reduc|drop|lower/i.test(sig.type || sig.kind || sig.label || ''))
  );
  if (hasObservationReduction) {
    signals.push({
      key: 'bid_reduction',
      label: 'Opening bid reduced on record',
      status: 'supported',
      evidenceClass: 'exact_source_observation',
      sourceUrl,
      observedAt,
      reason: 'Opening bid was decreased on the same verified source record over time.',
      nextAction: 'Review prior bid observation history and confirm updated reserve requirements.',
    });
  } else if (historyUnavailable) {
    signals.push({
      key: 'bid_reduction',
      label: 'Bid history unavailable',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'The observation history could not be read, so a bid reduction can be neither confirmed nor ruled out.',
      nextAction: 'Restore the source observation store and re-evaluate before relying on this signal.',
    });
  } else {
    signals.push({
      key: 'bid_reduction',
      label: 'No bid reduction observed',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'No downward price adjustment recorded between observations.',
      nextAction: 'Watch source feed for publisher reserve cuts prior to sale.',
    });
  }

  // 3. Returned to Market (Structured event detection from successive-snapshot diffs)
  const hasObservationRelist = Array.isArray(observations?.signals) && observations.signals.some((sig) =>
    (sig.listingId === listing.id || sig.recordId === String(listing.provenance?.recordId))
    && (sig.type === 'returned_to_market' || sig.kind === 'returned_to_market')
  );

  const recordKey = listing.source && listing.provenance?.recordId
    ? crypto.createHash('sha256').update(`${listing.source}\n${listing.provenance.recordId}`).digest('hex')
    : null;
  const recordHistory = (recordKey && observations?.records?.[recordKey]?.history) || [];
  // Publisher statuses are prose ("Status: Active - Postponed"), so the same
  // normalize-then-match classifier the observation producer uses decides
  // whether a history entry shows an inactive/adjourned sale that the current
  // record has returned to active from.
  const hasHistoryRelist = recordHistory.some((h) => classifyStatusActivity(h?.fields?.status || h?.status) === 'inactive'
    && classifyStatusActivity(listing.status || listing.lifecycleStatus) === 'active');

  // Explicit relist wording. "Returned" / "re-listed" anywhere in the status
  // (word-boundary so "deposits returned" prose cannot fire it), or a whole
  // status of exactly "rescheduled" (a bare reschedule means a new sale date
  // is on the schedule). "Active - Postponed" and similar current-off-market
  // prose deliberately do not match.
  const normalizedStatus = String(listing.status || listing.lifecycleStatus || '')
    .replace(/^status\s*:\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const isExplicitRelistStatus = /\breturned\b|\bre-?listed\b/.test(normalizedStatus) || normalizedStatus === 'rescheduled';
  const rawNotice = String(listing.raw || listing.rawNotice || '');
  const hasExplicitNoticeRelist = /returned to market|re-?listed/i.test(rawNotice);

  const isReturned = hasObservationRelist || hasHistoryRelist || isExplicitRelistStatus || hasExplicitNoticeRelist;

  if (isReturned && (publisherObserved || hasObservationRelist || hasHistoryRelist)) {
    signals.push({
      key: 'returned_to_market',
      label: 'Returned to market',
      status: 'supported',
      evidenceClass: (hasObservationRelist || hasHistoryRelist) ? 'exact_source_observation' : 'publisher_reported',
      sourceUrl,
      observedAt,
      reason: hasObservationRelist || hasHistoryRelist
        ? 'Observation history confirms property returned to active schedule following prior postponement or adjournment.'
        : 'Publisher record indicates property was re-listed or returned following a prior postponement.',
      nextAction: 'Review docket for bankruptcy relief, bankruptcy dismissals, or creditor motions.',
    });
  } else if (historyUnavailable && !isReturned) {
    signals.push({
      key: 'returned_to_market',
      label: 'Return history unavailable',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Observation history could not be read, so a return-to-market transition can be neither confirmed nor ruled out.',
      nextAction: 'Restore source observation store and re-evaluate before relying on this signal.',
    });
  } else if (isReturned) {
    signals.push({
      key: 'returned_to_market',
      label: 'Return to market not verified',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'A return-to-market phrase is present, but this record is not a live publisher observation.',
      nextAction: 'Open the publisher record before treating a relist as a fact.',
    });
  } else {
    signals.push({
      key: 'returned_to_market',
      label: 'Return to market not stated',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'The published status does not say this property returned to market, and no successive-snapshot relisting event was recorded.',
      nextAction: 'Read the publisher status and the docket before treating a relist as a fact.',
    });
  }

  // 4. Bid-to-Supported-Value Ratio (with Assessor Registry + FHFA HPI fallback & Macro-trend caveat)
  const bid = Number(listing.openingBid);
  const hasDirectRange = Number.isFinite(Number(listing.estLow))
    && Number(listing.estLow) > 0
    && Number.isFinite(Number(listing.estHigh))
    && Number(listing.estHigh) >= Number(listing.estLow);

  let estLow = hasDirectRange ? Number(listing.estLow) : null;
  let estHigh = hasDirectRange ? Number(listing.estHigh) : null;
  let mid = hasDirectRange ? (estLow + estHigh) / 2 : null;
  let valuationProvenance = hasDirectRange ? 'publisher_reported' : null;
  let valuationLabel = null;

  if (!hasDirectRange && publisherObserved && bid > 0) {
    // 1. Attempt enrolled county assessor registry conversion
    const countyKey = resolveCountyKey(listing.state, listing.county);
    const assessorRes = countyKey ? interpretAssessorParcel({
      countyKey,
      parcel: publicRecords?.parcel || listing.assessorParcel || listing.provenance?.derivedFields?.assessorRoll?.parcel,
      openingBid: listing.openingBid,
    }) : null;

    if (assessorRes && assessorRes.marketComparison > 0) {
      mid = assessorRes.marketComparison;
      estLow = Math.round(mid * 0.92);
      estHigh = Math.round(mid * 1.08);
      valuationProvenance = 'enrolled_assessor_registry';
      valuationLabel = assessorRes.citation || 'Enrolled county assessor market conversion (±8% band)';
    } else {
      // 2. Attempt explicit dollar basis + FHFA HPI
      const basis = explicitDollarBasis(listing);
      if (basis) {
        const macro = calculateMacroValuation(basis);
        if (macro) {
          estLow = macro.estLow;
          estHigh = macro.estHigh;
          mid = Math.round((estLow + estHigh) / 2);
          valuationProvenance = 'fhfa_hpi_macro_trend';
          valuationLabel = macro.label || 'FHFA HPI Macro Trend (±8% band)';
        }
      }
    }
  }

  // Macroeconomic trend context caveats
  const macroTrends = getCountyMarketTrends(listing.state, listing.county);
  const isDecliningMarket = macroTrends && (
    (typeof macroTrends.yoyPriceChangePct === 'number' && macroTrends.yoyPriceChangePct < 0) ||
    macroTrends.marketTemperature === 'cooling' ||
    macroTrends.marketTemperature === 'cold' ||
    macroTrends.marketTemperature === 'declining'
  );
  const marketCaveatText = isDecliningMarket
    ? ` [Market caveat: Discount measured against a declining market (${macroTrends.trendLabel || `${macroTrends.yoyPriceChangePct}% YoY`})].`
    : '';

  if (publisherObserved && bid > 0 && mid > 0) {
    const ratio = bid / mid;
    const discountPct = Math.round((1 - ratio) * 100);
    const evidenceClass = valuationProvenance === 'enrolled_assessor_registry'
      ? 'official_parcel_roll'
      : valuationProvenance === 'fhfa_hpi_macro_trend'
      ? 'macro_housing_index'
      : 'calculated_ratio';
    const provenanceSuffix = valuationLabel ? ` [derived from ${valuationLabel}]` : '';

    if (ratio <= 1) {
      signals.push({
        key: 'bid_to_value_ratio',
        label: valuationProvenance && valuationProvenance !== 'publisher_reported'
          ? 'Bid-to-supported-value ratio established (assessor/FHFA model)'
          : 'Bid-to-supported-value ratio established',
        status: 'supported',
        evidenceClass,
        sourceUrl,
        observedAt,
        valuationProvenance,
        marketCaveat: isDecliningMarket ? 'declining_market' : null,
        reason: `Opening bid ($${bid.toLocaleString()}) represents ${(ratio * 100).toFixed(1)}% of valuation midpoint ($${mid.toLocaleString()}) — ${discountPct}% spread${provenanceSuffix}.${marketCaveatText}`,
        nextAction: 'Calculate Max Allowable Offer (MAO) incorporating repair and holding allowances.',
      });
    } else {
      signals.push({
        key: 'bid_to_value_ratio',
        label: 'Opening bid exceeds supported valuation midpoint',
        status: 'contradicted',
        evidenceClass,
        sourceUrl,
        observedAt,
        valuationProvenance,
        marketCaveat: isDecliningMarket ? 'declining_market' : null,
        reason: `Opening bid ($${bid.toLocaleString()}) is ${(ratio * 100).toFixed(1)}% of valuation midpoint ($${mid.toLocaleString()}) — ${-discountPct}% above${provenanceSuffix}.${marketCaveatText}`,
        nextAction: 'Re-verify the valuation band and comparable sales before modeling this as an opportunity.',
      });
    }
  } else {
    signals.push({
      key: 'bid_to_value_ratio',
      label: 'Valuation ratio unavailable',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Opening bid or valuation estimate band is missing; ratio cannot be computed.',
      nextAction: 'Gather verified comp sales and publisher opening bid.',
    });
  }

  // 5. Building Area Discrepancy
  const parcel = publicRecords?.parcel;
  const parcelMatched = parcel?.status === 'matched';
  const advertisedSqft = Number(listing.sqft);
  const recordSqft = Number(parcel?.properties?.livingAreaSqft || parcel?.livingAreaSqft);
  if (publisherObserved && parcelMatched && advertisedSqft > 0 && recordSqft > 0) {
    const diff = Math.abs(advertisedSqft - recordSqft);
    const diffPct = diff / Math.max(advertisedSqft, recordSqft);
    if (diffPct > 0.10) {
      signals.push({
        key: 'building_area_discrepancy',
        label: 'Building area discrepancy detected',
        status: 'contradicted',
        evidenceClass: 'official_parcel_roll',
        sourceUrl: parcel?.source?.url || sourceUrl,
        observedAt,
        reason: `Advertised sqft (${advertisedSqft}) disagrees with official cadastral record (${recordSqft}) by ${Math.round(diffPct * 100)}%.`,
        nextAction: 'Compare building permits and property card for unpermitted additions or recording errors.',
      });
    } else {
      signals.push({
        key: 'building_area_discrepancy',
        label: 'Building area verified by official records',
        status: 'supported',
        evidenceClass: 'official_parcel_roll',
        sourceUrl: parcel?.source?.url || sourceUrl,
        observedAt,
        reason: `Advertised sqft (${advertisedSqft}) matches official cadastral record (${recordSqft}) within 10%.`,
        nextAction: 'Proceed with verified physical square footage.',
      });
    }
  } else {
    signals.push({
      key: 'building_area_discrepancy',
      label: 'Building area uncorroborated',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Official parcel cadastral record is not matched for square footage cross-check.',
      nextAction: 'Lookup county property appraiser card.',
    });
  }

  // 6. Title and Equity Unresolved
  const redemptionIsStateTable = Boolean(listing?.provenance?.derivedFields?.redemption);
  const lienIsPattern = Boolean(listing?.provenance?.derivedFields?.seniorLienRisk);
  const hasSeniorRisk = !lienIsPattern && isKnown(listing.seniorLienRisk);
  const hasRedemption = !redemptionIsStateTable
    && isKnown(listing.redemptionDays)
    && Number.isFinite(Number(listing.redemptionDays));
  const hasCashToClose = isKnown(listing.cashToClose);
  if (publisherObserved && hasSeniorRisk && listing.seniorLienRisk !== 'unknown' && hasRedemption && hasCashToClose) {
    signals.push({
      key: 'title_equity_unresolved',
      label: 'Core title and settlement facts available',
      status: 'supported',
      evidenceClass: 'derived_unverified',
      sourceUrl,
      observedAt,
      reason: `Statutory redemption (${listing.redemptionDays} days), lien-risk signal (${listing.seniorLienRisk}), and estimated cash-to-close are available but not docket-verified.`,
      nextAction: 'Confirm payoff figures and certificate of sale requirements.',
    });
  } else {
    signals.push({
      key: 'title_equity_unresolved',
      label: 'Title encumbrances and fees need research',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Senior lien survival, statutory redemption window, or cash-to-close terms remain unconfirmed.',
      nextAction: 'Examine docket for junior liens, tax certificates, and HOA super-priority claims.',
    });
  }

  // 7. Municipal Code Enforcement Distress Signal
  const municipalAnalysis = analyzeMunicipalViolations(listing, listing.municipalViolations || listing.codeEnforcement?.violations || []);
  if (municipalAnalysis.isCondemnedOrDemolitionRisk) {
    signals.push({
      key: 'municipal_code_enforcement',
      label: 'Active condemnation or demolition order on record',
      status: 'contradicted',
      evidenceClass: 'municipal_code_compliance',
      sourceUrl: listing.codeEnforcement?.sourceUrl || sourceUrl,
      observedAt,
      reason: `Property subject to active municipal condemnation or demolition order with ~$${municipalAnalysis.estimatedSurvivingLienLiability.toLocaleString()} estimated surviving assessment.`,
      nextAction: 'Confirm stay or permit with municipal code compliance department before bidding.',
    });
  } else if (municipalAnalysis.hasMunicipalViolations) {
    signals.push({
      key: 'municipal_code_enforcement',
      label: 'Active municipal code violations on record',
      status: 'supported',
      evidenceClass: 'municipal_code_compliance',
      sourceUrl: listing.codeEnforcement?.sourceUrl || sourceUrl,
      observedAt,
      reason: `${municipalAnalysis.activeViolationCount} unresolved municipal citation(s) totaling $${municipalAnalysis.estimatedSurvivingLienLiability.toLocaleString()} in potential surviving fines.`,
      nextAction: 'Deduct municipal violation liabilities from allowable bid and verify remediation schedule.',
    });
  } else if (listing.codeEnforcement?.checked === true || Array.isArray(listing.municipalViolations)) {
    signals.push({
      key: 'municipal_code_enforcement',
      label: 'No open municipal code violations detected',
      status: 'supported',
      evidenceClass: 'municipal_code_compliance',
      sourceUrl: listing.codeEnforcement?.sourceUrl || sourceUrl,
      observedAt,
      reason: 'Municipal code compliance docket was searched; no active violations or demolition notices on file.',
      nextAction: 'Proceed with standard physical inspection.',
    });
  } else {
    signals.push({
      key: 'municipal_code_enforcement',
      label: 'Municipal code compliance unverified',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'Municipal code enforcement and demolition docket has not been cross-referenced.',
      nextAction: 'Query municipal open data or city building department for open notices.',
    });
  }

  // 8. Publisher-Document Availability Signal
  // The vault documents observed in production are publisher-hosted auction
  // files (consumer notices, sale-agreement templates, pamphlets) — files the
  // publisher attaches to the record. They are observed facts about the
  // record, but they are NOT independently verified docket or title
  // instruments, so the signal is worded as document availability, never as
  // instrument verification.
  const docEvidence = buildDocumentEvidence(listing, { observedAt, sourceUrl, now });
  const hasVaultDocs = (docEvidence && docEvidence.status === 'observed' && docEvidence.count > 0)
    || (Array.isArray(listing.documents) && listing.documents.length > 0)
    || Boolean(listing.hasDocuments);
  const docCount = (docEvidence && docEvidence.count > 0 ? docEvidence.count : null)
    || (Array.isArray(listing.documents) ? listing.documents.length : 0)
    || (listing.hasDocuments ? 1 : 0);

  if (hasVaultDocs) {
    signals.push({
      key: 'publisher_documents',
      label: 'Documents published on the auction record',
      status: 'supported',
      evidenceClass: 'publisher_document_links',
      sourceUrl: docEvidence?.sourceUrl || sourceUrl,
      observedAt: docEvidence?.observedAt || observedAt,
      reason: `${docCount} document(s) captured from the publisher auction record. These are publisher-hosted files (notices, sale agreements), not independently verified docket or title instruments.`,
      nextAction: 'Download and read the published documents; independently confirm any docket or title claim they make.',
    });
  } else {
    signals.push({
      key: 'publisher_documents',
      label: 'No documents published on the auction record',
      status: 'unknown',
      evidenceClass: 'unresolved',
      sourceUrl,
      observedAt,
      reason: 'The publisher record carries no attached documents, and no docket filings or title commitments have been captured.',
      nextAction: 'Request the auction notice from the publisher or pull the docket entry directly.',
    });
  }

  // Compute Triage Priority (0-100)
  let priorityScore = 0;

  // 1. Ratio component (up to 30 pts)
  const ratioSignal = signals.find((s) => s.key === 'bid_to_value_ratio');
  let earnedRatio = 0;
  if (ratioSignal?.status === 'supported' && bid > 0 && mid > 0) {
    const discountFraction = Math.max(0, Math.min(1, 1 - (bid / mid)));
    earnedRatio = discountFraction * 100 * SIGNAL_WEIGHTS.bidToValueRatio;
    priorityScore += earnedRatio;
  }

  // 2. Sale date component (up to 20 pts)
  const saleSignal = signals.find((s) => s.key === 'sale_date_known');
  const earnedSaleDate = saleSignal?.status === 'supported' ? 100 * SIGNAL_WEIGHTS.saleDateKnown : 0;
  priorityScore += earnedSaleDate;

  // 3. Bid reduction component (up to 20 pts)
  const bidRedSignal = signals.find((s) => s.key === 'bid_reduction');
  const earnedBidReduction = bidRedSignal?.status === 'supported' ? 100 * SIGNAL_WEIGHTS.bidReduction : 0;
  priorityScore += earnedBidReduction;

  // 4. Area corroboration component (up to 10 pts)
  const areaSignal = signals.find((s) => s.key === 'building_area_discrepancy');
  const earnedArea = areaSignal?.status === 'supported' ? 100 * SIGNAL_WEIGHTS.areaDiscrepancy : 0;
  priorityScore += earnedArea;

  // 5. Return to market (up to 10 pts)
  const returnSignal = signals.find((s) => s.key === 'returned_to_market');
  const earnedReturn = returnSignal?.status === 'supported' ? 100 * SIGNAL_WEIGHTS.returnedToMarket : 0;
  priorityScore += earnedReturn;

  // 6. Data completeness (up to 10 pts)
  // Evaluates only distinct research completeness signals (title, area corroboration, valuation band)
  // without double-counting event flags in components 2, 3, and 5. Uses a constant denominator.
  const supportedCompletenessCount = signals.filter(
    (s) => CANONICAL_COMPLETENESS_SIGNALS.includes(s.key) && s.status === 'supported'
  ).length;
  const earnedCompleteness = (supportedCompletenessCount / CANONICAL_COMPLETENESS_DENOMINATOR) * 100 * SIGNAL_WEIGHTS.dataCompleteness;
  priorityScore += earnedCompleteness;

  const roundedPriority = Math.min(99, Math.max(0, Math.round(priorityScore)));

  const componentScores = {
    bidToValueRatio: {
      label: 'Bid-to-Value Ratio',
      weight: SIGNAL_WEIGHTS.bidToValueRatio,
      maxPoints: Math.round(100 * SIGNAL_WEIGHTS.bidToValueRatio),
      earnedPoints: Math.round(earnedRatio * 10) / 10,
      status: ratioSignal?.status || 'unknown',
    },
    saleDateKnown: {
      label: 'Published Sale Date',
      weight: SIGNAL_WEIGHTS.saleDateKnown,
      maxPoints: Math.round(100 * SIGNAL_WEIGHTS.saleDateKnown),
      earnedPoints: Math.round(earnedSaleDate * 10) / 10,
      status: saleSignal?.status || 'unknown',
    },
    bidReduction: {
      label: 'Bid Reduction',
      weight: SIGNAL_WEIGHTS.bidReduction,
      maxPoints: Math.round(100 * SIGNAL_WEIGHTS.bidReduction),
      earnedPoints: Math.round(earnedBidReduction * 10) / 10,
      status: bidRedSignal?.status || 'unknown',
    },
    areaDiscrepancy: {
      label: 'Building Area Corroboration',
      weight: SIGNAL_WEIGHTS.areaDiscrepancy,
      maxPoints: Math.round(100 * SIGNAL_WEIGHTS.areaDiscrepancy),
      earnedPoints: Math.round(earnedArea * 10) / 10,
      status: areaSignal?.status || 'unknown',
    },
    returnedToMarket: {
      label: 'Returned to Market',
      weight: SIGNAL_WEIGHTS.returnedToMarket,
      maxPoints: Math.round(100 * SIGNAL_WEIGHTS.returnedToMarket),
      earnedPoints: Math.round(earnedReturn * 10) / 10,
      status: returnSignal?.status || 'unknown',
    },
    dataCompleteness: {
      label: 'Data Completeness',
      weight: SIGNAL_WEIGHTS.dataCompleteness,
      maxPoints: Math.round(100 * SIGNAL_WEIGHTS.dataCompleteness),
      earnedPoints: Math.round(earnedCompleteness * 10) / 10,
      status: supportedCompletenessCount > 0 ? 'supported' : 'unknown',
    },
  };

  return {
    listingId: listing.id,
    generatedAt: new Date(now).toISOString(),
    triagePriority: roundedPriority,
    weights: SIGNAL_WEIGHTS,
    componentScores,
    signals,
    historyUnavailable,
    summary: {
      supported: signals.filter((s) => s.status === 'supported').length,
      unknown: signals.filter((s) => s.status === 'unknown').length,
      contradicted: signals.filter((s) => s.status === 'contradicted').length,
    },
    disclaimer: 'Triage priority only — not an appraisal, likelihood, or distress prediction.',
  };
}

module.exports = {
  evaluateOpportunitySignals,
  SIGNAL_WEIGHTS,
  CANONICAL_COMPLETENESS_SIGNALS,
  CANONICAL_COMPLETENESS_DENOMINATOR,
};
