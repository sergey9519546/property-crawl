const db = require('../db/client');
const AiCache = require('../ai/cache');
const ModelRouter = require('../ai/model_router');
const { CostTracker } = require('../ai/cost_tracker');
const SecuritySanitizer = require('../security/sanitizer');

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

  const model = ModelRouter.selectModel({ taskType: 'deal_analysis' });
  const promptKey = `deal_analysis:${listing.id}:${listing.openingBid}`;

  const cached = await AiCache.get(promptKey, model);
  if (cached) {
    return res.json({ analysis: cached, cached: true, model });
  }

  const safeDeposit = SecuritySanitizer.escapeHtml(String(listing.deposit || 'Certified funds'));
  const safeOccupancy = SecuritySanitizer.escapeHtml(String(listing.occupancy || 'Unknown'));
  const safePlaintiff = SecuritySanitizer.escapeHtml(String(listing.plaintiff || '—'));

  const bidText = listing.openingBid ? `$${listing.openingBid.toLocaleString()}` : 'TBD';
  const estText = (listing.estLow && listing.estHigh) 
    ? `$${listing.estLow.toLocaleString()}–$${listing.estHigh.toLocaleString()}` 
    : 'market';
  
  const analysisText = `**Primary catch:** Opening bid of ${bidText} represents a substantial built-in spread against the estimated ${estText} value band (Deal Score: ${listing.dealScore || 'N/A'}/100), but requires immediate **${safeDeposit}** and carries potential unpaid municipal liens.

**Occupancy & title:** The property is listed as **${safeOccupancy}**. Buyer takes title subject to standard foreclosure deed terms with no warranty on internal condition. Recommended for experienced bidders who have inspected the exterior and verified court docket ${safePlaintiff}.`;

  const cost = CostTracker.calculateCost(model, 350, 180);
  await AiCache.set(promptKey, model, analysisText, 350, 180, cost, 'deal_analysis');

  return res.json({
    analysis: analysisText,
    cached: false,
    model,
    costUsd: cost
  });
}

module.exports = handleEnrich;
