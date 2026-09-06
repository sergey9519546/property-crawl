const db = require('../db/client');
const SecuritySanitizer = require('../security/sanitizer');

const SUMMARY_MODEL = 'evidence-summary-v1';

function hasValue(value) {
  return value !== null && value !== undefined
    && (typeof value !== 'string' || value.trim() !== '');
}

function safeText(value) {
  return SecuritySanitizer.escapeHtml(String(value).replace(/\s+/g, ' ').trim());
}

function amount(value) {
  if (!hasValue(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return `$${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function addObserved(lines, label, value) {
  if (hasValue(value)) lines.push(`- ${label}: **${safeText(value)}**`);
}

function buildEvidenceSummary(listing) {
  const observed = [];
  const gaps = [];
  const provenance = listing.provenance && typeof listing.provenance === 'object'
    ? listing.provenance
    : {};

  addObserved(observed, 'Address', listing.address);
  addObserved(observed, 'Source', listing.source);
  addObserved(observed, 'Source record URL', listing.sourceUrl);

  const openingBid = amount(listing.openingBid);
  if (openingBid) addObserved(observed, 'Opening-bid field', openingBid);
  else gaps.push('Opening bid: not present in the listing record; obtain the current published amount before underwriting.');

  const estLow = amount(listing.estLow);
  const estHigh = amount(listing.estHigh);
  if (estLow && estHigh) addObserved(observed, 'Valuation-range fields', `${estLow}–${estHigh}`);
  else gaps.push('Valuation evidence: a complete estimate range is not present; obtain independent comparable-sales or appraisal support.');

  const assessed = amount(listing.assessed);
  if (assessed) addObserved(observed, 'Assessed-value field', assessed);
  addObserved(observed, 'Sale date field', listing.saleDate);
  addObserved(observed, 'Occupancy field', listing.occupancy);
  addObserved(observed, 'Deposit-terms field', listing.deposit);
  addObserved(observed, 'Plaintiff field', listing.plaintiff);
  addObserved(observed, 'Defendant field', listing.defendant);
  const judgment = amount(listing.judgment);
  if (judgment) addObserved(observed, 'Judgment-amount field', judgment);
  addObserved(observed, 'Status field', listing.status);
  addObserved(observed, 'Source-observed timestamp', listing.sourceObservedAt);
  addObserved(observed, 'Fetched timestamp', listing.fetchedAt);

  addObserved(observed, 'Source property ID', provenance.propertyId);
  addObserved(observed, 'Source sheriff number', provenance.sheriffNumber);
  addObserved(observed, 'Source-reported court case number', provenance.courtCaseNumber);
  addObserved(observed, 'Source parcel number', provenance.parcelNumber);
  addObserved(observed, 'Opening-bid source', provenance.openingBidSource);

  if (!hasValue(listing.sourceUrl)) {
    gaps.push('Exact source record: no direct record URL is attached; locate the publisher record before relying on any field.');
  }
  if (!hasValue(listing.saleDate)) {
    gaps.push('Sale schedule: not present; confirm status, date, time, postponements, and cancellation directly with the publisher.');
  }
  if (!hasValue(listing.deposit)) {
    gaps.push('Deposit and payment terms: not present; verify amount, form of funds, deadline, premiums, and fees.');
  }
  if (!hasValue(listing.occupancy)) {
    gaps.push('Occupancy and access: not present; do not infer vacancy, possession, or inspection rights.');
  }

  gaps.push('Court evidence: no official docket response is attached; verify the case, parties, sale order, and current status.');
  gaps.push('Title evidence: no recorder search or title commitment is attached; verify ownership, lien priority, surviving interests, and deed type.');
  gaps.push('Tax and municipal evidence: no current official balances are attached; verify taxes, assessments, utilities, and code obligations.');
  gaps.push('Condition evidence: interior condition and material property defects are not verified by this summary.');

  return `**Evidence summary — unverified**

**Observed listing fields**
${observed.join('\n')}

**Unknown or verification required**
${gaps.map((gap) => `- ${gap}`).join('\n')}

This deterministic summary reports stored fields only. It is not a title search, legal opinion, appraisal, condition report, or bid recommendation.`;
}

async function handleEnrich(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { listingId } = req.body || {};
  if (!listingId) {
    return res.status(400).json({ error: 'listingId is required' });
  }

  const listing = await db.getListingById(listingId);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  return res.json({
    analysis: buildEvidenceSummary(listing),
    cached: false,
    model: SUMMARY_MODEL,
    costUsd: 0,
    verified: false,
  });
}

module.exports = handleEnrich;
module.exports.buildEvidenceSummary = buildEvidenceSummary;
module.exports.SUMMARY_MODEL = SUMMARY_MODEL;
