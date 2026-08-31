const db = require('../db/client');

async function handleAlerts(req, res) {
  const method = req.method;
  const url = new URL(req.url, 'http://localhost');
  const userId = req.headers['x-user-id'] || url.searchParams.get('userId') || 'guest_user';

  if (method === 'GET') {
    const saved = await db.getSavedDeals(userId);
    return res.json({ userId, savedCount: saved.length, deals: saved });
  }

  if (method === 'POST') {
    const { listingId } = req.body || {};
    if (!listingId) return res.status(400).json({ error: 'listingId is required' });
    await db.saveDeal(userId, listingId);
    return res.status(201).json({ success: true, message: 'Deal saved to watchlist' });
  }

  if (method === 'DELETE') {
    const { listingId } = req.body || {};
    if (!listingId) return res.status(400).json({ error: 'listingId is required' });
    await db.removeSavedDeal(userId, listingId);
    return res.json({ success: true, message: 'Deal removed from watchlist' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handleAlerts;
