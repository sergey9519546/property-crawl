const db = require('../db/client');
const { resolveWatchlistIdentity } = require('../security/workspace-identity');
const { generateInvestorDigestReport, dispatchInvestorAlertDigest } = require('../delivery/alert-digest');

const EMAIL_REGEX = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
const ALLOWED_CADENCES = ['instant', 'daily', 'weekly'];

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  return EMAIL_REGEX.test(trimmed);
}

function isValidState(state) {
  return typeof state === 'string' && /^[A-Za-z]{2}$/.test(state.trim());
}

function isValidCounty(county) {
  return typeof county === 'string' && county.trim().length > 0 && county.trim().length <= 64;
}

function resolveCadence(cadence) {
  if (cadence === undefined || cadence === null || cadence === '') return 'daily';
  if (typeof cadence !== 'string') return null;
  const lower = cadence.trim().toLowerCase();
  return ALLOWED_CADENCES.includes(lower) ? lower : null;
}

async function handleAlerts(req, res) {
  const method = req.method;
  const userId = resolveWatchlistIdentity(req, res);
  if (!userId) return;
  res.setHeader('Cache-Control', 'no-store');

  if (method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const saved = await db.getSavedDeals(userId);
    if (url.searchParams.get('format') === 'digest') {
      const evaluation = {
        results: saved.map((deal) => ({ identityKey: deal.id, listingId: deal.id, status: 'match' })),
        matches: saved.map((deal) => ({ listingId: deal.id, listing: deal })),
      };
      const digest = generateInvestorDigestReport({
        hunt: { id: `watchlist-${userId.slice(0, 8)}`, name: 'Watchlist Deals' },
        evaluation,
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
      const recipient = (recipientEmail || req.body?.recipient || req.body?.email || '').trim();
      const evaluation = {
        results: saved.map((deal) => ({ identityKey: deal.id, listingId: deal.id, status: 'match' })),
        matches: saved.map((deal) => ({ listingId: deal.id, listing: deal })),
      };
      const result = await dispatchInvestorAlertDigest({
        recipient,
        hunt: { id: `watchlist-${userId.slice(0, 8)}`, name: 'Watchlist Deals', notifyEmail: recipient },
        evaluation,
        listings: saved,
      });
      return res.json(result);
    }
    if (action === 'subscribe_county_digest') {
      const { email, state, county, cadence } = req.body || {};
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Valid email is required' });
      }
      if (!isValidState(state)) {
        return res.status(400).json({ error: 'Valid 2-letter state code is required' });
      }
      if (!isValidCounty(county)) {
        return res.status(400).json({ error: 'Valid county is required' });
      }
      const resolvedCadence = resolveCadence(cadence);
      if (!resolvedCadence) {
        return res.status(400).json({ error: 'Invalid cadence; must be instant, daily, or weekly' });
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanState = state.trim().toUpperCase();
      const cleanCounty = county.trim().toLowerCase();

      const search = await db.createSavedSearch(userId, {
        label: `${county.trim()}, ${cleanState} Digest`,
        filters: {
          states: [cleanState],
          counties: [cleanCounty],
          notifyEmail: cleanEmail,
          email: cleanEmail,
          cadence: resolvedCadence,
        },
      });

      return res.json({
        success: true,
        subscriptionId: search.id,
        message: `Subscribed to ${county}, ${state} alerts`,
      });
    }
    if (typeof listingId !== 'string' || !listingId || listingId.length > 256) return res.status(400).json({ error: 'listingId is required' });
    if (!await db.getListingById(listingId)) return res.status(404).json({ error: 'Listing not found' });
    await db.saveDeal(userId, listingId);
    return res.status(201).json({ success: true, message: 'Deal saved to watchlist' });
  }

  if (method === 'DELETE') {
    const url = new URL(req.url, 'http://localhost');
    const listingId = (req.body && typeof req.body.listingId === 'string' && req.body.listingId) || url.searchParams.get('listingId');
    if (typeof listingId !== 'string' || !listingId || listingId.length > 256) return res.status(400).json({ error: 'listingId is required' });
    await db.removeSavedDeal(userId, listingId);
    return res.json({ success: true, message: 'Deal removed from watchlist' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handleAlerts;
