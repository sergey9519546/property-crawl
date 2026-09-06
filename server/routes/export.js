const db = require('../db/client');
const { presentListing } = require('./listings');
const discovery = require('../discovery/query');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');

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
  const { equity, cashToClose, cashToCloseDetails, source, ...rest } = presented;
  return {
    ...rest,
    source: neutralSource(source),
    bidSpread: numberOrNull(presented.bidSpread ?? equity),
    dealScore: numberOrNull(presented.dealScore),
    dealScoreMeaning: 'Opening amount versus supported valuation-range midpoint; triage only, not an appraisal.',
    cashRequirement: exportedCashRequirement({ ...presented, cashToClose, cashToCloseDetails })
  };
}

async function handleExport(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const format = url.searchParams.get('format') || 'csv';
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET to export discovery results' });
  if (!['csv','json'].includes(format)) return res.status(400).json({ error: 'Choose csv or json format' });
  const saved = url.searchParams.get('saved') === 'true' || url.searchParams.has('userId') || Boolean(req.headers['x-user-id']);
  const userId = saved ? requireWorkspaceIdentity(req, res) : null;
  if (saved && !userId) return;

  let items = [];
  if (userId) {
    items = await db.getSavedDeals(userId);
  } else {
    url.searchParams.delete('cursor');
    url.searchParams.delete('offset');
    url.searchParams.set('limit','1000');
    const query = discovery.queryFromUrl(url);
    let page = await discovery.search(db,query);
    if (page.total > 100000) return res.status(413).json({ error: 'This export exceeds 100,000 records. Narrow the filters.' });
    items = page.listings;
    while(page.page.hasMore) {
      page = await discovery.search(db,{...query,cursor:page.page.nextCursor});
      items.push(...page.listings);
    }
  }
  res.setHeader('Cache-Control','no-store');

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="perfectproperty_export.json"');
    return res.send(JSON.stringify(items.map(publicExportListing), null, 2));
  }

  // CSV
  const headers = ['ID', 'Address', 'City', 'State', 'ZIP', 'Source', 'Opening Bid', 'Est Low', 'Est High', 'Bid Spread', 'Deal Score (1-99, triage only)', 'Cash Requirement Status', 'Total Acquisition Cash', 'Registration Funds', 'Credited Deposit', "Buyer's Premium", 'Sheriff / Trustee Fee', 'Transfer Tax', 'Delinquent Taxes / Surviving Debt', 'Other Settlement Costs', 'Cash Due at Settlement', 'Unresolved Cash Inputs', 'Redemption Days', 'Senior Lien Risk', 'Sale Date', 'Plaintiff', 'Defendant', 'Deposit Terms'];
  const rows = items.map((l) => {
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
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="perfectproperty_export.csv"');
  return res.send(csvContent);
}

module.exports = handleExport;
module.exports.csvCell = csvCell;
module.exports.publicExportListing = publicExportListing;
module.exports.exportedCashRequirement = exportedCashRequirement;
