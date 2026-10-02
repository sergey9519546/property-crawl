'use strict';
const db = require('../db/client');
const { loadObservations } = require('../sources/observations');
const { evaluateOpportunitySignals } = require('../intelligence/signals');

function createPropertySignalsHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const readHistory = dependencies.loadObservations || loadObservations;

  return async function handlePropertySignals(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: 'Use GET or POST to evaluate property opportunity signals' });
    }

    const url = new URL(req.url, 'http://localhost');
    const id = req.method === 'GET' ? url.searchParams.get('listingId') : req.body?.listingId;
    if (typeof id !== 'string' || !id.trim() || id.length > 160) {
      return res.status(400).json({ error: 'A listing ID is required' });
    }

    try {
      const listing = await database.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });

      let observations = { records: {}, signals: [] };
      // A store that cannot be read is not the same as a store with no
      // history. Sibling routes (source-network, property-intelligence,
      // workspace) all report this; swallowing it here would let the
      // evaluation assert "no bid reduction observed" without ever looking.
      let historyUnavailable = false;
      try {
        observations = readHistory();
      } catch (_) {
        historyUnavailable = true;
      }

      const evaluation = evaluateOpportunitySignals(listing, { observations, historyUnavailable });
      return res.json(evaluation);
    } catch (error) {
      console.error('[Property Signals]', error.message);
      return res.status(503).json({ error: 'Opportunity signal evaluation is temporarily unavailable.' });
    }
  };
}

module.exports = createPropertySignalsHandler();
module.exports.createPropertySignalsHandler = createPropertySignalsHandler;
