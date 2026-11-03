const db = require('../db/client');
const { presentListing } = require('./listings');
const discovery = require('../discovery/query');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
const { buildPossessionDossier } = require('../intelligence/post-sale-possession');
const { calculateRequiredDeposit, getAuctionDepositRules } = require('../intelligence/escrow-optimizer');
const { calculateSurplusEquityWaterfall } = require('../intelligence/surplus-waterfall');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

function csvCell(value) {
  if (value === null || value === undefined || value === '') return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  text = text.replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${text}"` : text;
}

function neutralSource(value) {
  return String(value || '').replace(/servicelink(?:[\s_-]*auction)?/gi, 'Public Auction Network');
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function exportedCashRequirement(listing) {
  const details = listing?.cashToCloseDetails && typeof listing.cashToCloseDetails === 'object'
    ? listing.cashToCloseDetails
    : {};
  const basis = details.basis && typeof details.basis === 'object' ? details.basis : {};
  const supported = details.model === 'explicit-cash-requirements-v2'
    || (details.model === 'reported-cash-requirement-v1' && basis.totalAcquisitionCost);
  if (!supported) {
    return {
      status: 'unresolved',
      totalAcquisitionCost: null,
      registrationFunds: null,
      creditedDeposit: null,
      buyersPremium: null,
      sheriffPoundage: null,
      transferTax: null,
      delinquentTaxes: null,
      settlementCosts: null,
      cashDueAtSettlement: null,
      missingInputs: ['published terms or explicit assumptions']
    };
  }
  return {
    status: details.modelStatus || details.acquisitionCostStatus || 'reported',
    totalAcquisitionCost: numberOrNull(details.totalAcquisitionCost ?? details.totalCashToClose),
    registrationFunds: numberOrNull(details.registrationFunds),
    creditedDeposit: numberOrNull(details.creditedDeposit),
    buyersPremium: numberOrNull(details.buyersPremium),
    sheriffPoundage: numberOrNull(details.sheriffPoundage),
    transferTax: numberOrNull(details.transferTax),
    delinquentTaxes: numberOrNull(details.delinquentTaxes),
    settlementCosts: numberOrNull(details.settlementCosts ?? details.deedPrepAndRecording),
    cashDueAtSettlement: numberOrNull(details.cashDueAtSettlement),
    missingInputs: Array.isArray(details.missingInputs) ? details.missingInputs : []
  };
}

function publicExportListing(listing) {
  const presented = presentListing(listing);
  const fields = [
    'id', 'address', 'city', 'state', 'zip', 'county', 'sourceUrl', 'sourceObservedAt', 'fetchedAt',
    'openingBid', 'estLow', 'estHigh', 'assessed', 'saleDate', 'saleTime', 'saleTimezone', 'status', 'lifecycleStatus', 'lifecycle',
    'auctionProgram', 'program', 'transactionOutcome', 'auctionMethod', 'occupancy', 'interiorAccessAvailable', 'isCashOnly', 'isFinancible',
    'deposit', 'plaintiff', 'defendant', 'attorney', 'judgment', 'redemptionDays', 'seniorLienRisk',
    'propType', 'beds', 'baths', 'sqft', 'lotSize', 'year', 'yearBuilt', 'apn', 'parcelId', 'parcelNumber', 'caseNumber', 'lat', 'lng', 'photo',
    'hasDocuments', 'bidSpread', 'dealScore', 'sourceFreshness', 'discoveryStatus', 'evidenceCompleteness',
    'researchQuality', 'opportunity', 'identityKey',
  ];
  const exported = {};
  for (const field of fields) if (Object.hasOwn(presented, field)) exported[field] = presented[field];
  const provenance = presented.provenance && typeof presented.provenance === 'object'
    ? presented.provenance : {};
  const exportedProvenance = {};
  for (const field of ['origin', 'observed', 'recordKind', 'publisher', 'recordId', 'observedAt', 'exactSourceUrl']) {
    if (Object.hasOwn(provenance, field)) exportedProvenance[field] = provenance[field];
  }
  if (provenance.derivedFields && typeof provenance.derivedFields === 'object' && !Array.isArray(provenance.derivedFields)) {
    exportedProvenance.derivedFields = Object.fromEntries(Object.entries(provenance.derivedFields).slice(0, 100).map(([key, value]) => {
      if (value === true || typeof value === 'string') return [key, value];
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [key, true];
      const detail = {};
      for (const field of ['model', 'method', 'provider', 'basis', 'note']) {
        if (typeof value[field] === 'string') detail[field] = value[field];
      }
      if (Array.isArray(value.inputs)) detail.inputs = value.inputs.filter(item => typeof item === 'string').slice(0, 50);
      return [key, Object.keys(detail).length ? detail : true];
    }));
  }
  return {
    ...exported,
    source: neutralSource(presented.source),
    bidSpread: numberOrNull(presented.bidSpread ?? presented.equity),
    dealScore: numberOrNull(presented.dealScore),
    dealScoreMeaning: 'Opening amount versus supported valuation-range midpoint; triage only, not an appraisal.',
    cashRequirement: exportedCashRequirement(presented),
    provenance: exportedProvenance,
  };
}

function markdownDossier(listing) {
  const p = publicExportListing(listing);
  const cash = p.cashRequirement || {};
  const money = (val) => (val != null && Number.isFinite(Number(val)) ? `$${Math.round(Number(val)).toLocaleString('en-US')}` : 'Not published');
  const possession = buildPossessionDossier(p);

  return [
    `# DISTRESSED ASSET DOSSIER: ${p.address || 'Address Unspecified'}`,
    `**Listing ID:** \`${p.id}\` | **Location:** ${[p.city, p.county ? `${p.county} Co.` : '', p.state, p.zip].filter(Boolean).join(', ') || 'N/A'} | **Source Agency:** ${p.source}`,
    `**Docket / Case #:** ${p.caseNumber || 'Pending / Unspecified'} | **Observed:** ${p.sourceObservedAt || 'Recent'}`,
    '',
    '## 1. Statutory Auction & Filing Facts',
    `- **Opening Bid:** ${money(p.openingBid)}`,
    `- **Auction Date / Time:** ${[p.saleDate, p.saleTime, p.saleTimezone].filter(Boolean).join(' ') || 'Scheduled date pending'}`,
    `- **Lifecycle / Method:** ${p.lifecycleStatus || p.status || 'Active'} (${p.auctionMethod || 'Public Auction'})`,
    `- **Plaintiff:** ${p.plaintiff || 'Not specified'}`,
    `- **Defendant:** ${p.defendant || 'Not specified'}`,
    `- **Deposit Terms:** ${p.deposit || 'Statutory standard deposit required'}`,
    '',
    '## 2. Certified Valuation & Triage Benchmarks',
    `- **County Assessed Value:** ${money(p.assessed)}`,
    `- **Supported Valuation Range:** ${p.estLow != null && p.estHigh != null ? `${money(p.estLow)} - ${money(p.estHigh)}` : 'Unbenchmarked'}`,
    `- **Bid Spread:** ${money(p.bidSpread)}`,
    `- **Triage Deal Score:** ${p.dealScore != null ? `${p.dealScore}/99` : 'Unrated'} (${p.dealScoreMeaning})`,
    '',
    '## 3. Statutory Title & Lien Encumbrance Analysis',
    `- **Statutory Redemption Window:** ${p.redemptionDays != null ? `${p.redemptionDays} days post-sale` : 'No post-sale redemption published'}`,
    `- **Senior Lien Risk:** ${p.seniorLienRisk || 'Requires independent title abstract search'}`,
    `- **Federal Tax Lien Notice (26 U.S.C. § 7425):** 120-day IRS redemption right applies if federal notice was properly recorded.`,
    '',
    '## 4. Cash to Close & Statutory Settlement Requirements',
    `- **Settlement Status:** \`${cash.status || 'unresolved'}\``,
    `- **Total Acquisition Cash:** ${money(cash.totalAcquisitionCost)}`,
    `- **Registration Funds:** ${money(cash.registrationFunds)}`,
    `- **Credited Deposit:** ${money(cash.creditedDeposit)}`,
    `- **Buyer's Premium:** ${money(cash.buyersPremium)}`,
    `- **Sheriff / Trustee Poundage:** ${money(cash.sheriffPoundage)}`,
    `- **Transfer Tax:** ${money(cash.transferTax)}`,
    `- **Delinquent Taxes / Surviving Debt:** ${money(cash.delinquentTaxes)}`,
    `- **Cash Due at Settlement:** ${money(cash.cashDueAtSettlement)}`,
    cash.missingInputs && cash.missingInputs.length ? `- **Unresolved Inputs:** ${cash.missingInputs.join('; ')}` : '',
    '',
    '## 5. Post-Sale Possession & Title Clearance Timelines',
    `- **Quiet Title Action:** ${possession.quietTitle?.minDays != null ? `${possession.quietTitle.minDays}–${possession.quietTitle.maxDays} days (${possession.quietTitle.statutory})` : 'N/A or not required for direct deed'}`,
    `- **Writ of Possession / Eviction:** ${possession.writOfPossession?.minDays != null ? `${possession.writOfPossession.minDays}–${possession.writOfPossession.maxDays} days (${possession.writOfPossession.statutory})` : 'Statutory timeline unencoded'}`,
    `- **Holding Carry Basis:** ${possession.carryCost?.basis || 'Zero-Fabrication: requires observed parcel taxes and insurance'}`,
    '',
    '## 6. Cryptographic Provenance & Evidence Verification',
    `- **Publisher Origin:** \`${p.provenance?.origin || 'live'}\``,
    `- **Observed:** \`${p.provenance?.observed ? 'True' : 'Unconfirmed'}\``,
    `- **Exact Source URL:** ${p.sourceUrl || 'Archived'}`,
    '',
    '---',
    ''
  ].filter(line => line !== undefined).join('\n');
}

async function* exportPages(url, userId) {
  if (userId) {
    yield await db.getSavedDeals(userId);
  } else {
    url.searchParams.delete('cursor');
    url.searchParams.delete('offset');
    url.searchParams.set('limit','1000');
    const query = { ...discovery.queryFromUrl(url), facets: [] };
    let page = await discovery.search(db,query);
    if (page.total > 100000) throw new discovery.DiscoveryQueryError(413, 'This export exceeds 100,000 records. Narrow the filters.');
    yield page.listings;
    while(page.page.hasMore) {
      page = await discovery.search(db,{...query,cursor:page.page.nextCursor});
      yield page.listings;
    }
  }
}

const CSV_HEADERS = ['ID', 'Address', 'City', 'State', 'ZIP', 'Source', 'Opening Bid', 'Est Low', 'Est High', 'Bid Spread', 'Deal Score (1-99, triage only)', 'Cash Requirement Status', 'Total Acquisition Cash', 'Registration Funds', 'Credited Deposit', "Buyer's Premium", 'Sheriff / Trustee Fee', 'Transfer Tax', 'Delinquent Taxes / Surviving Debt', 'Other Settlement Costs', 'Cash Due at Settlement', 'Unresolved Cash Inputs', 'Redemption Days', 'Senior Lien Risk', 'Sale Date', 'Plaintiff', 'Defendant', 'Deposit Terms'];

function csvRow(l) {
  const cash = exportedCashRequirement(l);
  return [
    l.id,
    l.address,
    l.city,
    l.state,
    l.zip,
    neutralSource(l.source),
    l.openingBid,
    l.estLow,
    l.estHigh,
    l.bidSpread ?? l.equity,
    l.dealScore,
    cash.status,
    cash.totalAcquisitionCost,
    cash.registrationFunds,
    cash.creditedDeposit,
    cash.buyersPremium,
    cash.sheriffPoundage,
    cash.transferTax,
    cash.delinquentTaxes,
    cash.settlementCosts,
    cash.cashDueAtSettlement,
    cash.missingInputs.join('; '),
    l.redemptionDays,
    l.seniorLienRisk,
    l.saleDate,
    l.plaintiff,
    l.defendant,
    l.deposit,
  ].map(csvCell).join(',');
}

async function handleExport(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const format = url.searchParams.get('format') || 'csv';
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET to export discovery results' });
  const isMarkdown = format === 'markdown' || format === 'dossier';
  if (!['csv', 'json', 'markdown', 'dossier'].includes(format)) {
    return res.status(400).json({ error: 'Choose csv, json, or markdown format' });
  }
  const userId = requireWorkspaceIdentity(req, res);
  if (!userId) return;
  const saved = url.searchParams.get('saved') === 'true' || url.searchParams.has('userId') || Boolean(req.headers['x-user-id']);
  let directory, file;
  try {
    const base = path.resolve(__dirname, '../../.cache/discovery-exports');
    await fs.promises.mkdir(base, { recursive: true });
    directory = await fs.promises.mkdtemp(path.join(base, 'request-'));
    const filename = path.join(directory, 'export');
    file = await fs.promises.open(filename, 'wx', 0o600);

    const initialContent = format === 'json'
      ? '['
      : isMarkdown
        ? '# PERFECTPROPERTY INSTITUTIONAL UNDERWRITING DOSSIERS\n\n'
        : CSV_HEADERS.join(',');
    await file.writeFile(initialContent);

    let count = 0, bytes = 0;
    for await (const page of exportPages(url, saved ? userId : null)) {
      if (req.aborted) throw new Error('Export request was aborted');
      let content = '';
      if (format === 'json') {
        content = (count && page.length ? ',' : '') + page.map(item => JSON.stringify(publicExportListing(item))).join(',');
      } else if (isMarkdown) {
        content = page.map(item => markdownDossier(item)).join('\n');
      } else {
        content = page.map(item => '\r\n' + csvRow(item)).join('');
      }
      count += page.length;
      bytes += Buffer.byteLength(content);
      if (count > 100000 || bytes > 512 * 1024 * 1024) throw new discovery.DiscoveryQueryError(413, 'Export is too large. Narrow the filters.');
      await file.writeFile(content);
    }
    if (format === 'json') await file.writeFile(']');
    await file.close();
    file = null;

    // Spool before headers so a changed revision returns an explicit 409, never
    // a partially valid download. Memory stays bounded by one query page.
    res.setHeader('Cache-Control', 'no-store');
    const contentType = format === 'json'
      ? 'application/json'
      : isMarkdown
        ? 'text/markdown; charset=utf-8'
        : 'text/csv; charset=utf-8';
    const extension = format === 'json' ? 'json' : isMarkdown ? 'md' : 'csv';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="perfectproperty_export.${extension}"`);
    if (typeof res.write === 'function') await pipeline(fs.createReadStream(filename), res);
    else return res.send(await fs.promises.readFile(filename, 'utf8'));
  } catch (error) {
    if (res.headersSent) res.destroy?.(error);
    else return res.status(error.status || 503).json({ error: error.status ? error.message : 'Export temporarily unavailable. Retry with the current inventory revision.' });
  } finally {
    if (file) await file.close();
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

module.exports = handleExport;
module.exports.csvCell = csvCell;
module.exports.publicExportListing = publicExportListing;
module.exports.exportedCashRequirement = exportedCashRequirement;
module.exports.markdownDossier = markdownDossier;
