const db = require('../db/client');
const { presentListing } = require('./listings');
const discovery = require('../discovery/query');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
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
  if (!['csv','json'].includes(format)) return res.status(400).json({ error: 'Choose csv or json format' });
  const saved = url.searchParams.get('saved') === 'true' || url.searchParams.has('userId') || Boolean(req.headers['x-user-id']);
  const userId = saved ? requireWorkspaceIdentity(req, res) : null;
  if (saved && !userId) return;
  let directory, file;
  try {
    const base=path.resolve(__dirname,'../../.cache/discovery-exports');
    await fs.promises.mkdir(base,{recursive:true});
    directory=await fs.promises.mkdtemp(path.join(base,'request-'));
    const filename=path.join(directory,'export');
    file=await fs.promises.open(filename,'wx',0o600);
    await file.writeFile(format==='json'?'[':CSV_HEADERS.join(','));
    let count=0, bytes=0;
    for await (const page of exportPages(url,userId)) {
      if(req.aborted) throw new Error('Export request was aborted');
      const content=format==='json'
        ? (count && page.length?',':'')+page.map(item=>JSON.stringify(publicExportListing(item))).join(',')
        : page.map(item=>'\r\n'+csvRow(item)).join('');
      count+=page.length; bytes+=Buffer.byteLength(content);
      if(count>100000 || bytes>512*1024*1024) throw new discovery.DiscoveryQueryError(413,'Export is too large. Narrow the filters.');
      await file.writeFile(content);
    }
    if(format==='json')await file.writeFile(']');
    await file.close();file=null;
    // Spool before headers so a changed revision returns an explicit 409, never
    // a partially valid download. Memory stays bounded by one query page.
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',format==='json'?'application/json':'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="perfectproperty_export.${format}"`);
    if(typeof res.write==='function') await pipeline(fs.createReadStream(filename),res);
    else return res.send(await fs.promises.readFile(filename,'utf8'));
  } catch(error) {
    if(res.headersSent)res.destroy?.(error);
    else return res.status(error.status || 503).json({error:error.status?error.message:'Export temporarily unavailable. Retry with the current inventory revision.'});
  } finally {
    if(file)await file.close();
    if(directory)await fs.promises.rm(directory,{recursive:true,force:true});
  }
}

module.exports = handleExport;
module.exports.csvCell = csvCell;
module.exports.publicExportListing = publicExportListing;
module.exports.exportedCashRequirement = exportedCashRequirement;
