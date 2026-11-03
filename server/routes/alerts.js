const db = require('../db/client');
const { resolveWatchlistIdentity } = require('../security/workspace-identity');
const { generateInvestorDigestReport, dispatchInvestorAlertDigest } = require('../delivery/alert-digest');

async function handleAlerts(req, res) {
  const method = req.method;
  const userId = resolveWatchlistIdentity(req, res);
  if (!userId) return;
  res.setHeader('Cache-Control', 'no-store');

  if (method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const saved = await db.getSavedDeals(userId);
    if (url.searchParams.get('format') === 'digest') {
      const digest = generateInvestorDigestReport({
        hunt: { id: `watchlist-${userId.slice(0, 8)}`, name: 'Watchlist Deals' },
        evaluation: { matches: saved.map((deal) => ({ listingId: deal.id, listing: deal })) },
        listings: saved,
      });
      return res.json(digest);
    }
    return res.json({ savedCount: saved.length, deals: saved });
  }

  if (method === 'POST') {
    const { listingId, action, recipientEmail } = req.body || {};
    if (action === 'dispatch_digest') {
      const saved = await db.getSavedDeals(userId);
      const result = await dispatchInvestorAlertDigest({
        hunt: { id: `watchlist-${userId.slice(0, 8)}`, name: 'Watchlist Deals', notifyEmail: recipientEmail },
        evaluation: { matches: saved.map((deal) => ({ listingId: deal.id, listing: deal })) },
        listings: saved,
      });
      return res.json(result);
    }
    if (typeof listingId !== 'string' || !listingId || listingId.length > 256) return res.status(400).json({ error: 'listingId is required' });
    if (!await db.getListingById(listingId)) return res.status(404).json({ error: 'Listing not found' });
    await db.saveDeal(userId, listingId);
    return res.status(201).json({ success: true, message: 'Deal saved to watchlist' });
  }

  if (method === 'DELETE') {
    const { listingId } = req.body || {};
    if (typeof listingId !== 'string' || !listingId || listingId.length > 256) return res.status(400).json({ error: 'listingId is required' });
    await db.removeSavedDeal(userId, listingId);
    return res.json({ success: true, message: 'Deal removed from watchlist' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handleAlerts;
