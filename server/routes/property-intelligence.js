const db = require('../db/client');
const { createHash } = require('node:crypto');
const { loadObservations } = require('../sources/observations');
const { buildPropertyDossier } = require('../intelligence/dossier');
const { validateListingForIngestion } = require('../scrapers/validation');

function createPropertyIntelligenceHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const readHistory = dependencies.loadObservations || loadObservations;
  const publicRecords = dependencies.buildPublicRecordEvidence || ((listing) => require('../public-records').buildPublicRecordEvidence(listing, { allowNetwork: true, timeoutMs: 7000 }));
  const cache = new Map();
  const inFlight = new Map();
  return async function handlePropertyIntelligence(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Use GET to inspect or POST to research a property' });
    const url = new URL(req.url, 'http://localhost');
    const id = req.method === 'GET' ? url.searchParams.get('listingId') : req.body?.listingId;
    if (typeof id !== 'string' || !id.trim() || id.length > 160) return res.status(400).json({ error: 'A listing ID is required' });
    try {
      const listing = await database.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      const verified = listing.provenance?.origin === 'live' && validateListingForIngestion(listing).isValid
        && Date.parse(listing.sourceObservedAt || listing.provenance?.observedAt) <= Date.now() + 300_000;
      if (req.method === 'POST' && !verified) return res.status(422).json({ error: 'Public-record research requires a validated source-observed property record' });
      // Research belongs to this exact evidence and lookup input, even when an
      // upstream correction accidentally retains an observation timestamp.
      const key = createHash('sha256').update(JSON.stringify(listing)).digest('hex');
      let evidence = cache.get(key);
      if (!verified) evidence = null;
      if (evidence && Date.now() - evidence.savedAt > 3600_000) { cache.delete(key); evidence = null; }
      if (req.method === 'POST' && !evidence) {
        if (!inFlight.has(key) && inFlight.size >= 2) return res.status(429).json({ error: 'Two property investigations are already running. Retry shortly.' });
        if (!inFlight.has(key)) {
          const work = Promise.resolve().then(() => publicRecords(listing)).then((result) => {
            if (cache.size >= 100) cache.delete(cache.keys().next().value);
            const entry = { savedAt: Date.now(), result }; cache.set(key, entry); return entry;
          }).finally(() => inFlight.delete(key));
          inFlight.set(key, work);
        }
        evidence = await inFlight.get(key);
      }
      let observations = { records: {}, signals: [] }, historyUnavailable = false;
      try { observations = readHistory(); } catch (_) { historyUnavailable = true; }
      return res.json({ ...buildPropertyDossier(listing, { observations, publicRecords: evidence?.result || null }), historyUnavailable });
    } catch (error) {
      console.error('[Property Intelligence]', error.message);
      return res.status(503).json({ error: 'Property research is temporarily unavailable. Stored listing evidence was preserved.' });
    }
  };
}

module.exports = createPropertyIntelligenceHandler();
module.exports.createPropertyIntelligenceHandler = createPropertyIntelligenceHandler;
